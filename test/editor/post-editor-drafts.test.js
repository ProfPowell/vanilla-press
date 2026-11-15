import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { memoryBackend, createDraftStore } from '../../editor/assets/js/drafts/draft-store.js';
import { createEditorDrafts, UNPROTECTED } from '../../editor/assets/js/drafts/post-editor-drafts.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OFFLINE = "Can't reach Vanilla Press. Your changes are kept in this browser and will save when it's back.";
const serverDoc = (id = 'd1', updated = 'U1', text = 'a') => ({ id, meta: { title: 'T', updated }, blocks: [{ text }], regions: {} });

/** A stand-in for <save-bar>: records what it shows; showRestore buttons run then hide, as the real bar does. */
function fakeBar() {
  return {
    shown: null, offer: null, handlers: null,
    show(spec) { this.shown = spec; this.offer = null; },
    clear() { this.shown = null; this.offer = null; },
    showRestore(offer, handlers) { this.shown = null; this.offer = offer; this.handlers = handlers; },
    async click(name) { const p = this.handlers[name](); this.clear(); await p; },
  };
}

const live = [];
afterEach(() => { while (live.length) live.pop().release(); });

function setup(opts = {}) {
  const store = opts.store ?? createDraftStore(memoryBackend());
  const bar = fakeBar();
  let text = 'a';
  const calls = { restore: [], saves: 0, loads: [], created: [] };
  const view = { editable: true, focused: 0, setProps(p) { this.editable = p.editable(); }, focus() { this.focused++; } };
  const drafts = createEditorDrafts({
    store, siteId: 's', bar, getView: () => view,
    snapshot: () => ({ meta: { title: 'T' }, blocks: [{ text }], regions: {} }),
    restore: async (record) => { calls.restore.push(record); },
    createCopy: async (record) => { calls.created.push(record); return 'd2'; },
    load: async (id) => { calls.loads.push(id); },
    saveNow: async () => { calls.saves++; },
    flushSave: () => {},
    retryMs: 20, lockWait: 5,
    ...opts.extra,
  });
  live.push(drafts);
  return { store, bar, view, drafts, calls, type: (t) => { text = t; drafts.edited(); } };
}

describe('post editor drafts', () => {
  it('keeps an edit made while the post is still opening', async () => {
    const { store, drafts, type } = setup();
    const opening = drafts.openPost(serverDoc());
    type('typed early');
    await opening;
    await drafts.flush();
    assert.equal((await store.get('post:s:d1')).blocks[0].text, 'typed early');
  });

  it('a save of the previous post does not clear the next post copy', async () => {
    const { store, drafts, type } = setup();
    await drafts.openPost(serverDoc('d1'));
    type('one');
    const token = drafts.saveStarted();
    await drafts.openPost(serverDoc('d2'));
    type('two');
    await drafts.saveConfirmed(token, { docId: 'd1', updated: 'U2', meta: { title: 'T' }, blocks: [{ text: 'one' }], regions: {} });
    await drafts.flush();
    assert.equal((await store.get('post:s:d2')).blocks[0].text, 'two');
    assert.equal((await store.get('post:s:d1')).blocks[0].text, 'one');
  });

  it('a network failure shows the offline bar and retries until a save works', async () => {
    const { bar, drafts, calls } = setup();
    await drafts.openPost(serverDoc());
    drafts.saveFailed(new TypeError('Failed to fetch'));
    assert.deepEqual(bar.shown, { tone: 'error', text: OFFLINE });
    await sleep(30);
    assert.equal(calls.saves, 1);
    drafts.saveFailed(new TypeError('Failed to fetch'));
    drafts.saveSucceeded();
    assert.equal(bar.shown, null);
    await sleep(30);
    assert.equal(calls.saves, 1);
  });

  it('stops retrying when another post opens', async () => {
    const { drafts, calls } = setup();
    await drafts.openPost(serverDoc('d1'));
    drafts.saveFailed(new TypeError('Failed to fetch'));
    await drafts.openPost(serverDoc('d2'));
    await sleep(30);
    assert.equal(calls.saves, 0);
  });

  it('a server error shows its message without retrying', async () => {
    const { bar, drafts, calls } = setup();
    await drafts.openPost(serverDoc());
    drafts.saveFailed(Object.assign(new Error('Disk full'), { status: 500 }));
    assert.deepEqual(bar.shown, { tone: 'error', text: 'Disk full' });
    await sleep(30);
    assert.equal(calls.saves, 0);
  });

  it('storage trouble shows the warning, and it returns after a save problem clears', async () => {
    const failing = { get: () => Promise.reject(new Error('nope')), set: () => Promise.reject(new Error('nope')), delete: () => Promise.reject(new Error('nope')), keys: () => Promise.reject(new Error('nope')) };
    let ref;
    const store = createDraftStore(failing, { onUnavailable: () => ref.storageUnavailable() });
    const { bar, drafts } = setup({ store });
    ref = drafts;
    await drafts.openPost(serverDoc());
    assert.deepEqual(bar.shown, { tone: 'warn', text: UNPROTECTED });
    drafts.saveFailed(new TypeError('Failed to fetch'));
    assert.equal(bar.shown.tone, 'error');
    drafts.saveSucceeded();
    assert.deepEqual(bar.shown, { tone: 'warn', text: UNPROTECTED });
  });

  it('offers a differing copy; Restore hands it to the editor', async () => {
    const first = setup();
    await first.drafts.openPost(serverDoc());
    first.type('mine');
    await first.drafts.flush();
    first.drafts.release();
    const { bar, drafts, calls, view } = setup({ store: first.store });
    await drafts.openPost(serverDoc());
    assert.equal(bar.offer.kind, 'restore');
    assert.ok(bar.handlers.differences.includes('Body: 1 block changed'));
    await bar.click('onRestore');
    assert.equal(calls.restore[0].blocks[0].text, 'mine');
    assert.ok(view.focused > 0);
  });

  it('Discard removes the copy but keeps work typed since opening', async () => {
    const first = setup();
    await first.drafts.openPost(serverDoc());
    first.type('old');
    await first.drafts.flush();
    first.drafts.release();
    const { bar, drafts, store, type } = setup({ store: first.store });
    await drafts.openPost(serverDoc());
    await bar.click('onDiscard');
    assert.equal(await store.get('post:s:d1'), null);
    type('new');
    await bar.handlers.onDiscard();
    await drafts.flush();
    assert.equal((await store.get('post:s:d1')).blocks[0].text, 'new');
  });

  it('a stale copy is restored as a new draft and the original copy is let go', async () => {
    const first = setup();
    await first.drafts.openPost(serverDoc());
    first.type('old');
    await first.drafts.flush();
    first.drafts.release();
    const { bar, drafts, calls, store } = setup({ store: first.store });
    await drafts.openPost(serverDoc('d1', 'U9'));
    assert.equal(bar.offer.kind, 'stale');
    await bar.click('onRestoreAsNew');
    assert.equal(calls.created[0].blocks[0].text, 'old');
    assert.deepEqual(calls.loads, ['d2']);
    assert.equal(await store.get('post:s:d1'), null);
  });

  it('does not cover a save problem with an offer', async () => {
    const first = setup();
    await first.drafts.openPost(serverDoc());
    first.type('mine');
    await first.drafts.flush();
    first.drafts.release();
    const { bar, drafts } = setup({ store: first.store });
    const opening = drafts.openPost(serverDoc());
    drafts.saveWarning('Changed on disk');
    await opening;
    assert.deepEqual(bar.shown, { tone: 'warn', text: 'Changed on disk' });
    assert.equal(bar.offer, null);
  });

  it('offers a pending new post on the new post page', async () => {
    const first = setup();
    await first.drafts.openNew();
    first.type('never saved');
    await first.drafts.flush();
    const { bar, drafts, calls } = setup({ store: first.store });
    await drafts.openNew();
    assert.equal(bar.offer.kind, 'restore');
    await bar.click('onRestore');
    assert.equal(calls.restore[0].blocks[0].text, 'never saved');
  });

  it('a new post that is saved moves its copy to the post id', async () => {
    const { store, drafts, type } = setup();
    await drafts.openNew();
    type('draft');
    const token = drafts.saveStarted();
    type('draft more');
    await drafts.saveConfirmed(token, { docId: 'd7', updated: 'U1', meta: { title: 'T' }, blocks: [{ text: 'draft' }], regions: {} });
    await drafts.flush();
    assert.equal((await store.get('post:s:d7')).blocks[0].text, 'draft more');
    assert.deepEqual(await store.keys('post:s:new-'), []);
  });

  it('a post open in another tab is read-only until Edit here instead', async () => {
    const a = setup();
    await a.drafts.openPost(serverDoc());
    const b = setup({ store: a.store });
    await b.drafts.openPost(serverDoc());
    assert.equal(b.view.editable, false);
    assert.equal(b.bar.shown.text, 'This post is open in another tab');
    b.bar.shown.actions[0].run();
    await sleep(20);
    assert.equal(b.view.editable, true);
    assert.equal(a.view.editable, false);
    assert.deepEqual(b.calls.loads, ['d1']); // shows what the other tab saved
  });
});

describe('post editor drafts, repeats', () => {
  it('the same save problem is not shown again', async () => {
    const { bar, drafts } = setup();
    await drafts.openPost(serverDoc());
    let shows = 0;
    const show = bar.show.bind(bar);
    bar.show = (spec) => { shows++; show(spec); };
    drafts.saveWarning('Changed on disk');
    drafts.saveWarning('Changed on disk');
    assert.equal(shows, 1);
    drafts.saveFailed(new TypeError('Failed to fetch'));
    assert.equal(shows, 2);
    drafts.release();
  });
});
