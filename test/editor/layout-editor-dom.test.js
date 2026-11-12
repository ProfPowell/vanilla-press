/**
 * Layout editor page in a real DOM (linkedom): editor/layout.html's markup,
 * the canvas for the starter `post`, the header bar and Save (the hash it
 * opened with; 409 and 422 shown, never written over).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseHTML } from 'linkedom';

const COOK = '/Users/tpowell/src/cook';
const HAVE_COOK = existsSync(path.join(COOK, 'scripts', 'layouts.js'));
const cook = HAVE_COOK ? await import(path.join(COOK, 'scripts', 'layouts.js')) : null;
const STARTER = path.join(COOK, 'starters', 'vanilla-breeze', 'src', 'layouts');

const PAGE = readFileSync(new URL('../../editor/layout.html', import.meta.url), 'utf8');
const GLOBALS = ['window', 'document', 'Node', 'HTMLElement', 'customElements', 'CustomEvent', 'Event', 'getComputedStyle', 'MutationObserver'];
const saved = {};
let win;
let openLayoutEditor;

before(async () => {
  win = parseHTML(PAGE);
  for (const k of GLOBALS) { saved[k] = globalThis[k]; globalThis[k] = k === 'window' ? win : win[k]; }
  win.HTMLElement.prototype.scrollIntoView ??= function scrollIntoView() {};
  ({ openLayoutEditor } = await import('../../editor/assets/js/layout-editor/main.js'));
});
after(() => { for (const k of GLOBALS) globalThis[k] = saved[k]; });

/** A fetch stub: GET gives the starter's tree, PUT answers `put` and records the body. */
function stubFetch(tree, put) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
    const reply = (status, data) => ({ ok: status < 400, status, json: async () => data, text: async () => JSON.stringify(data) });
    if ((opts.method || 'GET') === 'GET') return reply(200, { tree, hash: 'h1', problems: [] });
    return reply(...put);
  };
  fn.calls = calls;
  return fn;
}

function starterTree(name, opts = {}) {
  const parsed = cook.parseLayout(readFileSync(path.join(STARTER, `${name}.html`), 'utf8'), opts);
  assert.ok(parsed.ok, JSON.stringify(parsed.problems));
  return parsed.tree;
}

/** A fresh copy of the page's body for each editor. */
function freshRoot() {
  const doc = win.document;
  const fresh = parseHTML(PAGE).document.body;
  doc.body.innerHTML = fresh.innerHTML;
  return doc.body;
}

const tick = () => new Promise(r => setTimeout(r, 0));

describe('layout editor page', { skip: !HAVE_COOK && 'needs the linked Cook' }, () => {
  it('opening the starter post shows its region slot and the document body', async () => {
    const root = freshRoot();
    const fetch = stubFetch(starterTree('post'), [200, { hash: 'h2' }]);
    await openLayoutEditor({ root, site: 's1', kind: 'layout', name: 'post', fetch });
    const canvas = root.querySelector('[data-le-canvas]').textContent;
    assert.match(canvas, /Region: Sidebar/);
    assert.match(canvas, /Document body goes here/);
    assert.match(canvas, /Title/); // ${title} as a token
    assert.equal(fetch.calls[0].url, '/api/sites/s1/layout-files/layout/post');
  });

  it('shows region names and fields in Title Case for the base', async () => {
    const root = freshRoot();
    const fetch = stubFetch(starterTree('base', { fields: ['siteTitle'] }), [200, { hash: 'h2' }]);
    const ed = await openLayoutEditor({ root, site: 's1', kind: 'layout', name: 'base', fetch });
    const canvas = root.querySelector('[data-le-canvas]').textContent;
    assert.match(canvas, /Main/);
    assert.match(canvas, /Sidebar/);
    assert.match(canvas, /Section menu/);
    assert.match(canvas, /\/includes\/header\.html/);
    const select = root.querySelector('[data-le-page-layout]');
    assert.ok([...select.options].some(o => o.textContent === 'Chosen by layouts built on this one' && o.value === '${pageLayout}'));
    assert.equal([...select.options].find(o => o.selected).value, '${pageLayout}');
    assert.equal(root.querySelector('[data-le-abstract]').closest('[hidden]'), null);
    assert.equal(root.querySelector('[data-le-abstract]').checked, true);
    assert.equal(root.querySelector('[data-le-head]').disabled, false); // the Head dialog (base only)
    ed.destroy();
  });

  it('editing the label and saving sends a tree whose info.label changed, with the hash it opened with', async () => {
    const root = freshRoot();
    const fetch = stubFetch(starterTree('post'), [200, { hash: 'h2' }]);
    const ed = await openLayoutEditor({ root, site: 's1', kind: 'layout', name: 'post', fetch });
    const label = root.querySelector('[data-le-label]');
    assert.equal(label.value, 'Blog post');
    label.value = 'Article';
    label.dispatchEvent(new win.Event('input', { bubbles: true }));
    assert.equal(ed.isDirty(), true);
    root.querySelector('[data-le-save]').click();
    await tick(); await tick();
    const put = fetch.calls.find(c => c.method === 'PUT');
    assert.equal(put.url, '/api/sites/s1/layout-files/layout/post');
    assert.equal(put.body.tree.info.label, 'Article');
    assert.equal(put.body.hash, 'h1');
    assert.equal(ed.hash(), 'h2');
    assert.equal(ed.isDirty(), false);
    ed.destroy();
  });

  it('a 409 shows the changed-on-disk message with Reload', async () => {
    const root = freshRoot();
    const fetch = stubFetch(starterTree('post'), [409, { error: 'This layout changed on disk since you opened it' }]);
    const ed = await openLayoutEditor({ root, site: 's1', kind: 'layout', name: 'post', fetch });
    await ed.save();
    const status = root.querySelector('[data-le-status]');
    assert.match(status.textContent, /This layout changed on disk since you opened it/);
    const reload = [...status.querySelectorAll('button')].find(b => b.textContent === 'Reload');
    assert.ok(reload);
    assert.equal(ed.hash(), 'h1');
    ed.destroy();
  });

  it('a 422 lists the problems', async () => {
    const root = freshRoot();
    const fetch = stubFetch(starterTree('post'), [422, { error: "This layout can't be saved", problems: [{ line: 3, message: 'unknown field "x"' }] }]);
    const ed = await openLayoutEditor({ root, site: 's1', kind: 'layout', name: 'post', fetch });
    await ed.save();
    const status = root.querySelector('[data-le-status]');
    assert.match(status.textContent, /unknown field "x"/);
    assert.ok(status.querySelector('li'));
    ed.destroy();
  });

  it('asks before leaving with unsaved changes, in the page (no browser dialog)', async () => {
    const root = freshRoot();
    const fetch = stubFetch(starterTree('post'), [200, { hash: 'h2' }]);
    const went = [];
    const ed = await openLayoutEditor({ root, site: 's1', kind: 'layout', name: 'post', fetch, navigate: (href) => went.push(href) });
    const back = root.querySelector('[data-le-back]');
    assert.equal(back.getAttribute('href'), '/app/site.html?site=s1&section=layouts');
    // Nothing unsaved: the link just goes
    const clean = new win.Event('click', { bubbles: true, cancelable: true });
    back.dispatchEvent(clean);
    assert.equal(clean.defaultPrevented, false);

    const view = ed.view;
    view.dispatch(view.state.tr.insertText('x', 4));
    assert.equal(ed.isDirty(), true);
    const ev = new win.Event('click', { bubbles: true, cancelable: true });
    back.dispatchEvent(ev);
    assert.equal(ev.defaultPrevented, true);
    const panel = root.querySelector('confirm-panel');
    assert.equal(panel.hidden, false);
    assert.match(panel.textContent, /not saved/);
    panel.confirmBtn.click();
    await tick();
    assert.deepEqual(went, ['/app/site.html?site=s1&section=layouts']);
    ed.destroy();
  });

  it('keeps undo history: an edit undone with Mod-z leaves the tree as opened', async () => {
    const root = freshRoot();
    const tree = starterTree('post');
    const fetch = stubFetch(tree, [200, { hash: 'h2' }]);
    const ed = await openLayoutEditor({ root, site: 's1', kind: 'layout', name: 'post', fetch });
    const before = ed.tree();
    const view = ed.view;
    view.dispatch(view.state.tr.insertText('x', 4));
    assert.notDeepEqual(ed.tree(), before);
    const { undo } = await import('prosemirror-history');
    const { docToTree } = await import('../../editor/assets/js/layout-editor/convert.js');
    // Applied without view.dispatch: linkedom can't scroll the selection into view
    let undone = null;
    assert.ok(undo(view.state, (tr) => { undone = view.state.apply(tr); }));
    assert.deepEqual(docToTree(undone.doc, ed.meta()), before);
    ed.destroy();
  });

  it('a child has no Abstract toggle and no Head button; a fragment has no info fields', async () => {
    let root = freshRoot();
    let ed = await openLayoutEditor({ root, site: 's1', kind: 'layout', name: 'post', fetch: stubFetch(starterTree('post'), [200, {}]) });
    assert.ok(root.querySelector('[data-le-abstract-field]').hidden);
    assert.ok(root.querySelector('[data-le-head]').hidden);
    assert.ok(![...root.querySelector('[data-le-page-layout]').options].some(o => o.value === '${pageLayout}'));
    assert.equal([...root.querySelector('[data-le-page-layout]').options].find(o => o.selected).value, 'article');
    ed.destroy();
    root = freshRoot();
    const frag = cook.parseLayout('<!-- layout-fragment -->\n<ul><li data-repeat="collections.blog | limit:5 as post"><a href="${post.url}">${post.title}</a></li></ul>\n', { fragment: true, lists: [] });
    ed = await openLayoutEditor({ root, site: 's1', kind: 'include', name: 'recent', fetch: stubFetch(frag.tree, [200, {}]) });
    assert.ok(root.querySelector('[data-le-info-fields]').hidden);
    const canvas = root.querySelector('[data-le-canvas]').textContent;
    assert.match(canvas, /Repeats for each post in collections\.blog \(5\)/);
    assert.match(canvas, /post\.title/);
    ed.destroy();
  });
});

describe('layout editor inspector', { skip: !HAVE_COOK && 'needs the linked Cook' }, () => {
  it('loads the context, shows the selected block and its changes mark the layout unsaved', async () => {
    const { NodeSelection } = await import('prosemirror-state');
    const root = freshRoot();
    const fetch = stubFetch(starterTree('post'), [200, { hash: 'h2' }]);
    const ed = await openLayoutEditor({ root, site: 's1', kind: 'layout', name: 'post', fetch });
    assert.ok(fetch.calls.some(c => c.url === '/api/sites/s1/layout-files/context'));
    const view = ed.view;
    let slotPos = null;
    view.state.doc.descendants((node, pos) => { if (node.type.name === 'slot_ref' && slotPos === null) slotPos = pos; });
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, slotPos)));
    const panel = root.querySelector('[data-le-inspector]');
    const label = panel.querySelector('[data-field="slot.label"]');
    assert.equal(label.value, 'Sidebar');
    assert.equal(ed.isDirty(), false);
    label.value = 'Extras';
    label.dispatchEvent(new win.Event('change', { bubbles: true }));
    assert.equal(ed.isDirty(), true);
    assert.match(root.querySelector('[data-le-canvas]').textContent, /Region: Extras/);
    assert.equal(ed.tree().info.slots[view.state.doc.nodeAt(slotPos).attrs.name].label, 'Extras');
    ed.destroy();
  });
});

describe('layout editor head and preview', { skip: !HAVE_COOK && 'needs the linked Cook' }, () => {
  it('Head (base only): a head edit marks the layout unsaved and reaches the saved tree', async () => {
    const root = freshRoot();
    const fetch = stubFetch(starterTree('base', { fields: ['siteTitle'] }), [200, { hash: 'h2' }]);
    const ed = await openLayoutEditor({ root, site: 's1', kind: 'layout', name: 'base', fetch });
    const head = root.querySelector('[data-le-head]');
    assert.equal(head.hidden, false);
    assert.equal(head.disabled, false);
    head.click();
    const dialog = root.querySelector('[data-le-head-dialog]');
    assert.ok(dialog.hasAttribute('open'));
    assert.match(dialog.querySelector('[data-head-list]').textContent, /Region: Head/);
    const region = [...dialog.querySelectorAll('[data-head-new] option')].find(o => o.value === 'region');
    assert.equal(region.disabled, true, 'the starter base already has the head region');
    dialog.querySelector('[data-head-add]').click(); // <meta> is the default choice
    assert.equal(ed.isDirty(), true);
    await ed.save();
    const put = fetch.calls.find(c => c.method === 'PUT');
    // Before ${slot:head}, which stays last
    assert.equal(put.body.tree.head.at(-2).tag, 'meta');
    assert.deepEqual(put.body.tree.head.at(-1), { slot: 'head' });
    const check = cook.checkLayout(cook.serializeLayout(put.body.tree), { fields: ['siteTitle'] });
    assert.ok(check.ok, JSON.stringify(check.problems));
    ed.destroy();
    assert.equal(root.querySelector('[data-le-head-dialog]'), null);
  });

  it('a child hides Head; the preview pane mounts and an edit schedules a render', async () => {
    const root = freshRoot();
    const fetch = stubFetch(starterTree('post'), [200, { hash: 'h2' }]);
    const ed = await openLayoutEditor({ root, site: 's1', kind: 'layout', name: 'post', fetch });
    assert.equal(root.querySelector('[data-le-head]').hidden, true);
    const frame = root.querySelector('[data-le-preview] iframe');
    assert.equal(frame.getAttribute('sandbox'), 'allow-scripts');
    await ed.preview().ready;
    const serializes = () => fetch.calls.filter(c => c.url === '/api/sites/s1/layout-files/serialize').length;
    const before = serializes();
    const label = root.querySelector('[data-le-label]');
    label.value = 'Changed';
    label.dispatchEvent(new win.Event('input', { bubbles: true }));
    await ed.preview().render();
    assert.equal(serializes(), before + 1);
    assert.equal(fetch.calls.filter(c => c.url === '/api/sites/s1/layout-files/serialize').at(-1).body.tree.info.label, 'Changed');
    ed.destroy();
  });
});

describe('layout editor: a child fills its parent\'s regions', { skip: !HAVE_COOK && 'needs the linked Cook' }, () => {
  it('the palette offers the parent\'s regions the child doesn\'t fill yet, by their labels', async () => {
    const root = freshRoot();
    const tree = starterTree('post');
    const base = stubFetch(tree, [200, { hash: 'h2' }]);
    const fetch = async (url, opts) => {
      if (url === '/api/sites/s1/layouts') {
        return { ok: true, status: 200, json: async () => ({ layouts: [{ name: 'base', slots: [{ name: 'nav', label: 'Section menu' }, { name: 'aside', label: 'Sidebar' }] }] }) };
      }
      return base(url, opts);
    };
    const ed = await openLayoutEditor({ root, site: 's1', kind: 'layout', name: 'post', fetch });
    // The starter post fills aside (and head) already
    assert.deepEqual(ed.palette.extraEntries(ed.view.state).map(e => [e.id, e.label]), [['fill-nav', 'Section menu']]);
    // A filled region shows by the parent's label
    const pieces = [...root.querySelectorAll('[data-le-canvas] .le-slot-piece')].map(d => d.querySelector('.le-name').textContent);
    assert.deepEqual(pieces, ['Region: Sidebar']);
    assert.doesNotMatch(root.querySelector('[data-le-canvas]').textContent, /Fills /);
    ed.destroy();
  });
});

describe('layout editor save edge cases', { skip: !HAVE_COOK && 'needs the linked Cook' }, () => {
  it('an edit made while the save runs keeps the layout unsaved (new hash stored)', async () => {
    const root = freshRoot();
    let release;
    const held = new Promise(r => { release = r; });
    const calls = [];
    const fetch = async (url, opts = {}) => {
      calls.push(opts.method || 'GET');
      const reply = (status, data) => ({ ok: status < 400, status, json: async () => data });
      if ((opts.method || 'GET') === 'GET') return reply(200, { tree: starterTree('post'), hash: 'h1', problems: [] });
      await held;
      return reply(200, { hash: 'h2' });
    };
    const ed = await openLayoutEditor({ root, site: 's1', kind: 'layout', name: 'post', fetch });
    const label = root.querySelector('[data-le-label]');
    label.value = 'First';
    label.dispatchEvent(new win.Event('input', { bubbles: true }));
    const saving = ed.save();
    await tick();
    label.value = 'Second';
    label.dispatchEvent(new win.Event('input', { bubbles: true }));
    release();
    await saving;
    assert.equal(ed.hash(), 'h2');
    assert.equal(ed.isDirty(), true);
    assert.match(root.querySelector('[data-le-status]').textContent, /Unsaved changes/);
    ed.destroy();
  });

  it('a base change that drops regions children fill asks in the panel, and Save anyway resends (I2)', async () => {
    const root = freshRoot();
    const puts = [];
    const fetch = async (url, opts = {}) => {
      const reply = (status, data) => ({ ok: status < 400, status, json: async () => data });
      if ((opts.method || 'GET') === 'GET') return reply(200, { tree: starterTree('base', { fields: ['siteTitle'] }), hash: 'h1', problems: [] });
      if (opts.method !== 'PUT') return reply(200, { ok: false, log: '', html: '' });
      const body = JSON.parse(opts.body);
      puts.push(body);
      if (!body.confirmDropped) {
        return reply(409, { error: 'Regions in use', dropped: [
          { layout: 'post', regions: [{ name: 'aside', label: 'Sidebar' }] },
          { layout: 'essay', regions: [{ name: 'aside', label: '' }] },
        ] });
      }
      return reply(200, { hash: 'h2' });
    };
    const ed = await openLayoutEditor({ root, site: 's1', kind: 'layout', name: 'base', fetch });
    const label = root.querySelector('[data-le-label]');
    label.value = 'Base 2';
    label.dispatchEvent(new win.Event('input', { bubbles: true }));
    const saving = ed.save();
    await tick(); await tick(); await tick();
    const panel = root.querySelector('confirm-panel');
    assert.equal(panel.hidden, false);
    assert.match(panel.textContent, /These layouts fill regions this change removes: post \(Sidebar\), essay \(aside\)/);
    assert.equal(panel.confirmBtn.textContent, 'Save anyway');
    assert.equal(panel.cancelBtn.textContent, 'Cancel');
    panel.confirmBtn.click();
    assert.equal(await saving, true);
    assert.equal(puts.length, 2);
    assert.equal(puts[1].confirmDropped, true);
    assert.equal(puts[1].hash, 'h1');
    assert.equal(ed.hash(), 'h2');
    assert.equal(ed.isDirty(), false);
    ed.destroy();
  });

  it('Cancel on the regions question writes nothing and keeps the edits (I2)', async () => {
    const root = freshRoot();
    const fetch = stubFetch(starterTree('base', { fields: ['siteTitle'] }), [409, { error: 'Regions in use', dropped: [{ layout: 'post', regions: [{ name: 'aside', label: 'Sidebar' }] }] }]);
    const ed = await openLayoutEditor({ root, site: 's1', kind: 'layout', name: 'base', fetch });
    const label = root.querySelector('[data-le-label]');
    label.value = 'Base 2';
    label.dispatchEvent(new win.Event('input', { bubbles: true }));
    const saving = ed.save();
    await tick(); await tick(); await tick();
    root.querySelector('confirm-panel').cancelBtn.click();
    assert.equal(await saving, false);
    assert.equal(fetch.calls.filter(c => c.method === 'PUT').length, 1);
    assert.equal(ed.isDirty(), true);
    assert.equal(ed.hash(), 'h1');
    ed.destroy();
  });

  it('Reload with unsaved edits asks first in the panel (M4)', async () => {
    const root = freshRoot();
    const fetch = stubFetch(starterTree('post'), [409, { error: 'This layout changed on disk since you opened it' }]);
    const ed = await openLayoutEditor({ root, site: 's1', kind: 'layout', name: 'post', fetch });
    const label = root.querySelector('[data-le-label]');
    label.value = 'Mine';
    label.dispatchEvent(new win.Event('input', { bubbles: true }));
    await ed.save();
    const gets = () => fetch.calls.filter(c => c.method === 'GET' && c.url === '/api/sites/s1/layout-files/layout/post').length;
    const before = gets();
    const reload = () => [...root.querySelector('[data-le-status]').querySelectorAll('button')].find(b => b.textContent === 'Reload');
    reload().click();
    await tick();
    const panel = root.querySelector('confirm-panel');
    assert.equal(panel.hidden, false);
    assert.match(panel.textContent, /Discard your changes and reload\?/);
    panel.cancelBtn.click();
    await tick(); await tick();
    assert.equal(gets(), before, 'Cancel keeps the edits');
    assert.equal(root.querySelector('[data-le-label]').value, 'Mine');
    reload().click();
    await tick();
    panel.confirmBtn.click();
    for (let i = 0; i < 6; i++) await tick();
    assert.equal(gets(), before + 1);
    assert.equal(root.querySelector('[data-le-label]').value, 'Blog post');
    assert.equal(ed.isDirty(), false);
    ed.destroy();
  });

  it('a 409 that is not a hand edit shows its own message, without Reload', async () => {
    const root = freshRoot();
    const msg = "This site's Cook is too old to edit layouts; update cook-ssg";
    const fetch = stubFetch(starterTree('post'), [409, { error: msg }]);
    const ed = await openLayoutEditor({ root, site: 's1', kind: 'layout', name: 'post', fetch });
    await ed.save();
    const status = root.querySelector('[data-le-status]');
    assert.match(status.textContent, /too old to edit layouts/);
    assert.doesNotMatch(status.textContent, /changed on disk/);
    assert.equal([...status.querySelectorAll('button')].some(b => b.textContent === 'Reload'), false);
    ed.destroy();
  });
});

describe('canvas labels', () => {
  it('a filled region without the parent\'s label shows its name', async () => {
    const { pieceText } = await import('../../editor/assets/js/layout-editor/views.js');
    assert.equal(pieceText([{ name: 'aside', label: 'Sidebar' }], 'aside'), 'Region: Sidebar');
    assert.equal(pieceText([], 'aside'), 'Region: aside');
  });
  it('fields: document fields in Title Case, others as written', async () => {
    const { fieldLabel } = await import('../../editor/assets/js/layout-editor/views.js');
    assert.equal(fieldLabel('title'), 'Title');
    assert.equal(fieldLabel('imageAlt'), 'Image alt');
    assert.equal(fieldLabel('post.title'), 'post.title');
    assert.equal(fieldLabel('siteTitle'), 'siteTitle');
  });
  it('regions and repeats', async () => {
    const { regionLabel, repeatLabel } = await import('../../editor/assets/js/layout-editor/views.js');
    const { layoutSchema } = await import('../../editor/assets/js/layout-editor/schema.js');
    const r = (tag, attrs = []) => regionLabel(layoutSchema.nodes.region.create({ tag, attrs }));
    assert.equal(r('header'), 'Header');
    assert.equal(r('main'), 'Main');
    assert.equal(r('aside'), 'Sidebar');
    assert.equal(r('footer'), 'Footer');
    assert.equal(r('nav'), 'Navigation');
    assert.equal(r('nav', [['aria-label', 'Section']]), 'Section menu');
    assert.equal(repeatLabel({ source: 'collections.blog', alias: 'post', pipes: [] }), 'Repeats for each post in collections.blog');
    assert.equal(repeatLabel({ source: 'collections.blog', alias: 'post', pipes: ['offset:1', 'limit:3'] }), 'Repeats for each post in collections.blog (3)');
  });
});

describe('layout editor: fragment mode (kind=include)', { skip: !HAVE_COOK && 'needs the linked Cook' }, () => {
  const siteNav = async () => {
    const names = await cook.loadSiteNames(path.join(COOK, 'starters', 'vanilla-breeze'));
    const src = readFileSync(path.join(COOK, 'starters', 'vanilla-breeze', 'src', 'includes', 'site-nav.html'), 'utf8');
    const r = cook.parseLayout(src, { fields: names.fields, lists: names.lists, fragment: true });
    assert.ok(r.ok, JSON.stringify(r.problems));
    return r.tree;
  };
  const listing = {
    layouts: [
      { name: 'base', kind: 'layout', abstract: true, usedBy: [], baseFor: ['page'] },
      { name: 'page', kind: 'layout', abstract: false, parent: 'base', usedBy: [], baseFor: [] },
    ],
    includes: [{ name: 'site-nav', kind: 'include', usedBy: ['src/layouts/base.html', 'src/layouts/page.html'] }],
  };

  /** GET listing answers `listing`; other GETs answer the tree; PUT records. */
  function fragFetch(tree) {
    const calls = [];
    const fn = async (url, opts = {}) => {
      const method = opts.method || 'GET';
      calls.push({ url, method, body: opts.body ? JSON.parse(opts.body) : null });
      const reply = (status, data) => ({ ok: status < 400, status, json: async () => data });
      if (method === 'PUT') return reply(200, { hash: 'h2' });
      if (url === '/api/sites/s1/layout-files') return reply(200, listing);
      if (url.endsWith('/layout-files/serialize')) return reply(200, { html: '<nav></nav>' });
      if (url.endsWith('/layout-preview')) return reply(200, { ok: true, url: 'http://127.0.0.1:5555/p/' });
      if (url.endsWith('/documents')) return reply(200, []);
      if (url.endsWith('/layout-files/context')) return reply(200, {});
      return reply(200, { tree, hash: 'h1', problems: [] });
    };
    fn.calls = calls;
    return fn;
  }

  it('hides Head, Abstract, page structure and the info inputs; the title is the file name', async () => {
    const root = freshRoot();
    const ed = await openLayoutEditor({ root, site: 's1', kind: 'include', name: 'site-nav', fetch: fragFetch(await siteNav()) });
    assert.equal(root.querySelector('[data-le-head]').hidden, true);
    assert.equal(root.querySelector('[data-le-head]').disabled, true);
    assert.equal(root.querySelector('[data-le-info-fields]').hidden, true);
    assert.equal(root.querySelector('[data-le-file]').textContent, 'src/includes/site-nav.html');
    assert.ok(root.querySelector('[data-le-canvas]').textContent.length > 0);
    ed.destroy();
  });

  it('Save keeps the fragment marker', async () => {
    const root = freshRoot();
    const fetch = fragFetch(await siteNav());
    const ed = await openLayoutEditor({ root, site: 's1', kind: 'include', name: 'site-nav', fetch });
    assert.ok(await ed.save());
    const put = fetch.calls.find(c => c.method === 'PUT');
    assert.match(put.url, /\/layout-files\/include\/site-nav$/);
    assert.equal(put.body.tree.kind, 'fragment');
    assert.ok(cook.serializeLayout(put.body.tree).startsWith('<!-- layout-fragment -->'));
    ed.destroy();
  });

  it('previews through a layout that includes it, sending the include as an override', async () => {
    const root = freshRoot();
    const fetch = fragFetch(await siteNav());
    const ed = await openLayoutEditor({ root, site: 's1', kind: 'include', name: 'site-nav', fetch });
    await ed.preview().ready;
    const prev = fetch.calls.filter(c => c.url.endsWith('/layout-preview')).at(-1);
    assert.equal(prev.body.layout, 'page', 'base is abstract, so the first non-abstract user');
    assert.deepEqual(prev.body.includes, { 'site-nav': '<nav></nav>' });
    ed.destroy();
  });
});
