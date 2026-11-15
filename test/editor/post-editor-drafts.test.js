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
  const settings = { editable: true };
  const drafts = createEditorDrafts({
    store, siteId: 's', bar, getView: () => view,
    setSettingsEditable: (on) => { settings.editable = on; },
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
  return { store, bar, view, settings, drafts, calls, type: (t) => { text = t; drafts.edited(); } };
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

describe('post editor drafts, two tabs', () => {
  /** Tab a edits d1; tab b opens it read-only. */
  async function twoTabs({ aExtra = {}, bExtra = {} } = {}) {
    const a = setup({ extra: aExtra });
    await a.drafts.openPost(serverDoc());
    const b = setup({ store: a.store, extra: bExtra });
    await b.drafts.openPost(serverDoc());
    assert.equal(b.view.editable, false);
    return { a, b };
  }

  it('a read-only tab records nothing, starts no save and does not retry', async () => {
    const { a, b } = await twoTabs();
    a.type('active');
    await a.drafts.flush();
    b.type('read-only');
    await b.drafts.flush();
    assert.equal((await a.store.get('post:s:d1')).blocks[0].text, 'active');
    assert.equal(b.drafts.saveStarted(), null);
    assert.equal(b.drafts.canSave(), false);
    assert.equal(a.drafts.canSave(), true);
    b.drafts.saveFailed(new TypeError('Failed to fetch'));
    await sleep(40);
    assert.equal(b.calls.saves, 0);
  });

  it('the tab that loses the lock stops retrying and its late save leaves the copy alone', async () => {
    const { a, b } = await twoTabs();
    a.type('one');
    const token = a.drafts.saveStarted();
    a.drafts.saveFailed(new TypeError('Failed to fetch'));
    b.bar.shown.actions[0].run();
    await sleep(20);
    assert.equal(a.view.editable, false);
    assert.equal(b.view.editable, true);
    b.type('b work');
    await b.drafts.flush();
    await a.drafts.saveConfirmed(token, { docId: 'd1', updated: 'U2', meta: { title: 'T' }, blocks: [{ text: 'one' }], regions: {} });
    await a.drafts.flush();
    assert.equal((await a.store.get('post:s:d1')).blocks[0].text, 'b work');
    assert.ok((await a.store.versions('post:s:d1')).some((v) => v.blocks[0].text === 'one' && v.updated === 'U2'));
    await sleep(30);
    assert.equal(a.calls.saves, 0);
  });

  it('Edit here instead waits for the other tab to finish saving', async () => {
    let done;
    const { b } = await twoTabs({ aExtra: { flushSave: () => new Promise((r) => { done = r; }) } });
    b.bar.shown.actions[0].run();
    await sleep(30);
    assert.deepEqual(b.calls.loads, []);
    assert.equal(b.view.editable, false);
    assert.equal(b.drafts.canSave(), false);
    done();
    await sleep(20);
    assert.deepEqual(b.calls.loads, ['d1']);
    assert.equal(b.view.editable, true);
  });

  it('Edit here instead gives up waiting after a while', async () => {
    const { b } = await twoTabs({ aExtra: { flushSave: () => new Promise(() => {}) }, bExtra: { handoffWait: 30 } });
    b.bar.shown.actions[0].run();
    await sleep(15);
    assert.deepEqual(b.calls.loads, []);
    await sleep(40);
    assert.deepEqual(b.calls.loads, ['d1']);
    assert.equal(b.view.editable, true);
  });
});

describe('post editor drafts, storage throwing', () => {
  it('a post whose copy cannot be read is still protected from then on', async () => {
    const store = createDraftStore(memoryBackend());
    store.get = () => Promise.reject(new Error('broken'));
    const { bar, drafts, type } = setup({ store });
    await drafts.openPost(serverDoc());
    assert.deepEqual(bar.shown, { tone: 'warn', text: UNPROTECTED });
    type('kept');
    await drafts.flush();
    assert.deepEqual(await store.keys('post:s:d1'), ['post:s:d1']);
    assert.notEqual(drafts.saveStarted(), null);
  });
});

describe('post editor drafts, reload after a takeover', () => {
  async function takeOverWith(load) {
    const a = setup();
    await a.drafts.openPost(serverDoc());
    a.type('active');
    await a.drafts.flush();
    const b = setup({ store: a.store, extra: { load } });
    await b.drafts.openPost(serverDoc());
    b.bar.shown.actions[0].run();
    return { a, b };
  }

  it('a failed reload leaves the tab read-only and the shared copy alone', async () => {
    let works = false;
    const loads = [];
    const { a, b } = await takeOverWith(async (id) => { loads.push(id); return works; });
    await sleep(30);
    assert.deepEqual(loads, ['d1']);
    assert.equal(b.view.editable, false);
    assert.equal(b.drafts.canSave(), false);
    assert.equal(b.drafts.saveStarted(), null);
    assert.equal(b.bar.shown.tone, 'error');
    assert.equal(b.bar.shown.text, "Couldn't reload this post. Try again");
    b.type('stale');
    await b.drafts.flush();
    assert.equal((await a.store.get('post:s:d1')).blocks[0].text, 'active');
    // Try again: works this time, and the takeover finishes
    works = true;
    const retry = b.bar.shown.actions.find((x) => x.label === 'Try again');
    await retry.run();
    assert.deepEqual(loads, ['d1', 'd1']);
    assert.equal(b.view.editable, true);
    assert.equal(b.drafts.canSave(), true);
    assert.equal(b.bar.shown, null);
  });

  it('a reload makes the tab editable only once the post is replaced', async () => {
    let finish;
    const seen = [];
    let bRef;
    const { b } = await takeOverWith((id) => new Promise((r) => {
      seen.push({ id, editable: bRef.view.editable, canSave: bRef.drafts.canSave() });
      finish = () => r(true);
    }));
    bRef = b;
    await sleep(30);
    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0], { id: 'd1', editable: false, canSave: false });
    assert.equal(b.view.editable, false);
    assert.equal(b.drafts.canSave(), false);
    finish();
    await sleep(5);
    assert.equal(b.view.editable, true);
    assert.equal(b.drafts.canSave(), true);
  });

  it('lists the saved versions and restores one through the restore path', async () => {
    const { drafts, calls, type } = setup();
    await drafts.openPost(serverDoc());
    type('v1');
    const token = drafts.saveStarted();
    await drafts.saveConfirmed(token, { docId: 'd1', updated: 'U2', meta: { title: 'T', updated: 'U2' }, blocks: [{ text: 'v1' }], regions: {} });
    const versions = await drafts.versions();
    assert.equal(versions.length, 1);
    assert.equal(versions[0].blocks[0].text, 'v1');
    assert.deepEqual(drafts.differences(versions[0]), []);
    type('v2');
    assert.ok(drafts.differences(versions[0]).length > 0);
    await drafts.restoreVersion(versions[0]);
    assert.deepEqual(calls.restore, [versions[0]]);
  });

  it('a read-only tab does not restore a version', async () => {
    const restored = [];
    const { drafts } = setup({ extra: { restore: async (v) => { restored.push(v); } } });
    await drafts.openPost(serverDoc());
    const other = createEditorDrafts({
      store: createDraftStore(memoryBackend()), siteId: 's', bar: fakeBar(), getView: () => null,
      snapshot: () => ({ meta: {}, blocks: [], regions: {} }), restore: async (v) => { restored.push(v); }, createCopy: async () => 'x',
      load: async () => {}, saveNow: async () => {}, lockWait: 5,
    });
    live.push(other);
    await other.openPost(serverDoc());
    await sleep(30);
    const readOnly = [drafts, other].filter((d) => !d.canSave());
    assert.equal(readOnly.length, 1);
    await readOnly[0].restoreVersion({ meta: {}, blocks: [], regions: {} });
    assert.equal(restored.length, 0);
  });

  it('restoring a version keeps the unsaved text as an "Unsaved copy" first', async () => {
    const { drafts, type, calls } = setup();
    await drafts.openPost(serverDoc());
    type('v1');
    await drafts.saveConfirmed(drafts.saveStarted(), { docId: 'd1', updated: 'U2', meta: { title: 'T', updated: 'U2' }, blocks: [{ text: 'v1' }], regions: {} });
    type('typed, not saved yet');
    const [older] = await drafts.versions();
    await drafts.restoreVersion(older);
    assert.equal(calls.restore.length, 1);
    const kept = (await drafts.versions())[0];
    assert.equal(kept.offered, true);
    assert.equal(kept.blocks[0].text, 'typed, not saved yet');
  });

  it('when the unsaved text cannot be kept, nothing is restored and storage is warned about', async () => {
    const backend = memoryBackend();
    const store = createDraftStore(backend);
    const { drafts, type, calls, bar } = setup({ store });
    await drafts.openPost(serverDoc());
    type('v1');
    await drafts.saveConfirmed(drafts.saveStarted(), { docId: 'd1', updated: 'U2', meta: { title: 'T', updated: 'U2' }, blocks: [{ text: 'v1' }], regions: {} });
    const [older] = await drafts.versions();
    type('typed, not saved yet');
    store.pushVersion = async () => false;
    await drafts.restoreVersion(older);
    assert.equal(calls.restore.length, 0);
    assert.equal(bar.shown?.text, UNPROTECTED);
  });});

describe('post editor drafts, while an offer waits', () => {
  /** A store holding an unsaved copy of d1 ('mine'), as a crashed tab leaves it. */
  async function leftCopy(text = 'mine') {
    const first = setup();
    await first.drafts.openPost(serverDoc());
    first.type(text);
    await first.drafts.flush();
    first.drafts.release();
    return first.store;
  }

  it('while an offer waits, editing pauses: read-only, settings off, nothing recorded or saved', async () => {
    const { bar, drafts, view, settings, store, type } = setup({ store: await leftCopy() });
    await drafts.openPost(serverDoc());
    assert.equal(bar.offer.kind, 'restore');
    assert.equal(view.editable, false);
    assert.equal(settings.editable, false);
    assert.equal(drafts.canSave(), false);
    assert.equal(drafts.saveStarted(), null);
    type('typed over it');
    await drafts.flush();
    assert.equal((await store.get('post:s:d1')).blocks[0].text, 'mine');
  });

  for (const choice of ['onRestore', 'onDiscard']) {
    it(`editing comes back after ${choice.slice(2)}`, async () => {
      const { bar, drafts, view, settings } = setup({ store: await leftCopy() });
      await drafts.openPost(serverDoc());
      await bar.click(choice);
      assert.equal(view.editable, true);
      assert.equal(settings.editable, true);
      assert.equal(drafts.canSave(), true);
      assert.notEqual(drafts.saveStarted(), null);
    });
  }

  it('editing comes back after Restore as a new draft', async () => {
    const { bar, drafts, view, settings } = setup({ store: await leftCopy() });
    await drafts.openPost(serverDoc('d1', 'U9'));
    assert.equal(bar.offer.kind, 'stale');
    assert.equal(view.editable, false);
    await bar.click('onRestoreAsNew');
    assert.equal(view.editable, true);
    assert.equal(settings.editable, true);
  });

  it('Restore runs with editing back on, so the restored copy can save', async () => {
    let canSaveDuring = null;
    let ref;
    const { bar, drafts } = setup({ store: await leftCopy(), extra: { restore: async () => { canSaveDuring = ref.canSave(); } } });
    ref = drafts;
    await drafts.openPost(serverDoc());
    await bar.click('onRestore');
    assert.equal(canSaveDuring, true);
  });

  it('a save problem while an offer waits does not replace the offer', async () => {
    const { bar, drafts } = setup({ store: await leftCopy() });
    await drafts.openPost(serverDoc());
    drafts.saveFailed(new TypeError('Failed to fetch'));
    assert.equal(bar.offer?.kind, 'restore');
  });

  it('opening another post ends the pause', async () => {
    const { drafts, view, settings } = setup({ store: await leftCopy() });
    await drafts.openPost(serverDoc());
    assert.equal(view.editable, false);
    await drafts.openPost(serverDoc('d2'));
    assert.equal(view.editable, true);
    assert.equal(settings.editable, true);
    assert.equal(drafts.canSave(), true);
  });

  it('a pending new post offer pauses editing too', async () => {
    const first = setup();
    await first.drafts.openNew();
    first.type('never saved');
    await first.drafts.flush();
    first.drafts.release();
    const { bar, drafts, view } = setup({ store: first.store });
    await drafts.openNew();
    assert.equal(bar.offer.kind, 'restore');
    assert.equal(view.editable, false);
    assert.equal(drafts.canSave(), false);
  });
});
