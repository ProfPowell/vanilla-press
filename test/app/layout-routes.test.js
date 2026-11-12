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
});
