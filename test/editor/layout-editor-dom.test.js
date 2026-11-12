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
    assert.ok(root.querySelector('[data-le-head]').disabled);
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
