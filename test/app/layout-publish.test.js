import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { listLayoutFiles, readLayoutFile, saveLayoutFile, deleteLayoutFile, publishLayouts, LayoutError } from '../../src/app/layout-store.js';
import { createBackup } from '../../src/app/site-git.js';
import { startApp } from '../../src/app/server.js';
import * as gitMod from '../../src/git/git.js';

const COOK = '/Users/tpowell/src/cook';
const STARTER = join(COOK, 'starters', 'vanilla-breeze');
const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });

function makeSite({ remote = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'vp-layout-publish-'));
  const dir = join(root, 'site');
  mkdirSync(join(dir, 'node_modules'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'site', type: 'module', devDependencies: { 'cook-ssg': '^2.9.0' } }));
  symlinkSync(COOK, join(dir, 'node_modules', 'cook-ssg'));
  for (const d of ['src/layouts', 'src/includes', 'config']) cpSync(join(STARTER, d), join(dir, d), { recursive: true });
  mkdirSync(join(dir, 'src', 'posts'), { recursive: true });
  writeFileSync(join(dir, 'src', 'posts', 'a.html'), '---\ntitle: A\nlayout: post\n---\n<p>hi</p>\n');
  writeFileSync(join(dir, '.gitignore'), 'node_modules\n');
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'T'); git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'init');
  let bare = null;
  if (remote) {
    bare = join(root, 'remote.git');
    execFileSync('git', ['init', '--bare', '-q', '-b', 'main', bare]);
    git(dir, 'remote', 'add', 'origin', bare);
    git(dir, 'push', '-q', '-u', 'origin', 'main');
  }
  return { root, dir, bare };
}

async function saveEdit(dir, name, label) {
  const { tree, hash } = await readLayoutFile(dir, 'layout', name);
  tree.info = { ...tree.info, label };
  await saveLayoutFile(dir, 'layout', name, { tree, hash });
}

describe('publishLayouts', () => {
  const roots = [];
  const mk = (opts) => { const s = makeSite(opts); roots.push(s.root); return s; };
  after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));
  const setup = (s) => {
    const ws = { siteDir: s.dir };
    return { ws, backup: createBackup({ ws, git: gitMod }), deps: gitMod };
  };

  it('commits only the published layout, with no CI skip, and pushes', async () => {
    const s = mk(); const { ws, backup, deps } = setup(s);
    await saveEdit(s.dir, 'page', 'Plain Page');
    assert.equal(git(s.dir, 'log', '--oneline').trim().split('\n').length, 1, 'save does not commit');
    const out = await publishLayouts(ws, { backup, deps, names: [{ kind: 'layout', name: 'page' }] });
    assert.equal(out.status, 'pushed');
    assert.equal(git(s.dir, 'log', '-1', '--format=%s').trim(), 'Layout: Plain Page');
    assert.deepEqual(git(s.dir, 'show', '--name-only', '--format=', 'HEAD').trim().split('\n'), ['src/layouts/page.html']);
    assert.equal(git(s.dir, 'rev-parse', 'HEAD'), git(s.bare, 'rev-parse', 'main'));
    assert.equal((await listLayoutFiles(s.dir)).layouts.find((e) => e.name === 'page').unpublished, false);
  });

  it('leaves a hand-edited layout and a dirty page unstaged (Review Focus 3)', async () => {
    const s = mk(); const { ws, backup, deps } = setup(s);
    await saveEdit(s.dir, 'page', 'Mine');
    writeFileSync(join(s.dir, 'src/layouts/docs.html'), readFileSync(join(s.dir, 'src/layouts/docs.html'), 'utf8') + '\n<!-- hand -->\n');
    writeFileSync(join(s.dir, 'src/posts/a.html'), '---\ntitle: A2\nlayout: post\n---\n<p>changed</p>\n');
    await publishLayouts(ws, { backup, deps, names: [{ kind: 'layout', name: 'page' }] });
    assert.deepEqual(git(s.dir, 'show', '--name-only', '--format=', 'HEAD').trim().split('\n'), ['src/layouts/page.html']);
    const status = git(s.dir, 'status', '--porcelain');
    assert.match(status, / M src\/layouts\/docs\.html/);
    assert.match(status, / M src\/posts\/a\.html/);
    assert.doesNotMatch(status, /^[MA] /m, 'nothing staged');
  });

  it('an empty list publishes every unpublished layout VP can see', async () => {
    const s = mk(); const { ws, backup, deps } = setup(s);
    await saveEdit(s.dir, 'page', 'One');
    await saveEdit(s.dir, 'post', 'Two');
    writeFileSync(join(s.dir, 'src/posts/a.html'), '---\ntitle: A2\nlayout: post\n---\n<p>x</p>\n');
    await publishLayouts(ws, { backup, deps, names: [] });
    assert.deepEqual(git(s.dir, 'show', '--name-only', '--format=', 'HEAD').trim().split('\n').sort(), ['src/layouts/page.html', 'src/layouts/post.html']);
    assert.match(git(s.dir, 'log', '-1', '--format=%s'), /^Layout: One, Two\n?$/);
    await assert.rejects(publishLayouts(ws, { backup, deps, names: [] }), (e) => e instanceof LayoutError && e.status === 409);
  });

  it('a backup flush after a layout save does not stage the layout', async () => {
    const s = mk(); const { ws, backup } = setup(s);
    await saveEdit(s.dir, 'page', 'Draft');
    backup.noteSaved({ title: 'x', status: 'draft' });
    await backup.flush();
    assert.equal(git(s.dir, 'status', '--porcelain', '--', 'src/layouts').trim(), 'M src/layouts/page.html');
    assert.equal(git(s.dir, 'log', '--oneline').trim().split('\n').length, 1, 'nothing of the layout was committed');
    assert.equal(git(s.dir, 'diff', '--cached', '--name-only').trim(), '');
  });

  it('rejects an unknown or invalid name without committing', async () => {
    const s = mk(); const { ws, backup, deps } = setup(s);
    await assert.rejects(publishLayouts(ws, { backup, deps, names: [{ kind: 'layout', name: 'nope' }] }), (e) => e.status === 404);
    await assert.rejects(publishLayouts(ws, { backup, deps, names: [{ kind: 'layout', name: '../x' }] }), (e) => e.status === 400);
  });

  it('keeps the commit and counts it unpushed when the push fails', async () => {
    const s = mk(); const { ws, backup } = setup(s);
    await saveEdit(s.dir, 'page', 'Fails');
    const deps = { ...gitMod, push: async () => { throw new gitMod.GitError('network down'); } };
    const out = await publishLayouts(ws, { backup, deps, names: [{ kind: 'layout', name: 'page' }] });
    assert.equal(out.unpushedCommit, true);
    assert.equal(out.pushError, 'network down');
    assert.ok(out.sha);
    assert.equal(git(s.dir, 'log', '-1', '--format=%s').trim(), 'Layout: Fails');
    assert.equal(backup.state().pending, 1);
    assert.equal(backup.state().error, 'network down');
    backup.dispose();
  });

  it('leaves a pending draft pending, with its timer, and counts only the layout commit on push failure', async () => {
    const s = mk();
    const ws = { siteDir: s.dir };
    const timers = [];
    const backup = createBackup({ ws, git: gitMod, setTimer: (fn, ms) => { timers.push(ms); return timers.length; }, clearTimer: () => {} });
    backup.noteSaved({ title: 'Draft', status: 'draft' });
    await saveEdit(s.dir, 'page', 'Pub');
    const before = timers.length;
    await publishLayouts(ws, { backup, deps: gitMod, names: [] });
    assert.equal(backup.state().pending, 1, 'the draft is still pending');
    assert.ok(timers.length >= before, 'timer state kept');
    await saveEdit(s.dir, 'post', 'Pub2');
    const deps = { ...gitMod, push: async () => { throw new gitMod.GitError('down'); } };
    await publishLayouts(ws, { backup, deps, names: [] });
    assert.equal(backup.state().pending, 2, 'draft + the layout commit');
    assert.ok(timers.length > before, 'a flush is scheduled');
    backup.dispose();
  });

  it('publishes a deleted layout: the commit removes it and the remote loses it', async () => {
    const s = mk(); const { ws, backup, deps } = setup(s);
    writeFileSync(join(s.dir, 'src/layouts/extra.html'), readFileSync(join(s.dir, 'src/layouts/page.html'), 'utf8'));
    git(s.dir, 'add', 'src/layouts/extra.html'); git(s.dir, 'commit', '-qm', 'extra'); git(s.dir, 'push', '-q');
    await deleteLayoutFile(s.dir, 'layout', 'extra');
    assert.deepEqual((await listLayoutFiles(s.dir)).deleted, [{ kind: 'layout', name: 'extra' }]);
    const out = await publishLayouts(ws, { backup, deps, names: [] });
    assert.equal(out.status, 'pushed');
    assert.match(git(s.dir, 'show', '--name-status', '--format=', 'HEAD'), /^D\tsrc\/layouts\/extra\.html/);
    assert.equal(git(s.bare, 'ls-tree', '-r', '--name-only', 'main').includes('extra.html'), false);
    assert.deepEqual((await listLayoutFiles(s.dir)).deleted, []);
  });

  it('refuses a layout with problems', async () => {
    const s = mk(); const { ws, backup, deps } = setup(s);
    const f = join(s.dir, 'src/layouts/page.html');
    writeFileSync(f, readFileSync(f, 'utf8').replace('${title}', '${nope}'));
    for (const names of [[{ kind: 'layout', name: 'page' }], []]) {
      await assert.rejects(publishLayouts(ws, { backup, deps, names }), (e) => e.status === 409
        && e.message === 'Fix these layouts before publishing' && e.body.problems[0].name === 'page' && e.body.problems[0].problems.length > 0);
    }
    assert.equal(git(s.dir, 'log', '--oneline').trim().split('\n').length, 1);
  });

  it('saves without pushing when there is no remote', async () => {
    const s = mk({ remote: false }); const { ws, backup, deps } = setup(s);
    await saveEdit(s.dir, 'page', 'Local');
    const out = await publishLayouts(ws, { backup, deps, names: [] });
    assert.equal(out.status, 'saved');
    assert.equal(git(s.dir, 'log', '-1', '--format=%s').trim(), 'Layout: Local');
  });
});

describe('POST /layout-files/publish', () => {
  it('commits and pushes the named layout; 409 when nothing is left; 400 on a bad name', async () => {
    const s = makeSite();
    const app = await startApp({ port: 0, env: { VP_CONFIG_DIR: join(s.root, 'config') } });
    try {
      const reg = await fetch(`${app.url}/api/sites`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: s.dir, name: 'S' }) });
      const id = (await reg.json()).id;
      const post = async (body) => {
        const res = await fetch(`${app.url}/api/sites/${id}/layout-files/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        return { status: res.status, data: await res.json() };
      };
      await saveEdit(s.dir, 'page', 'Via Route');
      const bad = await post({ files: [{ kind: 'layout', name: '../x' }] });
      assert.equal(bad.status, 400);
      const ok = await post({ files: [{ kind: 'layout', name: 'page' }] });
      assert.equal(ok.status, 200);
      assert.equal(ok.data.status, 'pushed');
      assert.equal(git(s.dir, 'rev-parse', 'HEAD'), git(s.bare, 'rev-parse', 'main'));
      assert.equal((await post({ files: [] })).status, 409);
    } finally {
      await app.close();
      rmSync(s.root, { recursive: true, force: true });
    }
  });
});
