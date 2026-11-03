import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, cpSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { migrate } from '../../src/store/migrate.js';
import { saveDocument } from '../../src/store/content.js';
import { startApp } from '../../src/app/server.js';
import { postsUsing, cookSupportsPackages } from '../../src/app/components.js';
import { commitPaths as realCommitPaths } from '../../src/git/git.js';
import { makeGitSite, fakeClock, git, write } from './git-site-fixture.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/components');

const hint = (tag, extra = {}) => ({
  tag, label: tag, icon: 'x', description: tag, group: 'Test', kind: 'none', defaults: {}, advanced: [], ...extra,
});
const catalog = [
  { package: 'x-widgets', elements: [hint('x-one'), hint('x-two')] },
  { package: '@x/scoped', elements: [hint('x-scoped')] },
  { package: 'x-other', elements: [hint('x-three')] },
  { package: 'x-bundled', bundled: true, elements: [hint('x-four')] },
];

function install(dir, name, fixture = 'x-widgets') {
  const dest = join(dir, 'node_modules', name);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(join(FIX, fixture), dest, { recursive: true });
}

const readPkg = (dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
const writePkg = (dir, pkg) => writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2));
const head = (dir) => git(dir, 'rev-parse', 'HEAD');
/** The newest commit whose subject starts with `subject`, and its files. */
const commitFiles = (dir, rev) => git(dir, 'show', '--name-only', '--format=', rev).split('\n').filter(Boolean).sort();
const componentsCommit = (dir, ref = 'HEAD') => git(dir, 'log', '-1', '--grep=^Components:', '--format=%H %s', ref);

/** A stub npm that edits package.json and the lock as npm would; `fail` makes it exit 1 after writing. */
function fakeNpm({ fail = false } = {}) {
  const calls = [];
  const run = async (dir, args) => {
    calls.push(args);
    const pkg = readPkg(dir);
    pkg.dependencies ??= {};
    const [cmd, spec] = args;
    const name = cmd === 'install' ? spec.replace(/@[^@/]*$/, '') : spec;
    if (cmd === 'install') {
      pkg.dependencies[name] = '^1.2.0';
      install(dir, name);
    } else {
      delete pkg.dependencies[name];
      rmSync(join(dir, 'node_modules', name), { recursive: true, force: true });
    }
    writePkg(dir, pkg);
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ name: 'site', lockfileVersion: 3, packages: { [name]: {} } }));
    if (fail) return { ok: false, log: 'npm http fetch GET 404\nnpm ERR! code E404\nnpm ERR! 404 Not Found - x-widgets' };
    return { ok: true, log: 'added 1 package' };
  };
  return { calls, run };
}

describe('site components API', () => {
  let fx, app, siteId, vpRoot, npm, clock;

  async function api(path, { method = 'GET', body } = {}) {
    const opts = { method };
    if (body !== undefined) {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`${app.url}${path}`, opts);
    const text = await res.text();
    let data = text;
    try { data = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, data, headers: res.headers };
  }

  /** A git site plus a VP root with x-widgets installed; `prepare(site)` runs before the commit. */
  async function open({ npmOpts, prepare, gitOverrides } = {}) {
    fx = makeGitSite();
    vpRoot = join(fx.root, 'vp');
    mkdirSync(vpRoot);
    writePkg(vpRoot, { name: 'vp', dependencies: { 'x-widgets': '^1.0.0', '@x/scoped': '~0.3.1' } });
    install(vpRoot, 'x-widgets');
    install(vpRoot, '@x/scoped');
    if (prepare) {
      prepare(fx.site);
      git(fx.site, 'add', '-A');
      git(fx.site, 'commit', '-m', 'prepare');
      git(fx.site, 'push');
    }
    npm = fakeNpm(npmOpts);
    clock = fakeClock();
    app = await startApp({
      port: 0,
      env: { VP_CONFIG_DIR: join(fx.root, 'vp-config') },
      previews: { start() {}, stop: async () => {}, stopAll: async () => {} },
      siteProcess: { runNpm: npm.run },
      git: gitOverrides,
      backup: { now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer },
      components: { catalog, vpRoot },
    });
    const added = await api('/api/sites', { method: 'POST', body: { path: fx.site } });
    assert.equal(added.status, 201, JSON.stringify(added.data));
    siteId = added.data.id;
  }

  afterEach(async () => {
    await app?.close();
    app = null;
    if (fx) rmSync(fx.root, { recursive: true, force: true });
    fx = null;
  });

  const put = (pkg, enabled) => api(`/api/sites/${siteId}/components/${encodeURIComponent(pkg)}`, { method: 'PUT', body: { enabled } });
  const draft = (title, blocks) => api(`/api/sites/${siteId}/documents`, {
    method: 'POST', body: { meta: { title, slug: title.toLowerCase().replace(/\W+/g, '-'), collection: 'posts' }, blocks },
  });

  it('enable adds the dependency, commits only package files with [CI Skip]', async () => {
    await open();
    // An unsaved draft backup is pending in content/: it must stay out of this commit.
    const d = await draft('Plain', [{ type: 'paragraph', children: [{ type: 'text', value: 'Hi.' }] }]);
    assert.equal(d.status, 201, JSON.stringify(d.data));
    const res = await put('x-widgets', true);
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.deepEqual(npm.calls, [['install', 'x-widgets@^1.0.0', '--save']]);
    assert.equal(res.data.package, 'x-widgets');
    assert.equal(res.data.enabled, true);
    assert.equal(res.data.source, 'site');
    assert.equal(readPkg(fx.site).dependencies['x-widgets'], '^1.2.0');
    const [sha, ...subject] = componentsCommit(fx.site).split(' ');
    assert.equal(subject.join(' '), 'Components: turn on x-widgets [CI Skip]');
    assert.deepEqual(commitFiles(fx.site, sha), ['package-lock.json', 'package.json']);
    // The backup flush pushed it (with the pending draft, in its own commit).
    assert.equal(git(fx.remote, 'rev-parse', 'main'), head(fx.site));
    assert.equal(componentsCommit(fx.remote, 'main').split(' ')[0], sha);
    // The scoped package uses VP's own range too.
    const scoped = await put('@x/scoped', true);
    assert.equal(scoped.status, 200, JSON.stringify(scoped.data));
    assert.deepEqual(npm.calls[1], ['install', '@x/scoped@~0.3.1', '--save']);
  });

  it('disable uninstalls and commits turn off', async () => {
    await open({ prepare: (site) => writePkg(site, { ...readPkg(site), dependencies: { 'x-widgets': '^1.2.0' } }) });
    const res = await put('x-widgets', false);
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.deepEqual(npm.calls, [['uninstall', 'x-widgets']]);
    assert.equal(res.data.enabled, false);
    assert.equal(git(fx.site, 'log', '-1', '--format=%s'), 'Components: turn off x-widgets [CI Skip]');
  });

  it('refuses enable when package.json is dirty', async () => {
    await open();
    const before = head(fx.site);
    const dirty = readFileSync(join(fx.site, 'package.json'), 'utf8') + '\n';
    writeFileSync(join(fx.site, 'package.json'), dirty);
    const res = await put('x-widgets', true);
    assert.equal(res.status, 409);
    assert.equal(res.data.error, "package.json has changes that aren't committed. Commit or discard them, then try again.");
    assert.equal(readFileSync(join(fx.site, 'package.json'), 'utf8'), dirty);
    assert.equal(head(fx.site), before);
    assert.deepEqual(npm.calls, []);
  });

  it('failed install restores package files', async () => {
    const lock = '{"name":"site","lockfileVersion":3}\n';
    await open({ npmOpts: { fail: true }, prepare: (site) => write(site, 'package-lock.json', lock) });
    const pkgBefore = readFileSync(join(fx.site, 'package.json'));
    const before = head(fx.site);
    const res = await put('x-widgets', true);
    assert.equal(res.status, 502);
    assert.match(res.data.error, /npm/);
    assert.match(res.data.log, /npm ERR! 404 Not Found/);
    assert.deepEqual(readFileSync(join(fx.site, 'package.json')), pkgBefore);
    assert.equal(readFileSync(join(fx.site, 'package-lock.json'), 'utf8'), lock);
    assert.equal(head(fx.site), before);
    assert.equal(git(fx.site, 'status', '--porcelain', '--', 'package.json', 'package-lock.json'), '');
  });

  it('a failed commit after npm puts the package files back, says what to do, and a later toggle works', async () => {
    let failCommit = true;
    const commitPaths = async (dir, paths, message) => {
      if (failCommit && typeof message === 'string' && message.startsWith('Components:')) {
        const err = new Error("fatal: Unable to create '.git/index.lock': File exists.");
        err.name = 'GitError';
        throw err;
      }
      return realCommitPaths(dir, paths, message);
    };
    const lock = '{"name":"site","lockfileVersion":3}\n';
    await open({ prepare: (site) => write(site, 'package-lock.json', lock), gitOverrides: { commitPaths } });
    const pkgBefore = readFileSync(join(fx.site, 'package.json'));
    const before = head(fx.site);
    const res = await put('x-widgets', true);
    assert.equal(res.status, 502, JSON.stringify(res.data));
    assert.match(res.data.error, /couldn't commit/i);
    assert.match(res.data.error, /index\.lock/);
    assert.match(res.data.error, /Close other git tools and try again\./);
    assert.deepEqual(readFileSync(join(fx.site, 'package.json')), pkgBefore);
    assert.equal(readFileSync(join(fx.site, 'package-lock.json'), 'utf8'), lock);
    assert.equal(head(fx.site), before);
    assert.equal(git(fx.site, 'status', '--porcelain', '--', 'package.json', 'package-lock.json'), '');
    const state = await api(`/api/sites/${siteId}/components`);
    assert.equal(state.data.packages.find((p) => p.package === 'x-widgets').enabled, false);

    failCommit = false;
    const again = await put('x-widgets', true);
    assert.equal(again.status, 200, JSON.stringify(again.data));
    assert.equal(again.data.enabled, true);
    assert.equal(componentsCommit(fx.site).split(' ').slice(1).join(' '), 'Components: turn on x-widgets [CI Skip]');
  });

  it('a dependency in package.json but not committed is not "already on": the dirty guard answers', async () => {
    await open();
    writePkg(fx.site, { ...readPkg(fx.site), dependencies: { 'x-widgets': '^1.2.0' } });
    const before = head(fx.site);
    const res = await put('x-widgets', true);
    assert.equal(res.status, 409, JSON.stringify(res.data));
    assert.equal(res.data.error, "package.json has changes that aren't committed. Commit or discard them, then try again.");
    assert.deepEqual(npm.calls, []);
    assert.equal(head(fx.site), before);
  });

  it('a failed install with no lock before leaves no lock', async () => {
    await open({ npmOpts: { fail: true } });
    const res = await put('x-widgets', true);
    assert.equal(res.status, 502);
    assert.equal(existsSync(join(fx.site, 'package-lock.json')), false);
  });

  it('refuses disable while a draft uses it', async () => {
    await open({ prepare: (site) => writePkg(site, { ...readPkg(site), dependencies: { 'x-widgets': '^1.2.0' } }) });
    const d = await draft('Draft With Window', [{ type: 'component', tag: 'x-one', attrs: {} }]);
    assert.equal(d.status, 201, JSON.stringify(d.data));
    const res = await put('x-widgets', false);
    assert.equal(res.status, 409);
    assert.match(res.data.error, /x-widgets/);
    assert.deepEqual(res.data.posts, [{ id: d.data.id, title: 'Draft With Window', status: 'draft' }]);
    assert.deepEqual(npm.calls, []);
    assert.equal(readPkg(fx.site).dependencies['x-widgets'], '^1.2.0');
  });

  it('404 for a package not in the catalog, 400 for a bundled one', async () => {
    await open();
    assert.equal((await put('left-pad', true)).status, 404);
    assert.equal((await put('x-bundled', false)).status, 400);
    assert.equal((await put('x-widgets', 'yes')).status, 400);
    assert.deepEqual(npm.calls, []);
  });

  it('GET components reports enabled, source and cookSupportsPackages', async () => {
    await open({ prepare: (site) => writePkg(site, { ...readPkg(site), dependencies: { 'x-widgets': '^1.2.0' } }) });
    let res = await api(`/api/sites/${siteId}/components`);
    assert.equal(res.status, 200);
    assert.equal(res.data.cookSupportsPackages, false);
    const by = (pkg) => res.data.packages.find((p) => p.package === pkg);
    assert.equal(by('x-widgets').enabled, true);
    assert.equal(by('x-widgets').source, 'vp');
    assert.equal(by('x-other').enabled, false);
    assert.equal(by('x-other').source, null);
    assert.equal(by('x-bundled').enabled, true);
    write(fx.site, 'node_modules/cook-ssg/package.json', JSON.stringify({ name: 'cook-ssg', version: '2.5.0' }));
    res = await api(`/api/sites/${siteId}/components`);
    assert.equal(res.data.cookSupportsPackages, true);
  });

  it('serves component files and refuses traversal and unknown packages', async () => {
    await open();
    const base = `/sites/${siteId}/components`;
    let res = await api(`${base}/x-widgets/package.json`);
    assert.equal(res.status, 200);
    assert.equal(res.data.version, '1.2.0');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal((await api(`${base}/@x/scoped/package.json`)).status, 200);
    assert.equal((await api(`${base}/%40x%2Fscoped/package.json`)).status, 200);
    assert.equal((await api(`${base}/x-widgets/..%2f..%2fpackage.json`)).status, 404);
    assert.equal((await api(`${base}/x-widgets/%2e%2e/%2e%2e/%2e%2e/package.json`)).status, 404);
    assert.equal((await api(`${base}/left-pad/package.json`)).status, 404);
    assert.equal((await api(`${base}/x-other/package.json`)).status, 404); // not installed anywhere
    assert.equal((await api(`/sites/nope/components/x-widgets/package.json`)).status, 404);
  });
});

describe('postsUsing', () => {
  it('postsUsing finds inline and nested components', () => {
    const db = new Database(':memory:');
    migrate(db);
    const doc = (id, title, blocks, status = 'draft') => saveDocument(db, {
      id, meta: { title, slug: id, collection: 'posts', status }, blocks,
    });
    doc('doc_inline', 'Inline', [{ type: 'paragraph', children: [
      { type: 'text', value: 'a ' },
      { type: 'link', attrs: { href: '/' }, children: [{ type: 'component', tag: 'x-inline', attrs: {}, children: [] }] },
    ] }], 'published');
    doc('doc_nested', 'Nested', [{ type: 'component', tag: 'x-blocks', attrs: {}, children: [
      { type: 'component', tag: 'x-one', attrs: {} },
    ] }]);
    doc('doc_plain', 'Plain', [{ type: 'paragraph', children: [{ type: 'text', value: 'x-one' }] }]);
    assert.deepEqual(postsUsing(db, ['x-one', 'x-inline']), [
      { id: 'doc_inline', title: 'Inline', status: 'published' },
      { id: 'doc_nested', title: 'Nested', status: 'draft' },
    ]);
    assert.deepEqual(postsUsing(db, ['x-blocks']).map((p) => p.id), ['doc_nested']);
    assert.deepEqual(postsUsing(db, ['x-two']), []);
    db.close();
  });
});

describe('cookSupportsPackages', () => {
  it('true from 2.5.0 up, false below, for a prerelease of 2.5.0, or when missing', () => {
    const fx = makeGitSite({ remote: false });
    const at = (version) => {
      write(fx.site, 'node_modules/cook-ssg/package.json', JSON.stringify({ name: 'cook-ssg', version }));
      return cookSupportsPackages(fx.site);
    };
    try {
      assert.equal(cookSupportsPackages(fx.site), false);
      assert.equal(at('2.4.9'), false);
      assert.equal(at('2.5.0-beta.1'), false);
      assert.equal(at('2.5.0'), true);
      assert.equal(at('2.10.0'), true);
      assert.equal(at('3.0.0'), true);
      assert.equal(at('1.99.99'), false);
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });
});
