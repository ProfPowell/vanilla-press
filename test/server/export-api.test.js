/**
 * API export tests: with a site workspace every document change is exported
 * into the Cook site; without one (fixture mode) nothing is written.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { migrate } from '../../src/store/migrate.js';
import { createRouter, sendJson } from '../../src/server/router.js';
import { mountApi } from '../../src/server/api.js';
import { resolveWorkspace, openWorkspaceDb } from '../../src/workspace/workspace.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Start an API server; returns { api, close }. */
async function startApi(db, options) {
  const router = createRouter();
  mountApi(router, db, { rootDir: repoRoot, ...options });
  const server = createServer(async (req, res) => {
    if (!(await router.handle(req, res))) sendJson(res, 404, { error: 'Not found' });
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
    return { status: res.status, data: await res.json() };
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
    site = mkdtempSync(join(tmpdir(), 'vp-export-api-'));
    ws = resolveWorkspace({ site, repoRoot });
    db = openWorkspaceDb(ws);
    ({ api, close } = await startApi(db, { mediaDir: ws.mediaDir, workspace: ws }));
  });

  after(async () => {
    await close();
    db.close();
    rmSync(site, { recursive: true, force: true });
  });

  it('GET /api/workspace reports the site with export enabled', async () => {
    const { status, data } = await api('/api/workspace');
    assert.equal(status, 200);
    assert.deepEqual(data, { site, exportEnabled: true });
  });

  it('POST a published doc exports JSON and HTML', async () => {
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

  it('POST /api/publish re-exports every document', async () => {
    await api(`/api/documents/${id}`, { method: 'PUT', body: { meta: { status: 'published' } } });
    rmSync(at(HTML_REL));
    const { status, data } = await api('/api/publish', { method: 'POST' });
    assert.equal(status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.exported, 1);
    assert.deepEqual(data.conflicts, []);
    assert.ok(existsSync(at(HTML_REL)));
    assert.ok(existsSync(at('content/media.json')));
    assert.deepEqual(JSON.parse(readFileSync(at('config/vp.json'), 'utf8')), { theme: 'default' });
  });

  it('DELETE removes both files', async () => {
    const { status } = await api(`/api/documents/${id}`, { method: 'DELETE' });
    assert.equal(status, 200);
    assert.ok(!existsSync(at(JSON_REL)));
    assert.ok(!existsSync(at(HTML_REL)));
  });

  it('media upload lands in src/media and is listed in content/media.json', async () => {
    const form = new FormData();
    form.append('file', new Blob([Buffer.from('PNGDATA')], { type: 'image/png' }), 'pic.png');
    form.append('alt', 'A picture');
    const { status, data } = await api('/api/media', { method: 'POST', form });
    assert.equal(status, 201);
    assert.ok(existsSync(join(site, 'src', 'media', data.filename)));
    const media = JSON.parse(readFileSync(at('content/media.json'), 'utf8'));
    assert.ok(Array.isArray(media));
    assert.equal(media.length, 1);
    assert.equal(media[0].filename, data.filename);
    assert.equal(media[0].alt, 'A picture');
  });

  it('PUT /api/config/theme writes config/vp.json', async () => {
    const { status } = await api('/api/config/theme', { method: 'PUT', body: { value: 'amber' } });
    assert.equal(status, 200);
    assert.deepEqual(JSON.parse(readFileSync(at('config/vp.json'), 'utf8')), { theme: 'amber' });
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

  it('GET /api/workspace reports export disabled', async () => {
    const { data } = await api('/api/workspace');
    assert.deepEqual(data, { site: null, exportEnabled: false });
  });

  it('POST writes no export files into the repo', async () => {
    const slug = 'fixture-mode-no-export';
    const { status } = await api('/api/documents', { method: 'POST', body: postBody({ slug }) });
    assert.equal(status, 201);
    assert.ok(!existsSync(join(repoRoot, 'content', 'posts', `${slug}.json`)));
    assert.ok(!existsSync(join(repoRoot, 'src', 'posts', `${slug}.html`)));
    assert.ok(!existsSync(join(repoRoot, 'content', '.vp-manifest.json')));
  });

  it('POST /api/publish exports nothing', async () => {
    const { status, data } = await api('/api/publish', { method: 'POST' });
    assert.equal(status, 200);
    assert.deepEqual(data, { ok: true, exported: 0 });
  });
});
