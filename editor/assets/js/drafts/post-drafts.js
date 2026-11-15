/**
 * The post editor's controller for local copies. Call `edited` on every
 * change, `saveStarted`/`saveConfirmed` around a save, and `open` when a post
 * loads. Every store write from one controller goes through a single promise
 * chain so writes never overlap, and storage trouble never reaches the
 * editor (the store resolves with empty answers instead of failing).
 *
 * @module editor/drafts/post-drafts
 */

import { postKey, newPostKey, restoreOffer } from './draft-logic.js';

const clone = (value) => (value === undefined ? value : JSON.parse(JSON.stringify(value)));

/**
 * @param {{ store: object, siteId: string|null, now?: () => string }} opts
 */
export function createPostDrafts({ store, siteId, now = () => new Date().toISOString() }) {
  let key = null;
  let docId = null;
  let baseUpdated = null;
  let seq = 0;
  let latest = null;      // newest snapshot not yet cleared by a save
  let scheduled = false;  // a coalesced write is queued but has not started
  let generation = 0;     // bumped by a save so older queued writes stand down
  let chain = Promise.resolve();

  const enqueue = (fn) => {
    const run = chain.then(fn);
    chain = run.catch(() => {});
    return run;
  };

  const record = (snapshot) => ({
    docId, meta: snapshot.meta, blocks: snapshot.blocks, regions: snapshot.regions,
    baseUpdated, seq, at: now(),
  });

  const controller = {
    /** Start on a post. A new post (no id) gets a fresh key. */
    async open(id, serverDoc) {
      await chain;
      generation++;
      scheduled = false;
      latest = null;
      seq = 0;
      docId = id ?? null;
      baseUpdated = serverDoc?.meta?.updated ?? null;
      key = id ? postKey(siteId, id) : newPostKey(siteId, now());
      const local = await store.get(key);
      return restoreOffer(local, serverDoc ?? null);
    },

    /** The newest never-saved copy for this site, or null. */
    pendingNew() {
      return enqueue(async () => {
        const keys = await store.keys(newPostKey(siteId, ''));
        let best = null;
        for (const k of keys) {
          const rec = await store.get(k);
          if (rec && (!best || String(rec.at) > String(best.at))) best = rec;
        }
        return best;
      });
    },

    /** Record a change. Coalesced: the last snapshot always lands. */
    edited(snapshot) {
      if (!key) return;
      seq++;
      latest = {
        meta: clone(snapshot.meta), blocks: clone(snapshot.blocks), regions: clone(snapshot.regions) ?? {},
      };
      if (scheduled) return;
      scheduled = true;
      const gen = generation;
      enqueue(async () => {
        if (gen !== generation) return;
        scheduled = false;
        if (!latest) return;
        await store.put(key, record(latest));
      });
    },

    /** Mark the start of a save; the token is the current edit count. */
    saveStarted() { return seq; },

    /** The server accepted a save started with `token`. */
    saveConfirmed(token, { docId: id, updated, meta, blocks, regions }) {
      const oldKey = key;
      const newKey = postKey(siteId, id);
      const clean = seq === token;
      generation++;
      scheduled = false;
      key = newKey;
      docId = id;
      baseUpdated = updated;
      if (clean) latest = null;
      const entry = { meta: clone(meta), blocks: clone(blocks), regions: clone(regions) ?? {}, updated, at: now() };
      return enqueue(async () => {
        if (oldKey && oldKey !== newKey) await store.rekey(oldKey, newKey);
        await store.pushVersion(newKey, entry);
        if (clean) await store.remove(newKey);
        else if (latest) await store.put(newKey, record(latest));
      });
    },

    /** Throw the local copy away, keeping it as a version. */
    discard() {
      const k = key;
      return enqueue(async () => {
        if (!k) return;
        const rec = (await store.get(k)) ?? (latest && record(latest));
        latest = null;
        if (!rec) return;
        await store.remove(k);
        await store.pushVersion(k, {
          meta: rec.meta, blocks: rec.blocks, regions: rec.regions,
          updated: rec.baseUpdated, at: now(), discarded: true,
        });
      });
    },

    /** Saved and discarded copies of this post, newest first. */
    versions() {
      return enqueue(async () => (key ? store.versions(key) : []));
    },

    /** Resolves when everything queued so far has been written. */
    flush() { return chain.then(() => {}); },
  };
  return controller;
}
