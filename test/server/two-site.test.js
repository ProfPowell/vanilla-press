/**
 * Two machines editing the same Cook site: site A and site B are copies of
 * the same tracked files (content/ and src/, never .vp/), each with its own
 * store. Pulled edits must be detected and A's published pages must be
 * editable on B.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, existsSync, readFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRouter, sendJson } from '../../src/server/router.js';
import { mountApi } from '../../src/server/api.js';
import { resolveWorkspace, openWorkspaceDb } from '../../src/workspace/workspace.js';
import { syncFromContent } from '../../src/export/sync.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

async function startSite() {
  const site = mkdtempSync(join(tmpdir(), 'vp-two-site-'));
  const ws = resolveWorkspace({ site, repoRoot });
  const db = openWorkspaceDb(ws);
  const router = createRouter();
  mountApi(router, db, { rootDir: repoRoot, mediaDir: ws.mediaDir, workspace: ws });
  const server = createServer(async (req, res) => {
    if (!(await router.handle(req, res))) sendJson(res, 404, { error: 'Not found' });
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  async function api(path, { method = 'GET', body } = {}) {
    const opts = { method };
    if (body !== undefined) {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`http://localhost:${port}${path}`, opts);
    return { status: res.status, data: await res.json() };
  }
  const at = (rel) => join(site, rel);
  const close = async () => {
    await new Promise((r) => server.close(r));
    db.close();
    rmSync(site, { recursive: true, force: true });
  };
  return { site, ws, db, api, at, close };
}

/** `git pull`: replace B's tracked files (content/, src/) with A's. */
function pull(from, to) {
  for (const dir of ['content', 'src']) {
    rmSync(to.at(dir), { recursive: true, force: true });
    if (existsSync(from.at(dir))) cpSync(from.at(dir), to.at(dir), { recursive: true });
  }
}

describe('two sites sharing tracked files', () => {
  let A, B;
  const ID = 'doc_shared1';
  const JSON_REL = 'content/posts/hello.json';
  const HTML_REL = 'src/posts/hello.html';
  const body = {
    id: ID,
    meta: { title: 'Hello', slug: 'hello', collection: 'posts', status: 'published', published: '2026-01-02T10:00:00.000Z' },
    blocks: [{ type: 'paragraph', children: [{ type: 'text', value: 'Hi.' }] }],
  };

  before(async () => {
    A = await startSite();
    B = await startSite();
  });
  after(async () => {
    await A.close();
    await B.close();
  });

  it('(a) B can edit a post A published', async () => {
    assert.equal((await A.api('/api/documents', { method: 'POST', body })).status, 201);
    pull(A, B);
    assert.deepEqual(syncFromContent(B.ws, B.db).imported, [ID]);

    const put = await B.api(`/api/documents/${ID}`, { method: 'PUT', body: { meta: { title: 'B edit' } } });
    assert.equal(put.status, 200, JSON.stringify(put.data));
    assert.match(readFileSync(B.at(HTML_REL), 'utf8'), /title: "B edit"/);
    assert.equal(JSON.parse(readFileSync(B.at(JSON_REL), 'utf8')).meta.title, 'B edit');
  });

  it('(b) an edit pulled from A is detected on B without a restart', async () => {
    assert.equal((await A.api(`/api/documents/${ID}`, { method: 'PUT', body: { meta: { title: 'A edit' } } })).status, 200);
    pull(A, B);

    const put = await B.api(`/api/documents/${ID}`, { method: 'PUT', body: { meta: { title: 'B clobber' } } });
    assert.equal(put.status, 409, JSON.stringify(put.data));
    assert.equal((await B.api(`/api/documents/${ID}`)).data.meta.title, 'B edit');
    assert.equal(JSON.parse(readFileSync(B.at(JSON_REL), 'utf8')).meta.title, 'A edit');

    const reload = await B.api(`/api/documents/${ID}/reload`, { method: 'POST' });
    assert.equal(reload.status, 200);
    assert.equal(reload.data.meta.title, 'A edit');

    const again = await B.api(`/api/documents/${ID}`, { method: 'PUT', body: { meta: { title: 'B after pull' } } });
    assert.equal(again.status, 200, JSON.stringify(again.data));
    assert.match(readFileSync(B.at(HTML_REL), 'utf8'), /title: "B after pull"/);
  });

  it('(c) B renames the post A published: old files removed, new written', async () => {
    const put = await B.api(`/api/documents/${ID}`, { method: 'PUT', body: { meta: { slug: 'renamed' } } });
    assert.equal(put.status, 200, JSON.stringify(put.data));
    assert.ok(!existsSync(B.at(JSON_REL)));
    assert.ok(!existsSync(B.at(HTML_REL)));
    assert.ok(existsSync(B.at('content/posts/renamed.json')));
    assert.ok(existsSync(B.at('src/posts/renamed.html')));
  });
});
