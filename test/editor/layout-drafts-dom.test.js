/**
 * The layout editor's local copy in a real DOM (linkedom): edits are kept in
 * the store, reopening offers them back in the save bar (Restore, or Keep my
 * copy when the file changed, whose save meets the 409), Discard removes
 * them, and a save clears them.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseHTML } from 'linkedom';
import { memoryBackend, createDraftStore } from '../../editor/assets/js/drafts/draft-store.js';

const COOK = '/Users/tpowell/src/cook';
const HAVE_COOK = existsSync(path.join(COOK, 'scripts', 'layouts.js'));
const cook = HAVE_COOK ? await import(path.join(COOK, 'scripts', 'layouts.js')) : null;
const STARTER = path.join(COOK, 'starters', 'vanilla-breeze', 'src', 'layouts');

const PAGE = readFileSync(new URL('../../editor/layout.html', import.meta.url), 'utf8');
const GLOBALS = ['window', 'document', 'Node', 'HTMLElement', 'customElements', 'CustomEvent', 'Event', 'getComputedStyle', 'MutationObserver'];
const saved = {};
let win;
let openLayoutEditor;
const KEY = 'layout:s1:layout:post';

before(async () => {
  win = parseHTML(PAGE);
  for (const k of GLOBALS) { saved[k] = globalThis[k]; globalThis[k] = k === 'window' ? win : win[k]; }
  win.HTMLElement.prototype.scrollIntoView ??= function scrollIntoView() {};
  // linkedom has no selection to focus: the canvas's focus after Restore does nothing here
  const { EditorView } = await import('prosemirror-view');
  EditorView.prototype.focus = function focus() {};
  ({ openLayoutEditor } = await import('../../editor/assets/js/layout-editor/main.js'));
});
after(() => { for (const k of GLOBALS) globalThis[k] = saved[k]; });

/** GET gives `tree` with `hash`; PUT answers `put` and records the body. */
function stubFetch(tree, { hash = 'h1', put = [200, { hash: 'h2' }] } = {}) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
    const reply = (status, data) => ({ ok: status < 400, status, json: async () => data, text: async () => JSON.stringify(data) });
    if ((opts.method || 'GET') === 'GET') return reply(200, { tree, hash, problems: [] });
    return reply(...put);
  };
  fn.calls = calls;
  return fn;
}

const starterTree = () => cook.parseLayout(readFileSync(path.join(STARTER, 'post.html'), 'utf8')).tree;

function freshRoot() {
  win.document.body.innerHTML = parseHTML(PAGE).document.body.innerHTML;
  return win.document.body;
}

const bar = (root) => root.querySelector('save-bar');
const labels = (root) => [...bar(root).querySelectorAll('button')].map((b) => b.textContent);
const click = (root, label) => [...bar(root).querySelectorAll('button')].find((b) => b.textContent === label).click();

/** Open, change the label to `label` and leave without saving. */
async function leaveEdited(store, label = 'Article', opts = {}) {
  const root = freshRoot();
  const ed = await openLayoutEditor({ root, site: 's1', kind: 'layout', name: 'post', fetch: stubFetch(starterTree(), opts), store });
  const input = root.querySelector('[data-le-label]');
  input.value = label;
  input.dispatchEvent(new win.Event('input', { bubbles: true }));
  await ed.flushCopy();
  ed.destroy();
}

describe('layout editor local copy', { skip: !HAVE_COOK && 'needs the linked Cook' }, () => {
  it('the page has a hidden save bar under the bar', () => {
    const root = freshRoot();
    const sb = bar(root);
    assert.ok(sb);
    assert.equal(sb.hidden, true);
    assert.equal(sb.previousElementSibling.tagName.toLowerCase(), 'header');
  });

  it('keeps every edit, and offers it back on reopening; Restore puts it in the editor unsaved', async () => {
    const store = createDraftStore(memoryBackend());
    await leaveEdited(store);
    const rec = await store.get(KEY);
    assert.equal(rec.tree.info.label, 'Article');
    assert.equal(rec.baseHash, 'h1');

    const root = freshRoot();
    const fetch = stubFetch(starterTree());
    const ed = await openLayoutEditor({ root, site: 's1', kind: 'layout', name: 'post', fetch, store });
    assert.equal(bar(root).hidden, false);
    assert.match(bar(root).textContent, /Unsaved changes from/);
    assert.deepEqual(labels(root), ['Restore', 'Show differences', 'Discard']);
    assert.match(bar(root).textContent, /Label changed/);
    assert.equal(ed.isDirty(), false);
    click(root, 'Restore');
    assert.equal(bar(root).hidden, true);
    assert.equal(ed.isDirty(), true);
    assert.equal(ed.tree().info.label, 'Article');
    assert.equal(root.querySelector('[data-le-label]').value, 'Article');
    // Saving clears the copy
    assert.equal(await ed.save(), true);
    await ed.flushCopy();
    assert.equal(fetch.calls.find((c) => c.method === 'PUT').body.hash, 'h1');
    assert.equal(await store.get(KEY), null);
    ed.destroy();
  });

  it('edits before choosing never write over the offered copy; Discard keeps them instead', async () => {
    const store = createDraftStore(memoryBackend());
    await leaveEdited(store, 'Article');
    const root = freshRoot();
    const ed = await openLayoutEditor({ root, site: 's1', kind: 'layout', name: 'post', fetch: stubFetch(starterTree()), store });
    const input = root.querySelector('[data-le-label]');
    input.value = 'Typed meanwhile';
    input.dispatchEvent(new win.Event('input', { bubbles: true }));
    await ed.flushCopy();
    assert.equal((await store.get(KEY)).tree.info.label, 'Article');
    click(root, 'Discard');
    await ed.flushCopy();
    assert.equal((await store.get(KEY)).tree.info.label, 'Typed meanwhile');
    assert.equal(ed.tree().info.label, 'Typed meanwhile');
    ed.destroy();
  });

  it('Discard with nothing typed removes the copy', async () => {
    const store = createDraftStore(memoryBackend());
    await leaveEdited(store);
    const root = freshRoot();
    const ed = await openLayoutEditor({ root, site: 's1', kind: 'layout', name: 'post', fetch: stubFetch(starterTree()), store });
    click(root, 'Discard');
    await ed.flushCopy();
    assert.equal(await store.get(KEY), null);
    assert.equal(ed.tree().info.label, 'Blog post');
    assert.equal(ed.isDirty(), false);
    ed.destroy();
  });

  it('a copy made before the file changed offers Discard and Keep my copy; its save meets the 409', async () => {
    const store = createDraftStore(memoryBackend());
    await leaveEdited(store, 'Article', { hash: 'h0' });
    const root = freshRoot();
    const fetch = stubFetch(starterTree(), { hash: 'h1', put: [409, { error: 'This layout changed on disk since you opened it' }] });
    const ed = await openLayoutEditor({ root, site: 's1', kind: 'layout', name: 'post', fetch, store });
    assert.match(bar(root).textContent, /made before this layout was changed elsewhere/);
    assert.deepEqual(labels(root), ['Discard', 'Keep my copy']);
    click(root, 'Keep my copy');
    assert.equal(bar(root).hidden, true);
    assert.equal(ed.isDirty(), true);
    assert.equal(ed.tree().info.label, 'Article');
    assert.equal(ed.hash(), 'h0');
    assert.equal(await ed.save(), false);
    assert.equal(fetch.calls.find((c) => c.method === 'PUT').body.hash, 'h0');
    assert.match(root.querySelector('[data-le-status]').textContent, /changed on disk/);
    await ed.flushCopy();
    assert.equal((await store.get(KEY)).tree.info.label, 'Article'); // still kept
    ed.destroy();
  });

  it('a copy that matches the file is not offered', async () => {
    const store = createDraftStore(memoryBackend());
    await leaveEdited(store, 'Blog post'); // the label as it already is
    const root = freshRoot();
    const ed = await openLayoutEditor({ root, site: 's1', kind: 'layout', name: 'post', fetch: stubFetch(starterTree()), store });
    assert.equal(bar(root).hidden, true);
    ed.destroy();
  });

  it('leaving without saving, when asked, lets the copy go', async () => {
    const store = createDraftStore(memoryBackend());
    const root = freshRoot();
    const ed = await openLayoutEditor({ root, site: 's1', kind: 'layout', name: 'post', fetch: stubFetch(starterTree()), store, navigate() {} });
    const input = root.querySelector('[data-le-label]');
    input.value = 'Article';
    input.dispatchEvent(new win.Event('input', { bubbles: true }));
    await ed.flushCopy();
    assert.ok(await store.get(KEY));
    root.querySelector('[data-le-back]').dispatchEvent(new win.Event('click', { bubbles: true, cancelable: true }));
    root.querySelector('confirm-panel').confirmBtn.click();
    await new Promise((r) => setTimeout(r, 0));
    await ed.flushCopy();
    assert.equal(await store.get(KEY), null);
    ed.destroy();
  });

  it('says unsaved work is not protected when the browser has no storage', async () => {
    const root = freshRoot();
    const ed = await openLayoutEditor({ root, site: 's1', kind: 'layout', name: 'post', fetch: stubFetch(starterTree()) });
    await ed.flushCopy();
    assert.equal(bar(root).hidden, false);
    assert.match(bar(root).textContent, /Unsaved work isn't protected in this browser/);
    ed.destroy();
  });
});
