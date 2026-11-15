import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { memoryBackend, createDraftStore } from '../../editor/assets/js/drafts/draft-store.js';
import { createLayoutDrafts } from '../../editor/assets/js/drafts/layout-drafts.js';
import { layoutKey, sameLayout, layoutOffer, describeLayoutDifferences } from '../../editor/assets/js/drafts/draft-logic.js';

const KEY = 'layout:s:layout:post';
const snap = (text, label = 'Post') => ({
  tree: { kind: 'child', info: { label }, body: [{ type: 'text', tag: 'p', inline: [{ text }] }], slots: [] },
  meta: { kind: 'child', info: { label } },
});
const server = () => snap('a');

const setup = (backend = memoryBackend()) => {
  const store = createDraftStore(backend);
  let n = 0;
  const mk = (opts = {}) => createLayoutDrafts({
    store, siteId: 's', kind: 'layout', name: 'post',
    now: () => `2026-01-01T00:00:${String(n++).padStart(2, '0')}.000Z`, ...opts,
  });
  return { store, mk };
};

/** A copy of `text` left by an earlier visit, opened on hash `base`. */
async function leaveCopy(mk, text, base = 'h1') {
  const d = mk();
  await d.open(base, server());
  d.edited(snap(text));
  await d.flush();
}

describe('layout drafts: logic', () => {
  it('keys a layout by site, kind and name', () => {
    assert.equal(layoutKey('s', 'layout', 'post'), 'layout:s:layout:post');
    assert.equal(layoutKey('s', 'include', 'header'), 'layout:s:include:header');
    assert.equal(layoutKey(null, 'layout', 'post'), 'layout:local:layout:post');
  });

  it('compares the whole tree and meta, whatever the key order', () => {
    const a = snap('x');
    const b = { meta: { info: { label: 'Post' }, kind: 'child' }, tree: { slots: [], body: a.tree.body, info: { label: 'Post' }, kind: 'child' } };
    assert.equal(sameLayout(a, b), true);
    assert.equal(sameLayout(a, snap('y')), false);
    const meta = snap('x');
    meta.meta.info.slots = { aside: { label: 'Aside' } }; // only in meta
    assert.equal(sameLayout(a, meta), false);
  });

  it('offers nothing without a copy, or when the copy matches the file', () => {
    assert.equal(layoutOffer(null, 'h1', server()), null);
    assert.equal(layoutOffer({ ...server(), baseHash: 'h1', at: 't' }, 'h1', server()), null);
  });

  it('offers restore on the same hash and stale on another', () => {
    const local = { ...snap('b'), baseHash: 'h1', at: 't' };
    assert.deepEqual(layoutOffer(local, 'h1', server()), { kind: 'restore', at: 't' });
    assert.deepEqual(layoutOffer(local, 'h2', server()), { kind: 'stale', at: 't' });
  });

  it('describes the differences in plain words', () => {
    assert.deepEqual(describeLayoutDifferences(snap('b', 'Essay'), server()), ['Label changed', 'Blocks changed']);
    assert.deepEqual(describeLayoutDifferences(server(), server()), []);
  });
});

describe('layout drafts: controller', () => {
  it('offers nothing when there is no copy', async () => {
    const { mk } = setup();
    assert.equal(await mk().open('h1', server()), null);
  });

  it('offers restore on the same hash', async () => {
    const { mk, store } = setup();
    await leaveCopy(mk, 'mine');
    const rec = await store.get(KEY);
    assert.deepEqual(Object.keys(rec).sort(), ['at', 'baseHash', 'meta', 'seq', 'tree']);
    assert.equal(rec.baseHash, 'h1');
    const offer = await mk().open('h1', server());
    assert.equal(offer.kind, 'restore');
    assert.equal(offer.at, rec.at);
  });

  it('offers stale when the file has changed since', async () => {
    const { mk } = setup();
    await leaveCopy(mk, 'mine');
    assert.equal((await mk().open('h2', server())).kind, 'stale');
  });

  it('offers nothing when the copy is the file as it is', async () => {
    const { mk } = setup();
    await leaveCopy(mk, 'a');
    assert.equal(await mk().open('h1', server()), null);
  });

  it('keeps an include under its own kind', async () => {
    const { store, mk } = setup();
    const d = mk({ kind: 'include', name: 'header' });
    await d.open('h1', server());
    d.edited(snap('x'));
    await d.flush();
    assert.ok(await store.get('layout:s:include:header'));
    assert.equal(await store.get(KEY), null);
  });

  it('keeps edits made during a save, with the new hash', async () => {
    const { store, mk } = setup();
    const d = mk();
    await d.open('h1', server());
    d.edited(snap('one'));
    const token = d.saveStarted();
    d.edited(snap('two'));
    await d.saveConfirmed(token, 'h2');
    await d.flush();
    const rec = await store.get(KEY);
    assert.equal(rec.tree.body[0].inline[0].text, 'two');
    assert.equal(rec.baseHash, 'h2');
  });

  it('clears the copy when nothing came after the save', async () => {
    const { store, mk } = setup();
    const d = mk();
    await d.open('h1', server());
    d.edited(snap('one'));
    const token = d.saveStarted();
    await d.saveConfirmed(token, 'h2');
    await d.flush();
    assert.equal(await store.get(KEY), null);
  });

  it('coalesces writes and the last snapshot lands', async () => {
    const { store, mk } = setup();
    const d = mk();
    await d.open('h1', server());
    for (let i = 0; i < 10; i++) d.edited(snap('v' + i));
    await d.flush();
    const rec = await store.get(KEY);
    assert.equal(rec.tree.body[0].inline[0].text, 'v9');
    assert.equal(rec.seq, 10);
  });

  it('does not keep a reference to the caller snapshot', async () => {
    const { store, mk } = setup();
    const d = mk();
    await d.open('h1', server());
    const s = snap('one');
    d.edited(s);
    await d.flush();
    s.tree.body[0].inline[0].text = 'mutated';
    s.meta.info.label = 'mutated';
    const rec = await store.get(KEY);
    assert.equal(rec.tree.body[0].inline[0].text, 'one');
    assert.equal(rec.meta.info.label, 'Post');
  });

  it('an edit before open has read the copy does not overwrite it', async () => {
    const { store, mk } = setup();
    await leaveCopy(mk, 'mine');
    const d = mk();
    const opening = d.open('h1', server());
    d.edited(snap('early'));
    const offer = await opening;
    await d.flush();
    assert.equal(offer.kind, 'restore');
    assert.equal((await store.get(KEY)).tree.body[0].inline[0].text, 'mine');
  });

  it('an edit before open with no copy is written once open is done', async () => {
    const { store, mk } = setup();
    const d = mk();
    const opening = d.open('h1', server());
    d.edited(snap('early'));
    assert.equal(await opening, null);
    await d.flush();
    assert.equal((await store.get(KEY)).tree.body[0].inline[0].text, 'early');
  });

  it('never writes over the offered copy before the person chooses', async () => {
    const { store, mk } = setup();
    await leaveCopy(mk, 'mine');
    const d = mk();
    await d.open('h1', server());
    d.edited(snap('typed meanwhile'));
    await d.flush();
    assert.equal((await store.get(KEY)).tree.body[0].inline[0].text, 'mine');
    // A save meanwhile does not clear it either
    const token = d.saveStarted();
    await d.saveConfirmed(token, 'h2');
    await d.flush();
    assert.equal((await store.get(KEY)).tree.body[0].inline[0].text, 'mine');
  });

  it('take() gives the copy and its hash; edits are recorded from then on', async () => {
    const { store, mk } = setup();
    await leaveCopy(mk, 'mine', 'h0');
    const d = mk();
    assert.equal((await d.open('h1', server())).kind, 'stale');
    const rec = d.take();
    assert.equal(rec.tree.body[0].inline[0].text, 'mine');
    assert.equal(rec.baseHash, 'h0');
    rec.tree.body[0].inline[0].text = 'changed by caller';
    d.edited(snap('mine, then more'));
    await d.flush();
    const now = await store.get(KEY);
    assert.equal(now.tree.body[0].inline[0].text, 'mine, then more');
    assert.equal(now.baseHash, 'h0'); // still behind the file: the next save meets the conflict
  });

  it('discard() removes the offered copy', async () => {
    const { store, mk } = setup();
    await leaveCopy(mk, 'mine');
    const d = mk();
    await d.open('h1', server());
    await d.discard();
    assert.equal(await store.get(KEY), null);
    d.edited(snap('after'));
    await d.flush();
    assert.equal((await store.get(KEY)).tree.body[0].inline[0].text, 'after');
  });

  it('discard(current) replaces the copy with the work typed since, in one write', async () => {
    const { store, mk } = setup();
    await leaveCopy(mk, 'mine');
    const d = mk();
    await d.open('h1', server());
    d.edited(snap('typed meanwhile'));
    await d.discard(snap('typed meanwhile'));
    const rec = await store.get(KEY);
    assert.equal(rec.tree.body[0].inline[0].text, 'typed meanwhile');
    assert.equal(rec.baseHash, 'h1');
  });

  it('a failed write in discard keeps the old copy', async () => {
    const backend = memoryBackend();
    const { store, mk } = setup(backend);
    await leaveCopy(mk, 'mine');
    const d = mk();
    await d.open('h1', server());
    backend.set = async () => { throw new Error('quota'); };
    await d.discard(snap('typed meanwhile'));
    assert.equal((await store.get(KEY)).tree.body[0].inline[0].text, 'mine');
    assert.equal(store.available, false);
  });

  it('an edit queued before a discard does not land after it', async () => {
    const { store, mk } = setup();
    const d = mk();
    await d.open('h1', server());
    d.edited(snap('one'));
    await d.discard();
    await d.flush();
    assert.equal(await store.get(KEY), null);
  });
});
