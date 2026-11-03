import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, cpSync } from 'node:fs';
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

  it('GET /info returns the site URL, null when not set', async () => {
    const none = await api(`/api/sites/${idA}/info`);
    assert.equal(none.status, 200);
    assert.deepEqual(none.data, { siteUrl: null });
    mkdirSync(join(siteA, 'config'), { recursive: true });
    writeFileSync(join(siteA, 'config', 'data.js'), "export default { siteUrl: 'https://example.com' };\n");
    const set = await api(`/api/sites/${idA}/info`);
    assert.deepEqual(set.data, { siteUrl: 'https://example.com' });
    rmSync(join(siteA, 'config'), { recursive: true, force: true });
  });

  it('GET /status is not connected for a site without an upstream, before any save', async () => {
    const res = await api(`/api/sites/${idB}/status`);
    assert.equal(res.status, 200);
    assert.equal(res.data.connected, false);
    assert.equal(res.data.pending, 0);
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

describe('app server request guard', () => {
  let root, env, app, site, siteId, cloneCalls;
  const raw = (path, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
    // node:http lets the test set Host and Origin, which fetch forbids.
    const req = httpRequest({ host: '127.0.0.1', port: app.port, path, method, headers }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        let data = text;
        try { data = JSON.parse(text); } catch { /* text */ }
        resolve({ status: res.statusCode, data });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
  const docs = () => existsSync(join(site, 'content', 'posts')) ? readdirSync(join(site, 'content', 'posts')) : [];

  before(async () => {
    root = mkdtempSync(join(tmpdir(), 'vp-app-guard-'));
    env = { VP_CONFIG_DIR: join(root, 'config') };
    site = makeSite(root, 'guarded');
    cloneCalls = 0;
    app = await startApp({ port: 0, env, git: { ...fakeGit, cloneRepo: async () => { cloneCalls++; } } });
    siteId = (await (await fetch(`${app.url}/api/sites`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: site }),
    })).json()).id;
  });
  after(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('a foreign Host is 403, for API and static', async () => {
    const res = await raw('/api/sites', { headers: { Host: 'evil.example' } });
    assert.equal(res.status, 403);
    assert.deepEqual(res.data, { error: 'Forbidden' });
    assert.equal((await raw('/src/sync/paths.js', { headers: { Host: `evil.example:${app.port}` } })).status, 403);
  });

  it('GET /api/folders with a foreign Host is 403', async () => {
    const res = await raw(`/api/folders?path=${encodeURIComponent(root)}`, { headers: { Host: 'rebound.example:' + app.port } });
    assert.equal(res.status, 403);
  });

  it('localhost Host is accepted', async () => {
    assert.equal((await raw('/api/sites', { headers: { Host: `localhost:${app.port}` } })).status, 200);
  });

  it('a cross-origin POST is 403 and does nothing', async () => {
    const clone = await raw('/api/sites/clone', {
      method: 'POST',
      headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://evil.example/x.git', dest: join(root, 'evil') }),
    });
    assert.equal(clone.status, 403);
    assert.equal(cloneCalls, 0);
    const doc = await raw(`/api/sites/${siteId}/documents`, {
      method: 'POST',
      headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
      body: JSON.stringify(post('doc_evil0001', 'evil')),
    });
    assert.equal(doc.status, 403);
    assert.deepEqual(docs(), []);
  });

  it('a text/plain;application/json body is 415 and creates nothing', async () => {
    const res = await raw(`/api/sites/${siteId}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;application/json' },
      body: JSON.stringify(post('doc_evil0002', 'evil2')),
    });
    assert.equal(res.status, 415);
    assert.deepEqual(docs(), []);
  });

  it('a same-origin POST works', async () => {
    const res = await raw(`/api/sites/${siteId}/documents`, {
      method: 'POST',
      headers: { Origin: `http://127.0.0.1:${app.port}`, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(post('doc_good0001', 'good')),
    });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.deepEqual(docs(), ['good.json']);
  });
});

describe('app server preview and per-site media', () => {
  let root, env, app, siteA, siteB, idA, idB, previewCalls, previewImpl;
  const previews = {
    start: async (site) => { previewCalls.push(site); return previewImpl(site); },
    stop: async () => {},
    stopAll: async () => {},
  };

  before(async () => {
    root = mkdtempSync(join(tmpdir(), 'vp-app-preview-'));
    env = { VP_CONFIG_DIR: join(root, 'config') };
    siteA = makeSite(root, 'media-a');
    siteB = makeSite(root, 'media-b');
    mkdirSync(join(siteA, 'src', 'media'), { recursive: true });
    writeFileSync(join(siteA, 'src', 'media', 'pic.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    app = await startApp({ port: 0, env, git: fakeGit, previews });
    const add = async (path) => (await (await fetch(`${app.url}/api/sites`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }),
    })).json()).id;
    idA = await add(siteA);
    idB = await add(siteB);
  });
  after(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("preview route starts the site's dev server", async () => {
    previewCalls = [];
    previewImpl = async () => ({ url: 'http://127.0.0.1:45678' });
    const res = await fetch(`${app.url}/api/sites/${idA}/preview`, { method: 'POST' });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { url: 'http://127.0.0.1:45678' });
    assert.equal(previewCalls.length, 1);
    assert.equal(previewCalls[0].id, idA);
    assert.equal(previewCalls[0].path, siteA);
  });

  it('preview route reports a dev server that did not start as 502', async () => {
    previewCalls = [];
    previewImpl = async () => { throw new Error('Preview server did not start: boom'); };
    const res = await fetch(`${app.url}/api/sites/${idA}/preview`, { method: 'POST' });
    assert.equal(res.status, 502);
    assert.deepEqual(await res.json(), { error: 'Preview server did not start: boom' });
  });

  it('preview route for an unknown site is 404', async () => {
    previewCalls = [];
    const res = await fetch(`${app.url}/api/sites/nope/preview`, { method: 'POST' });
    assert.equal(res.status, 404);
    assert.equal(previewCalls.length, 0);
  });

  it("serves a site's media at /sites/<id>/media/<file>", async () => {
    const res = await fetch(`${app.url}/sites/${idA}/media/pic.png`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [0x89, 0x50, 0x4e, 0x47]);
  });

  it('per-site media: other site, unknown id and traversal are 404', async () => {
    assert.equal((await fetch(`${app.url}/sites/${idB}/media/pic.png`)).status, 404);
    assert.equal((await fetch(`${app.url}/sites/nope/media/pic.png`)).status, 404);
    assert.equal((await fetch(`${app.url}/sites/${idA}/media/..%2f..%2fpackage.json`)).status, 404);
    assert.equal((await fetch(`${app.url}/sites/${idA}/media/%2e%2e/%2e%2e/package.json`)).status, 404);
  });
});

describe('documents API with components', () => {
  const FIX = join(repoRoot, 'test', 'fixtures', 'components');
  const hint = (tag) => ({ tag, label: tag, icon: 'x', description: tag, group: 'Test', kind: 'none', defaults: {}, advanced: [] });
  const catalog = [{ package: 'x-widgets', elements: [hint('x-one')] }, { package: 'x-other', elements: [hint('x-three')] }];
  let root, app, siteId, vpRoot;

  const call = async (path, method = 'GET', body) => {
    const res = await fetch(`${app.url}${path}`, body === undefined ? { method } : {
      method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: res.status, data: await res.json() };
  };
  const withX = (attrs) => ({ ...post('doc_comp0001', 'comp', 'Comp'), blocks: [{ type: 'component', tag: 'x-one', attrs }] });

  before(async () => {
    root = mkdtempSync(join(tmpdir(), 'vp-app-components-'));
    vpRoot = join(root, 'vp');
    mkdirSync(join(vpRoot, 'node_modules'), { recursive: true });
    cpSync(join(FIX, 'x-widgets'), join(vpRoot, 'node_modules', 'x-widgets'), { recursive: true });
    const site = makeSite(root, 'comp-site');
    writeFileSync(join(site, 'package.json'), JSON.stringify({ name: 'comp-site', dependencies: { 'x-widgets': '^1.0.0' }, devDependencies: { 'cook-ssg': '^2.5.0' } }));
    app = await startApp({ port: 0, env: { VP_CONFIG_DIR: join(root, 'config') }, git: fakeGit, components: { catalog, vpRoot } });
    siteId = (await call('/api/sites', 'POST', { path: site })).data.id;
  });
  after(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('POST document drops undeclared component attrs and returns a notice', async () => {
    const res = await call(`/api/sites/${siteId}/documents`, 'POST', withX({ mode: 'a', bogus: 'x' }));
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.deepEqual(res.data.blocks[0].attrs, { mode: 'a' });
    assert.deepEqual(res.data.notices, ['Removed "bogus" from <x-one>: this version of the component doesn\'t have it.']);
  });

  it('PUT document drops undeclared component attrs and returns a notice', async () => {
    const res = await call(`/api/sites/${siteId}/documents/doc_comp0001`, 'PUT', { blocks: withX({ count: 2, nope: true, zap: 1 }).blocks });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.deepEqual(res.data.blocks[0].attrs, { count: 2 });
    assert.deepEqual(res.data.notices, [
      'Removed "nope" from <x-one>: this version of the component doesn\'t have it.',
      'Removed "zap" from <x-one>: this version of the component doesn\'t have it.',
    ]);
    const stored = await call(`/api/sites/${siteId}/documents/doc_comp0001`);
    assert.deepEqual(stored.data.blocks[0].attrs, { count: 2 });
    assert.equal(stored.data.notices, undefined);
  });

  it('PUT validates against the enabled components', async () => {
    const off = await call(`/api/sites/${siteId}/documents/doc_comp0001`, 'PUT', {
      blocks: [{ type: 'component', tag: 'x-three', attrs: {} }],
    });
    assert.equal(off.status, 400);
    assert.match(off.data.errors.join('\n'), /x-three" is not on for this site/);
    const bad = await call(`/api/sites/${siteId}/documents/doc_comp0001`, 'PUT', { blocks: withX({ mode: 'zzz' }).blocks });
    assert.equal(bad.status, 400);
    assert.match(bad.data.errors.join('\n'), /not in allowed values/);
  });
});

describe('mountApi components options', () => {
  async function serve(options, fn) {
    const site = mkdtempSync(join(tmpdir(), 'vp-mount-comp-'));
    const ws = resolveWorkspace({ site, repoRoot });
    const db = openWorkspaceDb(ws);
    const router = createRouter();
    mountApi(router, db, { rootDir: repoRoot, mediaDir: ws.mediaDir, workspace: ws, ...options });
    const server = createServer(async (req, res) => {
      if (!(await router.handle(req, res))) sendJson(res, 404, { error: 'Not found' });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    try {
      await fn(`http://127.0.0.1:${server.address().port}`);
    } finally {
      await new Promise((r) => server.close(r));
      db.close();
      rmSync(site, { recursive: true, force: true });
    }
  }

  it('GET /api/components is served when componentsState is given', async () => {
    const state = { cookSupportsPackages: false, packages: [{ package: 'x', enabled: true }] };
    await serve({ componentsState: () => state }, async (base) => {
      const res = await fetch(`${base}/api/components`);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), state);
    });
  });

  it('without components options: no /api/components, no notices, attrs kept (vp serve)', async () => {
    await serve({}, async (base) => {
      assert.equal((await fetch(`${base}/api/components`)).status, 404);
      const res = await fetch(`${base}/api/documents`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...post('doc_serve001', 'serve'), blocks: [{ type: 'component', tag: 'x-any', attrs: { bogus: 'x' } }] }),
      });
      assert.equal(res.status, 201);
      const data = await res.json();
      assert.deepEqual(data.blocks[0].attrs, { bogus: 'x' });
      assert.equal(data.notices, undefined);
    });
  });
});
