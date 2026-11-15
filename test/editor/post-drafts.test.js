import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { memoryBackend, createDraftStore } from '../../editor/assets/js/drafts/draft-store.js';
import { createPostDrafts } from '../../editor/assets/js/drafts/post-drafts.js';

const snap = (text, title = 'T') => ({ meta: { title }, blocks: [{ text }], regions: {} });
const serverDoc = (updated = 'U1') => ({ id: 'd1', meta: { title: 'T', updated }, blocks: [{ text: 'a' }], regions: {} });
const setup = () => {
  const store = createDraftStore(memoryBackend());
  let n = 0;
  const mk = () => createPostDrafts({ store, siteId: 's', now: () => `2026-01-01T00:00:${String(n++).padStart(2, '0')}.000Z` });
  return { store, mk };
};

describe('post drafts', () => {
  it('keeps edits made during a save', async () => {
    const { store, mk } = setup();
    const d = mk();
    await d.open('d1', serverDoc());
    d.edited(snap('one'));
    const token = d.saveStarted();
    d.edited(snap('two'));
    await d.saveConfirmed(token, { docId: 'd1', updated: 'U2', ...snap('one') });
    await d.flush();
    const rec = await store.get('post:s:d1');
    assert.equal(rec.blocks[0].text, 'two');
    assert.equal(rec.baseUpdated, 'U2');
    assert.equal((await d.versions()).length, 1);
  });

  it('clears the copy when nothing came after the save', async () => {
    const { store, mk } = setup();
    const d = mk();
    await d.open('d1', serverDoc());
    d.edited(snap('one'));
    const token = d.saveStarted();
    await d.saveConfirmed(token, { docId: 'd1', updated: 'U2', ...snap('one') });
    assert.equal(await store.get('post:s:d1'), null);
    const v = await d.versions();
    assert.equal(v.length, 1);
    assert.equal(v[0].updated, 'U2');
    assert.deepEqual(Object.keys(v[0]).sort(), ['at', 'blocks', 'meta', 'regions', 'updated']);
  });

  it('coalesces writes and the last snapshot lands', async () => {
    const { store, mk } = setup();
    const d = mk();
    await d.open('d1', serverDoc());
    for (let i = 0; i < 10; i++) d.edited(snap('v' + i));
    await d.flush();
    const rec = await store.get('post:s:d1');
    assert.equal(rec.blocks[0].text, 'v9');
    assert.equal(rec.seq, 10);
    assert.equal(rec.baseUpdated, 'U1');
  });

  it('does not keep a reference to the caller snapshot', async () => {
    const { store, mk } = setup();
    const d = mk();
    await d.open('d1', serverDoc());
    const s = snap('one');
    d.edited(s);
    await d.flush();
    s.blocks[0].text = 'mutated';
    assert.equal((await store.get('post:s:d1')).blocks[0].text, 'one');
  });

  it('keeps a new post and moves it to its id on save', async () => {
    const { store, mk } = setup();
    const d = mk();
    assert.equal(await d.open(null, null), null);
    d.edited(snap('fresh'));
    await d.flush();
    const d2 = mk();
    const pending = await d2.pendingNew();
    assert.equal(pending.record.blocks[0].text, 'fresh');
    assert.equal(pending.record.docId, null);

    const token = d.saveStarted();
    d.edited(snap('fresh2'));
    await d.saveConfirmed(token, { docId: 'doc_9', updated: 'U1', ...snap('fresh') });
    assert.equal(await d2.pendingNew(), null);
    const moved = await store.get('post:s:doc_9');
    assert.equal(moved.blocks[0].text, 'fresh2');
    assert.equal(moved.docId, 'doc_9');
    assert.equal((await d.versions()).length, 1);
    // later edits go to the new key
    d.edited(snap('fresh3'));
    await d.flush();
    assert.equal((await store.get('post:s:doc_9')).blocks[0].text, 'fresh3');
    assert.deepEqual(await store.keys('post:s:new-'), []);
  });

  it('removes a new post copy on a clean save', async () => {
    const { store, mk } = setup();
    const d = mk();
    await d.open(null, null);
    d.edited(snap('x'));
    await d.saveConfirmed(d.saveStarted(), { docId: 'doc_1', updated: 'U1', ...snap('x') });
    assert.deepEqual(await store.keys('post:s:'), []);
  });

  it('offers a restore on open', async () => {
    const { mk } = setup();
    const d = mk();
    await d.open('d1', serverDoc());
    d.edited(snap('changed'));
    await d.flush();
    const offer = await mk().open('d1', serverDoc());
    assert.equal(offer.kind, 'restore');
    const stale = await mk().open('d1', serverDoc('U9'));
    assert.equal(stale.kind, 'stale');
  });

  it('discard removes the copy and keeps it as a version', async () => {
    const { store, mk } = setup();
    const d = mk();
    await d.open('d1', serverDoc());
    d.edited(snap('lost'));
    await d.discard();
    assert.equal(await store.get('post:s:d1'), null);
    const v = await d.versions();
    assert.equal(v[0].discarded, true);
    assert.equal(v[0].blocks[0].text, 'lost');
  });

  it('uses local when there is no site', async () => {
    const store = createDraftStore(memoryBackend());
    const d = createPostDrafts({ store, siteId: null });
    await d.open('d1', serverDoc());
    d.edited(snap('a'));
    await d.flush();
    assert.notEqual(await store.get('post:local:d1'), null);
  });

  it('keeps an offered stale copy as a version before it is overwritten', async () => {
    const { mk } = setup();
    const d = mk();
    await d.open('d1', serverDoc());
    d.edited(snap('old work'));
    await d.flush();
    const d2 = mk();
    const offer = await d2.open('d1', serverDoc('U9'));
    assert.equal(offer.kind, 'stale');
    d2.edited(snap('new'));
    await d2.flush();
    const v = await d2.versions();
    assert.ok(v.some((x) => x.offered === true && x.blocks[0].text === 'old work'));
  });

  it('keeps an offered restore copy as a version', async () => {
    const { mk } = setup();
    const d = mk();
    await d.open('d1', serverDoc());
    d.edited(snap('old work'));
    await d.flush();
    const d2 = mk();
    assert.equal((await d2.open('d1', serverDoc())).kind, 'restore');
    d2.edited(snap('new'));
    await d2.flush();
    assert.ok((await d2.versions()).some((x) => x.offered && x.blocks[0].text === 'old work'));
  });

  it('adopts a pending new post key', async () => {
    const { store, mk } = setup();
    const d = mk();
    await d.open(null, null);
    d.edited(snap('fresh'));
    await d.flush();
    const d2 = mk();
    const { key, record } = await d2.pendingNew();
    record.blocks[0].text = 'poked';
    assert.equal((await store.get(key)).blocks[0].text, 'fresh');
    await d2.open(null, null, { adoptKey: key });
    d2.edited(snap('resumed'));
    const token = d2.saveStarted();
    await d2.saveConfirmed(token, { docId: 'doc_9', updated: 'U1', ...snap('resumed') });
    assert.equal(await d2.pendingNew(), null);
    assert.equal(await store.get('post:s:doc_9'), null);
    d2.edited(snap('later'));
    await d2.flush();
    assert.equal((await store.get('post:s:doc_9')).blocks[0].text, 'later');
    assert.deepEqual(await store.keys('post:s:new-'), []);
  });

  it('discard keeps the draft when the version cannot be saved', async () => {
    const backend = memoryBackend();
    const store = createDraftStore({ ...backend, set: (s, k, v) => (s === 'versions' ? Promise.reject(new Error('full')) : backend.set(s, k, v)) });
    const d = createPostDrafts({ store, siteId: 's' });
    await d.open('d1', serverDoc());
    d.edited(snap('precious'));
    await d.flush();
    await d.discard();
    assert.equal((await backend.get('drafts', 'post:s:d1')).blocks[0].text, 'precious');
  });
});
