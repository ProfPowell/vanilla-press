import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { publishCatalog } from '../../src/app/catalog-publish.js';
import { BuildError, PublishRejectedError } from '../../src/app/publish.js';
import * as realGit from '../../src/git/git.js';
import { ensureInstalled, runBuild } from '../../src/app/site-process.js';
import { startApp } from '../../src/app/server.js';
import { resolveWorkspace, openWorkspaceDb } from '../../src/workspace/workspace.js';
import { saveDocument } from '../../src/store/content.js';
import { createCatalog, createItem, getItem, updateCatalog, updateItem } from '../../src/store/catalogs.js';
import { designFromTemplate } from '../../src/catalogs/templates.js';
import { writeMediaJson } from '../../src/sync/site-files.js';
import { makeGitSite, fakeClock, git, write, BUILD_FAIL } from './git-site-fixture.js';

const repoRoot = join(import.meta.dirname, '..', '..');
const FILE = 'content/catalogs/retro-games.json';

let fx, db;
afterEach(() => {
  db?.close();
  db = null;
  if (fx) rmSync(fx.root, { recursive: true, force: true });
  fx = null;
});

const addMedia = (filename, access = 'public') => db.prepare(
  `INSERT INTO media (id, filename, mime_type, size, created, access) VALUES (?, ?, 'image/jpeg', 1, '2026-11-01T00:00:00.000Z', ?)`,
).run(`m_${filename}`, filename, access);

/** A git site with a Retro games collection, photo a.jpg (public) in the library, media.json committed and pushed. */
function setup() {
  fx = makeGitSite();
  const ws = resolveWorkspace({ site: fx.site, env: {}, repoRoot });
  db = openWorkspaceDb(ws);
  const catalog = createCatalog(db, { title: 'Retro games', template: 'retro-games', design: designFromTemplate('retro-games') });
  write(fx.site, 'src/media/a.jpg', 'jpeg');
  addMedia('a.jpg');
  writeMediaJson(ws, db);
  git(fx.site, 'add', 'content');
  git(fx.site, 'commit', '-m', 'media');
  git(fx.site, 'push');
  return { ws, catalog };
}

const deps = () => ({ ensureInstalled, runBuild, ...realGit });
const lastRemote = () => git(fx.remote, 'log', '-1', '--format=%s', 'main');
const remoteChanged = () => git(fx.remote, 'show', '--name-only', '--format=', 'main').split('\n').filter(Boolean).sort();
const readData = () => JSON.parse(readFileSync(join(fx.site, FILE), 'utf8'));
const mediaJson = () => JSON.parse(readFileSync(join(fx.site, 'content', 'media.json'), 'utf8'));

describe('publishCatalog', () => {
  test('publish writes the file and commits exactly those paths', async () => {
    const { ws, catalog } = setup();
    const item = createItem(db, catalog.id, { title: 'Super Mario Bros. 3', photos: [{ file: 'a.jpg', main: true }] });
    createItem(db, catalog.id, { title: 'A draft' });
    write(fx.site, 'content/unrelated.json', '{}\n');
    const res = await publishCatalog({ ws, db, catalogId: catalog.id, change: { itemId: item.id, publish: true }, deps: deps() });
    assert.equal(res.sha, git(fx.site, 'rev-parse', 'HEAD'));
    assert.equal(res.url, 'https://example.com/collections/retro-games/super-mario-bros-3/');
    assert.equal(lastRemote(), 'Publish collection item: Super Mario Bros. 3');
    assert.deepEqual(remoteChanged(), [FILE, 'src/media/a.jpg']);
    const stored = getItem(db, item.id);
    assert.equal(stored.status, 'published');
    assert.ok(stored.published);
    assert.deepEqual(readData().items.map((i) => i.title), ['Super Mario Bros. 3']);
    assert.match(git(fx.site, 'status', '--porcelain'), /content\/unrelated\.json/);
  });

  test('publishCatalog warns with the posts that share a photo', async () => {
    const { ws, catalog } = setup();
    saveDocument(db, {
      id: 'doc_trip', meta: { title: 'My trip', slug: 'trip', collection: 'posts', status: 'published' },
      blocks: [{ type: 'figure', attrs: { src: '/media/a.jpg' }, children: [] }],
    });
    const item = createItem(db, catalog.id, { title: 'Mine', access: 'friends', photos: [{ file: 'a.jpg' }] });
    const before = git(fx.site, 'rev-parse', 'HEAD');
    await assert.rejects(
      publishCatalog({ ws, db, catalogId: catalog.id, change: { itemId: item.id, publish: true }, deps: deps() }),
      (err) => err instanceof PublishRejectedError && err.status === 409
        && err.body.photoWarnings.length === 1
        && err.body.photoWarnings[0].file === 'a.jpg'
        && err.body.photoWarnings[0].access === 'public'
        && err.body.photoWarnings[0].needed === 'friends'
        && err.body.photoWarnings[0].posts.join() === 'My trip'
        && typeof err.body.error === 'string',
    );
    assert.equal(getItem(db, item.id).status, 'draft');
    assert.equal(existsSync(join(fx.site, FILE)), false);
    assert.equal(git(fx.site, 'rev-parse', 'HEAD'), before);
  });

  test('confirming raises the photo to the item level in the DB and media.json', async () => {
    const { ws, catalog } = setup();
    const item = createItem(db, catalog.id, { title: 'Mine', access: 'friends', photos: [{ file: 'a.jpg' }] });
    await publishCatalog({
      ws, db, catalogId: catalog.id, change: { itemId: item.id, publish: true }, confirmRaisePhotoAccess: true, deps: deps(),
    });
    assert.equal(db.prepare("SELECT access FROM media WHERE filename = 'a.jpg'").get().access, 'friends');
    assert.equal(mediaJson().find((m) => m.filename === 'a.jpg').access, 'friends');
    assert.deepEqual(remoteChanged(), [FILE, 'content/media.json', 'src/media/a.jpg']);
  });

  test('a failing build restores the previous status and file and throws BuildError', async () => {
    const { ws, catalog } = setup();
    const first = createItem(db, catalog.id, { title: 'First' });
    await publishCatalog({ ws, db, catalogId: catalog.id, change: { itemId: first.id, publish: true }, deps: deps() });
    const fileBefore = readFileSync(join(fx.site, FILE), 'utf8');
    const second = createItem(db, catalog.id, { title: 'Second' });
    const secondBefore = getItem(db, second.id);
    write(fx.site, 'build.js', BUILD_FAIL);
    const remoteBefore = git(fx.remote, 'rev-parse', 'main');
    await assert.rejects(
      publishCatalog({ ws, db, catalogId: catalog.id, change: { itemId: second.id, publish: true }, deps: deps() }),
      (err) => err instanceof BuildError && /boom/.test(err.log),
    );
    assert.deepEqual(getItem(db, second.id), secondBefore);
    assert.equal(readFileSync(join(fx.site, FILE), 'utf8'), fileBefore);
    assert.equal(git(fx.remote, 'rev-parse', 'main'), remoteBefore);
  });

  test('a failing first publish leaves no file behind', async () => {
    const { ws, catalog } = setup();
    const item = createItem(db, catalog.id, { title: 'First' });
    write(fx.site, 'build.js', BUILD_FAIL);
    await assert.rejects(
      publishCatalog({ ws, db, catalogId: catalog.id, change: { itemId: item.id, publish: true }, deps: deps() }),
      BuildError,
    );
    assert.equal(getItem(db, item.id).published, null);
    assert.equal(existsSync(join(fx.site, FILE)), false);
  });

  test('unpublishing the last item writes a file with items: []', async () => {
    const { ws, catalog } = setup();
    const item = createItem(db, catalog.id, { title: 'Only' });
    await publishCatalog({ ws, db, catalogId: catalog.id, change: { itemId: item.id, publish: true }, deps: deps() });
    const res = await publishCatalog({ ws, db, catalogId: catalog.id, change: { itemId: item.id, publish: false }, deps: deps() });
    assert.equal(res.url, null);
    assert.deepEqual(readData().items, []);
    assert.equal(lastRemote(), 'Unpublish collection item: Only');
    const stored = getItem(db, item.id);
    assert.equal(stored.status, 'draft');
    assert.ok(stored.published, 'published stays set: the item was published once');
  });

  test('a collection publish rewrites the file and checks every published item', async () => {
    const { ws, catalog } = setup();
    const item = createItem(db, catalog.id, { title: 'Mine', photos: [{ file: 'a.jpg' }] });
    await publishCatalog({ ws, db, catalogId: catalog.id, change: { itemId: item.id, publish: true }, deps: deps() });
    updateCatalog(db, catalog.id, { access: 'friends' });
    await assert.rejects(
      publishCatalog({ ws, db, catalogId: catalog.id, change: null, deps: deps() }),
      (err) => err instanceof PublishRejectedError && err.status === 409 && err.body.photoWarnings[0].needed === 'friends',
    );
    const res = await publishCatalog({ ws, db, catalogId: catalog.id, change: null, confirmRaisePhotoAccess: true, deps: deps() });
    assert.equal(res.url, 'https://example.com/collections/retro-games/');
    assert.equal(lastRemote(), 'Update collection: Retro games');
    assert.equal(readData().catalog.access, 'friends');
  });

  test('refuses (422) an item with no title or a photo missing from src/media', async () => {
    const { ws, catalog } = setup();
    const untitled = createItem(db, catalog.id, { title: 'x' });
    db.prepare("UPDATE catalog_items SET title = '  ' WHERE id = ?").run(untitled.id);
    await assert.rejects(
      publishCatalog({ ws, db, catalogId: catalog.id, change: { itemId: untitled.id, publish: true }, deps: deps() }),
      (err) => err instanceof PublishRejectedError && err.status === 422,
    );
    addMedia('gone.jpg');
    const missing = createItem(db, catalog.id, { title: 'Missing', photos: [{ file: 'gone.jpg' }] });
    await assert.rejects(
      publishCatalog({ ws, db, catalogId: catalog.id, change: { itemId: missing.id, publish: true }, deps: deps() }),
      (err) => err instanceof PublishRejectedError && err.status === 422 && /gone\.jpg/.test(err.body.error),
    );
    assert.equal(getItem(db, missing.id).status, 'draft');
  });

  test('publishing another item checks the items already published at the collection\'s current level', async () => {
    const { ws, catalog } = setup();
    const first = createItem(db, catalog.id, { title: 'First', photos: [{ file: 'a.jpg' }] });
    await publishCatalog({ ws, db, catalogId: catalog.id, change: { itemId: first.id, publish: true }, deps: deps() });
    updateCatalog(db, catalog.id, { access: 'friends' });
    const second = createItem(db, catalog.id, { title: 'Second', access: 'friends' });
    await assert.rejects(
      publishCatalog({ ws, db, catalogId: catalog.id, change: { itemId: second.id, publish: true }, deps: deps() }),
      (err) => err instanceof PublishRejectedError && err.status === 409
        && err.body.photoWarnings.length === 1 && err.body.photoWarnings[0].file === 'a.jpg'
        && err.body.photoWarnings[0].item.id === first.id && err.body.photoWarnings[0].needed === 'friends',
    );
    assert.equal(getItem(db, second.id).status, 'draft');
  });

  test('a photo added to a published item is committed when another item is published', async () => {
    const { ws, catalog } = setup();
    const first = createItem(db, catalog.id, { title: 'First', photos: [{ file: 'a.jpg' }] });
    await publishCatalog({ ws, db, catalogId: catalog.id, change: { itemId: first.id, publish: true }, deps: deps() });
    write(fx.site, 'src/media/b.jpg', 'jpeg b');
    addMedia('b.jpg');
    updateItem(db, first.id, { photos: [{ file: 'a.jpg' }, { file: 'b.jpg' }] });
    const second = createItem(db, catalog.id, { title: 'Second' });
    await publishCatalog({ ws, db, catalogId: catalog.id, change: { itemId: second.id, publish: true }, deps: deps() });
    assert.ok(remoteChanged().includes('src/media/b.jpg'), remoteChanged().join());
    assert.deepEqual(readData().items.find((i) => i.id === first.id).photos.map((p) => p.file), ['a.jpg', 'b.jpg']);
  });

  test('a missing photo on another published item is refused (422)', async () => {
    const { ws, catalog } = setup();
    const first = createItem(db, catalog.id, { title: 'First' });
    await publishCatalog({ ws, db, catalogId: catalog.id, change: { itemId: first.id, publish: true }, deps: deps() });
    addMedia('gone.jpg');
    updateItem(db, first.id, { photos: [{ file: 'gone.jpg' }] });
    const second = createItem(db, catalog.id, { title: 'Second' });
    await assert.rejects(
      publishCatalog({ ws, db, catalogId: catalog.id, change: { itemId: second.id, publish: true }, deps: deps() }),
      (err) => err instanceof PublishRejectedError && err.status === 422 && /gone\.jpg/.test(err.body.error),
    );
    assert.equal(getItem(db, second.id).status, 'draft');
  });

  test('a photo with no media row is refused (422), even when confirmed', async () => {
    const { ws, catalog } = setup();
    write(fx.site, 'src/media/norow.jpg', 'jpeg');
    const item = createItem(db, catalog.id, { title: 'Mine', access: 'friends', photos: [{ file: 'norow.jpg' }] });
    const before = git(fx.site, 'rev-parse', 'HEAD');
    await assert.rejects(
      publishCatalog({
        ws, db, catalogId: catalog.id, change: { itemId: item.id, publish: true }, confirmRaisePhotoAccess: true, deps: deps(),
      }),
      (err) => err instanceof PublishRejectedError && err.status === 422
        && err.body.error === "This photo isn't in the media library: norow.jpg. Re-add it to the item.",
    );
    assert.equal(getItem(db, item.id).status, 'draft');
    assert.equal(existsSync(join(fx.site, FILE)), false);
    assert.equal(git(fx.site, 'rev-parse', 'HEAD'), before);
  });

  test('a photo with no media row on another published item is refused (422)', async () => {
    const { ws, catalog } = setup();
    const first = createItem(db, catalog.id, { title: 'First' });
    await publishCatalog({ ws, db, catalogId: catalog.id, change: { itemId: first.id, publish: true }, deps: deps() });
    write(fx.site, 'src/media/norow.jpg', 'jpeg');
    updateItem(db, first.id, { photos: [{ file: 'norow.jpg' }] });
    await assert.rejects(
      publishCatalog({ ws, db, catalogId: catalog.id, change: null, confirmRaisePhotoAccess: true, deps: deps() }),
      (err) => err instanceof PublishRejectedError && err.status === 422 && /isn't in the media library: norow\.jpg/.test(err.body.error),
    );
  });

  test('an unknown collection or item is 404', async () => {
    const { ws, catalog } = setup();
    await assert.rejects(
      publishCatalog({ ws, db, catalogId: 'cat_nope', change: null, deps: deps() }),
      (err) => err instanceof PublishRejectedError && err.status === 404,
    );
    await assert.rejects(
      publishCatalog({ ws, db, catalogId: catalog.id, change: { itemId: 'item_nope', publish: true }, deps: deps() }),
      (err) => err instanceof PublishRejectedError && err.status === 404,
    );
  });
});

describe('collection publish routes', () => {
  let app, siteId;

  async function api(path, { method = 'GET', body } = {}) {
    const opts = { method };
    if (body !== undefined) {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`${app.url}/api/sites/${siteId}${path}`, opts);
    return { status: res.status, data: res.status === 204 ? null : await res.json() };
  }

  afterEach(async () => { await app?.close(); app = null; });

  test('publish, unpublish and collection publish through the API', async () => {
    fx = makeGitSite();
    const clock = fakeClock();
    app = await startApp({
      port: 0, env: { VP_CONFIG_DIR: join(fx.root, 'vp-config') },
      previews: { start() {}, stop: async () => {}, stopAll: async () => {} },
      backup: { now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer },
    });
    const added = await fetch(`${app.url}/api/sites`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: fx.site }),
    });
    siteId = (await added.json()).id;
    const cat = (await api('/catalogs', { method: 'POST', body: { title: 'Retro games', template: 'retro-games' } })).data;
    const item = (await api(`/catalogs/${cat.id}/items`, { method: 'POST', body: { title: 'Earthbound' } })).data;

    const pub = await api(`/catalogs/${cat.id}/items/${item.id}/publish`, { method: 'POST', body: {} });
    assert.equal(pub.status, 200, JSON.stringify(pub.data));
    assert.equal(pub.data.status, 'pushed');
    assert.equal(pub.data.url, 'https://example.com/collections/retro-games/earthbound/');
    assert.equal(lastRemote(), 'Publish collection item: Earthbound');
    assert.equal((await api(`/catalogs/${cat.id}/items/${item.id}`)).data.status, 'published');

    assert.equal((await api(`/catalogs/${cat.id}`, { method: 'PUT', body: { description: 'Games I own' } })).status, 200);
    const whole = await api(`/catalogs/${cat.id}/publish`, { method: 'POST', body: {} });
    assert.equal(whole.status, 200, JSON.stringify(whole.data));
    assert.equal(lastRemote(), 'Update collection: Retro games');
    assert.equal(readData().catalog.description, 'Games I own');

    const un = await api(`/catalogs/${cat.id}/items/${item.id}/unpublish`, { method: 'POST' });
    assert.equal(un.status, 200, JSON.stringify(un.data));
    assert.equal(lastRemote(), 'Unpublish collection item: Earthbound');
    assert.deepEqual(readData().items, []);

    assert.equal((await api(`/catalogs/${cat.id}/items/item_nope/publish`, { method: 'POST' })).status, 404);
    write(fx.site, 'build.js', BUILD_FAIL);
    const failed = await api(`/catalogs/${cat.id}/items/${item.id}/publish`, { method: 'POST' });
    assert.equal(failed.status, 422);
    assert.equal(failed.data.error, 'Build failed');
    assert.match(failed.data.log, /boom/);

    assert.equal((await api(`/catalogs/${cat.id}`, { method: 'DELETE' })).status, 204);
    assert.equal(existsSync(join(fx.site, FILE)), false);
  });
});
