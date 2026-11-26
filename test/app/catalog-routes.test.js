import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { startApp, isQueuedWrite } from '../../src/app/server.js';

const fakeGit = {
  cloneRepo: async () => {},
  changedFiles: async () => [],
  pullFastForward: async () => ({}),
  gitStatus: async () => ({ isRepo: false }),
};

describe('catalog routes', () => {
  let root, app, id;

  async function api(path, { method = 'GET', body } = {}) {
    const opts = { method };
    if (body !== undefined) {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`${app.url}/api/sites/${id}${path}`, opts);
    if (res.status === 204) return { status: 204, data: null };
    return { status: res.status, data: await res.json() };
  }
  const makeCatalog = async (body = { title: 'Retro games', template: 'retro-games' }) => (await api('/catalogs', { method: 'POST', body })).data;

  before(async () => {
    root = mkdtempSync(join(tmpdir(), 'vp-catalog-routes-'));
    const site = join(root, 'site');
    mkdirSync(join(site, 'src'), { recursive: true });
    writeFileSync(join(site, 'package.json'), JSON.stringify({ name: 'site', devDependencies: { 'cook-ssg': '^2.4.0' } }));
    app = await startApp({ port: 0, env: { VP_CONFIG_DIR: join(root, 'config') }, git: fakeGit });
    const res = await fetch(`${app.url}/api/sites`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: site, name: 'Site' }),
    });
    id = (await res.json()).id;
  });
  after(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('GET /catalogs/templates lists templates and agencies', async () => {
    const res = await api('/catalogs/templates');
    assert.equal(res.status, 200);
    assert.ok(res.data.templates.some((t) => t.id === 'retro-games'));
    assert.deepEqual(Object.keys(res.data.templates[0]).sort(), ['description', 'id', 'label']);
    assert.ok(res.data.agencies.pcgs);
  });

  it('POST /catalogs from a template: 201 with the design; unknown template and missing title are 400', async () => {
    const res = await api('/catalogs', { method: 'POST', body: { title: 'Retro games', template: 'retro-games' } });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.equal(res.data.slug, 'retro-games');
    assert.ok(res.data.design.fields.length > 0);
    assert.ok(res.data.design.lists.length > 0);
    assert.equal((await api('/catalogs', { method: 'POST', body: { title: 'X', template: 'nope' } })).status, 400);
    assert.equal((await api('/catalogs', { method: 'POST', body: { template: 'retro-games' } })).status, 400);
    assert.equal((await api('/catalogs', { method: 'POST', body: { title: 'X', template: 'retro-games', access: 'bogus' } })).status, 400);
  });

  it('GET /catalogs lists with counts; GET /catalogs/:id and 404', async () => {
    const cat = (await api('/catalogs')).data.catalogs.find((c) => c.slug === 'retro-games');
    assert.equal(cat.itemCount, 0);
    assert.equal(cat.publishedCount, 0);
    assert.equal((await api(`/catalogs/${cat.id}`)).data.id, cat.id);
    assert.equal((await api('/catalogs/cat_missing')).status, 404);
  });

  it('PUT /catalogs/:id updates; an invalid design is 400 with errors; a taken slug is 409', async () => {
    const cat = await makeCatalog({ title: 'Put me', template: 'retro-games' });
    const ok = await api(`/catalogs/${cat.id}`, { method: 'PUT', body: { title: 'Renamed', description: 'd', access: 'friends' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.title, 'Renamed');
    assert.equal(ok.data.access, 'friends');
    const bad = await api(`/catalogs/${cat.id}`, { method: 'PUT', body: { design: { fields: 'x' } } });
    assert.equal(bad.status, 400);
    assert.ok(bad.data.errors.length > 0);
    assert.equal((await api(`/catalogs/${cat.id}`, { method: 'PUT', body: { access: 'bogus' } })).status, 400);
    const clash = await api(`/catalogs/${cat.id}`, { method: 'PUT', body: { slug: 'retro-games' } });
    assert.equal(clash.status, 409);
    assert.match(clash.data.error, /already in use/);
    assert.equal((await api('/catalogs/cat_missing', { method: 'PUT', body: { title: 'x' } })).status, 404);
  });

  it('choices: add, rename, remove; in use is 409 with count', async () => {
    const cat = await makeCatalog({ title: 'Choices', template: 'retro-games' });
    const listId = cat.design.lists[0].id;
    const added = await api(`/catalogs/${cat.id}/choices`, { method: 'POST', body: { listId, parentId: null, label: 'Brand new' } });
    assert.equal(added.status, 200);
    const choiceId = added.data.id;
    assert.ok(added.data.design.lists[0].choices.some((c) => c.id === choiceId));
    assert.equal((await api(`/catalogs/${cat.id}`)).data.design.lists[0].choices.some((c) => c.id === choiceId), true);

    const renamed = await api(`/catalogs/${cat.id}/choices/${choiceId}`, { method: 'PUT', body: { listId, label: 'Renamed' } });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.data.design.lists[0].choices.find((c) => c.id === choiceId).label, 'Renamed');

    const item = (await api(`/catalogs/${cat.id}/items`, { method: 'POST', body: { title: 'Uses it', categories: { [listId]: [choiceId] } } })).data;
    const refused = await api(`/catalogs/${cat.id}/choices/${choiceId}?listId=${listId}`, { method: 'DELETE' });
    assert.equal(refused.status, 409);
    assert.equal(refused.data.count, 1);
    await api(`/catalogs/${cat.id}/items/${item.id}`, { method: 'DELETE' });
    const removed = await api(`/catalogs/${cat.id}/choices/${choiceId}?listId=${listId}`, { method: 'DELETE' });
    assert.equal(removed.status, 200);
    assert.equal(removed.data.design.lists[0].choices.some((c) => c.id === choiceId), false);

    assert.equal((await api(`/catalogs/${cat.id}/choices`, { method: 'POST', body: { listId: 'l_nope', label: 'x' } })).status, 404);
    assert.equal((await api(`/catalogs/${cat.id}/choices`, { method: 'POST', body: { listId, label: ' ' } })).status, 400);
    assert.equal((await api(`/catalogs/${cat.id}/choices/c_x`, { method: 'DELETE' })).status, 400);
  });

  it('items: create (draft), list with tags, get, update, delete', async () => {
    const cat = await makeCatalog({ title: 'Items', template: 'retro-games' });
    const created = await api(`/catalogs/${cat.id}/items`, { method: 'POST', body: { title: 'Super Mario Bros. 3', tags: ['childhood copy'] } });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.equal(created.data.status, 'draft');
    assert.equal(created.data.slug, 'super-mario-bros-3');
    const list = await api(`/catalogs/${cat.id}/items`);
    assert.equal(list.data.items.length, 1);
    assert.deepEqual(list.data.tags, ['childhood copy']);
    const path = `/catalogs/${cat.id}/items/${created.data.id}`;
    assert.equal((await api(path)).data.title, 'Super Mario Bros. 3');
    const upd = await api(path, { method: 'PUT', body: { title: 'SMB3', rating: 5 } });
    assert.equal(upd.status, 200);
    assert.equal(upd.data.rating, 5);
    const bad = await api(path, { method: 'PUT', body: { rating: 9 } });
    assert.equal(bad.status, 400);
    assert.ok(bad.data.errors.length > 0);
    assert.equal((await api(`/catalogs/${cat.id}/items`, { method: 'POST', body: { title: '' } })).status, 400);
    assert.equal((await api(path, { method: 'DELETE' })).status, 204);
    assert.equal((await api(path)).status, 404);
    assert.equal((await api(`/catalogs/${cat.id}/items/item_x`, { method: 'PUT', body: { title: 'x' } })).status, 404);
    assert.equal((await api('/catalogs/cat_missing/items')).status, 404);
  });

  it('an item in another catalog is 404', async () => {
    const a = await makeCatalog({ title: 'Cat A', template: 'retro-games' });
    const b = await makeCatalog({ title: 'Cat B', template: 'retro-games' });
    const item = (await api(`/catalogs/${a.id}/items`, { method: 'POST', body: { title: 'In A' } })).data;
    assert.equal((await api(`/catalogs/${b.id}/items/${item.id}`)).status, 404);
  });

  it('item access is clamped up to the collection level on create and update', async () => {
    const cat = await makeCatalog({ title: 'Friends only', template: 'retro-games', access: 'friends' });
    const created = await api(`/catalogs/${cat.id}/items`, { method: 'POST', body: { title: 'One', access: 'public' } });
    assert.equal(created.data.access, 'friends');
    const upd = await api(`/catalogs/${cat.id}/items/${created.data.id}`, { method: 'PUT', body: { access: 'public' } });
    assert.equal(upd.data.access, 'friends');
    const up = await api(`/catalogs/${cat.id}/items/${created.data.id}`, { method: 'PUT', body: { access: 'private' } });
    assert.equal(up.data.access, 'private');
    // Raising the collection's level lifts items too when they are next saved; a bogus level fails closed.
    const odd = await api(`/catalogs/${cat.id}/items`, { method: 'POST', body: { title: 'Odd', access: 'weird' } });
    assert.equal(odd.data.access, 'private');
  });

  it('DELETE /catalogs/:id: 204 when empty of published items; 409 with a published item', async () => {
    const cat = await makeCatalog({ title: 'Doomed', template: 'retro-games' });
    await api(`/catalogs/${cat.id}/items`, { method: 'POST', body: { title: 'Draft' } });
    assert.equal((await api(`/catalogs/${cat.id}`, { method: 'DELETE' })).status, 204);
    assert.equal((await api(`/catalogs/${cat.id}`)).status, 404);
    assert.equal((await api('/catalogs/cat_missing', { method: 'DELETE' })).status, 404);
  });

  describe('PUT design removals', () => {
    const textField = (d) => d.fields.find((f) => f.type === 'text');

    it('a removed list or choice that an item uses is 409 with count; items untouched', async () => {
      const cat = await makeCatalog({ title: 'Design lists', template: 'retro-games' });
      const list = cat.design.lists[0];
      const choice = list.choices[0];
      const item = (await api(`/catalogs/${cat.id}/items`, { method: 'POST', body: { title: 'A', categories: { [list.id]: [choice.id] } } })).data;
      const noList = { ...cat.design, lists: cat.design.lists.filter((l) => l.id !== list.id) };
      const r1 = await api(`/catalogs/${cat.id}`, { method: 'PUT', body: { design: noList } });
      assert.equal(r1.status, 409);
      assert.equal(r1.data.count, 1);
      const noChoice = { ...cat.design, lists: cat.design.lists.map((l) => (l.id === list.id ? { ...l, choices: l.choices.slice(1) } : l)) };
      const r2 = await api(`/catalogs/${cat.id}`, { method: 'PUT', body: { design: noChoice } });
      assert.equal(r2.status, 409);
      assert.equal(r2.data.count, 1);
      assert.deepEqual((await api(`/catalogs/${cat.id}/items/${item.id}`)).data.categories, { [list.id]: [choice.id] });
      assert.deepEqual((await api(`/catalogs/${cat.id}`)).data.design, cat.design);
    });

    it('a removed field with values is 409 with count and field; confirmDropValues saves and cleans the items', async () => {
      const cat = await makeCatalog({ title: 'Design fields', template: 'retro-games' });
      const f = textField(cat.design);
      const a = (await api(`/catalogs/${cat.id}/items`, { method: 'POST', body: { title: 'A', fields: { [f.id]: 'hello' } } })).data;
      const b = (await api(`/catalogs/${cat.id}/items`, { method: 'POST', body: { title: 'B' } })).data;
      const design = { ...cat.design, fields: cat.design.fields.filter((x) => x.id !== f.id) };
      const refused = await api(`/catalogs/${cat.id}`, { method: 'PUT', body: { design } });
      assert.equal(refused.status, 409);
      assert.equal(refused.data.count, 1);
      assert.equal(refused.data.field, f.id);
      assert.equal((await api(`/catalogs/${cat.id}/items/${a.id}`)).data.fields[f.id], 'hello');
      assert.ok((await api(`/catalogs/${cat.id}`)).data.design.fields.some((x) => x.id === f.id));
      const ok = await api(`/catalogs/${cat.id}`, { method: 'PUT', body: { design, confirmDropValues: true } });
      assert.equal(ok.status, 200, JSON.stringify(ok.data));
      assert.equal(ok.data.design.fields.some((x) => x.id === f.id), false);
      assert.equal(f.id in (await api(`/catalogs/${cat.id}/items/${a.id}`)).data.fields, false);
      assert.equal((await api(`/catalogs/${cat.id}/items/${a.id}`, { method: 'PUT', body: { title: 'A2' } })).status, 200);
      assert.equal((await api(`/catalogs/${cat.id}/items/${b.id}`)).status, 200);
    });

    it('a removed field nobody has a value for is dropped without confirmation', async () => {
      const cat = await makeCatalog({ title: 'Design empty', template: 'retro-games' });
      const f = textField(cat.design);
      await api(`/catalogs/${cat.id}/items`, { method: 'POST', body: { title: 'A', fields: { [f.id]: '' } } });
      const design = { ...cat.design, fields: cat.design.fields.filter((x) => x.id !== f.id) };
      const ok = await api(`/catalogs/${cat.id}`, { method: 'PUT', body: { design } });
      assert.equal(ok.status, 200, JSON.stringify(ok.data));
    });
  });

  it('writes under /catalogs are queued behind a publish; reads are not', () => {
    assert.equal(isQueuedWrite('PUT', '/api/sites/x/catalogs/y'), true);
    assert.equal(isQueuedWrite('POST', '/api/sites/x/catalogs'), true);
    assert.equal(isQueuedWrite('DELETE', '/api/sites/x/catalogs/y/items/z'), true);
    assert.equal(isQueuedWrite('GET', '/api/sites/x/catalogs/y'), false);
    // Publish routes (Task 5) take the lock themselves, like document publish.
    assert.equal(isQueuedWrite('POST', '/api/sites/x/catalogs/y/items/z/publish'), false);
    assert.equal(isQueuedWrite('POST', '/api/sites/x/catalogs/y/items/z/unpublish'), false);
    assert.equal(isQueuedWrite('POST', '/api/sites/x/catalogs/y/publish'), false);
    assert.equal(isQueuedWrite('POST', '/api/sites/x/catalogs/y/items'), true);
  });

  it('a request with a foreign Origin is refused', async () => {
    const status = await new Promise((resolve, reject) => {
      const req = httpRequest({
        host: '127.0.0.1', port: app.port, path: `/api/sites/${id}/catalogs`, method: 'POST',
        headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
      }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      req.on('error', reject);
      req.end(JSON.stringify({ title: 'Evil', template: 'retro-games' }));
    });
    assert.equal(status, 403);
    assert.equal((await api('/catalogs')).data.catalogs.some((c) => c.title === 'Evil'), false);
  });
});
