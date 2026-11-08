import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, cpSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startApp, isQueuedWrite } from '../../src/app/server.js';
import { createRouter, sendJson } from '../../src/server/router.js';
import { mountApi } from '../../src/server/api.js';
import { makeGitSite, git as gitCmd, write as writeIn } from './git-site-fixture.js';
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
    assert.deepEqual(list.data[0].git, {
      connected: false, branch: 'main', ahead: null, behind: null, lastBackupAt: null,
    });
    assert.equal(list.data[0].siteUrl, null);
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
    // The same, as data, for the editor to take out of its copy
    assert.deepEqual(res.data.dropped, [{ tag: 'x-one', attr: 'bogus' }]);
  });

  it('PUT document drops undeclared component attrs and returns a notice', async () => {
    const res = await call(`/api/sites/${siteId}/documents/doc_comp0001`, 'PUT', { blocks: withX({ count: 2, nope: true, zap: 1 }).blocks });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.deepEqual(res.data.blocks[0].attrs, { count: 2 });
    assert.deepEqual(res.data.notices, [
      'Removed "nope" from <x-one>: this version of the component doesn\'t have it.',
      'Removed "zap" from <x-one>: this version of the component doesn\'t have it.',
    ]);
    assert.deepEqual(res.data.dropped, [{ tag: 'x-one', attr: 'nope' }, { tag: 'x-one', attr: 'zap' }]);
    const stored = await call(`/api/sites/${siteId}/documents/doc_comp0001`);
    assert.deepEqual(stored.data.blocks[0].attrs, { count: 2 });
    assert.equal(stored.data.notices, undefined);
    assert.equal(stored.data.dropped, undefined);
  });

  it('PUT saves a catalogued component that is off (R12); a tag not in the catalog is still refused', async () => {
    const off = await call(`/api/sites/${siteId}/documents/doc_comp0001`, 'PUT', {
      blocks: [{ type: 'component', tag: 'x-three', attrs: {} }],
    });
    assert.equal(off.status, 200, JSON.stringify(off.data));
    assert.equal(off.data.blocks[0].tag, 'x-three');
    const unknown = await call(`/api/sites/${siteId}/documents/doc_comp0001`, 'PUT', {
      blocks: [{ type: 'component', tag: 'x-zz', attrs: {} }],
    });
    assert.equal(unknown.status, 400);
    assert.match(unknown.data.errors.join('\n'), /x-zz" is not on for this site/);
    const bad = await call(`/api/sites/${siteId}/documents/doc_comp0001`, 'PUT', { blocks: withX({ mode: 'zzz' }).blocks });
    assert.equal(bad.status, 400);
    assert.match(bad.data.errors.join('\n'), /not in allowed values/);
  });

  it('Publish of a post using an off component is refused, naming it', async () => {
    const saved = await call(`/api/sites/${siteId}/documents/doc_comp0001`, 'PUT', {
      blocks: [{ type: 'component', tag: 'x-three', attrs: {} }],
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    const res = await call(`/api/sites/${siteId}/documents/doc_comp0001/publish`, 'POST', {});
    assert.equal(res.status, 422);
    assert.equal(res.data.error,
      'This post uses <x-three>, which is not on for this site. Turn it on under Components, or remove it from the post.');
  });
});

describe('documents API: components without a published manifest (R13)', () => {
  let root, app, siteId;
  const call = async (path, method = 'GET', body) => {
    const res = await fetch(`${app.url}${path}`, body === undefined ? { method } : {
      method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: res.status, data: await res.json() };
  };

  before(async () => {
    root = mkdtempSync(join(tmpdir(), 'vp-app-hint-'));
    const site = makeSite(root, 'hint-site');
    writeFileSync(join(site, 'package.json'), JSON.stringify({
      name: 'hint-site', dependencies: { '@profpowell/border-wc': '^0.2.0' }, devDependencies: { 'cook-ssg': '^2.5.0' },
    }));
    // The real catalog and VP's own node_modules (border-wc 0.2.0 ships no custom-elements.json)
    app = await startApp({ port: 0, env: { VP_CONFIG_DIR: join(root, 'config') }, git: fakeGit });
    siteId = (await call('/api/sites', 'POST', { path: site })).data.id;
  });
  after(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('a border-wc keeps its catalog-hinted attributes; an undeclared one is dropped with a notice', async () => {
    const res = await call(`/api/sites/${siteId}/documents`, 'POST', {
      ...post('doc_border001', 'border', 'Border'),
      blocks: [{
        type: 'component', tag: 'border-wc',
        attrs: { effect: 'squiggle', animate: true, thickness: 3, bogus: 'x' },
        children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Hi' }] }],
      }],
    });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.deepEqual(res.data.blocks[0].attrs, { effect: 'squiggle', animate: true, thickness: 3 });
    assert.deepEqual(res.data.notices, ['Removed "bogus" from <border-wc>: this version of the component doesn\'t have it.']);
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

  it('liveMedia: a failed scan refuses DELETE (503, file kept) but GET still lists', async () => {
    const errors = [];
    const orig = console.error;
    console.error = (...a) => errors.push(a);
    try {
      await serve({ liveMedia: async () => { throw new Error('git broke'); } }, async (base) => {
        const form = new FormData();
        form.append('file', new Blob([Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')], { type: 'image/svg+xml' }), 'x.svg');
        const up = await fetch(`${base}/api/media`, { method: 'POST', body: form });
        assert.equal(up.status, 201, await up.clone().text());
        const item = await up.json();
        const list = await fetch(`${base}/api/media`);
        assert.equal(list.status, 200);
        const del = await fetch(`${base}/api/media/${item.id}`, { method: 'DELETE' });
        assert.equal(del.status, 503);
        assert.match((await del.json()).error, /Nothing was deleted/);
        assert.equal((await (await fetch(`${base}/api/media`)).json()).length, 1);
      });
    } finally {
      console.error = orig;
    }
    assert.ok(errors.length >= 2);
  });

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

describe('GET /api/sites with a real git clone', () => {
  let fx, app;
  before(async () => {
    fx = makeGitSite();
    // Cook-shaped enough for addSite; the fixture's package.json already names cook-ssg.
    app = await startApp({ port: 0, env: { VP_CONFIG_DIR: join(fx.root, 'config') } });
    const res = await fetch(`${app.url}/api/sites`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: fx.site }),
    });
    assert.equal(res.status, 201);
  });
  after(async () => {
    await app.close();
    rmSync(fx.root, { recursive: true, force: true });
  });

  it('carries siteUrl, ahead/behind and lastBackupAt without opening the workspace', async () => {
    const get = async () => (await (await fetch(`${app.url}/api/sites`)).json())[0];
    rmSync(join(fx.site, '.vp'), { recursive: true, force: true }); // adding the site may have opened it
    let site = await get();
    assert.equal(site.siteUrl, 'https://example.com');
    assert.deepEqual(site.git, { connected: true, branch: 'main', ahead: 0, behind: 0, lastBackupAt: null });

    writeIn(fx.site, 'content/posts/a.json', '{}');
    gitCmd(fx.site, 'add', '-A');
    gitCmd(fx.site, 'commit', '-m', 'Draft: a [CI Skip]');
    site = await get();
    assert.equal(site.git.ahead, 1);
    assert.equal(site.git.lastBackupAt, null);

    gitCmd(fx.site, 'push');
    const when = gitCmd(fx.site, 'log', '-1', '--format=%cI');
    site = await get();
    assert.equal(site.git.ahead, 0);
    assert.equal(site.git.lastBackupAt, when);
    assert.equal(existsSync(join(fx.site, '.vp')), false, 'listing must not open the workspace');
  });
});

describe('app server media library', () => {
  it('opening a site with a stray media file schedules a draft backup', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vp-app-media-'));
    const env = { VP_CONFIG_DIR: join(root, 'config') };
    const site = makeSite(root, 'site-m');
    mkdirSync(join(site, 'src', 'media'), { recursive: true });
    // A PNG header: 3x2.
    writeFileSync(join(site, 'src', 'media', 'stray.png'),
      Buffer.from('89504e470d0a1a0a0000000d4948445200000003000000020806000000730100', 'hex'));
    const timers = { setTimer: () => 0, clearTimer: () => {} }; // the debounce never fires
    const app = await startApp({ port: 0, env, git: fakeGit, backup: timers });
    try {
      const added = await fetch(`${app.url}/api/sites`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: site }),
      });
      const { id } = await added.json();
      const status = await (await fetch(`${app.url}/api/sites/${id}/status`)).json();
      assert.equal(status.pending, 1);
    } finally {
      await app.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('app server media serving and backup', () => {
  const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000003000000020806000000730100', 'hex');
  let root, app, id, site;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), 'vp-app-mserve-'));
    site = makeSite(root, 'site-s');
    mkdirSync(join(site, 'src', 'media'), { recursive: true });
    writeFileSync(join(site, 'src', 'media', 'x.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    writeFileSync(join(site, 'src', 'media', 'clip.mp4'), Buffer.from('0123456789abcdef'));
    writeFileSync(join(site, 'src', 'media', 'doc.pdf'), '%PDF-1.4');
    writeFileSync(join(site, 'src', 'media', 'empty.mp4'), '');
    app = await startApp({ port: 0, env: { VP_CONFIG_DIR: join(root, 'config') }, git: fakeGit });
    id = (await (await fetch(`${app.url}/api/sites`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: site }),
    })).json()).id;
  });
  after(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('media responses are sandboxed', async () => {
    const res = await fetch(`${app.url}/sites/${id}/media/x.svg`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-security-policy'), 'sandbox');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('content-type'), 'image/svg+xml');
  });

  it('media supports byte ranges', async () => {
    const res = await fetch(`${app.url}/sites/${id}/media/clip.mp4`, { headers: { Range: 'bytes=0-3' } });
    assert.equal(res.status, 206);
    assert.equal(res.headers.get('content-range'), 'bytes 0-3/16');
    assert.equal(res.headers.get('accept-ranges'), 'bytes');
    assert.equal(await res.text(), '0123');
    const tail = await fetch(`${app.url}/sites/${id}/media/clip.mp4`, { headers: { Range: 'bytes=-4' } });
    assert.equal(tail.headers.get('content-range'), 'bytes 12-15/16');
    assert.equal(await tail.text(), 'cdef');
    const open = await fetch(`${app.url}/sites/${id}/media/clip.mp4`, { headers: { Range: 'bytes=10-' } });
    assert.equal(open.headers.get('content-range'), 'bytes 10-15/16');
    const bad = await fetch(`${app.url}/sites/${id}/media/clip.mp4`, { headers: { Range: 'bytes=999999-' } });
    assert.equal(bad.status, 416);
    assert.equal(bad.headers.get('content-range'), 'bytes */16');
    await bad.arrayBuffer();
  });

  it('a multi-range request is served whole (M4)', async () => {
    const res = await fetch(`${app.url}/sites/${id}/media/clip.mp4`, { headers: { Range: 'bytes=0-1,4-5' } });
    assert.equal(res.status, 200);
    assert.equal((await res.text()).length, 16);
  });

  it('a range whose end is before its start is ignored (200, whole file)', async () => {
    const res = await fetch(`${app.url}/sites/${id}/media/clip.mp4`, { headers: { Range: 'bytes=5-2' } });
    assert.equal(res.status, 200);
    assert.equal((await res.text()).length, 16);
  });

  it('a suffix range on a zero-byte file is served whole (200, RFC 9110 14.1.1)', async () => {
    const res = await fetch(`${app.url}/sites/${id}/media/empty.mp4`, { headers: { Range: 'bytes=-5' } });
    assert.equal(res.status, 200);
    assert.equal((await res.text()).length, 0);
  });

  it('a HEAD request gets the size and range headers without a body', async () => {
    const whole = await fetch(`${app.url}/sites/${id}/media/clip.mp4`, { method: 'HEAD' });
    assert.equal(whole.status, 200);
    assert.equal(whole.headers.get('content-length'), '16');
    const part = await fetch(`${app.url}/sites/${id}/media/clip.mp4`, { method: 'HEAD', headers: { Range: 'bytes=2-5' } });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get('content-length'), '4');
    assert.equal(part.headers.get('content-range'), 'bytes 2-5/16');
  });

  it('a first-byte range on a zero-byte file is unsatisfiable (416)', async () => {
    for (const range of ['bytes=0-', 'bytes=0-0']) {
      const res = await fetch(`${app.url}/sites/${id}/media/empty.mp4`, { headers: { Range: range } });
      assert.equal(res.status, 416, range);
      assert.equal(res.headers.get('content-range'), 'bytes */0');
      await res.arrayBuffer();
    }
  });

  it('pdf and mp4 get their types', async () => {
    const pdf = await fetch(`${app.url}/sites/${id}/media/doc.pdf`);
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    const mp4 = await fetch(`${app.url}/sites/${id}/media/clip.mp4`);
    assert.equal(mp4.headers.get('content-type'), 'video/mp4');
    await pdf.arrayBuffer(); await mp4.arrayBuffer();
  });

  it('isQueuedWrite covers media writes', () => {
    assert.equal(isQueuedWrite('POST', '/api/sites/a/media'), true);
    assert.equal(isQueuedWrite('PUT', '/api/sites/a/media/m1'), true);
    assert.equal(isQueuedWrite('DELETE', '/api/sites/a/media/m1'), true);
    assert.equal(isQueuedWrite('GET', '/api/sites/a/media'), false);
    assert.equal(isQueuedWrite('POST', '/api/sites/a/documents/x/publish'), false);
    assert.equal(isQueuedWrite('POST', '/api/sites/a/documents'), true);
  });

  it('the app serves its own pdf-viewer and image-editor', async () => {
    for (const p of ['pdf-viewer/pdf-viewer.js', 'image-editor/image-editor.js']) {
      const res = await fetch(`${app.url}/assets/${p}`);
      assert.equal(res.status, 200, p);
      await res.arrayBuffer();
    }
  });

  it('an upload schedules a draft backup', async () => {
    const fx = makeGitSite();
    const env = { VP_CONFIG_DIR: join(fx.root, 'config') };
    const timers = { setTimer: () => 0, clearTimer: () => {} };
    const a = await startApp({ port: 0, env, git: undefined, backup: timers });
    try {
      const sid = (await (await fetch(`${a.url}/api/sites`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: fx.site }),
      })).json()).id;
      const form = new FormData();
      form.append('file', new Blob([PNG], { type: 'image/png' }), 'pic.png');
      const up = await fetch(`${a.url}/api/sites/${sid}/media`, { method: 'POST', body: form });
      assert.equal(up.status, 201, await up.clone().text());
      const { filename } = await up.json();
      await fetch(`${a.url}/api/sites/${sid}/backup`, { method: 'POST' });
      assert.equal(gitCmd(fx.site, 'log', '-1', '--format=%s'), `Draft: ${filename} [CI Skip]`);
    } finally {
      await a.close();
      rmSync(fx.root, { recursive: true, force: true });
    }
  });
});

describe('app server themes', () => {
  const VB = 'src/assets/vendor/vanilla-breeze';
  let root, app, id, site, outside;
  const T = { light: { '--color-primary': 'oklch(0.5 0.2 30)', '--A': 'red' }, dark: { '--color-primary': 'oklch(0.7 0.2 30)' } };

  /** A request with the path sent as is (fetch would normalize dot segments). */
  const raw = (path, method = 'GET') => new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: app.port, path, method }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
  async function api(path, { method = 'GET', body } = {}) {
    const opts = { method };
    if (body !== undefined) {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`${app.url}/api/sites/${id}${path}`, opts);
    return { status: res.status, data: await res.json(), type: res.headers.get('content-type') };
  }

  before(async () => {
    root = mkdtempSync(join(tmpdir(), 'vp-app-theme-'));
    site = makeSite(root, 'site-t');
    outside = join(root, 'outside');
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, 'secret.css'), 'secret');
    writeIn(site, `${VB}/vanilla-breeze.css`, '[data-theme~="modern"]{--x:1}\n');
    writeIn(site, `${VB}/themes/swiss.css`, '[data-theme~="swiss"]{--x:1}\n');
    writeIn(site, `${VB}/themes/.hidden.css`, 'hidden');
    writeIn(site, `${VB}/page.html`, '<script>alert(1)</script>');
    writeIn(site, `${VB}/site-own.css`, 'body{}'); // beside vanilla-breeze.css, not VB's
    writeIn(site, `${VB}/lib/body.js`, 'body{}');
    writeIn(site, `${VB}/themes/manifest.json`, '{"body{}":1}');
    writeIn(site, `${VB}/fonts/a.woff2`, 'font');
    writeIn(site, 'src/posts/hello.html', '<p>hi</p>');
    writeIn(site, 'src/assets/site.css', 'body{}');
    writeIn(site, 'config/vp.json', '{ "theme": "swiss" }\n');
    // Links that point out of src/ (a file and a folder) are never followed.
    symlinkSync(join(outside, 'secret.css'), join(site, VB, 'themes', 'link.css'));
    symlinkSync(outside, join(site, VB, 'out'));
    app = await startApp({ port: 0, env: { VP_CONFIG_DIR: join(root, 'config') }, git: fakeGit });
    id = (await (await fetch(`${app.url}/api/sites`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: site }),
    })).json()).id;
  });
  after(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('opening a site migrates its vp.json theme', async () => {
    const { status, data } = await api('/theme');
    assert.equal(status, 200);
    assert.equal(data.setting.name, 'swiss');
    assert.equal(readFileSync(join(site, 'config/vp.json'), 'utf8'), '{ "theme": "swiss" }\n'); // untouched
    assert.deepEqual(data.vb, { source: 'site', url: `/sites/${id}/site/assets/vendor/vanilla-breeze/vanilla-breeze.css` });
    assert.ok(data.themes.some((t) => t.id === 'swiss' && t.href === `/sites/${id}/site/assets/vendor/vanilla-breeze/themes/swiss.css`));
  });

  it("GET /api/themes lists the site's VB", async () => {
    const { data } = await api('/themes');
    assert.ok(data.some((t) => t.id === 'swiss' && t.href.startsWith(`/sites/${id}/site/`)));
    assert.ok(data.some((t) => t.id === 'modern'));
  });

  it('serves the site VB and custom themes under /sites/<id>/site/, nothing else', async () => {
    const ok = await raw(`/sites/${id}/site/assets/vendor/vanilla-breeze/themes/swiss.css`);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers['content-type'], 'text/css; charset=utf-8');
    assert.equal(ok.headers['x-content-type-options'], 'nosniff');
    assert.equal(ok.body, '[data-theme~="swiss"]{--x:1}\n');
    assert.equal((await raw(`/sites/${id}/site/assets/vendor/vanilla-breeze/vanilla-breeze.css`)).status, 200);
    assert.equal((await raw(`/sites/${id}/site/assets/vendor/vanilla-breeze/fonts/a.woff2`)).status, 200);
    const head = await raw(`/sites/${id}/site/assets/vendor/vanilla-breeze/vanilla-breeze.css`, 'HEAD');
    assert.equal(head.status, 200);
    assert.equal(head.body, '');
    for (const path of [
      `/sites/${id}/site/posts/hello.html`, // outside the VB folder and assets/themes
      `/sites/${id}/site/assets/site.css`,
      `/sites/${id}/site/assets/vendor/vanilla-breeze/site-own.css`, // only VB's own files in its folder
      `/sites/${id}/site/assets/vendor/vanilla-breeze/lib/body.js`,
      `/sites/${id}/site/assets/vendor/vanilla-breeze/themes/manifest.json`, // no .json
      `/sites/${id}/site/assets/vendor/vanilla-breeze/%252e%252e/%252e%252e/site.css`, // double-encoded
      `/sites/${id}/site/assets/vendor/vanilla-breeze/themes/%252e%252e%252f%252e%252e%252fsite.css`,
      `/sites/${id}/site/assets/vendor/vanilla-breeze/page.html`, // not an asset type
      `/sites/${id}/site/assets/vendor/vanilla-breeze/themes/.hidden.css`,
      `/sites/${id}/site/assets/vendor/vanilla-breeze/themes/link.css`, // symlink out of src/
      `/sites/${id}/site/assets/vendor/vanilla-breeze/out/secret.css`,
      `/sites/${id}/site/assets/vendor/vanilla-breeze/themes`, // a folder
      `/sites/${id}/site/assets/vendor/vanilla-breeze/../../site.css`,
      `/sites/${id}/site/assets/vendor/vanilla-breeze/%2e%2e/%2e%2e/site.css`,
      `/sites/${id}/site/assets/vendor/vanilla-breeze/..%2f..%2fsite.css`,
      `/sites/${id}/site/assets/vendor/vanilla-breeze/..%5c..%5csite.css`,
      `/sites/${id}/site/assets/vendor/vanilla-breeze/themes/%2fetc%2fpasswd`,
      `/sites/${id}/site/assets/themes/..%2f..%2f..%2fconfig%2fvp.json`,
      `/sites/${id}/site//etc/passwd`,
      `/sites/${id}/site/assets/vendor/vanilla-breeze/themes/swiss.css%00`,
      `/sites/${id}/site/%E0%A4%A`,
      `/sites/nope/site/assets/vendor/vanilla-breeze/themes/swiss.css`,
      `/sites/${encodeURIComponent('../' + id)}/site/assets/vendor/vanilla-breeze/themes/swiss.css`,
    ]) {
      const res = await raw(path);
      assert.equal(res.status, 404, path);
      assert.doesNotMatch(res.body, /secret|alert|hidden|passwd|body\{\}/, path);
    }
    const post = await fetch(`${app.url}/sites/${id}/site/assets/vendor/vanilla-breeze/themes/swiss.css`, { method: 'POST' });
    assert.equal(post.status, 404);
  });

  it('custom theme routes: save (with skipped tokens), import, rename, delete', async () => {
    const saved = await api('/theme/custom', { method: 'POST', body: { name: 'Retro Mine', base: 'swiss', tokens: T } });
    assert.equal(saved.status, 201);
    assert.equal(saved.data.theme.id, 'retro-mine');
    assert.deepEqual(saved.data.skipped, ['--A']);
    const css = await raw(`/sites/${id}/site/assets/themes/retro-mine.css`);
    assert.equal(css.status, 200);
    assert.match(css.body, /@layer bundle-theme/);

    const bad = await api('/theme/custom', { method: 'POST', body: { name: 'X', base: 'swiss', tokens: { light: { '--A': 'red' } } } });
    assert.equal(bad.status, 422);
    assert.deepEqual(bad.data.dropped, ['--A']);
    assert.match(bad.type, /application\/json/);
    assert.equal((await api('/theme/custom', { method: 'POST', body: { name: '', base: 'swiss', tokens: T } })).status, 400);

    const imp = await api('/theme/import', { method: 'POST', body: { name: 'Night <b>', css: ':root{--color-background: oklch(0.2 0 0)} <img src=x onerror=alert(1)>{}' } });
    assert.equal(imp.status, 201);
    assert.equal(imp.data.theme.only, 'dark');
    assert.equal(imp.data.theme.name, 'Night <b>');
    assert.ok(imp.data.dropped.length >= 1);
    assert.match(imp.type, /application\/json/);
    const big = await api('/theme/import', { method: 'POST', body: { name: 'Big', css: ':root{--a:1}' + ' '.repeat(300 * 1024) } });
    assert.equal(big.status, 413);

    const renamed = await api('/theme/custom/retro-mine', { method: 'PATCH', body: { name: 'Arcade' } });
    assert.equal(renamed.status, 200);
    assert.deepEqual([renamed.data.theme.id, renamed.data.theme.name], ['retro-mine', 'Arcade']);
    assert.equal((await api('/theme/custom/nope', { method: 'PATCH', body: { name: 'X' } })).status, 404);

    const state = await api('/theme');
    assert.ok(state.data.themes.some((t) => t.id === 'retro-mine' && t.custom && t.name === 'Arcade'));

    const del = await api('/theme/custom/retro-mine', { method: 'DELETE' });
    assert.equal(del.status, 200);
    assert.equal(existsSync(join(site, 'src/assets/themes/retro-mine.css')), false);
    assert.equal((await api('/theme/custom/retro-mine', { method: 'DELETE' })).status, 404);
  });

  it('delete of a theme in use is 409 naming the users', async () => {
    const saved = await api('/theme/custom', { method: 'POST', body: { name: 'Used', base: 'swiss', tokens: T } });
    const doc = { ...post('doc_used0001', 'used-post', 'Uses it'), meta: { ...post('x', 'used-post', 'Uses it').meta, theme: saved.data.theme.id } };
    assert.equal((await api('/documents', { method: 'POST', body: doc })).status, 201);
    const res = await api(`/theme/custom/${saved.data.theme.id}`, { method: 'DELETE' });
    assert.equal(res.status, 409);
    assert.deepEqual(res.data.usedBy, ['Uses it']);
    const state = await api('/theme');
    assert.deepEqual(state.data.pages.map((p) => [p.title, p.theme, p.themeScope]), [['Uses it', 'used', 'page']]);
  });

  it('delete fails closed (503) when committed HEAD cannot be read', async () => {
    const saved = await api('/theme/custom', { method: 'POST', body: { name: 'Fragile', base: 'swiss', tokens: T } });
    fakeGit.headCommit = async () => { throw new Error('git broke'); };
    try {
      const res = await api(`/theme/custom/${saved.data.theme.id}`, { method: 'DELETE' });
      assert.equal(res.status, 503);
      assert.match(res.data.error, /Nothing was deleted/);
      assert.ok(existsSync(join(site, `src/assets/themes/${saved.data.theme.id}.css`)));
    } finally {
      delete fakeGit.headCommit;
    }
    assert.equal((await api(`/theme/custom/${saved.data.theme.id}`, { method: 'DELETE' })).status, 200);
  });

  it('theme library writes take the backup queue, then the write lock, themselves (not isQueuedWrite)', () => {
    assert.equal(isQueuedWrite('POST', '/api/sites/a/theme/custom'), false);
    assert.equal(isQueuedWrite('PATCH', '/api/sites/a/theme/custom/x'), false);
    assert.equal(isQueuedWrite('DELETE', '/api/sites/a/theme/custom/x'), false);
    assert.equal(isQueuedWrite('POST', '/api/sites/a/theme/import'), false);
    assert.equal(isQueuedWrite('POST', '/api/sites/a/theme/apply'), false);
    assert.equal(isQueuedWrite('GET', '/api/sites/a/theme'), false);
  });
});
