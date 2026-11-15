/**
 * Local copies of unsaved work. A small key/value store with two stores:
 * `drafts` (one record per post, keyed like `post:<site>:<docId>`) and
 * `versions` (the last saved copies of a post, newest first, under the same
 * key). Browsers use IndexedDB; tests use memory. If storage fails for any
 * reason (private window, quota, IndexedDB missing) every method still
 * resolves with an empty answer, `available` turns false and `onUnavailable`
 * is called once, so editing carries on without a local copy.
 *
 * @module editor/drafts/draft-store
 */

const DRAFTS = 'drafts';
const VERSIONS = 'versions';
const STORES = [DRAFTS, VERSIONS];

/** In-memory backend, for tests and as a fallback. */
export function memoryBackend() {
  const data = { [DRAFTS]: new Map(), [VERSIONS]: new Map() };
  return {
    async get(store, key) { return data[store].has(key) ? data[store].get(key) : undefined; },
    async set(store, key, value) { data[store].set(key, value); },
    async delete(store, key) { data[store].delete(key); },
    async keys(store) { return [...data[store].keys()]; },
  };
}

const wrap = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

/** IndexedDB backend. Rejects when IndexedDB is missing or cannot be opened. */
export function idbBackend({ name = 'vp-drafts' } = {}) {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB is not available'));
    let open;
    try { open = indexedDB.open(name, 1); } catch (err) { return reject(err); }
    open.onupgradeneeded = () => {
      for (const s of STORES) if (!open.result.objectStoreNames.contains(s)) open.result.createObjectStore(s);
    };
    open.onerror = () => reject(open.error);
    open.onblocked = () => reject(new Error('IndexedDB is blocked'));
    open.onsuccess = () => {
      const db = open.result;
      const store = (s, mode) => db.transaction(s, mode).objectStore(s);
      resolve({
        get: (s, key) => wrap(store(s, 'readonly').get(key)),
        set: (s, key, value) => wrap(store(s, 'readwrite').put(value, key)).then(() => {}),
        delete: (s, key) => wrap(store(s, 'readwrite').delete(key)).then(() => {}),
        keys: (s) => wrap(store(s, 'readonly').getAllKeys()).then((k) => k.map(String)),
      });
    };
  });
}

/**
 * @param {object} backend
 * @param {{ onUnavailable?: (err: Error) => void }} [opts]
 */
export function createDraftStore(backend, { onUnavailable } = {}) {
  const store = { available: true };

  // Run a backend operation; on any failure give `fallback` and report once.
  async function guard(fn, fallback) {
    try {
      return await fn();
    } catch (err) {
      if (store.available) {
        store.available = false;
        try { onUnavailable?.(err); } catch { /* the callback must not break editing */ }
      }
      return fallback;
    }
  }

  const read = async (s, key) => (await backend.get(s, key)) ?? null;

  store.get = (key) => guard(() => read(DRAFTS, key), null);
  store.put = (key, record) => guard(async () => { await backend.set(DRAFTS, key, record); return true; }, false);
  // Removes the draft only; saved versions stay.
  store.remove = (key) => guard(async () => { await backend.delete(DRAFTS, key); return true; }, false);
  store.rekey = (from, to) => guard(async () => {
    for (const s of STORES) {
      const value = await read(s, from);
      if (value === null) continue;
      await backend.set(s, to, value);
      await backend.delete(s, from);
    }
    return true;
  }, false);
  store.keys = (prefix = '') => guard(async () => (await backend.keys(DRAFTS)).filter((k) => k.startsWith(prefix)), []);
  store.pushVersion = (key, version, { limit = 20 } = {}) => guard(async () => {
    const list = (await read(VERSIONS, key)) || [];
    await backend.set(VERSIONS, key, [version, ...list].slice(0, limit));
    return true;
  }, false);
  store.versions = (key) => guard(async () => (await read(VERSIONS, key)) || [], []);

  return store;
}
