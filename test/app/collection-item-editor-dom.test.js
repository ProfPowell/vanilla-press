import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';

// The item editor and items list in a real DOM (linkedom), with fetch, upload and downscale stubbed.
const page = readFileSync(new URL('../../app/site.html', import.meta.url), 'utf8');
const win = parseHTML(page.replace(/<script[^>]*><\/script>/g, ''));
const GLOBALS = ['window', 'document', 'HTMLElement', 'Event', 'CSS'];
const saved = {};
let createItemEditor, createItemsView, initCollectionsSection, calls, responders, container, confirms, confirmAnswer, uploads;

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const settle = async () => { for (let i = 0; i < 8; i++) await tick(); };
const $ = (sel) => container.querySelector(sel);
const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();
const setValue = (el, value) => {
  if (el.tagName !== 'SELECT') { el.value = value; return; }
  for (const o of el.options) o.toggleAttribute('selected', o.value === value);
};
const change = (el, value) => { setValue(el, value); el.dispatchEvent(new win.Event('change', { bubbles: true })); el.dispatchEvent(new win.Event('input', { bubbles: true })); };
const click = (el) => el.dispatchEvent(new win.Event('click', { bubbles: true }));

const agencies = { pcgs: { label: 'PCGS', scale: ['MS-64', 'MS-65'], extras: [{ id: 'cac', label: 'CAC sticker', type: 'bool' }] }, ngc: { label: 'NGC', scale: ['MS-65'] } };
const design = () => ({
  fields: [
    { id: 'f_region', label: 'Region', type: 'choice', level: 'public', options: ['NTSC-U', 'PAL'] },
    { id: 'f_paid', label: 'Price paid', type: 'money', level: 'private' },
    { id: 'f_year', label: 'Year', type: 'number', level: 'friends' },
    { id: 'f_note', label: 'Note', type: 'text', level: 'public' },
  ],
  lists: [{ id: 'l_sys', label: 'System', choices: [{ id: 'c_nin', label: 'Nintendo', children: [{ id: 'c_nes', label: 'NES', children: [] }] }, { id: 'c_sega', label: 'Sega', children: [] }] }],
  grading: { level: 'public', agencies: ['pcgs', 'ngc'] },
  sort: ['title'],
});
const catalog = (o = {}) => ({ id: 'cat_1', slug: 'retro', title: 'Retro', access: 'friends', design: design(), itemCount: 1, publishedCount: 0, ...o });
const item = (o = {}) => ({
  id: 'item_1', catalogId: 'cat_1', slug: 'mario', title: 'Mario', status: 'draft', access: 'friends', rating: null, description: '', video: '',
  links: [], tags: [], categories: {}, grade: null, fields: {}, photos: [], created: '2026-01-01T00:00:00Z', updated: '2026-02-01T00:00:00Z', published: null, ...o,
});
const base = '/api/sites/my%20site/catalogs/cat_1';

before(async () => {
  for (const k of GLOBALS) { saved[k] = globalThis[k]; globalThis[k] = k === 'window' ? win : win[k] ?? globalThis[k]; }
  globalThis.CSS ??= { escape: (s) => s };
  const proto = Object.getPrototypeOf(win.document.createElement('dialog'));
  proto.showModal = function showModal() { this.setAttribute('open', ''); };
  proto.close = function close() { this.removeAttribute('open'); this.dispatchEvent(new win.Event('close')); };
  Object.defineProperty(proto, 'open', { configurable: true, get() { return this.hasAttribute('open'); } });
  saved.fetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    const path = String(url).replace(/^\/api\/sites\/my%20site/, '');
    calls.push({ method, url: String(url), path, body });
    const r = responders[`${method} ${path}`];
    if (r) return r(body);
    if (method === 'GET' && path === '/catalogs') return Response.json({ catalogs: [catalog()] });
    if (method === 'GET' && path === '/catalogs/templates') return Response.json({ templates: [], agencies });
    if (method === 'GET' && path === '/catalogs/cat_1/items') return Response.json({ items: [item(), item({ id: 'item_2', title: 'Zelda', status: 'published', photos: [{ file: 'z.jpg', main: true }] })], tags: ['kid'] });
    if (method === 'PUT' && path.startsWith('/catalogs/cat_1/items/')) return Response.json({ ...item(), ...body });
    return Response.json({});
  };
  ({ createItemEditor } = await import('../../app/assets/js/collection-item-editor.js'));
  ({ createItemsView } = await import('../../app/assets/js/collection-items.js'));
  ({ initCollectionsSection } = await import('../../app/assets/js/collections-page.js'));
});
after(() => {
  for (const k of GLOBALS) globalThis[k] = saved[k];
  globalThis.fetch = saved.fetch;
});

beforeEach(() => {
  calls = []; responders = {}; confirms = []; confirmAnswer = true; uploads = [];
  container = win.document.createElement('div');
  win.document.body.append(container);
});

const confirm = async (q) => { confirms.push(q); return confirmAnswer; };
const upload = async (b, file, opts) => { uploads.push({ base: b, name: file.name, opts }); return { filename: `up-${uploads.length}.jpg` }; };
const downscale = async (file) => new win.File(['s'], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' });
const open = async (it = item(), cat = catalog(), extra = {}) => {
  const editor = createItemEditor({ siteId: 'my site', container, catalog: cat, item: it, tags: ['kid', 'retro'], agencies, confirm, upload, downscale, onSaved() {}, ...extra });
  await settle();
  return editor;
};
const putBody = () => calls.filter((c) => c.method === 'PUT').at(-1)?.body;
const pick = async (names) => {
  const input = $('#item-photo-input');
  Object.defineProperty(input, 'files', { configurable: true, value: names.map((n) => new win.File(['x'], n, { type: 'image/png' })) });
  input.dispatchEvent(new win.Event('change', { bubbles: true }));
  await settle();
};

describe('Item editor', () => {
  it('offers only levels at or above the collection’s', async () => {
    await open();
    assert.deepEqual([...$('#item-access').options].map((o) => o.value), ['friends', 'private']);
    await open(item({ access: 'public' }), catalog({ access: 'public' }));
    assert.deepEqual([...$('#item-access').options].map((o) => o.value), ['public', 'friends', 'private']);
  });

  it('marks private and friends fields', async () => {
    await open();
    assert.match(text($('[data-field-id="f_paid"]')), /Private/);
    assert.match(text($('[data-field-id="f_year"]')), /Friends/);
    assert.doesNotMatch(text($('[data-field-id="f_note"]')), /Private|Friends/);
  });

  it('builds the PUT body with categories, grade, fields, links, tags and rating', async () => {
    await open();
    change($('#item-title'), 'Super Mario Bros. 3');
    change($('#item-rating'), '4');
    change($('[data-list-id="l_sys"] select'), 'c_nes');
    change($('#item-grade-agency'), 'pcgs');
    change($('#item-grade-value'), 'MS-65');
    change($('[data-extra="cac"]'), 'x'); $('[data-extra="cac"]').checked = true; change($('[data-extra="cac"]'), 'x');
    change($('[data-field-id="f_region"] select'), 'PAL');
    change($('[data-field-id="f_paid"] input'), '12.5');
    change($('#item-tags'), 'kid, retro , ');
    change($('#item-description'), 'A classic.');
    change($('#item-video'), 'https://example.com/v');
    click($('#item-link-add'));
    change($('[data-link] [data-role="label"]'), 'Review');
    change($('[data-link] [data-role="url"]'), 'https://example.com/r');
    click($('#item-save'));
    await settle();
    const body = putBody();
    assert.equal(body.title, 'Super Mario Bros. 3');
    assert.equal(body.rating, 4);
    assert.deepEqual(body.categories, { l_sys: ['c_nes'] });
    assert.deepEqual(body.grade, { agency: 'pcgs', value: 'MS-65', extras: { cac: true }, other: '' });
    assert.deepEqual(body.fields, { f_region: 'PAL', f_paid: 12.5 });
    assert.deepEqual(body.tags, ['kid', 'retro']);
    assert.deepEqual(body.links, [{ label: 'Review', url: 'https://example.com/r' }]);
    assert.equal(body.description, 'A classic.');
    assert.equal(body.video, 'https://example.com/v');
    assert.equal(body.access, 'friends');
    assert.equal('slug' in body && body.slug !== 'mario', false);
  });

  it('shows validation errors from a 400', async () => {
    responders['PUT /catalogs/cat_1/items/item_1'] = () => Response.json({ error: 'The item is not valid', errors: ['Rating must be a whole number from 1 to 5'] }, { status: 400 });
    const editor = await open();
    change($('#item-title'), 'x');
    click($('#item-save'));
    await settle();
    assert.match(text($('#item-error')), /Rating must be/);
    assert.equal(editor.isDirty(), true);
  });

  it('is dirty after an edit and clean after Save', async () => {
    const editor = await open();
    assert.equal(editor.isDirty(), false);
    change($('#item-title'), 'Changed');
    assert.equal(editor.isDirty(), true);
    click($('#item-save'));
    await settle();
    assert.equal(editor.isDirty(), false);
    assert.match(text($('#item-status')), /Saved/);
  });

  it('locks the slug once the item has been published', async () => {
    await open(item({ published: '2026-02-01T00:00:00Z', status: 'published' }));
    assert.equal($('#item-slug').hasAttribute('disabled'), true);
    await open();
    assert.equal($('#item-slug').hasAttribute('disabled'), false);
  });

  it('downscales then uploads each photo at the item’s effective level; the first becomes Main', async () => {
    await open();
    change($('#item-access'), 'private');
    await pick(['a.png', 'b.png']);
    assert.deepEqual(uploads.map((u) => [u.name, u.opts.access, u.base]), [['a.jpg', 'private', '/api/sites/my%20site'], ['b.jpg', 'private', '/api/sites/my%20site']]);
    click($('#item-save'));
    await settle();
    assert.deepEqual(putBody().photos, [{ file: 'up-1.jpg', main: true }, { file: 'up-2.jpg', main: false }]);
  });

  it('uses the collection’s level when it is higher than the item’s', async () => {
    await open(item({ access: 'public' }), catalog({ access: 'friends' }));
    await pick(['a.png']);
    assert.equal(uploads[0].opts.access, 'friends');
  });

  it('chooses Main, moves and removes photos', async () => {
    await open(item({ photos: [{ file: 'a.jpg', main: true }, { file: 'b.jpg', main: false }, { file: 'c.jpg', main: false }] }));
    click($('[data-photo="b.jpg"] [data-role="main"]'));
    click($('[data-photo="c.jpg"] [data-role="left"]'));
    click($('[data-photo="a.jpg"] [data-role="remove"]'));
    click($('#item-save'));
    await settle();
    assert.deepEqual(putBody().photos, [{ file: 'c.jpg', main: false }, { file: 'b.jpg', main: true }]);
  });

  it('removing the Main photo makes the first remaining one Main', async () => {
    await open(item({ photos: [{ file: 'a.jpg', main: true }, { file: 'b.jpg', main: false }] }));
    click($('[data-photo="a.jpg"] [data-role="remove"]'));
    click($('#item-save'));
    await settle();
    assert.deepEqual(putBody().photos, [{ file: 'b.jpg', main: true }]);
  });

  it('Publish saves, publishes, and says Published or Saved, not pushed', async () => {
    responders['POST /catalogs/cat_1/items/item_1/publish'] = () => Response.json({ status: 'pushed', sha: 'abc', url: 'https://x.test/collections/retro/mario/' });
    responders['GET /catalogs/cat_1/items/item_1'] = () => Response.json(item({ status: 'published', published: '2026-03-01T00:00:00Z' }));
    await open();
    change($('#item-title'), 'Mario 2');
    click($('#item-publish'));
    await settle();
    assert.deepEqual(calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path}`), ['PUT /catalogs/cat_1/items/item_1', 'POST /catalogs/cat_1/items/item_1/publish']);
    assert.match(text($('#item-status')), /Published/);
    assert.equal($('#item-unpublish').hasAttribute('hidden'), false);
    assert.match(text($('#item-publish')), /Update/);
    assert.equal($('#item-slug').hasAttribute('disabled'), true);

    responders['POST /catalogs/cat_1/items/item_1/publish'] = () => Response.json({ status: 'saved', sha: 'abc', url: null });
    click($('#item-publish'));
    await settle();
    assert.match(text($('#item-status')), /Saved, not pushed/);
  });

  it('Unpublish posts to unpublish', async () => {
    responders['POST /catalogs/cat_1/items/item_1/unpublish'] = () => Response.json({ status: 'pushed', sha: 'abc', url: null });
    responders['GET /catalogs/cat_1/items/item_1'] = () => Response.json(item({ status: 'draft', published: '2026-03-01T00:00:00Z' }));
    await open(item({ status: 'published', published: '2026-03-01T00:00:00Z' }));
    click($('#item-unpublish'));
    await settle();
    assert.ok(calls.some((c) => c.method === 'POST' && c.path.endsWith('/unpublish')));
    assert.match(text($('#item-status')), /Unpublished/);
  });

  it('a 409 lists each photo with the posts that share it; Raise and publish resends confirmed', async () => {
    let n = 0;
    responders['POST /catalogs/cat_1/items/item_1/publish'] = (body) => {
      n++;
      if (!body?.confirmRaisePhotoAccess) {
        return Response.json({ error: 'Photos would be exposed', photoWarnings: [{ item: { id: 'item_1', title: 'Mario' }, file: 'a.jpg', access: 'public', needed: 'friends', posts: ['My trip'] }] }, { status: 409 });
      }
      return Response.json({ status: 'pushed', sha: 's', url: null });
    };
    await open();
    click($('#item-publish'));
    await settle();
    assert.equal(confirms.length, 1);
    assert.match(confirms[0].items.join(' '), /a\.jpg/);
    assert.match(confirms[0].items.join(' '), /public/);
    assert.match(confirms[0].items.join(' '), /friends/);
    assert.match(confirms[0].items.join(' '), /My trip/);
    const posts = calls.filter((c) => c.method === 'POST');
    assert.deepEqual(posts.map((c) => c.body), [{}, { confirmRaisePhotoAccess: true }]);
    assert.equal(n, 2);
  });

  it('declining the 409 confirm publishes nothing', async () => {
    responders['POST /catalogs/cat_1/items/item_1/publish'] = () => Response.json({ error: 'x', photoWarnings: [{ item: { id: 'item_1', title: 'Mario' }, file: 'a.jpg', access: 'public', needed: 'friends', posts: [] }] }, { status: 409 });
    confirmAnswer = false;
    await open();
    click($('#item-publish'));
    await settle();
    assert.equal(calls.filter((c) => c.method === 'POST').length, 1);
  });

  it('shows a 422 refusal text', async () => {
    responders['POST /catalogs/cat_1/items/item_1/publish'] = () => Response.json({ error: 'This photo isn’t in the media library: a.jpg. Re-add it to the item.' }, { status: 422 });
    await open();
    click($('#item-publish'));
    await settle();
    assert.match(text($('#item-error')), /isn’t in the media library: a\.jpg/);
  });
});

describe('Nested choices and a changed design', () => {
  it('marks depth with characters that do not collapse and gives each option its full path', async () => {
    await open();
    const options = [...$('[data-list-id="l_sys"] select').options];
    const nes = options.find((o) => o.value === 'c_nes');
    assert.match(nes.textContent, /^\u00a0+\u2514 NES$/);
    assert.equal(nes.getAttribute('title'), 'Nintendo \u203a NES');
    assert.equal(options.find((o) => o.value === 'c_nin').textContent, 'Nintendo');
  });

  it('an open editor takes a new design, keeps its edited title and drops values of removed fields', async () => {
    const editor = await open(item({ fields: { f_note: 'hi', f_year: 1990 } }));
    change($('#item-title'), 'Edited title');
    const next = catalog({ design: { ...design(), fields: [...design().fields.filter((f) => f.id !== 'f_note'), { id: 'f_new', label: 'Condition', type: 'text', level: 'public' }] } });
    editor.setCatalog(next);
    assert.ok($('[data-field-id="f_new"]'));
    assert.equal($('[data-field-id="f_note"]'), null);
    assert.equal($('#item-title').value, 'Edited title');
    assert.equal(editor.isDirty(), true);
    click($('#item-save'));
    await settle();
    assert.deepEqual(putBody().fields, { f_year: 1990 });
  });
});

describe('Items list', () => {
  it('lists items with thumbnail, status, level and updated; filters by text', async () => {
    const view = createItemsView({ siteId: 'my site', container, catalog: catalog(), agencies, confirm, upload, downscale, onCounts() {} });
    await view.show();
    await settle();
    const rows = [...container.querySelectorAll('tbody tr')];
    assert.equal(rows.length, 2);
    assert.match(text(rows[1]), /Zelda/);
    assert.match(text(rows[1]), /Published/);
    assert.match(text(rows[0]), /Draft/);
    assert.match(text(rows[0]), /Friends/);
    assert.equal(rows[1].querySelector('img').getAttribute('src'), '/sites/my%20site/media/z.jpg');
    change($('#items-filter'), 'zel');
    assert.equal([...container.querySelectorAll('tbody tr')].filter((r) => !r.hasAttribute('hidden')).length, 1);
  });

  it('New item creates a draft with just a title and opens the editor', async () => {
    responders['POST /catalogs/cat_1/items'] = () => Response.json(item({ id: 'item_9', title: 'Metroid' }), { status: 201 });
    responders['GET /catalogs/cat_1/items/item_9'] = () => Response.json(item({ id: 'item_9', title: 'Metroid' }));
    const view = createItemsView({ siteId: 'my site', container, catalog: catalog(), agencies, confirm, upload, downscale, onCounts() {} });
    await view.show();
    await settle();
    change($('#items-new-title'), 'Metroid');
    click($('#items-new'));
    await settle();
    assert.deepEqual(calls.find((c) => c.method === 'POST').body, { title: 'Metroid' });
    assert.equal($('#item-title').value, 'Metroid');
  });

  it('asks before closing an editor with unsaved edits', async () => {
    const view = createItemsView({ siteId: 'my site', container, catalog: catalog(), agencies, confirm, upload, downscale, onCounts() {} });
    await view.show();
    await settle();
    click(container.querySelector('tbody tr [data-role="open"]'));
    await settle();
    change($('#item-title'), 'Edited');
    assert.equal(view.isDirty(), true);
    confirmAnswer = false;
    click($('#item-back'));
    await settle();
    assert.equal(confirms.at(-1).title, 'Discard unsaved changes?');
    assert.ok($('#item-title'));
    confirmAnswer = true;
    click($('#item-back'));
    await settle();
    assert.equal($('#item-title'), null);
    assert.equal(view.isDirty(), false);
  });
});

describe('Collections page', () => {
  it('after a design save, the Items tab shows the new field', async () => {
    globalThis.location = { search: '?site=my%20site&section=collections&catalog=cat_1&tab=design' };
    const newDesign = { ...design(), fields: [...design().fields, { id: 'f_new', label: 'Condition', type: 'text', level: 'public' }] };
    responders['PUT /catalogs/cat_1'] = () => Response.json(catalog({ design: newDesign }));
    responders['GET /catalogs/cat_1/items/item_1'] = () => Response.json(item());
    const root = win.document.getElementById('collections-section');
    const section = initCollectionsSection({ siteId: 'my site', root });
    await section.show();
    await settle();
    root.querySelector('#collection-tabs button[data-tab="items"]').dispatchEvent(new win.Event('click', { bubbles: true }));
    await settle();
    root.querySelector('#collection-items-mount tbody [data-role="open"]').dispatchEvent(new win.Event('click', { bubbles: true }));
    await settle();
    assert.equal(root.querySelector('[data-field-id="f_new"]'), null);
    root.querySelector('#item-title').value = 'Dirty title';
    root.querySelector('#item-title').dispatchEvent(new win.Event('input', { bubbles: true }));
    root.querySelector('#collection-tabs button[data-tab="design"]').dispatchEvent(new win.Event('click', { bubbles: true }));
    await settle();
    root.querySelector('#design-save').dispatchEvent(new win.Event('click', { bubbles: true }));
    await settle();
    root.querySelector('#collection-tabs button[data-tab="items"]').dispatchEvent(new win.Event('click', { bubbles: true }));
    await settle();
    assert.ok(root.querySelector('[data-field-id="f_new"]'));
    assert.equal(root.querySelector('#item-title').value, 'Dirty title');
  });

  it('mounts the items list on the Items tab', async () => {
    globalThis.location = { search: '?site=my%20site&section=collections&catalog=cat_1' };
    const root = win.document.getElementById('collections-section');
    const section = initCollectionsSection({ siteId: 'my site', root });
    await section.show();
    await settle();
    assert.match(text(root.querySelector('#collection-items-mount')), /Zelda/);
  });
});
