/**
 * API sync tests: with a site workspace every document change is synced
 * into the Cook site; without one (fixture mode) nothing is written.
 */

import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { migrate } from '../../src/store/migrate.js';
import { createRouter, sendJson } from '../../src/server/router.js';
import { mountApi } from '../../src/server/api.js';
import { resolveWorkspace, openWorkspaceDb } from '../../src/workspace/workspace.js';
import { setConfig } from '../../src/store/config.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Start an API server; returns { api, close }. */
async function startApi(db, options) {
  const router = createRouter();
  mountApi(router, db, { rootDir: repoRoot, ...options });
  // Same catch-all as src/server/index.js: an uncaught throw becomes a text/plain 500.
  const server = createServer(async (req, res) => {
    try {
      if (!(await router.handle(req, res))) sendJson(res, 404, { error: 'Not found' });
    } catch {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
      }
    }
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  async function api(path, { method = 'GET', body, form } = {}) {
    const opts = { method };
    if (form) opts.body = form;
    else if (body !== undefined) {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`http://localhost:${port}${path}`, opts);
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { notJson: text }; }
    return { status: res.status, data };
  }
  return { api, close: () => new Promise((r) => server.close(r)) };
}

const postBody = (meta = {}) => ({
  meta: {
    title: 'Hello',
    slug: 'hello',
    collection: 'posts',
    status: 'published',
    published: '2026-01-02T10:00:00.000Z',
    ...meta,
  },
  blocks: [{ type: 'paragraph', children: [{ type: 'text', value: 'Hi there.' }] }],
});

describe('API with a site workspace', () => {
  let site, ws, db, api, close, id;
  const JSON_REL = 'content/posts/hello.json';
  const HTML_REL = 'src/posts/hello.html';
  const at = (rel) => join(site, rel);

  before(async () => {
    site = mkdtempSync(join(tmpdir(), 'vp-sync-api-'));
    ws = resolveWorkspace({ site, repoRoot });
    db = openWorkspaceDb(ws);
    ({ api, close } = await startApi(db, { mediaDir: ws.mediaDir, workspace: ws }));
  });

  after(async () => {
    await close();
    db.close();
    rmSync(site, { recursive: true, force: true });
  });

  it('GET /api/workspace reports the site with sync enabled', async () => {
    const { status, data } = await api('/api/workspace');
    assert.equal(status, 200);
    assert.deepEqual(data, { site, syncEnabled: true, previewUrl: 'http://localhost:3000' });
  });

  it('GET /api/workspace reports a configured preview_url', async () => {
    setConfig(db, 'preview_url', 'http://localhost:4000');
    const { data } = await api('/api/workspace');
    assert.equal(data.previewUrl, 'http://localhost:4000');
    db.prepare("DELETE FROM config WHERE key = 'preview_url'").run();
  });

  it('POST a published doc syncs JSON and HTML', async () => {
    const { status, data } = await api('/api/documents', { method: 'POST', body: postBody() });
    assert.equal(status, 201);
    id = data.id;
    assert.ok(existsSync(at(JSON_REL)));
    assert.ok(existsSync(at(HTML_REL)));
    assert.equal(JSON.parse(readFileSync(at(JSON_REL), 'utf8')).id, id);
  });

  it('PUT status draft removes the HTML and keeps the JSON', async () => {
    const { status } = await api(`/api/documents/${id}`, { method: 'PUT', body: { meta: { status: 'draft' } } });
    assert.equal(status, 200);
    assert.ok(!existsSync(at(HTML_REL)));
    assert.ok(existsSync(at(JSON_REL)));
  });

  it('PUT after a hand edit on disk is a 409 and does not save', async () => {
    const onDisk = JSON.parse(readFileSync(at(JSON_REL), 'utf8'));
    onDisk.meta.title = 'Edited on disk';
    writeFileSync(at(JSON_REL), JSON.stringify(onDisk, null, 2) + '\n');

    const put = await api(`/api/documents/${id}`, { method: 'PUT', body: { meta: { title: 'Edited in VP' } } });
    assert.equal(put.status, 409);
    assert.equal(put.data.error, 'This document changed on disk (e.g. git pull).');
    assert.equal(put.data.path, JSON_REL);

    const get = await api(`/api/documents/${id}`);
    assert.equal(get.data.meta.title, 'Hello');
    assert.equal(JSON.parse(readFileSync(at(JSON_REL), 'utf8')).meta.title, 'Edited on disk');
  });

  it('POST /api/documents/:id/reload loads the on-disk version, then PUT succeeds', async () => {
    const reload = await api(`/api/documents/${id}/reload`, { method: 'POST' });
    assert.equal(reload.status, 200);
    assert.equal(reload.data.meta.title, 'Edited on disk');

    const put = await api(`/api/documents/${id}`, { method: 'PUT', body: { meta: { title: 'After reload' } } });
    assert.equal(put.status, 200);
    assert.equal(JSON.parse(readFileSync(at(JSON_REL), 'utf8')).meta.title, 'After reload');
  });

  it('POST with an existing id is also checked for conflicts', async () => {
    const onDisk = JSON.parse(readFileSync(at(JSON_REL), 'utf8'));
    onDisk.meta.title = 'Edited again';
    writeFileSync(at(JSON_REL), JSON.stringify(onDisk, null, 2) + '\n');

    const post = await api('/api/documents', { method: 'POST', body: { id, ...postBody({ title: 'Clobber' }) } });
    assert.equal(post.status, 409);
    assert.equal(post.data.path, JSON_REL);
    assert.equal((await api(`/api/documents/${id}`)).data.meta.title, 'After reload');
    await api(`/api/documents/${id}/reload`, { method: 'POST' });
  });

  it('POST /api/sync re-syncs every document', async () => {
    await api(`/api/documents/${id}`, { method: 'PUT', body: { meta: { status: 'published' } } });
    rmSync(at(HTML_REL));
    const { status, data } = await api('/api/sync', { method: 'POST' });
    assert.equal(status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.synced, 1);
    assert.deepEqual(data.conflicts, []);
    assert.ok(existsSync(at(HTML_REL)));
    assert.ok(existsSync(at('content/media.json')));
    assert.deepEqual(JSON.parse(readFileSync(at('config/vp.json'), 'utf8')), { theme: 'default' });
  });

  it('DELETE of a published doc is refused (409) and deletes nothing', async () => {
    const published = await api(`/api/documents/${id}`);
    assert.equal(published.data.meta.status, 'published');
    const res = await api(`/api/documents/${id}`, { method: 'DELETE' });
    assert.equal(res.status, 409);
    assert.equal(res.data.error, 'Unpublish this post before deleting it.');
    assert.ok(existsSync(at(JSON_REL)));
    assert.ok(existsSync(at(HTML_REL)));
    const list = await api('/api/documents');
    assert.ok(JSON.stringify(list.data).includes(id));
  });

  it('DELETE removes both files', async () => {
    await api(`/api/documents/${id}`, { method: 'PUT', body: { meta: { status: 'draft' } } });
    const { status } = await api(`/api/documents/${id}`, { method: 'DELETE' });
    assert.equal(status, 200);
    assert.ok(!existsSync(at(JSON_REL)));
    assert.ok(!existsSync(at(HTML_REL)));
  });

  it('media.json follows upload, alt edit and delete', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 20, 0, 10, 1, 1, 0x11, 0]);
    const form = new FormData();
    form.append('file', new Blob([jpeg], { type: 'image/jpeg' }), 'pic.jpg');
    form.append('alt', 'A picture');
    const { status, data } = await api('/api/media', { method: 'POST', form });
    assert.equal(status, 201);
    assert.ok(existsSync(join(site, 'src', 'media', data.filename)));
    const read = () => JSON.parse(readFileSync(at('content/media.json'), 'utf8'));
    assert.equal(read().length, 1);
    assert.equal(read()[0].filename, data.filename);
    assert.equal(read()[0].alt, 'A picture');
    assert.equal(read()[0].original_name, 'pic.jpg');
    assert.equal(read()[0].width, 10);

    await api(`/api/media/${data.id}`, { method: 'PUT', body: { alt: '' } });
    assert.equal(read()[0].alt, '');
    await api(`/api/media/${data.id}`, { method: 'PUT', body: { alt: null } });
    assert.equal(read()[0].alt, null);

    const del = await api(`/api/media/${data.id}`, { method: 'DELETE' });
    assert.equal(del.status, 200);
    assert.deepEqual(read(), []);
    assert.ok(!existsSync(join(site, 'src', 'media', data.filename)));
  });

  it('PUT /api/config/theme writes config/vp.json', async () => {
    const { status } = await api('/api/config/theme', { method: 'PUT', body: { value: 'amber' } });
    assert.equal(status, 200);
    assert.deepEqual(JSON.parse(readFileSync(at('config/vp.json'), 'utf8')), { theme: 'amber' });
  });
});

describe('API refuses saves whose sync would be rejected', () => {
  let site, ws, db, api, close, id;
  const at = (rel) => join(site, rel);
  /** Every file under the site (except the store) with its contents. */
  const snapshot = () => {
    const out = [];
    const walk = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const abs = join(d, e.name);
        if (e.name === '.vp') continue;
        if (e.isDirectory()) walk(abs); else out.push(`${abs}:${readFileSync(abs, 'utf8')}`);
      }
    };
    walk(site);
    return out.sort();
  };

  before(async () => {
    site = mkdtempSync(join(tmpdir(), 'vp-sync-preflight-'));
    ws = resolveWorkspace({ site, repoRoot });
    db = openWorkspaceDb(ws);
    ({ api, close } = await startApi(db, { mediaDir: ws.mediaDir, workspace: ws }));
    const { data } = await api('/api/documents', { method: 'POST', body: postBody() });
    id = data.id;
  });

  after(async () => {
    await close();
    db.close();
    rmSync(site, { recursive: true, force: true });
  });

  it('renaming onto a hand-written HTML page is 422 Not saved, with nothing changed', async () => {
    mkdirSync(at('src/posts'), { recursive: true });
    writeFileSync(at('src/posts/foreign.html'), '<p>mine</p>\n');
    const before = snapshot();

    const put = await api(`/api/documents/${id}`, { method: 'PUT', body: { meta: { slug: 'foreign' } } });
    assert.equal(put.status, 422);
    assert.match(put.data.error, /^Not saved: /);
    assert.equal(put.data.path, undefined);
    assert.equal((await api(`/api/documents/${id}`)).data.meta.slug, 'hello');
    assert.deepEqual(snapshot(), before);
  });

  it('renaming onto an unowned JSON file is 422 Not saved, with nothing changed', async () => {
    mkdirSync(at('content/posts'), { recursive: true });
    writeFileSync(at('content/posts/unowned.json'), '{"not":"vp"}\n');
    const before = snapshot();

    const put = await api(`/api/documents/${id}`, { method: 'PUT', body: { meta: { slug: 'unowned' } } });
    assert.equal(put.status, 422);
    assert.match(put.data.error, /^Not saved: /);
    assert.equal((await api(`/api/documents/${id}`)).data.meta.slug, 'hello');
    assert.deepEqual(snapshot(), before);
  });

  it('creating a new doc onto an unowned JSON file is 422 and saves nothing', async () => {
    const post = await api('/api/documents', { method: 'POST', body: { id: 'doc_newone1', ...postBody({ slug: 'unowned' }) } });
    assert.equal(post.status, 422);
    assert.match(post.data.error, /^Not saved: /);
    assert.equal((await api('/api/documents/doc_newone1')).status, 404);
  });

  it('a normal edit afterwards still saves and syncs', async () => {
    const put = await api(`/api/documents/${id}`, { method: 'PUT', body: { meta: { title: 'Still fine' } } });
    assert.equal(put.status, 200);
    assert.equal(JSON.parse(readFileSync(at('content/posts/hello.json'), 'utf8')).meta.title, 'Still fine');
  });
});

describe('API errors are JSON (final fix)', () => {
  let site, ws, db, api, close, id;
  const at = (rel) => join(site, rel);

  before(async () => {
    site = mkdtempSync(join(tmpdir(), 'vp-sync-errors-'));
    ws = resolveWorkspace({ site, repoRoot });
    db = openWorkspaceDb(ws);
    ({ api, close } = await startApi(db, { mediaDir: ws.mediaDir, workspace: ws }));
    id = (await api('/api/documents', { method: 'POST', body: postBody() })).data.id;
  });

  after(async () => {
    await close();
    db.close();
    rmSync(site, { recursive: true, force: true });
  });

  it('a reserved collection name is 422 Not saved', async () => {
    const post = await api('/api/documents', { method: 'POST', body: postBody({ collection: 'layouts', slug: 'x' }) });
    assert.equal(post.status, 422);
    assert.match(post.data.error, /^Not saved: Reserved collection name: layouts/);
  });

  it('a corrupt local manifest makes PUT a JSON 500 naming the manifest, and saves nothing', async () => {
    // A published post can't be deleted at all; make it a draft so the delete reaches the manifest.
    assert.equal((await api(`/api/documents/${id}`, { method: 'PUT', body: { meta: { status: 'draft' } } })).status, 200);
    const good = readFileSync(at('.vp/manifest.json'), 'utf8');
    writeFileSync(at('.vp/manifest.json'), '{not json');
    mock.method(console, 'error', () => {});
    try {
      const put = await api(`/api/documents/${id}`, { method: 'PUT', body: { meta: { title: 'Lost' } } });
      assert.equal(put.status, 500);
      assert.match(put.data.error, /\.vp\/manifest\.json/);
      assert.equal((await api(`/api/documents/${id}`)).data.meta.title, 'Hello');
      assert.equal(JSON.parse(readFileSync(at('content/posts/hello.json'), 'utf8')).meta.title, 'Hello');

      const post = await api('/api/documents', { method: 'POST', body: postBody({ slug: 'other' }) });
      assert.equal(post.status, 500);
      assert.match(post.data.error, /manifest/);

      const del = await api(`/api/documents/${id}`, { method: 'DELETE' });
      assert.equal(del.status, 500);
      assert.match(del.data.error, /manifest/);
      assert.equal((await api(`/api/documents/${id}`)).status, 200);

      const reload = await api(`/api/documents/${id}/reload`, { method: 'POST' });
      assert.ok(reload.status >= 400 && typeof reload.data.error === 'string');
    } finally {
      mock.restoreAll();
      writeFileSync(at('.vp/manifest.json'), good);
    }
  });
});

describe('API in fixture mode', () => {
  let db, api, close, mediaDir;

  before(async () => {
    mediaDir = mkdtempSync(join(tmpdir(), 'vp-fixture-media-'));
    db = new Database(':memory:');
    migrate(db);
    ({ api, close } = await startApi(db, { mediaDir }));
  });

  after(async () => {
    await close();
    db.close();
    rmSync(mediaDir, { recursive: true, force: true });
  });

  it('GET /api/workspace reports sync disabled', async () => {
    const { data } = await api('/api/workspace');
    assert.deepEqual(data, { site: null, syncEnabled: false, previewUrl: 'http://localhost:3000' });
  });

  it('POST writes no synced files into the repo', async () => {
    const slug = 'fixture-mode-no-sync';
    const { status } = await api('/api/documents', { method: 'POST', body: postBody({ slug }) });
    assert.equal(status, 201);
    assert.ok(!existsSync(join(repoRoot, 'content', 'posts', `${slug}.json`)));
    assert.ok(!existsSync(join(repoRoot, 'src', 'posts', `${slug}.html`)));
    assert.ok(!existsSync(join(repoRoot, 'content', '.vp-manifest.json')));
    assert.ok(!existsSync(join(repoRoot, '.vp', 'manifest.json')));
  });

  it('POST /api/sync syncs nothing', async () => {
    const { status, data } = await api('/api/sync', { method: 'POST' });
    assert.equal(status, 200);
    assert.deepEqual(data, { ok: true, synced: 0 });
  });
});
