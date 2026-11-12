/**
 * The layout editor's preview pane in a real DOM (linkedom): a sandboxed
 * iframe (allow-scripts only), Desktop / Narrow widths, a 600 ms debounce
 * after the last edit, the unsaved tree serialized by the site's Cook and
 * sent as an override, and a failed build shown as text (Review Focus 4).
 */
import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

const GLOBALS = ['window', 'document', 'Node', 'HTMLElement', 'Event'];
const saved = {};
let win;
let mod;

before(async () => {
  win = parseHTML('<!doctype html><html><body><section data-le-preview></section></body></html>');
  for (const k of GLOBALS) { saved[k] = globalThis[k]; globalThis[k] = k === 'window' ? win : win[k]; }
  mod = await import('../../editor/assets/js/layout-editor/preview-pane.js');
});
after(() => { for (const k of GLOBALS) globalThis[k] = saved[k]; });

const TREE = { kind: 'child', info: { format: 1, label: 'Post', slots: {} }, parent: 'base', vars: [], pageLayout: null, htmlAttrs: [], head: [], body: [], slots: [] };

/** A fetch stub for the pane's routes; `preview` is the layout-preview answer. */
function stubFetch({ docs = [], collections = null, preview = { ok: true, url: 'http://127.0.0.1:5555/vp-layout-preview/' } } = {}) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    calls.push({ url, method, body: opts.body ? JSON.parse(opts.body) : null });
    const reply = (status, data) => ({ ok: status < 400, status, json: async () => data });
    if (url.endsWith('/documents')) return reply(200, docs);
    if (url.endsWith('/config/collections')) return reply(200, { key: 'collections', value: collections });
    if (url.endsWith('/layout-files/serialize')) return reply(200, { html: '<body data-template="base">${content}</body>' });
    if (url.endsWith('/layout-preview')) return reply(200, preview);
    return reply(404, { error: 'nope' });
  };
  fn.calls = calls;
  return fn;
}

function freshEl() {
  const el = win.document.querySelector('[data-le-preview]');
  el.replaceChildren();
  return el;
}

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

describe('preview pane', () => {
  it('the iframe sandbox is exactly allow-scripts, with no referrer', async () => {
    const el = freshEl();
    const pane = mod.createPreviewPane({ el, site: 's1', kind: 'layout', name: 'post', getTree: () => TREE, fetch: stubFetch() });
    await pane.ready;
    const frame = el.querySelector('iframe');
    assert.equal(frame.getAttribute('sandbox'), 'allow-scripts');
    assert.equal(frame.getAttribute('referrerpolicy'), 'no-referrer');
    assert.match(frame.getAttribute('src'), /^http:\/\/127\.0\.0\.1:5555\/vp-layout-preview\/\?v=\d+$/);
    pane.destroy();
  });

  it('sends the serialized tree as the override for this layout', async () => {
    const el = freshEl();
    const fetch = stubFetch();
    const pane = mod.createPreviewPane({ el, site: 's1', kind: 'layout', name: 'post', getTree: () => TREE, fetch });
    await pane.ready;
    const ser = fetch.calls.find(c => c.url === '/api/sites/s1/layout-files/serialize');
    assert.deepEqual(ser.body, { tree: TREE, kind: 'layout' });
    const prev = fetch.calls.find(c => c.url === '/api/sites/s1/layout-preview');
    assert.deepEqual(prev.body, { layouts: { post: '<body data-template="base">${content}</body>' }, includes: {}, layout: 'post' });
    pane.destroy();
  });

  it('a failed render shows the log text, and the pane keeps working', async () => {
    const el = freshEl();
    const log = 'building…\nline 2\nError: Layout cycle: base → post → base';
    const pane = mod.createPreviewPane({ el, site: 's1', kind: 'layout', name: 'post', getTree: () => TREE, fetch: stubFetch({ preview: { ok: false, log } }) });
    await pane.ready;
    const shown = el.querySelector('[data-lp-log]');
    assert.equal(shown.hidden, false);
    assert.match(shown.textContent, /Layout cycle: base → post → base/);
    assert.equal(shown.querySelector('*'), null, 'the log is text, not markup');
    pane.destroy();
  });

  it('a log with markup is shown as text', async () => {
    const el = freshEl();
    const pane = mod.createPreviewPane({ el, site: 's1', kind: 'layout', name: 'post', getTree: () => TREE, fetch: stubFetch({ preview: { ok: false, log: '<img src=x onerror=alert(1)>' } }) });
    await pane.ready;
    const shown = el.querySelector('[data-lp-log]');
    assert.equal(shown.querySelector('img'), null);
    assert.match(shown.textContent, /<img src=x/);
    pane.destroy();
  });

  it('width buttons switch data-width', async () => {
    const el = freshEl();
    const pane = mod.createPreviewPane({ el, site: 's1', kind: 'layout', name: 'post', getTree: () => TREE, fetch: stubFetch() });
    await pane.ready;
    const frame = el.querySelector('iframe');
    const btn = (w) => el.querySelector(`button[data-width="${w}"]`);
    assert.equal(btn('desktop').textContent, 'Desktop');
    assert.equal(btn('narrow').textContent, 'Narrow');
    assert.equal(frame.dataset.width, 'desktop');
    btn('narrow').click();
    assert.equal(frame.dataset.width, 'narrow');
    assert.equal(btn('narrow').getAttribute('aria-pressed'), 'true');
    assert.equal(btn('desktop').getAttribute('aria-pressed'), 'false');
    btn('desktop').click();
    assert.equal(frame.dataset.width, 'desktop');
    pane.destroy();
  });

  it('three quick edits send one request, 600 ms after the last', async () => {
    const el = freshEl();
    const fetch = stubFetch();
    const pane = mod.createPreviewPane({ el, site: 's1', kind: 'layout', name: 'post', getTree: () => TREE, fetch });
    await pane.ready;
    const previews = () => fetch.calls.filter(c => c.url.endsWith('/layout-preview')).length;
    const before = previews();
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      pane.schedule();
      mock.timers.tick(200);
      pane.schedule();
      mock.timers.tick(200);
      pane.schedule();
      mock.timers.tick(599);
      await flush();
      assert.equal(previews(), before);
      mock.timers.tick(1);
      await flush();
      assert.equal(previews(), before + 1);
    } finally {
      mock.timers.reset();
    }
    pane.destroy();
  });
});

describe('preview document choice', () => {
  const doc = (id, collection, updated, layout) => ({ id, meta: { title: id, collection, updated, ...(layout ? { layout } : {}) } });

  it('the most recent document whose effective layout is this one', () => {
    const docs = [
      doc('old-post', 'posts', '2026-01-01T00:00:00Z'),
      doc('new-post', 'posts', '2026-03-01T00:00:00Z'),
      doc('page', 'pages', '2026-05-01T00:00:00Z'),
      doc('docs-page', 'pages', '2026-04-01T00:00:00Z', 'docs'),
    ];
    assert.equal(mod.defaultPreviewDocument(docs, {}, 'post').id, 'new-post');
    assert.equal(mod.defaultPreviewDocument(docs, {}, 'page').id, 'page');
    assert.equal(mod.defaultPreviewDocument(docs, {}, 'docs').id, 'docs-page');
    // collections config: notes render with the docs layout
    const withNotes = [...docs, doc('note', 'notes', '2026-06-01T00:00:00Z')];
    assert.equal(mod.defaultPreviewDocument(withNotes, { notes: { layout: 'docs' } }, 'docs').id, 'note');
  });

  it('else the most recent post, else the sample page (null)', () => {
    const docs = [doc('a', 'posts', '2026-01-01T00:00:00Z'), doc('b', 'posts', '2026-02-01T00:00:00Z'), doc('p', 'pages', '2026-09-01T00:00:00Z')];
    assert.equal(mod.defaultPreviewDocument(docs, {}, 'landing').id, 'b');
    assert.equal(mod.defaultPreviewDocument([doc('p', 'pages', '2026-09-01T00:00:00Z')], {}, 'landing'), null);
    assert.equal(mod.defaultPreviewDocument([], {}, 'post'), null);
  });

  it('the select defaults to that document and lists Sample page', async () => {
    const el = freshEl();
    const docs = [doc('a', 'posts', '2026-01-01T00:00:00Z'), doc('b', 'posts', '2026-02-01T00:00:00Z')];
    const fetch = stubFetch({ docs });
    const pane = mod.createPreviewPane({ el, site: 's1', kind: 'layout', name: 'post', getTree: () => TREE, fetch });
    await pane.ready;
    const select = el.querySelector('select[data-lp-doc]');
    const chosen = [...select.querySelectorAll('option')].find(o => o.selected);
    assert.equal(chosen.value, 'b');
    assert.ok([...select.querySelectorAll('option')].some(o => o.value === '' && o.textContent === 'Sample page'));
    assert.equal(fetch.calls.find(c => c.url.endsWith('/layout-preview')).body.docId, 'b');
    pane.destroy();
  });
});
