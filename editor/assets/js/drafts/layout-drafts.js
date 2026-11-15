/**
 * The layout editor's controller for local copies: the layout (or include)
 * as it is in the editor, kept in this browser on every change until a save
 * has it. Call `open` when the layout loads, `edited` on every change, and
 * `saveStarted`/`saveConfirmed` around a save.
 *
 * A copy offered back by `open` is never written over before the person
 * chooses (the editor takes no edits meanwhile; any that come are not
 * recorded): `take()` (Restore, Keep my copy) hands the copy over and
 * records from then on, and `discard()` removes it (or replaces it with
 * work typed before the offer, in one write). All store writes go through
 * one promise chain, so they never overlap.
 *
 * @module editor/drafts/layout-drafts
 */

import { layoutKey, layoutOffer } from './draft-logic.js';

const clone = (value) => (value === undefined ? value : JSON.parse(JSON.stringify(value)));

/**
 * @param {{ store: object, siteId: string|null, kind: 'layout'|'include', name: string, now?: () => string }} opts
 */
export function createLayoutDrafts({ store, siteId, kind, name, now = () => new Date().toISOString() }) {
  const key = layoutKey(siteId, kind, name);
  let baseHash = null;
  let seq = 0;
  let latest = null;      // newest snapshot not yet cleared by a save
  let scheduled = false;  // a coalesced write is queued but has not started
  let generation = 0;     // bumped by open, a save or a discard so older queued writes stand down
  let opened = false;     // open has read the stored copy: writes may start
  let held = null;        // the copy offered back, until the person chooses
  let chain = Promise.resolve();

  const enqueue = (fn) => {
    const run = chain.then(fn);
    chain = run.catch(() => {});
    return run;
  };

  const record = (snapshot) => ({ tree: snapshot.tree, meta: snapshot.meta, baseHash, seq, at: now() });

  /** Queue a write of the newest snapshot (once per burst of edits). */
  function schedule() {
    if (scheduled || !opened || held || !latest) return;
    scheduled = true;
    const gen = generation;
    enqueue(async () => {
      if (gen !== generation) return;
      scheduled = false;
      if (!latest || held) return;
      await store.put(key, record(latest));
    });
  }

  return {
    /**
     * Start on the layout as loaded (its hash, and its tree and meta as the
     * editor shows them). Resolves with the offer, or null.
     * @param {string|null} serverHash
     * @param {{ tree: object, meta: object }|null} [server]
     */
    async open(serverHash, server = null) {
      generation++;
      scheduled = false;
      opened = false;
      held = null;
      latest = null; // edits from before this open (a reload) are not this layout's
      baseHash = serverHash ?? null;
      try {
        await chain;
        const local = await store.get(key);
        const offer = layoutOffer(local, baseHash, server);
        if (offer) held = local;
        return offer;
      } finally {
        // Even when reading failed, edits are recorded from here on
        opened = true;
        schedule();
      }
    },

    /** Record a change. Coalesced: the last snapshot always lands. */
    edited(snapshot) {
      if (held) return; // the offered copy waits for a choice
      seq++;
      latest = { tree: clone(snapshot.tree), meta: clone(snapshot.meta) };
      schedule();
    },

    /**
     * The offered copy (a clone), for Restore or Keep my copy. Edits are
     * recorded over it from now on, against the copy's own hash.
     * @returns {{ tree: object, meta: object, baseHash: string|null, seq: number, at: string }|null}
     */
    take() {
      const rec = held;
      held = null;
      if (!rec) return null;
      baseHash = rec.baseHash ?? null;
      return clone(rec);
    },

    /** The copy offered and not yet chosen about (a clone), or null. */
    offeredCopy() { return held ? clone(held) : null; },

    /** Mark the start of a save; the token is the current edit count. */
    saveStarted() { return seq; },

    /**
     * The server accepted a save started with `token`. The copy goes when no
     * edit came after the token; otherwise it is kept with the new hash. An
     * offered copy waiting for a choice is left as it is.
     */
    saveConfirmed(token, newHash) {
      const clean = seq === token;
      generation++;
      scheduled = false;
      baseHash = newHash ?? null;
      if (clean) latest = null;
      if (held || !opened) return chain.then(() => {});
      return enqueue(async () => {
        if (clean) await store.remove(key);
        else if (latest) await store.put(key, record(latest));
      });
    },

    /**
     * Throw the copy away. With `current` (work typed since the copy was
     * offered), that replaces the copy in one write, so a failed write
     * leaves the old copy rather than nothing.
     * @param {{ tree: object, meta: object }|null} [current]
     */
    discard(current = null) {
      generation++;
      scheduled = false;
      held = null;
      if (current) {
        latest = { tree: clone(current.tree), meta: clone(current.meta) };
        return enqueue(() => store.put(key, record(latest)));
      }
      latest = null;
      return enqueue(() => store.remove(key));
    },

    /** The key the copy is kept under. */
    get key() { return key; },

    /** Resolves when everything queued so far has been written. */
    flush() { return chain.then(() => {}); },
  };
}
