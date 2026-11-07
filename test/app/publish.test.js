import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setPublished, readSiteUrl, checkLive, BuildError, PublishRejectedError, normalizeText } from '../../src/app/publish.js';
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

/** Save new text (and meta) for a stored document and sync it, as an editor save does. */
function edit(ws, id, text, meta = {}) {
  const cur = getDocument(db, id);
  const next = saveDocument(db, {
    ...cur, meta: { ...cur.meta, ...meta }, blocks: [{ type: 'paragraph', children: [{ type: 'text', value: text }] }],
  });
  syncDocument(ws, next, { collectionsConfig: {}, previousDoc: cur });
  return next;
}
const headFiles = () => git(fx.site, 'ls-tree', '-r', '--name-only', 'HEAD').split('\n');
const remoteShow = (path) => git(fx.remote, 'show', `main:${path}`);
const OTHER = 'doc_other001';

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

  test('publish refuses a post using a component that is off', async () => {
    const ws = setup();
    const cur = getDocument(db, ID);
    saveDocument(db, { ...cur, blocks: [...cur.blocks, { type: 'paragraph', children: [
      { type: 'component', tag: 'x-one', attrs: {}, children: [] },
    ] }] });
    const localBefore = git(fx.site, 'rev-parse', 'HEAD');
    const updatedBefore = getDocument(db, ID).meta.updated;
    let built = 0;
    const d = { ...deps(), runBuild: async () => { built++; return { ok: true, log: '' } }, components: () => new Map() };
    await assert.rejects(
      setPublished({ site: {}, ws, db, docId: ID, publish: true, deps: d }),
      (err) => err instanceof PublishRejectedError && err.status === 422 &&
        err.message === 'This post uses <x-one>, which is not on for this site. Turn it on under Components, or remove it from the post.',
    );
    assert.equal(built, 0);
    assert.equal(getDocument(db, ID).meta.status, 'draft');
    assert.equal(getDocument(db, ID).meta.updated, updatedBefore);
    assert.equal(git(fx.site, 'rev-parse', 'HEAD'), localBefore);
    // With the component on, it publishes; unpublish is never refused.
    const on = new Map([['x-one', { tag: 'x-one' }]]);
    const res = await setPublished({ site: {}, ws, db, docId: ID, publish: true, deps: { ...d, components: () => on } });
    assert.equal(res.kind, 'publish');
    const off = await setPublished({ site: {}, ws, db, docId: ID, publish: false, deps: d });
    assert.equal(off.kind, 'unpublish');
  });

  test('publish and update refuse a post with no title', async () => {
    const ws = setup();
    const cur = getDocument(db, ID);
    saveDocument(db, { ...cur, meta: { ...cur.meta, title: '' } });
    const localBefore = git(fx.site, 'rev-parse', 'HEAD');
    let built = 0;
    const d = { ...deps(), runBuild: async () => { built++; return { ok: true, log: '' } } };
    const refused = (err) => err instanceof PublishRejectedError && err.status === 422 &&
      err.body.error === 'Give the post a title before publishing.';
    await assert.rejects(setPublished({ site: {}, ws, db, docId: ID, publish: true, deps: d }), refused);
    assert.equal(getDocument(db, ID).meta.status, 'draft');
    // A published post whose title was cleared (stored directly): Update is refused too.
    const pub = getDocument(db, ID);
    saveDocument(db, { ...pub, meta: { ...pub.meta, title: '  ', status: 'published', published: new Date().toISOString() } });
    await assert.rejects(setPublished({ site: {}, ws, db, docId: ID, publish: true, update: true, deps: d }), refused);
    assert.equal(built, 0);
    assert.equal(git(fx.site, 'rev-parse', 'HEAD'), localBefore);
    // Unpublish is never refused.
    const off = await setPublished({ site: {}, ws, db, docId: ID, publish: false, deps: d });
    assert.equal(off.kind, 'unpublish');
  });

  test('publish and update refuse a post using a component that will not load on the live site (R14)', async () => {
    const ws = setup();
    const cur = getDocument(db, ID);
    saveDocument(db, { ...cur, blocks: [...cur.blocks, { type: 'component', tag: 'marquee-wc', attrs: {}, value: 'Hi' }] });
    const localBefore = git(fx.site, 'rev-parse', 'HEAD');
    let built = 0;
    const note = "Won't load on the live site until @profpowell/marquee-wc ships custom-elements.json in its npm package";
    const on = new Map([['marquee-wc', { tag: 'marquee-wc', package: '@profpowell/marquee-wc', loadsOnLiveSite: false, liveSiteNote: note }]]);
    const d = { ...deps(), runBuild: async () => { built++; return { ok: true, log: '' } }, components: () => on };
    const expected = `This post uses <marquee-wc>, which won't load on the live site: ${note}. Remove it from the post to publish now.`;
    await assert.rejects(
      setPublished({ site: {}, ws, db, docId: ID, publish: true, deps: d }),
      (err) => err instanceof PublishRejectedError && err.status === 422 && err.message === expected,
    );
    assert.equal(built, 0);
    assert.equal(getDocument(db, ID).meta.status, 'draft');
    assert.equal(git(fx.site, 'rev-parse', 'HEAD'), localBefore);
    // An already published post: Update is refused the same way.
    const pub = getDocument(db, ID);
    saveDocument(db, { ...pub, meta: { ...pub.meta, status: 'published', published: new Date().toISOString() } });
    await assert.rejects(
      setPublished({ site: {}, ws, db, docId: ID, publish: true, update: true, deps: d }),
      (err) => err instanceof PublishRejectedError && err.status === 422 && err.message === expected,
    );
    assert.equal(built, 0);
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

  test('publish never commits a hand-written page in the collection dir', async () => {
    const ws = setup();
    write(fx.site, 'src/posts/mine.html', '---\ntitle: "Mine"\n---\n<p>Hand-written</p>\n');
    await setPublished({ site: {}, ws, db, docId: ID, publish: true, deps: deps() });
    assert.ok(remoteFiles().includes('src/posts/hello.html'));
    assert.ok(!remoteFiles().includes('src/posts/mine.html'));
    assert.equal(git(fx.site, 'ls-files', '--others', '--exclude-standard'), 'src/posts/mine.html');
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

  test('update on a published post commits only its own page, as Update, keeping the published date', async () => {
    const ws = setup();
    const otherSaved = saveDocument(db, { ...hello(), id: OTHER, meta: { ...hello().meta, title: 'Other', slug: 'other' } });
    syncDocument(ws, otherSaved, { collectionsConfig: {} });
    await setPublished({ site: {}, ws, db, docId: ID, publish: true, deps: deps() });
    await setPublished({ site: {}, ws, db, docId: OTHER, publish: true, deps: deps() });
    const published = getDocument(db, ID).meta.published;
    edit(ws, ID, 'Version two.');
    edit(ws, OTHER, 'Other, not live yet.'); // saved, never updated
    const res = await setPublished({ site: {}, ws, db, docId: ID, publish: true, update: true, deps: deps() });
    assert.equal(res.status, 'pushed');
    assert.equal(res.url, 'https://example.com/posts/hello/');
    assert.equal(lastRemote(), 'Update: Hello');
    const files = git(fx.remote, 'show', '--name-only', '--format=', 'main').split('\n');
    assert.ok(files.includes('src/posts/hello.html'), files.join(' '));
    assert.ok(!files.includes('src/posts/other.html'), files.join(' '));
    assert.match(remoteShow('src/posts/hello.html'), /Version two\./);
    assert.match(remoteShow('src/posts/other.html'), /Hi there\./);
    assert.match(git(fx.site, 'status', '--porcelain'), /M src\/posts\/other\.html/);
    assert.equal(getDocument(db, ID).meta.published, published);
    assert.equal(getDocument(db, ID).meta.status, 'published');
    assert.match(res.expectedText, /Version two\./); // the page this build made, for the live check
  });

  test('publish on an already-published post is an Update too', async () => {
    const ws = setup();
    await setPublished({ site: {}, ws, db, docId: ID, publish: true, deps: deps() });
    edit(ws, ID, 'Version two.');
    await setPublished({ site: {}, ws, db, docId: ID, publish: true, deps: deps() });
    assert.equal(lastRemote(), 'Update: Hello');
  });

  test('update refuses a post that is not published', async () => {
    const ws = setup();
    await assert.rejects(
      setPublished({ site: {}, ws, db, docId: ID, publish: true, update: true, deps: deps() }),
      (err) => err.status === 422 && /not published/.test(err.body.error),
    );
    assert.equal(getDocument(db, ID).meta.status, 'draft');
  });

  test('a failed build on update pushes nothing and keeps the post published', async () => {
    const ws = setup();
    await setPublished({ site: {}, ws, db, docId: ID, publish: true, deps: deps() });
    edit(ws, ID, 'Version two.');
    write(fx.site, 'build.js', BUILD_FAIL);
    const before = git(fx.remote, 'rev-parse', 'main');
    const localBefore = git(fx.site, 'rev-parse', 'HEAD');
    await assert.rejects(setPublished({ site: {}, ws, db, docId: ID, publish: true, update: true, deps: deps() }), BuildError);
    assert.equal(git(fx.remote, 'rev-parse', 'main'), before);
    assert.equal(git(fx.site, 'rev-parse', 'HEAD'), localBefore);
    assert.equal(getDocument(db, ID).meta.status, 'published');
  });

  test('rename a published post, then Update: HEAD has the new page and not the old one', async () => {
    const ws = setup();
    await setPublished({ site: {}, ws, db, docId: ID, publish: true, deps: deps() });
    edit(ws, ID, 'Renamed.', { slug: 'hello-2' });
    await setPublished({ site: {}, ws, db, docId: ID, publish: true, update: true, deps: deps() });
    assert.ok(headFiles().includes('src/posts/hello-2.html'), headFiles().join(' '));
    assert.ok(!headFiles().includes('src/posts/hello.html'), headFiles().join(' '));
    assert.ok(!remoteFiles().includes('src/posts/hello.html'));
    assert.equal(git(fx.site, 'status', '--porcelain'), '');
  });

  test('rename a published post, then Unpublish: neither page is in HEAD (I-1)', async () => {
    const ws = setup();
    await setPublished({ site: {}, ws, db, docId: ID, publish: true, deps: deps() });
    edit(ws, ID, 'Renamed.', { slug: 'hello-2' });
    await setPublished({ site: {}, ws, db, docId: ID, publish: false, deps: deps() });
    assert.equal(lastRemote(), 'Unpublish: Hello');
    const head = headFiles();
    assert.ok(!head.includes('src/posts/hello.html') && !head.includes('src/posts/hello-2.html'), head.join(' '));
    assert.ok(!remoteFiles().some((f) => f.endsWith('.html') && f.includes('hello')), remoteFiles().join(' '));
  });

  test('a git failure listing the pages makes Unpublish fail, commit nothing and keep the post published', async () => {
    const ws = setup();
    await setPublished({ site: {}, ws, db, docId: ID, publish: true, deps: deps() });
    const localBefore = git(fx.site, 'rev-parse', 'HEAD');
    const failing = { ...deps(), changedSinceHead: async () => { throw new realGit.GitError('git diff timed out after 60s'); } };
    await assert.rejects(
      setPublished({ site: {}, ws, db, docId: ID, publish: false, deps: failing }),
      (err) => !err.name.startsWith('Git') && /timed out/.test(err.message),
    );
    assert.equal(git(fx.site, 'rev-parse', 'HEAD'), localBefore);
    assert.equal(getDocument(db, ID).meta.status, 'published');
    assert.ok(existsSync(join(fx.site, 'src', 'posts', 'hello.html')));
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

  async function open({ fetchImpl, git: gitOps, siteProcess } = {}) {
    setup();
    db.close();
    db = null;
    env = { VP_CONFIG_DIR: join(fx.root, 'vp-config') };
    clock = fakeClock();
    app = await startApp({
      port: 0, env, previews: { start() {}, stop: async () => {}, stopAll: async () => {} },
      ...(gitOps ? { git: gitOps } : {}),
      ...(siteProcess ? { siteProcess } : {}),
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
    assert.equal(lastRemote(), 'Edit: all posts [CI Skip]'); // not known to be drafts only
  });

  test('a slug rename of a published post backs up the JSON only; Update moves the page', async () => {
    await open();
    await api(`/api/sites/${siteId}/documents/${ID}/publish`, { method: 'POST' });
    const put = await api(`/api/sites/${siteId}/documents/${ID}`, { method: 'PUT', body: { meta: { slug: 'hello-2' } } });
    assert.equal(put.status, 200, JSON.stringify(put.data));
    assert.equal((await api(`/api/sites/${siteId}/backup`, { method: 'POST' })).data.error, null);
    assert.equal(lastRemote(), 'Edit: Hello [CI Skip]');
    let head = headFiles();
    assert.ok(head.includes('content/posts/hello-2.json') && !head.includes('content/posts/hello.json'), head.join(' '));
    assert.ok(head.includes('src/posts/hello.html') && !head.includes('src/posts/hello-2.html'), head.join(' ')); // live page unchanged
    const up = await api(`/api/sites/${siteId}/documents/${ID}/update`, { method: 'POST' });
    assert.deepEqual(up.data, { status: 'pushed', url: 'https://example.com/posts/hello-2/' });
    assert.equal(lastRemote(), 'Update: Hello');
    assert.deepEqual(remoteFiles().filter((f) => f.includes('hello')).sort(), ['content/posts/hello-2.json', 'src/posts/hello-2.html']);
    assert.equal(git(fx.site, 'diff', '--cached', '--name-only'), '');
  });

  test('rename, restart the app, then Unpublish: neither page is in HEAD', async () => {
    await open();
    await api(`/api/sites/${siteId}/documents/${ID}/publish`, { method: 'POST' });
    await api(`/api/sites/${siteId}/documents/${ID}`, { method: 'PUT', body: { meta: { slug: 'hello-2' } } });
    await app.close(); // quits inside the backup pause: nothing flushed
    app = await startApp({
      port: 0, env, previews: { start() {}, stop: async () => {}, stopAll: async () => {} },
      backup: { now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer },
    });
    const un = await api(`/api/sites/${siteId}/documents/${ID}/unpublish`, { method: 'POST' });
    assert.equal(un.status, 200, JSON.stringify(un.data));
    const head = headFiles();
    assert.ok(!head.includes('src/posts/hello.html') && !head.includes('src/posts/hello-2.html'), head.join(' '));
    assert.ok(head.includes('content/posts/hello-2.json') && !head.includes('content/posts/hello.json'), head.join(' '));
  });

  test('a save during a publish waits until the publish commit; the commit holds the pre-save page', async () => {
    let entered, release;
    const inBuild = new Promise((r) => { entered = r; });
    const gate = new Promise((r) => { release = r; });
    const slowBuild = async (dir) => { entered(); await gate; return runBuild(dir); };
    await open({ siteProcess: { runBuild: slowBuild } });
    const order = [];
    const publishing = api(`/api/sites/${siteId}/documents/${ID}/publish`, { method: 'POST' }).then((r) => { order.push('publish'); return r; });
    await inBuild;
    const saving = api(`/api/sites/${siteId}/documents/${ID}`, {
      method: 'PUT', body: { blocks: [{ type: 'paragraph', children: [{ type: 'text', value: 'Saved mid-build.' }] }] },
    }).then((r) => { order.push('save'); return r; });
    await new Promise((r) => setTimeout(r, 200));
    assert.deepEqual(order, []); // the save waits for the publish
    release();
    const [pub, put] = await Promise.all([publishing, saving]);
    assert.equal(pub.status, 200, JSON.stringify(pub.data));
    assert.equal(put.status, 200, JSON.stringify(put.data));
    assert.deepEqual(order, ['publish', 'save']);
    const committed = git(fx.site, 'show', 'HEAD:src/posts/hello.html');
    assert.match(committed, /Hi there\./);
    assert.doesNotMatch(committed, /Saved mid-build/);
  });

  test('a held page edit does not stop the fast-forward pull on open', async () => {
    await open();
    write(fx.site, 'src/posts/hello.html', '---\nvp_id: "doc_hello001"\n---\n<p>Live</p>\n');
    git(fx.site, 'add', '-A');
    git(fx.site, 'commit', '-m', 'Publish: Hello');
    git(fx.site, 'push');
    write(fx.site, 'src/posts/hello.html', '---\nvp_id: "doc_hello001"\n---\n<p>Held edit</p>\n');
    const remoteId = pushRemotePost();
    assert.ok((await docIds()).includes(remoteId));
    assert.equal(git(fx.site, 'rev-parse', 'HEAD'), git(fx.remote, 'rev-parse', 'main'));
    assert.match(readFileSync(join(fx.site, 'src/posts/hello.html'), 'utf8'), /Held edit/);
  });

  test('notLive: true after a saved edit to a published post, false after Update', async () => {
    await open();
    const state = async () => (await api(`/api/sites/${siteId}/documents/${ID}/state`)).data;
    assert.deepEqual(await state(), { notLive: false }); // a draft
    await api(`/api/sites/${siteId}/documents/${ID}/publish`, { method: 'POST' });
    assert.deepEqual(await state(), { notLive: false });
    await api(`/api/sites/${siteId}/documents/${ID}`, {
      method: 'PUT', body: { blocks: [{ type: 'paragraph', children: [{ type: 'text', value: 'Version two.' }] }] },
    });
    assert.deepEqual(await state(), { notLive: true });
    await api(`/api/sites/${siteId}/backup`, { method: 'POST' });
    assert.deepEqual(await state(), { notLive: true }); // a backup never makes it live
    await api(`/api/sites/${siteId}/documents/${ID}/update`, { method: 'POST' });
    assert.deepEqual(await state(), { notLive: false });
    assert.equal((await api(`/api/sites/${siteId}/documents/doc_nope0000/state`)).status, 404);
  });

  test('app PUT ignores status and published: only Publish/Update/Unpublish change them', async () => {
    await open();
    await api(`/api/sites/${siteId}/documents/${ID}/publish`, { method: 'POST' });
    const published = (await api(`/api/sites/${siteId}/documents/${ID}`)).data.meta.published;
    const put = await api(`/api/sites/${siteId}/documents/${ID}`, { method: 'PUT', body: { meta: { status: 'draft', published: null, title: 'X' } } });
    assert.equal(put.status, 200, JSON.stringify(put.data));
    const doc = (await api(`/api/sites/${siteId}/documents/${ID}`)).data;
    assert.equal(doc.meta.status, 'published');
    assert.equal(doc.meta.published, published);
    assert.equal(doc.meta.title, 'X');
    assert.ok(existsSync(join(fx.site, 'src', 'posts', 'hello.html')));
  });

  test('app POST create stores a new post as a draft whatever status it asks for', async () => {
    await open();
    const body = { id: 'doc_new00001', meta: { title: 'New', slug: 'new', collection: 'posts', status: 'published', published: '2026-01-01T00:00:00.000Z' }, blocks: [] };
    const res = await api(`/api/sites/${siteId}/documents`, { method: 'POST', body });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.equal(res.data.meta.status, 'draft');
    assert.equal(res.data.meta.published, undefined);
    assert.equal(existsSync(join(fx.site, 'src', 'posts', 'new.html')), false);
  });

  /** Run `action` with a build held at a gate; while it waits, PUT the full stored meta (as the editor's autosave does). */
  async function raceFullMetaSave(action, { before } = {}) {
    let slow = false, entered, release;
    const inBuild = new Promise((r) => { entered = r; });
    const gate = new Promise((r) => { release = r; });
    const build = async (dir) => { if (slow) { entered(); await gate; } return runBuild(dir); };
    await open({ siteProcess: { runBuild: build } });
    if (before) await api(`/api/sites/${siteId}/documents/${ID}/${before}`, { method: 'POST' });
    const staleMeta = (await api(`/api/sites/${siteId}/documents/${ID}`)).data.meta;
    slow = true;
    const acting = api(`/api/sites/${siteId}/documents/${ID}/${action}`, { method: 'POST' });
    await inBuild;
    const saving = api(`/api/sites/${siteId}/documents/${ID}`, {
      method: 'PUT', body: { meta: { ...staleMeta, title: 'Typed meanwhile' }, blocks: hello().blocks },
    });
    release();
    const [act, put] = await Promise.all([acting, saving]);
    assert.equal(act.status, 200, JSON.stringify(act.data));
    assert.equal(put.status, 200, JSON.stringify(put.data));
    assert.equal((await api(`/api/sites/${siteId}/backup`, { method: 'POST' })).data.error, null);
    const doc = (await api(`/api/sites/${siteId}/documents/${ID}`)).data;
    assert.equal(doc.meta.title, 'Typed meanwhile');
    return { doc, headJson: JSON.parse(git(fx.site, 'show', 'HEAD:content/posts/hello.json')) };
  }

  test('a full-meta autosave queued behind Publish does not turn the post back into a draft', async () => {
    const { doc, headJson } = await raceFullMetaSave('publish');
    assert.equal(doc.meta.status, 'published');
    assert.ok(existsSync(join(fx.site, 'src', 'posts', 'hello.html')));
    assert.equal(headJson.meta.status, 'published');
    assert.ok(headFiles().includes('src/posts/hello.html'));
  });

  test('a full-meta autosave queued behind Unpublish does not publish the post again', async () => {
    const { doc, headJson } = await raceFullMetaSave('unpublish', { before: 'publish' });
    assert.equal(doc.meta.status, 'draft');
    assert.equal(existsSync(join(fx.site, 'src', 'posts', 'hello.html')), false);
    assert.equal(headJson.meta.status, 'draft');
    assert.ok(!headFiles().includes('src/posts/hello.html'));
  });

  test('publish route on an untitled draft is a 422 with the reason', async () => {
    await open();
    const put = await api(`/api/sites/${siteId}/documents/${ID}`, { method: 'PUT', body: { meta: { title: '' } } });
    assert.equal(put.status, 200, JSON.stringify(put.data));
    const res = await api(`/api/sites/${siteId}/documents/${ID}/publish`, { method: 'POST' });
    assert.equal(res.status, 422, JSON.stringify(res.data));
    assert.deepEqual(res.data, { error: 'Give the post a title before publishing.' });
  });

  test('update route on a draft is a 422', async () => {
    await open();
    const res = await api(`/api/sites/${siteId}/documents/${ID}/update`, { method: 'POST' });
    assert.equal(res.status, 422, JSON.stringify(res.data));
    assert.match(res.data.error, /not published/);
  });

  test('live check after Update compares with the page that Update built, even if dist changes later', async () => {
    let body = '';
    await open({ fetchImpl: async () => new Response(body, { status: 200 }) });
    await api(`/api/sites/${siteId}/documents/${ID}/publish`, { method: 'POST' });
    const put = await api(`/api/sites/${siteId}/documents/${ID}`, {
      method: 'PUT', body: { blocks: [{ type: 'paragraph', children: [{ type: 'text', value: 'Version two.' }] }] },
    });
    assert.equal(put.status, 200, JSON.stringify(put.data));
    assert.equal((await api(`/api/sites/${siteId}/documents/${ID}/update`, { method: 'POST' })).status, 200);
    const built = readFileSync(join(fx.site, 'dist', 'posts', 'hello', 'index.html'), 'utf8');
    assert.match(built, /Version two\./);
    // Preview's dev server rebuilds dist from a later, unpublished edit.
    write(fx.site, 'dist/posts/hello/index.html', '<p>Version three.</p>\n');
    body = '<p>Version three.</p>';
    assert.equal((await api(`/api/sites/${siteId}/documents/${ID}/live`)).data.live, false);
    body = `<html><body>${built}</body></html>`;
    assert.deepEqual((await api(`/api/sites/${siteId}/documents/${ID}/live`)).data, { live: true, url: 'https://example.com/posts/hello/' });
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
    assert.equal((await api(`/api/sites/${siteId}/documents/${ID}`)).status, 200); // opened before the remote moves
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

  /** Push a new post from another clone; returns its id. */
  function pushRemotePost(slug = 'remote') {
    const other = fx.clone(`other-${slug}`);
    const id = `doc_${slug}0001`;
    write(other, `content/posts/${slug}.json`, JSON.stringify({ id, meta: { title: 'From elsewhere', slug, collection: 'posts', status: 'draft' }, blocks: [] }, null, 2) + '\n');
    git(other, 'add', '-A');
    git(other, 'commit', '-m', 'other machine');
    git(other, 'push');
    return id;
  }
  const docIds = async () => (await api(`/api/sites/${siteId}/documents`)).data.map((d) => d.id);

  test('opening a site fast-forwards it first, so a post from another machine is there', async () => {
    await open();
    const remoteId = pushRemotePost();
    assert.ok((await docIds()).includes(remoteId));
    assert.equal(git(fx.site, 'rev-parse', 'HEAD'), git(fx.remote, 'rev-parse', 'main'));
  });

  test('opening a site with uncommitted changes in VP paths skips the pull', async () => {
    await open();
    const remoteId = pushRemotePost();
    write(fx.site, 'config/vp.json', '{"theme":"local"}\n'); // unsaved local VP work
    const before = git(fx.site, 'rev-parse', 'HEAD');
    assert.ok(!(await docIds()).includes(remoteId));
    assert.equal(git(fx.site, 'rev-parse', 'HEAD'), before);
  });

  test('a failing pull on open is logged and the site still opens', async () => {
    const failing = { ...realGit, pullFastForward: async () => { throw new realGit.GitError('git pull failed: offline', 'offline'); } };
    await open({ git: failing });
    assert.ok((await docIds()).includes(ID));
  });

  test('a backup push that rebased re-syncs the store', async () => {
    await open();
    assert.ok((await docIds()).includes(ID)); // site open
    const remoteId = pushRemotePost();
    await api(`/api/sites/${siteId}/documents/${ID}`, { method: 'PUT', body: { meta: { title: 'Hello 2' } } });
    assert.equal((await api(`/api/sites/${siteId}/backup`, { method: 'POST' })).data.error, null);
    assert.ok((await docIds()).includes(remoteId));
  });

  test('a publish push that rebased re-syncs the store', async () => {
    await open();
    assert.ok((await docIds()).includes(ID));
    const remoteId = pushRemotePost();
    const res = await api(`/api/sites/${siteId}/documents/${ID}/publish`, { method: 'POST' });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.ok((await docIds()).includes(remoteId));
  });

  test('a rebase conflict on publish names the next step', async () => {
    await open();
    assert.ok((await docIds()).includes(ID));
    const other = fx.clone('other');
    const p = join(other, 'content', 'posts', 'hello.json');
    const doc = JSON.parse(readFileSync(p, 'utf8'));
    doc.meta.status = 'archived';
    writeFileSync(p, JSON.stringify(doc, null, 2) + '\n');
    git(other, 'commit', '-am', 'remote edit');
    git(other, 'push');
    const res = await api(`/api/sites/${siteId}/documents/${ID}/publish`, { method: 'POST' });
    assert.equal(res.status, 409);
    assert.match(res.data.error, /resolve the conflict in content\/posts\/hello\.json, then publish again/);
  });

  test('removing a site pushes its pending saves first', async () => {
    await open();
    await api(`/api/sites/${siteId}/documents/${ID}`, { method: 'PUT', body: { meta: { title: 'Bye' } } });
    const res = await api(`/api/sites/${siteId}`, { method: 'DELETE' });
    assert.deepEqual(res.data, { ok: true });
    assert.equal(lastRemote(), 'Draft: Bye [CI Skip]');
    assert.equal((await api(`/api/sites/${siteId}/documents`)).status, 404);
  });

  test('removing a site during a publish lets the publish finish, then closes', async () => {
    let entered, release;
    const inBuild = new Promise((r) => { entered = r; });
    const gate = new Promise((r) => { release = r; });
    const slowBuild = async (dir) => { entered(); await gate; return runBuild(dir); };
    await open({ siteProcess: { runBuild: slowBuild } });
    const order = [];
    const publishing = api(`/api/sites/${siteId}/documents/${ID}/publish`, { method: 'POST' })
      .then((r) => { order.push('publish'); return r; });
    await inBuild;
    const removing = api(`/api/sites/${siteId}`, { method: 'DELETE' }).then((r) => { order.push('delete'); return r; });
    await new Promise((r) => setTimeout(r, 200));
    assert.deepEqual(order, []); // the removal waits for the publish
    release();
    const [pub, del] = await Promise.all([publishing, removing]);
    assert.equal(pub.status, 200, JSON.stringify(pub.data));
    assert.equal(pub.data.status, 'pushed');
    assert.deepEqual(del.data, { ok: true });
    assert.deepEqual(order, ['publish', 'delete']);
    assert.equal(lastRemote(), 'Publish: Hello');
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
