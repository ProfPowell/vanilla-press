import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, cpSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startApp } from '../../src/app/server.js';

const COOK = '/Users/tpowell/src/cook';
const STARTER = join(COOK, 'starters', 'vanilla-breeze');

describe('layout routes', () => {
  let root, site, app, id;
  const call = async (path, { method = 'GET', body } = {}) => {
    const init = { method };
    if (body !== undefined) { init.headers = { 'Content-Type': 'application/json' }; init.body = JSON.stringify(body); }
    const res = await fetch(`${app.url}/api/sites/${id}${path}`, init);
    return { status: res.status, data: await res.json() };
  };

  before(async () => {
    root = mkdtempSync(join(tmpdir(), 'vp-layout-routes-'));
    site = join(root, 'site');
    mkdirSync(join(site, 'node_modules'), { recursive: true });
    writeFileSync(join(site, 'package.json'), JSON.stringify({ name: 'site', type: 'module', devDependencies: { 'cook-ssg': '^2.9.0' } }));
    symlinkSync(COOK, join(site, 'node_modules', 'cook-ssg'));
    for (const d of ['src/layouts', 'src/includes', 'config']) cpSync(join(STARTER, d), join(site, d), { recursive: true });
    app = await startApp({ port: 0, env: { VP_CONFIG_DIR: join(root, 'config') } });
    const res = await fetch(`${app.url}/api/sites`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: site, name: 'Site' }),
    });
    id = (await res.json()).id;
  });
  after(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('lists, reads, saves, creates and deletes through the routes', async () => {
    const list = await call('/layout-files');
    assert.equal(list.status, 200);
    assert.equal(list.data.supported, true);
    assert.ok(list.data.layouts.some((e) => e.name === 'post' && e.status === 'editable'));

    const read = await call('/layout-files/layout/page');
    assert.equal(read.status, 200);
    const put = await call('/layout-files/layout/page', { method: 'PUT', body: { tree: read.data.tree, hash: read.data.hash } });
    assert.equal(put.status, 200);

    const made = await call('/layout-files', { method: 'POST', body: { kind: 'layout', name: 'kid', label: 'Kid', start: { type: 'child', from: 'base' } } });
    assert.equal(made.status, 201);
    assert.equal((await call('/layout-files', { method: 'POST', body: { kind: 'layout', name: 'kid', label: 'Kid', start: { type: 'blank' } } })).status, 409);

    const del = await call('/layout-files/layout/kid', { method: 'DELETE' });
    assert.equal(del.status, 200);
    assert.equal(existsSync(join(site, 'src/layouts/kid.html')), false);
  });

  it('maps errors: stale hash 409, in use 409 with users, plain 409 with problems, bad name 400', async () => {
    const read = await call('/layout-files/layout/page');
    const file = join(site, 'src/layouts/page.html');
    const edited = `${readFileSync(file, 'utf8')}\n<!-- hand -->\n`;
    writeFileSync(file, edited);
    const stale = await call('/layout-files/layout/page', { method: 'PUT', body: { tree: read.data.tree, hash: read.data.hash } });
    assert.equal(stale.status, 409);
    assert.equal(stale.data.error, 'This layout changed on disk since you opened it');
    assert.equal(readFileSync(file, 'utf8'), edited);

    const inUse = await call('/layout-files/layout/base', { method: 'DELETE' });
    assert.equal(inUse.status, 409);
    assert.ok(inUse.data.baseFor.includes('post'));

    writeFileSync(join(site, 'src/layouts/plain.html'), '<html><body>${content}</body></html>');
    const plain = await call('/layout-files/layout/plain');
    assert.equal(plain.status, 409);
    assert.ok(Array.isArray(plain.data.problems));

    assert.equal((await call('/layout-files/layout/.x')).status, 400);
    assert.equal((await call('/layout-files/layout/..%2Fx')).status, 400);
    assert.equal((await call('/layout-files/layout/a%2Fb', { method: 'DELETE' })).status, 400);
    assert.equal((await call('/layout-files/thing/page')).status, 400);
  });

  it('delete is refused while a VP draft or a collection default uses the layout (M1)', async () => {
    const api = (path, init) => fetch(`${app.url}/api/sites/${id}${path}`, init);
    const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const doc = await api('/documents', json('POST', { meta: { title: 'Hello draft', slug: 'hello-draft', collection: 'notes', layout: 'docs' }, blocks: [] }));
    assert.equal(doc.status, 201, await doc.clone().text());
    const cfg = await api('/config/collections', json('PUT', { value: JSON.stringify({ articles: { layout: 'landing' } }) }));
    assert.equal(cfg.status, 200);

    const docs = await call('/layout-files/layout/docs', { method: 'DELETE' });
    assert.equal(docs.status, 409);
    assert.equal(docs.data.error, 'in use');
    assert.ok(docs.data.usedBy.includes('draft: Hello draft'), JSON.stringify(docs.data));
    const landing = await call('/layout-files/layout/landing', { method: 'DELETE' });
    assert.equal(landing.status, 409);
    assert.ok(landing.data.usedBy.includes('collection default: articles'), JSON.stringify(landing.data));
    assert.ok(existsSync(join(site, 'src/layouts/docs.html')));
    assert.ok(existsSync(join(site, 'src/layouts/landing.html')));
  });

  it('previews unsaved sources: { ok, url }, a failed build as { ok: false, log }, unknown doc 404', async () => {
    const post = readFileSync(join(site, 'src/layouts/post.html'), 'utf8').replace('<article>', '<article><p>ROUTE-MARKER-55</p>');
    const ok = await call('/layout-preview', { method: 'POST', body: { layouts: { post }, layout: 'post' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.ok, true, ok.data.log);
    assert.match(await (await fetch(ok.data.url)).text(), /ROUTE-MARKER-55/);
    assert.ok(existsSync(join(root, 'config', 'layout-preview', id, 'dist')));

    const bad = await call('/layout-preview', { method: 'POST', body: { layouts: { base: '<body data-template="post">${content}</body>' }, layout: 'post' } });
    assert.equal(bad.status, 200);
    assert.equal(bad.data.ok, false);
    assert.match(bad.data.log, /cycle/i);

    assert.equal((await call('/layout-preview', { method: 'POST', body: { docId: 'nope', layout: 'post' } })).status, 404);
    assert.equal((await call('/layout-preview', { method: 'POST', body: { layouts: [], layout: 'post' } })).status, 422);
    assert.equal((await call('/layout-preview', { method: 'POST', body: {} })).status, 422);
  });

  it('context: site and declared fields, the lists a repeat can use, document fields and components', async () => {
    writeFileSync(join(site, 'config', 'programs.json'), JSON.stringify({ areas: [{ path: 'courses', label: 'Courses' }] }));
    const main = readFileSync(join(site, 'config', 'main.js'), 'utf8');
    writeFileSync(join(site, 'config', 'main.js'), main.replace('export default {', "export default {\n  layouts: { fields: ['subtitle'] },"));
    const made = await call('/documents', { method: 'POST', body: { meta: { title: 'Hi', slug: 'hi', collection: 'blog' }, blocks: [] } });
    assert.ok(made.status < 300, JSON.stringify(made.data));

    const r = await call('/layout-files/context');
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.ok(r.data.siteFields.includes('siteTitle'));
    assert.ok(r.data.siteFields.includes('navItems'));
    assert.deepEqual(r.data.declaredFields, ['subtitle']);
    assert.ok(!r.data.siteFields.includes('subtitle'));
    assert.ok(r.data.lists.includes('collections.blog'), r.data.lists.join());
    assert.ok(r.data.lists.includes('programs'));
    assert.ok(r.data.lists.includes('programAreas.courses'));
    assert.ok(r.data.lists.includes('navItems'));
    assert.ok(!r.data.lists.includes('programAreas'));
    assert.ok(r.data.documentFields.includes('title'));
    assert.ok(r.data.documentFields.includes('pageLayout'));
    // VB's own manifest; a catalog package only when it is on for the site
    assert.ok(Array.isArray(r.data.components['site-search']?.attributes));
    assert.ok(r.data.components['youtube-player']);
    assert.equal(r.data.components['code-block'], undefined);
    assert.ok(r.data.layoutElements['layout-stack'].some((a) => a.name === 'data-layout-gap' && a.enum.includes('m')));
  });

  it('serialize: an unsaved tree as the site\'s Cook writes it; bad input 400', async () => {
    const read = await call('/layout-files/layout/post');
    read.data.tree.body[0].body[0].tag = 'h2';
    const r = await call('/layout-files/serialize', { method: 'POST', body: { tree: read.data.tree, kind: 'layout' } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.match(r.data.html, /<h2>\$\{title\}<\/h2>/);
    assert.doesNotMatch(readFileSync(join(site, 'src/layouts/post.html'), 'utf8'), /<h2>\$\{title\}/);
    assert.equal((await call('/layout-files/serialize', { method: 'POST', body: { kind: 'layout' } })).status, 400);
  });

  it('app close stops the layout preview server', async () => {
    const r = await call('/layout-preview', { method: 'POST', body: { layout: 'page' } });
    assert.equal(r.data.ok, true, r.data.log);
    await app.close();
    await assert.rejects(fetch(r.data.url));
    app = await startApp({ port: 0, env: { VP_CONFIG_DIR: join(root, 'config') } });
  });
});
