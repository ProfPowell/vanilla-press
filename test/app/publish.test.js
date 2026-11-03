import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setPublished, readSiteUrl, checkLive, BuildError, normalizeText } from '../../src/app/publish.js';
import * as realGit from '../../src/git/git.js';
import { ensureInstalled, runBuild } from '../../src/app/site-process.js';
import { startApp } from '../../src/app/server.js';
import { resolveWorkspace, openWorkspaceDb } from '../../src/workspace/workspace.js';
import { getDocument, saveDocument } from '../../src/store/content.js';
import { syncDocument } from '../../src/sync/to-site.js';
import { makeGitSite, fakeClock, git, write, BUILD_FAIL } from './git-site-fixture.js';

const repoRoot = join(import.meta.dirname, '..', '..');
const ID = 'doc_hello001';
const hello = (meta = {}) => ({
  id: ID,
  meta: { title: 'Hello', slug: 'hello', collection: 'posts', status: 'draft', created: '2026-11-01T00:00:00.000Z', ...meta },
  blocks: [{ type: 'paragraph', children: [{ type: 'text', value: 'Hi there.' }] }],
});

let fx, db;
afterEach(() => {
  db?.close();
  db = null;
  if (fx) rmSync(fx.root, { recursive: true, force: true });
  fx = null;
});

/** A git site with the Hello draft synced, committed and pushed. */
function setup(opts) {
  fx = makeGitSite(opts);
  const ws = resolveWorkspace({ site: fx.site, env: {}, repoRoot });
  db = openWorkspaceDb(ws);
  const saved = saveDocument(db, hello());
  syncDocument(ws, saved, { collectionsConfig: {} });
  git(fx.site, 'add', 'content');
  git(fx.site, 'commit', '-m', 'add hello');
  if (fx.remote) git(fx.site, 'push');
  return ws;
}

const deps = () => ({ ensureInstalled, runBuild, ...realGit, collectionsConfig: {} });
const lastRemote = () => git(fx.remote, 'log', '-1', '--format=%s', 'main');
const remoteFiles = () => git(fx.remote, 'ls-tree', '-r', '--name-only', 'main').split('\n');

describe('setPublished', () => {
  test('publish writes, builds, commits and pushes', async () => {
    const ws = setup();
    const res = await setPublished({ site: { id: 's' }, ws, db, docId: ID, publish: true, deps: deps() });
    assert.equal(res.status, 'pushed');
    assert.equal(res.url, 'https://example.com/posts/hello/');
    assert.equal(res.sha, git(fx.site, 'rev-parse', 'HEAD'));
    assert.equal(lastRemote(), 'Publish: Hello');
    assert.ok(git(fx.remote, 'show', '--name-only', '--format=', 'main').split('\n').includes('src/posts/hello.html'));
    const stored = getDocument(db, ID);
    assert.equal(stored.meta.status, 'published');
    assert.ok(stored.meta.published);
    assert.ok(existsSync(join(fx.site, 'dist', 'posts', 'hello', 'index.html')));
  });

  test('a first publish sets published once; republish keeps it', async () => {
    const ws = setup();
    await setPublished({ site: {}, ws, db, docId: ID, publish: true, deps: deps() });
    const first = getDocument(db, ID).meta.published;
    await setPublished({ site: {}, ws, db, docId: ID, publish: false, deps: deps() });
    await setPublished({ site: {}, ws, db, docId: ID, publish: true, deps: deps() });
    assert.equal(getDocument(db, ID).meta.published, first);
  });

  test('build failure reverts to draft and pushes nothing', async () => {
    const ws = setup();
    write(fx.site, 'build.js', BUILD_FAIL);
    const before = git(fx.remote, 'rev-parse', 'main');
    const localBefore = git(fx.site, 'rev-parse', 'HEAD');
    await assert.rejects(
      setPublished({ site: {}, ws, db, docId: ID, publish: true, deps: deps() }),
      (err) => err instanceof BuildError && /boom: layout post not found/.test(err.log),
    );
    assert.equal(getDocument(db, ID).meta.status, 'draft');
    assert.equal(getDocument(db, ID).meta.published, undefined);
    assert.equal(existsSync(join(fx.site, 'src', 'posts', 'hello.html')), false);
    assert.equal(JSON.parse(readFileSync(join(fx.site, 'content', 'posts', 'hello.json'), 'utf8')).meta.status, 'draft');
    assert.equal(git(fx.remote, 'rev-parse', 'main'), before);
    assert.equal(git(fx.site, 'rev-parse', 'HEAD'), localBefore);
  });

  test('build failure keeps an edit saved during the build', async () => {
    const ws = setup();
    const edited = [{ type: 'paragraph', children: [{ type: 'text', value: 'Edited during the build.' }] }];
    const failingBuild = async () => {
      const cur = getDocument(db, ID);
      const next = saveDocument(db, { ...cur, meta: { ...cur.meta, updated: '2099-01-01T00:00:00.000Z' }, blocks: edited });
      syncDocument(ws, next, { collectionsConfig: {}, previousDoc: cur });
      return { ok: false, log: 'boom' };
    };
    await assert.rejects(
      setPublished({ site: {}, ws, db, docId: ID, publish: true, deps: { ...deps(), runBuild: failingBuild } }),
      BuildError,
    );
    const stored = getDocument(db, ID);
    assert.deepEqual(stored.blocks, edited);
    assert.equal(stored.meta.status, 'draft');
    assert.equal(stored.meta.published, undefined);
    assert.equal(stored.meta.updated, '2099-01-01T00:00:00.000Z');
    assert.equal(existsSync(join(fx.site, 'src', 'posts', 'hello.html')), false);
    const onDisk = JSON.parse(readFileSync(join(fx.site, 'content', 'posts', 'hello.json'), 'utf8'));
    assert.deepEqual(onDisk.blocks, edited);
    assert.equal(onDisk.meta.status, 'draft');
  });

  test('publish leaves unrelated changes uncommitted', async () => {
    const ws = setup();
    write(fx.site, 'src/programs/p/index.html', '<p>agent</p>');
    write(fx.site, 'config/main.js', 'export default { changed: 1 };\n');
    await setPublished({ site: {}, ws, db, docId: ID, publish: true, deps: deps() });
    assert.equal(git(fx.site, 'diff', '--name-only'), 'config/main.js'); // modified, not staged
    assert.equal(git(fx.site, 'diff', '--cached', '--name-only'), '');
    assert.equal(git(fx.site, 'ls-files', '--others', '--exclude-standard'), 'src/programs/p/index.html');
    assert.ok(!remoteFiles().includes('src/programs/p/index.html'));
  });

  test('unpublish removes the page and pushes', async () => {
    const ws = setup();
    await setPublished({ site: {}, ws, db, docId: ID, publish: true, deps: deps() });
    const res = await setPublished({ site: {}, ws, db, docId: ID, publish: false, deps: deps() });
    assert.equal(res.status, 'pushed');
    assert.equal(res.url, null);
    assert.equal(lastRemote(), 'Unpublish: Hello');
    assert.equal(existsSync(join(fx.site, 'src', 'posts', 'hello.html')), false);
    assert.ok(!remoteFiles().includes('src/posts/hello.html'));
    assert.ok(remoteFiles().includes('content/posts/hello.json'));
    assert.equal(getDocument(db, ID).meta.status, 'draft');
  });

  test('without a remote the publish is saved and committed locally', async () => {
    const ws = setup({ remote: false });
    const res = await setPublished({ site: {}, ws, db, docId: ID, publish: true, deps: deps() });
    assert.equal(res.status, 'saved');
    assert.equal(git(fx.site, 'log', '-1', '--format=%s'), 'Publish: Hello');
  });
});

describe('readSiteUrl and checkLive', () => {
  test('readSiteUrl reads config/data.js, fresh each time', async () => {
    fx = makeGitSite({ remote: false });
    assert.equal(await readSiteUrl(fx.site), 'https://example.com');
    writeFileSync(join(fx.site, 'config', 'data.js'), "export default { siteUrl: 'https://other.example' };\n");
    assert.equal(await readSiteUrl(fx.site), 'https://other.example');
    writeFileSync(join(fx.site, 'config', 'data.js'), 'export default {};\n');
    assert.equal(await readSiteUrl(fx.site), null);
    rmSync(join(fx.site, 'config', 'data.js'));
    assert.equal(await readSiteUrl(fx.site), null);
  });

  test('checkLive compares page text', async () => {
    const page = '<html><body><h1>Hello</h1>\n  <p>Hi   there.</p></body></html>';
    const fetchWith = (status, body) => async () => new Response(body, { status });
    const expectedText = '<h1>Hello</h1><p>Hi there.</p>';
    assert.equal(await checkLive({ url: 'https://x/', expectedText, fetch: fetchWith(200, page) }), true);
    assert.equal(await checkLive({ url: 'https://x/', expectedText, fetch: fetchWith(200, '<p>Old</p>') }), false);
    assert.equal(await checkLive({ url: 'https://x/', expectedText, fetch: fetchWith(404, page) }), false);
    const throws = async () => { throw new Error('offline'); };
    assert.equal(await checkLive({ url: 'https://x/', expectedText, fetch: throws }), false);
    assert.equal(normalizeText('<p>a</p>\n<p>b</p>'), 'a b');
  });
});

describe('app routes', () => {
  let app, env, siteId, clock;

  async function api(path, { method = 'GET', body } = {}) {
    const opts = { method };
    if (body !== undefined) {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`${app.url}${path}`, opts);
    return { status: res.status, data: await res.json() };
  }

  async function open({ fetchImpl, git: gitOps } = {}) {
    setup();
    db.close();
    db = null;
    env = { VP_CONFIG_DIR: join(fx.root, 'vp-config') };
    clock = fakeClock();
    app = await startApp({
      port: 0, env, previews: { start() {}, stop: async () => {}, stopAll: async () => {} },
      ...(gitOps ? { git: gitOps } : {}),
      backup: { now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer },
      fetch: fetchImpl,
    });
    const added = await api('/api/sites', { method: 'POST', body: { path: fx.site } });
    assert.equal(added.status, 201, JSON.stringify(added.data));
    siteId = added.data.id;
  }

  afterEach(async () => { await app?.close(); app = null; });

  test('publish route returns status and url; status shows the backup state', async () => {
    await open();
    const res = await api(`/api/sites/${siteId}/documents/${ID}/publish`, { method: 'POST' });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.deepEqual(res.data, { status: 'pushed', url: 'https://example.com/posts/hello/' });
    assert.equal(lastRemote(), 'Publish: Hello');
    const st = await api(`/api/sites/${siteId}/status`);
    assert.equal(st.status, 200);
    assert.equal(st.data.pending, 0);
    assert.equal(st.data.connected, true);
    assert.ok(st.data.lastPushAt);
    const un = await api(`/api/sites/${siteId}/documents/${ID}/unpublish`, { method: 'POST' });
    assert.deepEqual(un.data, { status: 'pushed', url: null });
    assert.equal(lastRemote(), 'Unpublish: Hello');
  });

  test('publish includes pending draft saves and cancels their timer', async () => {
    await open();
    const other = { id: 'doc_other001', meta: { title: 'Other', slug: 'other', collection: 'posts', status: 'draft' }, blocks: [] };
    assert.equal((await api(`/api/sites/${siteId}/documents`, { method: 'POST', body: other })).status, 201);
    assert.equal((await api(`/api/sites/${siteId}/status`)).data.pending, 1);
    assert.equal(clock.pending(), 1);
    await api(`/api/sites/${siteId}/documents/${ID}/publish`, { method: 'POST' });
    assert.equal(clock.pending(), 0);
    assert.ok(git(fx.remote, 'show', '--name-only', '--format=', 'main').split('\n').includes('content/posts/other.json'));
    assert.equal((await api(`/api/sites/${siteId}/status`)).data.pending, 0);
  });

  test('saves through the API are backed up after the pause', async () => {
    await open();
    const put = await api(`/api/sites/${siteId}/documents/${ID}`, { method: 'PUT', body: { meta: { title: 'Hello 2' } } });
    assert.equal(put.status, 200, JSON.stringify(put.data));
    await clock.advance(30_000);
    assert.equal(lastRemote(), 'Draft: Hello 2 [CI Skip]');
  });

  test('sync-all is noted once as all posts', async () => {
    await open();
    const res = await api(`/api/sites/${siteId}/sync`, { method: 'POST' });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal((await api(`/api/sites/${siteId}/status`)).data.pending, 1);
    write(fx.site, 'content/posts/hello.json', readFileSync(join(fx.site, 'content/posts/hello.json'), 'utf8')); // unchanged
    write(fx.site, 'config/vp.json', '{"theme":"x"}\n');
    const flushed = await api(`/api/sites/${siteId}/backup`, { method: 'POST' });
    assert.equal(flushed.status, 200);
    assert.equal(flushed.data.pending, 0);
    assert.equal(lastRemote(), 'Draft: all posts [CI Skip]');
  });

  test('a slug rename of a published post leaves only the new files in HEAD', async () => {
    await open();
    await api(`/api/sites/${siteId}/documents/${ID}/publish`, { method: 'POST' });
    const put = await api(`/api/sites/${siteId}/documents/${ID}`, { method: 'PUT', body: { meta: { slug: 'hello-2' } } });
    assert.equal(put.status, 200, JSON.stringify(put.data));
    assert.equal((await api(`/api/sites/${siteId}/backup`, { method: 'POST' })).data.error, null);
    const head = git(fx.site, 'ls-tree', '-r', '--name-only', 'HEAD').split('\n');
    assert.ok(head.includes('content/posts/hello-2.json') && head.includes('src/posts/hello-2.html'), head.join(' '));
    assert.ok(!head.includes('content/posts/hello.json') && !head.includes('src/posts/hello.html'), head.join(' '));
    assert.deepEqual(remoteFiles().filter((f) => f.includes('hello')).sort(), ['content/posts/hello-2.json', 'src/posts/hello-2.html']);
    assert.equal(git(fx.site, 'diff', '--cached', '--name-only'), '');
  });

  test('build failure is a 422 with the log', async () => {
    await open();
    write(fx.site, 'build.js', BUILD_FAIL);
    const res = await api(`/api/sites/${siteId}/documents/${ID}/publish`, { method: 'POST' });
    assert.equal(res.status, 422);
    assert.equal(res.data.error, 'Build failed');
    assert.match(res.data.log, /boom/);
  });

  test('conflicting remote change is a 409', async () => {
    await open();
    const other = fx.clone('other');
    const p = join(other, 'content', 'posts', 'hello.json');
    const doc = JSON.parse(readFileSync(p, 'utf8'));
    doc.meta.status = 'archived'; // the same line Publish changes
    writeFileSync(p, JSON.stringify(doc, null, 2) + '\n');
    git(other, 'commit', '-am', 'remote edit');
    git(other, 'push');
    const res = await api(`/api/sites/${siteId}/documents/${ID}/publish`, { method: 'POST' });
    assert.equal(res.status, 409, JSON.stringify(res.data));
    assert.deepEqual(res.data.files, ['content/posts/hello.json']);
    assert.ok(res.data.error);
  });

  test('other git errors are a 502 and the post stays published', async () => {
    const failing = { ...realGit, push: async () => { throw new realGit.GitError('git push failed: denied', 'denied'); } };
    await open({ git: failing });
    const res = await api(`/api/sites/${siteId}/documents/${ID}/publish`, { method: 'POST' });
    assert.equal(res.status, 502);
    assert.match(res.data.error, /denied/);
    const doc = await api(`/api/sites/${siteId}/documents/${ID}`);
    assert.equal(doc.data.meta.status, 'published');
    assert.match((await api(`/api/sites/${siteId}/status`)).data.error, /denied/);
  });

  test('unknown document is a 404', async () => {
    await open();
    const res = await api(`/api/sites/${siteId}/documents/doc_nope0000/publish`, { method: 'POST' });
    assert.equal(res.status, 404);
  });

  test('live check compares the deployed page with the local build', async () => {
    let body = '<p>old</p>';
    const seen = [];
    await open({ fetchImpl: async (url) => { seen.push(url); return new Response(body, { status: 200 }); } });
    const draftLive = await api(`/api/sites/${siteId}/documents/${ID}/live`);
    assert.deepEqual(draftLive.data, { live: false, url: null });
    await api(`/api/sites/${siteId}/documents/${ID}/publish`, { method: 'POST' });
    const before = await api(`/api/sites/${siteId}/documents/${ID}/live`);
    assert.deepEqual(before.data, { live: false, url: 'https://example.com/posts/hello/' });
    body = `<html><body>${readFileSync(join(fx.site, 'dist', 'posts', 'hello', 'index.html'), 'utf8')}</body></html>`;
    const after = await api(`/api/sites/${siteId}/documents/${ID}/live`);
    assert.deepEqual(after.data, { live: true, url: 'https://example.com/posts/hello/' });
    assert.equal(seen.at(-1), 'https://example.com/posts/hello/');
  });

  test('shutdown flushes every open site, then stops previews', async () => {
    const order = [];
    setup();
    db.close();
    db = null;
    env = { VP_CONFIG_DIR: join(fx.root, 'vp-config') };
    clock = fakeClock();
    app = await startApp({
      port: 0, env,
      previews: { start() {}, stop: async () => {}, stopAll: async () => { order.push(`stopAll:${lastRemote()}`); } },
      backup: { now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer },
    });
    siteId = (await api('/api/sites', { method: 'POST', body: { path: fx.site } })).data.id;
    await api(`/api/sites/${siteId}/documents/${ID}`, { method: 'PUT', body: { meta: { title: 'Bye' } } });
    await app.shutdown();
    app = null;
    assert.deepEqual(order, ['stopAll:Draft: Bye [CI Skip]']);
  });
});
