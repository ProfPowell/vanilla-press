import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';

// The Collections section in a real DOM (linkedom), with fetch stubbed. Never hand a linkedom node to assert.
const page = readFileSync(new URL('../../app/site.html', import.meta.url), 'utf8');
const win = parseHTML(page.replace(/<script[^>]*><\/script>/g, ''));
const GLOBALS = ['window', 'document', 'HTMLElement', 'Event', 'CSS'];
const saved = {};
let initCollectionsSection, calls, responders, catalogs, section;

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const settle = async () => { for (let i = 0; i < 8; i++) await tick(); };
const $ = (id) => win.document.getElementById(id);
const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();
const base = '/api/sites/my%20site/catalogs';

const design = () => ({
  fields: [
    { id: 'f_region', label: 'Region', type: 'choice', level: 'public', options: ['NTSC-U', 'PAL'] },
    { id: 'f_paid', label: 'Price paid', type: 'money', level: 'private', total: false },
  ],
  lists: [{ id: 'l_sys', label: 'System', choices: [{ id: 'c_nin', label: 'Nintendo', children: [{ id: 'c_nes', label: 'NES', children: [] }] }] }],
  grading: null,
  sort: ['title'],
});
const catalog = (o = {}) => ({
  id: 'cat_1', slug: 'retro-games', title: 'Retro games', description: 'My games', access: 'friends',
  template: 'retro-games', itemCount: 4, publishedCount: 0, design: design(), ...o,
});

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
    if (method === 'GET' && path === '/catalogs') return Response.json({ catalogs });
    if (method === 'GET' && /^\/catalogs\/[^/]+\/items$/.test(path)) return Response.json({ items: [], tags: [] });
    if (method === 'GET' && path === '/catalogs/templates') {
      return Response.json({
        templates: [{ id: 'retro-games', label: 'Retro games', description: 'Games' }, { id: 'coins', label: 'Coins', description: 'Coins' }],
        agencies: { pcgs: { label: 'PCGS' }, ngc: { label: 'NGC' } },
      });
    }
    return Response.json({});
  };
  ({ initCollectionsSection } = await import('../../app/assets/js/collections-page.js'));
});
after(() => {
  for (const k of GLOBALS) globalThis[k] = saved[k];
  globalThis.fetch = saved.fetch;
});

async function openDesign(search = '?site=my%20site&section=collections&catalog=cat_1&tab=design') {
  win.history?.replaceState?.(null, '', search);
  globalThis.location = { search };
  await section.show();
  await settle();
}
const fieldRow = (id) => $('design-fields').querySelector(`[data-field-id="${id}"]`);
const setValue = (el, value) => {
  if (el.tagName !== 'SELECT') { el.value = value; return; }
  for (const o of el.options) o.toggleAttribute('selected', o.value === value);
};
const change = (el, value) => { setValue(el, value); el.dispatchEvent(new win.Event('change', { bubbles: true })); el.dispatchEvent(new win.Event('input', { bubbles: true })); };
const check = (el, on) => { el.checked = on; el.dispatchEvent(new win.Event('change', { bubbles: true })); };
const click = (el) => el.dispatchEvent(new win.Event('click', { bubbles: true }));

beforeEach(async () => {
  calls = [];
  responders = {};
  catalogs = [catalog(), catalog({ id: 'cat_2', slug: 'coins', title: 'Coins', access: 'public', itemCount: 0, publishedCount: 0 })];
  globalThis.location = { search: '?site=my%20site&section=collections' };
  // A fresh copy of the section, so earlier tests' sections do not keep listening to clicks
  const old = $('collections-section');
  old.replaceWith(old.cloneNode(true));
  section = await initCollectionsSection({ siteId: 'my site', root: $('collections-section') });
  await section.show();
  await settle();
});

describe('Collections section', () => {
  it('the rail lists Collections, and the page says collection, never catalog', () => {
    const rail = [...win.document.querySelectorAll('#rail-sections a')].map((a) => text(a));
    assert.ok(rail.includes('Collections'));
    assert.doesNotMatch(text($('collections-section')), /catalog/i);
  });

  it('lists each collection with its level and counts', () => {
    const rows = [...$('collections-list').querySelectorAll('li')];
    assert.equal(rows.length, 2);
    assert.match(text(rows[0]), /Retro games/);
    assert.match(text(rows[0]), /Friends/);
    assert.match(text(rows[0]), /4 items/);
    assert.match(text(rows[0]), /0 published/);
    assert.match(text(rows[1]), /Public/);
    assert.match(text(rows[1]), /0 items/);
    assert.equal(rows[0].querySelector('a').getAttribute('href'), 'site.html?site=my%20site&section=collections&catalog=cat_1');
  });

  it('New collection posts the title and template, then opens it', async () => {
    responders['POST /catalogs'] = () => Response.json(catalog({ id: 'cat_9', title: 'Coins 2' }), { status: 201 });
    click($('collections-new'));
    await settle();
    assert.equal($('collections-new-dialog').open, true);
    assert.deepEqual([...$('collections-new-template').options].map((o) => o.value), ['retro-games', 'coins', 'blank']);
    $('collections-new-title').value = 'Coins 2';
    setValue($('collections-new-template'), 'coins');
    $('collections-new-form').onsubmit(new win.Event('submit'));
    await settle();
    const post = calls.find((c) => c.method === 'POST' && c.path === '/catalogs');
    assert.deepEqual(post.body, { title: 'Coins 2', template: 'coins' });
    assert.equal($('collections-new-dialog').open, false);
    assert.equal($('collection-view').hidden, false);
    assert.match(text($('collection-title')), /Coins 2/);
  });
});

describe('Collection design', () => {
  it('shows the collection fields, with the Items tab beside it', async () => {
    await openDesign('?site=my%20site&section=collections&catalog=cat_1');
    assert.equal($('collection-view').hidden, false);
    assert.equal($('collection-items').hidden, false);
    assert.equal($('collection-design').hidden, true);
    assert.ok($('collection-items-mount'));
    await openDesign();
    assert.equal($('collection-design').hidden, false);
    assert.equal($('design-title').value, 'Retro games');
    assert.equal($('design-access').value, 'friends');
    assert.equal(fieldRow('f_paid').querySelector('[data-role="level"]').value, 'private');
    assert.ok(fieldRow('f_paid').querySelector('[data-role="total"]'));
    assert.equal(fieldRow('f_region').querySelector('[data-role="total"]'), null);
    assert.doesNotMatch(text($('collection-design')), /catalog/i);
  });

  it('round-trips a field level change into the PUT body', async () => {
    await openDesign();
    responders['PUT /catalogs/cat_1'] = (body) => Response.json(catalog({ design: body.design }));
    change(fieldRow('f_paid').querySelector('[data-role="level"]'), 'friends');
    check(fieldRow('f_paid').querySelector('[data-role="total"]'), true);
    click($('design-save'));
    await settle();
    const put = calls.find((c) => c.method === 'PUT' && c.path === '/catalogs/cat_1');
    const paid = put.body.design.fields.find((f) => f.id === 'f_paid');
    assert.equal(paid.level, 'friends');
    assert.equal(paid.total, true);
    assert.equal(put.body.access, 'friends');
    assert.equal(put.body.slug, undefined);
    assert.match(text($('design-status')), /saved/i);
  });

  it('adds a field and moves it up', async () => {
    await openDesign();
    $('design-new-field-label').value = 'Year';
    setValue($('design-new-field-type'), 'number');
    click($('design-new-field-add'));
    const rows = () => [...$('design-fields').querySelectorAll('tr[data-field-id]')];
    assert.equal(rows().length, 3);
    const label = (row) => row.querySelector('[data-role="label"]').value;
    assert.equal(label(rows()[2]), 'Year');
    click(rows()[2].querySelector('[data-role="up"]'));
    assert.equal(label(rows()[1]), 'Year');
    click(rows()[1].querySelector('[data-role="remove"]'));
    assert.equal(rows().length, 2);
  });

  it('shows the count when a removed choice is in use', async () => {
    await openDesign();
    responders['PUT /catalogs/cat_1'] = () => Response.json({ error: 'Choice is used by 3 items', count: 3 }, { status: 409 });
    click($('design-lists').querySelector('[data-choice-id="c_nes"] [data-role="remove"]'));
    click($('design-save'));
    await settle();
    assert.match(text($('design-error')), /Used by 3 items; move them first/);
    assert.equal($('design-error').hidden, false);
  });

  it('asks before dropping values of a removed field, then resends with confirmDropValues', async () => {
    await openDesign();
    let n = 0;
    responders['PUT /catalogs/cat_1'] = (body) => (++n === 1
      ? Response.json({ error: 'values', count: 3, fields: [{ id: 'f_paid', label: 'Price paid', count: 2 }, { id: 'f_region', label: 'Region', count: 1 }], grades: 1 }, { status: 409 })
      : Response.json(catalog({ design: body.design })));
    click(fieldRow('f_paid').querySelector('[data-role="remove"]'));
    click($('design-save'));
    await settle();
    assert.equal($('collections-confirm-dialog').open, true);
    assert.match(text($('collections-confirm-desc')), /3 items/);
    // Every field the save would empty is named with its count, and the grades too.
    const listed = [...$('collections-confirm-list').querySelectorAll('li')].map(text);
    assert.deepEqual(listed, ['Price paid: 2 items', 'Region: 1 item', 'Grade (its company is no longer listed): 1 item']);
    $('collections-confirm-form').onsubmit(new win.Event('submit'));
    await settle();
    const puts = calls.filter((c) => c.method === 'PUT');
    assert.equal(puts.length, 2);
    assert.equal(puts[0].body.confirmDropValues, undefined);
    assert.equal(puts[1].body.confirmDropValues, true);
  });

  it('locks the slug once something was ever published (as the server does), with a note', async () => {
    await openDesign();
    assert.equal($('design-slug').hasAttribute('disabled'), false);
    // Everything unpublished again: the server still locks the address.
    catalogs[0].publishedCount = 0;
    catalogs[0].everPublished = true;
    await openDesign();
    assert.equal($('design-slug').hasAttribute('disabled'), true);
    assert.match(text($('design-slug-note')), /published/i);
  });

  it('cleans a typed address into a slug when the field is left', async () => {
    await openDesign();
    responders['PUT /catalogs/cat_1'] = (body) => Response.json(catalog({ design: body.design, slug: body.slug }));
    change($('design-slug'), ' Old Games / NES ');
    $('design-slug').dispatchEvent(new win.Event('blur'));
    assert.equal($('design-slug').value, 'old-games-nes');
    click($('design-save'));
    await settle();
    assert.equal(calls.find((c) => c.method === 'PUT').body.slug, 'old-games-nes');
  });

  it('sends a changed slug, and edits grading and sort', async () => {
    await openDesign();
    responders['PUT /catalogs/cat_1'] = (body) => Response.json(catalog({ design: body.design }));
    change($('design-slug'), 'old-games');
    check($('design-grading-on'), true);
    check($('design-grading').querySelector('[data-agency="pcgs"]'), true);
    check($('design-sort').querySelector('[data-sort="f_region"]'), true);
    click($('design-save'));
    await settle();
    const put = calls.find((c) => c.method === 'PUT');
    assert.equal(put.body.slug, 'old-games');
    assert.deepEqual(put.body.design.grading, { level: 'public', agencies: ['pcgs'] });
    assert.deepEqual(put.body.design.sort, ['title', 'f_region']);
  });

  it('Update site shows only with published items, and confirms raising photo access', async () => {
    await openDesign();
    assert.equal($('design-publish').hidden, true);
    catalogs[0].publishedCount = 2;
    await openDesign();
    assert.equal($('design-publish').hidden, false);
    let n = 0;
    responders['POST /catalogs/cat_1/publish'] = (body) => (++n === 1
      ? Response.json({ error: 'less restricted', photoWarnings: [{ item: { id: 'i', title: 'Zelda' }, file: 'a.jpg', access: 'public', needed: 'friends', posts: ['Hello'] }] }, { status: 409 })
      : Response.json({ status: 'pushed', sha: 'abc', url: 'https://x.test/collections/retro-games/' }));
    click($('design-publish'));
    await settle();
    assert.equal($('collections-confirm-dialog').open, true);
    assert.match(text($('collections-confirm-list')), /a\.jpg/);
    assert.match(text($('collections-confirm-list')), /Hello/);
    $('collections-confirm-form').onsubmit(new win.Event('submit'));
    await settle();
    const posts = calls.filter((c) => c.path === '/catalogs/cat_1/publish');
    assert.equal(posts[1].body.confirmRaisePhotoAccess, true);
    assert.match(text($('design-status')), /Site updated/);
  });

  it('Update site says when the change was saved but not pushed', async () => {
    catalogs[0].publishedCount = 2;
    await openDesign();
    responders['POST /catalogs/cat_1/publish'] = () => Response.json({ status: 'saved', sha: 'abc', url: null });
    click($('design-publish'));
    await settle();
    assert.doesNotMatch(text($('design-status')), /Site updated/);
    assert.match(text($('design-status')), /not pushed/);
  });

  it('Delete collection asks, deletes and goes back to the list', async () => {
    await openDesign();
    responders['DELETE /catalogs/cat_1'] = () => new Response(null, { status: 204 });
    click($('design-delete'));
    await settle();
    assert.equal($('collections-confirm-dialog').open, true);
    assert.match(text($('collections-confirm-title')), /Delete/);
    $('collections-confirm-form').onsubmit(new win.Event('submit'));
    await settle();
    assert.ok(calls.some((c) => c.method === 'DELETE' && c.path === '/catalogs/cat_1'));
    assert.equal($('collection-view').hidden, true);
    assert.equal($('collections-list-view').hidden, false);
    assert.equal($('collections-list').querySelector('[data-id="cat_1"]'), null);
  });

  it('Delete collection shows the refusal when items are published', async () => {
    catalogs[0].publishedCount = 1;
    await openDesign();
    responders['DELETE /catalogs/cat_1'] = () => Response.json({ error: 'Published items must be unpublished first' }, { status: 409 });
    click($('design-delete'));
    await settle();
    $('collections-confirm-form').onsubmit(new win.Event('submit'));
    await settle();
    assert.match(text($('design-error')), /unpublished first/);
    assert.equal($('collection-view').hidden, false);
  });

  it('shows a publish refusal', async () => {
    catalogs[0].publishedCount = 2;
    await openDesign();
    responders['POST /catalogs/cat_1/publish'] = () => Response.json({ error: 'Photos missing from src/media: a.jpg.' }, { status: 422 });
    click($('design-publish'));
    await settle();
    assert.match(text($('design-error')), /Photos missing/);
  });

  it('making the collection more visible lists the items that follow it, then resends with confirmLowerLevel', async () => {
    await openDesign();
    let n = 0;
    responders['PUT /catalogs/cat_1'] = (body) => (++n === 1
      ? Response.json({ error: 'more visible', items: [{ id: 'i1', title: 'Zelda', access: 'public' }, { id: 'i2', title: 'Mario', access: 'public' }] }, { status: 409 })
      : Response.json(catalog({ access: body.access, design: body.design })));
    change($('design-access'), 'public');
    click($('design-save'));
    await settle();
    assert.equal($('collections-confirm-dialog').open, true);
    assert.match(text($('collections-confirm-desc')), /visible to everyone/);
    assert.deepEqual([...$('collections-confirm-list').querySelectorAll('li')].map(text), ['Zelda', 'Mario']);
    $('collections-confirm-form').onsubmit(new win.Event('submit'));
    await settle();
    const puts = calls.filter((c) => c.method === 'PUT');
    assert.equal(puts.length, 2);
    assert.equal(puts[0].body.confirmLowerLevel, undefined);
    assert.equal(puts[1].body.confirmLowerLevel, true);
    assert.match(text($('design-status')), /saved/i);
  });

  it('declining the more-visible confirm saves nothing', async () => {
    await openDesign();
    responders['PUT /catalogs/cat_1'] = () => Response.json({ error: 'more visible', items: [{ id: 'i1', title: 'Zelda', access: 'friends' }] }, { status: 409 });
    catalogs[0].access = 'private';
    await openDesign();
    change($('design-access'), 'friends');
    click($('design-save'));
    await settle();
    assert.match(text($('collections-confirm-desc')), /visible to friends/);
    $('collections-confirm-dialog').close();
    await settle();
    assert.equal(calls.filter((c) => c.method === 'PUT').length, 1);
  });

  it('locks the address after an item is published in this session', async () => {
    const draft = { id: 'item_1', catalogId: 'cat_1', slug: 'zelda', title: 'Zelda', status: 'draft', access: 'public', published: null, categories: {}, fields: {}, links: [], tags: [], photos: [], grade: null, rating: null, description: '', video: '' };
    let current = draft;
    responders['GET /catalogs/cat_1/items'] = () => Response.json({ items: [current], tags: [] });
    responders['GET /catalogs/cat_1/items/item_1'] = () => Response.json(current);
    responders['POST /catalogs/cat_1/items/item_1/publish'] = () => {
      current = { ...draft, status: 'published', published: '2026-11-26T00:00:00Z' };
      return Response.json({ status: 'pushed' });
    };
    await openDesign('?site=my%20site&section=collections&catalog=cat_1&tab=items');
    click($('collection-items-mount').querySelector('[data-item-id="item_1"] [data-role="open"]'));
    await settle();
    click($('item-publish'));
    await settle();
    click($('collection-tabs').querySelector('[data-tab="design"]'));
    await settle();
    assert.equal($('design-slug').hasAttribute('disabled'), true);
    assert.match(text($('design-slug-note')), /published/i);
    // Unpublished again in the same session: the address stays locked, as on the server.
    click($('collection-tabs').querySelector('[data-tab="items"]'));
    await settle();
    responders['POST /catalogs/cat_1/items/item_1/unpublish'] = () => {
      current = { ...current, status: 'draft' };
      return Response.json({ status: 'pushed' });
    };
    click($('item-unpublish'));
    await settle();
    assert.match(text($('collection-summary')), /0 published/);
    click($('collection-tabs').querySelector('[data-tab="design"]'));
    await settle();
    assert.equal($('design-slug').hasAttribute('disabled'), true);
  });

  it('an open design with unsaved edits locks its address when an item is published meanwhile', async () => {
    const draft = { id: 'item_1', catalogId: 'cat_1', slug: 'zelda', title: 'Zelda', status: 'draft', access: 'public', published: null, categories: {}, fields: {}, links: [], tags: [], photos: [], grade: null, rating: null, description: '', video: '' };
    let current = draft;
    responders['GET /catalogs/cat_1/items'] = () => Response.json({ items: [current], tags: [] });
    responders['GET /catalogs/cat_1/items/item_1'] = () => Response.json(current);
    responders['POST /catalogs/cat_1/items/item_1/publish'] = () => {
      current = { ...draft, status: 'published', published: '2026-11-26T00:00:00Z' };
      return Response.json({ status: 'pushed' });
    };
    await openDesign();
    change($('design-slug'), 'new-address');
    click($('collection-tabs').querySelector('[data-tab="items"]'));
    await settle();
    click($('collection-items-mount').querySelector('[data-item-id="item_1"] [data-role="open"]'));
    await settle();
    click($('item-publish'));
    await settle();
    click($('collection-tabs').querySelector('[data-tab="design"]'));
    await settle();
    assert.equal($('design-slug').hasAttribute('disabled'), true);
    assert.equal($('design-slug').value, 'retro-games');
    assert.equal($('design-publish').hidden, false);
    responders['PUT /catalogs/cat_1'] = (body) => Response.json(catalog({ design: body.design }));
    click($('design-save'));
    await settle();
    assert.equal('slug' in calls.find((c) => c.method === 'PUT').body, false);
  });
});

describe('Collections section: hidden and unsaved edits', () => {
  it('the stylesheet keeps every hidden element in the section hidden (buttons are inline-flex)', () => {
    const css = readFileSync(new URL('../../app/assets/app.css', import.meta.url), 'utf8');
    assert.match(css, /#collections-section \[hidden\]\s*\{[^}]*display:\s*none\s*!important/);
    assert.ok($('collections-section').querySelector('#collections-new'), 'section exists');
  });

  const edit = () => { const t = $('design-title'); t.value = 'Renamed'; t.dispatchEvent(new win.Event('input', { bubbles: true })); };

  it('keeps an unsaved edit when switching to Items and back', async () => {
    await openDesign();
    edit();
    click($('collection-tabs').querySelector('[data-tab="items"]'));
    await settle();
    assert.equal($('collection-design').hidden, true);
    click($('collection-tabs').querySelector('[data-tab="design"]'));
    await settle();
    assert.equal($('design-title').value, 'Renamed');
  });

  it('keeps an unsaved edit across hide() and show()', async () => {
    await openDesign();
    edit();
    await section.hide();
    await section.show();
    await settle();
    assert.equal($('design-title').value, 'Renamed');
  });

  it('asks before leaving a collection with unsaved edits; Cancel stays, Discard leaves', async () => {
    await openDesign();
    edit();
    click($('collection-back'));
    await settle();
    assert.equal($('collections-confirm-dialog').open, true);
    assert.match(text($('collections-confirm-title')), /Discard unsaved design changes\?/);
    $('collections-confirm-dialog').close();
    await settle();
    assert.equal($('collection-view').hidden, false);
    assert.equal($('design-title').value, 'Renamed');
    click($('collection-back'));
    await settle();
    $('collections-confirm-form').onsubmit(new win.Event('submit'));
    await settle();
    assert.equal($('collection-view').hidden, true);
    assert.equal($('collections-list-view').hidden, false);
  });

  it('does not ask when nothing was edited', async () => {
    await openDesign();
    click($('collection-back'));
    await settle();
    assert.equal($('collections-confirm-dialog').open, false);
    assert.equal($('collections-list-view').hidden, false);
  });
});
