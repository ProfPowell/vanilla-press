import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startApp } from '../../src/app/server.js';
import { createRouter, sendJson } from '../../src/server/router.js';
import { mountApi } from '../../src/server/api.js';
import { resolveWorkspace, openWorkspaceDb } from '../../src/workspace/workspace.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function makeSite(root, name) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, devDependencies: { 'cook-ssg': '^2.4.0' } }));
  return dir;
}

/** Every file under dir (relative), sorted. */
function tree(dir, base = dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? tree(p, base) : [p.slice(base.length + 1)];
  }).sort();
}

const fakeGit = {
  gitStatus: async () => ({ isRepo: true, branch: 'main', hasRemote: true, hasUpstream: false }),
  cloneRepo: async () => {},
};

const post = (id, slug, title = 'Hello') => ({
  id,
  meta: { title, slug, collection: 'posts', status: 'draft' },
  blocks: [{ type: 'paragraph', children: [{ type: 'text', value: 'Hi.' }] }],
});

describe('app server', () => {
  let root, env, app, siteA, siteB, idA, idB;

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
    return { status: res.status, data };
  }

  before(async () => {
    root = mkdtempSync(join(tmpdir(), 'vp-app-server-'));
    env = { VP_CONFIG_DIR: join(root, 'config') };
    siteA = makeSite(root, 'site-a');
    siteB = makeSite(root, 'site-b');
    // A post already on disk in A before the app first opens it.
    mkdirSync(join(siteA, 'content', 'posts'), { recursive: true });
    writeFileSync(join(siteA, 'content', 'posts', 'existing.json'),
      JSON.stringify(post('doc_exist001', 'existing', 'Existing'), null, 2));
    app = await startApp({ port: 0, env, git: fakeGit });
  });
  after(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('listens on 127.0.0.1', () => {
    assert.equal(app.server.address().address, '127.0.0.1');
    assert.match(app.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it('adds and lists sites', async () => {
    const a = await api('/api/sites', { method: 'POST', body: { path: siteA } });
    assert.equal(a.status, 201, JSON.stringify(a.data));
    assert.equal(a.data.path, siteA);
    const b = await api('/api/sites', { method: 'POST', body: { path: siteB } });
    assert.equal(b.status, 201);
    idA = a.data.id;
    idB = b.data.id;
    const list = await api('/api/sites');
    assert.equal(list.status, 200);
    assert.deepEqual(list.data.map((s) => s.id), [idA, idB]);
    assert.deepEqual(list.data[0].git, { connected: false, branch: 'main' });
  });

  it('rejects a non-Cook folder with 422', async () => {
    const dir = join(root, 'plain');
    mkdirSync(dir);
    const res = await api('/api/sites', { method: 'POST', body: { path: dir } });
    assert.equal(res.status, 422);
    assert.match(res.data.error, /Not a Cook site/);
  });

  it('opening a site syncs from its files', async () => {
    const res = await api(`/api/sites/${idA}/documents`);
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.deepEqual(res.data.map((d) => d.id), ['doc_exist001']);
  });

  it('per-site API creates and syncs a post', async () => {
    const res = await api(`/api/sites/${idA}/documents`, { method: 'POST', body: post('doc_a0000001', 'hello') });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.ok(existsSync(join(siteA, 'content', 'posts', 'hello.json')));
  });

  it('two sites are isolated', async () => {
    const before = tree(siteB);
    const res = await api(`/api/sites/${idA}/documents`, { method: 'POST', body: post('doc_a0000002', 'only-a', 'Only A') });
    assert.equal(res.status, 201);
    const inA = (await api(`/api/sites/${idA}/documents`)).data.map((d) => d.id);
    const inB = (await api(`/api/sites/${idB}/documents`)).data.map((d) => d.id);
    assert.ok(inA.includes('doc_a0000002'));
    assert.ok(!inB.includes('doc_a0000002'));
    assert.deepEqual(inB, []);
    // Opening B creates only its own store; no content or src files appear.
    const after = tree(siteB).filter((f) => !f.startsWith('.vp/'));
    assert.deepEqual(after, before.filter((f) => !f.startsWith('.vp/')));
    assert.ok(!existsSync(join(siteB, 'content', 'posts', 'only-a.json')));
  });

  it('unknown site id is 404', async () => {
    const res = await api('/api/sites/nope/documents');
    assert.equal(res.status, 404);
    assert.deepEqual(res.data, { error: 'Unknown site' });
  });

  it('GET /api/folders lists folders, 422 for a bad path', async () => {
    const ok = await api(`/api/folders?path=${encodeURIComponent(root)}`);
    assert.equal(ok.status, 200);
    assert.ok(ok.data.folders.some((f) => f.name === 'site-a' && f.isSite));
    const bad = await api(`/api/folders?path=${encodeURIComponent(join(root, 'missing'))}`);
    assert.equal(bad.status, 422);
    assert.ok(bad.data.error);
  });

  it('POST /api/sites/clone clones then adds', async () => {
    const dest = join(root, 'cloned');
    const calls = [];
    fakeGit.cloneRepo = async (url, d) => { calls.push([url, d]); makeSite(root, 'cloned'); };
    const res = await api('/api/sites/clone', { method: 'POST', body: { url: 'https://example.com/x.git', dest } });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.deepEqual(calls, [['https://example.com/x.git', dest]]);
    assert.equal(res.data.path, dest);
    fakeGit.cloneRepo = async () => { const e = new Error('git clone failed: nope'); e.stderr = 'nope'; throw e; };
    const bad = await api('/api/sites/clone', { method: 'POST', body: { url: 'x', dest: join(root, 'x') } });
    assert.equal(bad.status, 422);
    assert.match(bad.data.error, /nope/);
  });

  it('DELETE /api/sites/:siteId forgets the site', async () => {
    const res = await api(`/api/sites/${idB}`, { method: 'DELETE' });
    assert.deepEqual(res.data, { ok: true });
    assert.equal((await api(`/api/sites/${idB}/documents`)).status, 404);
    assert.ok(existsSync(siteB), 'folder untouched');
  });

  it('static path traversal is 404', async () => {
    const res = await api('/app/..%2fpackage.json');
    assert.equal(res.status, 404);
    const res2 = await api('/src/..%2fpackage.json');
    assert.equal(res2.status, 404);
  });

  it('serves the shared /src/ mount', async () => {
    const res = await fetch(`${app.url}/src/sync/paths.js`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /javascript/);
  });
});

describe('startApp port', () => {
  it('falls back to the next port', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vp-app-port-'));
    const env = { VP_CONFIG_DIR: join(root, 'config') };
    // Find a P where P and P+1 are free, then hold P.
    let holder, P;
    for (let i = 0; i < 20 && !holder; i++) {
      const probe = createServer();
      await new Promise((r) => probe.listen(0, '127.0.0.1', r));
      P = probe.address().port;
      await new Promise((r) => probe.close(r));
      const next = createServer();
      const nextFree = await new Promise((r) => { next.once('error', () => r(false)); next.listen(P + 1, '127.0.0.1', () => r(true)); });
      if (nextFree) await new Promise((r) => next.close(r));
      else continue;
      const h = createServer();
      const okay = await new Promise((r) => { h.once('error', () => r(false)); h.listen(P, '127.0.0.1', () => r(true)); });
      if (okay) holder = h;
    }
    try {
      const app = await startApp({ port: P, env, git: fakeGit });
      try {
        assert.equal(app.port, P + 1);
        assert.equal(app.server.address().address, '127.0.0.1');
      } finally {
        await app.close();
      }
    } finally {
      await new Promise((r) => holder.close(r));
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('mountApi onSynced', () => {
  it('onSynced fires after a save', async () => {
    const site = mkdtempSync(join(tmpdir(), 'vp-onsynced-'));
    const ws = resolveWorkspace({ site, repoRoot });
    const db = openWorkspaceDb(ws);
    const calls = [];
    const router = createRouter();
    mountApi(router, db, { rootDir: repoRoot, mediaDir: ws.mediaDir, workspace: ws, prefix: '/x', onSynced: (e) => calls.push(e) });
    const server = createServer(async (req, res) => {
      if (!(await router.handle(req, res))) sendJson(res, 404, { error: 'Not found' });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/x/documents`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(post('doc_spy00001', 'hello')),
      });
      assert.equal(res.status, 201);
      assert.deepEqual(calls, [{ docId: 'doc_spy00001', title: 'Hello', status: 'draft' }]);
      const del = await fetch(`http://127.0.0.1:${server.address().port}/x/documents/doc_spy00001`, { method: 'DELETE' });
      assert.equal(del.status, 200);
      assert.equal(calls.length, 2);
      assert.equal(calls[1].docId, 'doc_spy00001');
    } finally {
      await new Promise((r) => server.close(r));
      db.close();
      rmSync(site, { recursive: true, force: true });
    }
  });
});
