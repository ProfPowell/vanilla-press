/**
 * The post editor's side of "never losing work": keeps every edit as a local
 * copy, offers a copy back when a post opens, keeps a failed save on screen
 * in the save bar (retrying while the app can't be reached), and lets only
 * one tab edit a post. editor.js calls in from its load, edit and save paths
 * and passes what this needs from the editor as callbacks.
 *
 * The save bar shows one thing at a time. In order of what stays on screen:
 * the other-tab notice (or a failed reload after taking over), a save problem, an offer to restore, the storage
 * warning (shown again whenever nothing else is).
 *
 * @module editor/drafts/post-editor-drafts
 */

import { createDraftStore, idbBackend, memoryBackend } from './draft-store.js';
import { createPostDrafts } from './post-drafts.js';
import { postKey, describeDifferences } from './draft-logic.js';
import { createTabLock } from './tab-lock.js';
import { saveFailureMessage, isNetworkFailure } from './save-failure.js';

export const UNPROTECTED = "Unsaved work isn't protected in this browser";
const LOCKED = 'This post is open in another tab';
const RELOAD_FAILED = "Couldn't reload this post. Try again";

/**
 * A draft store usable at once: IndexedDB once it opens, else memory (with
 * `onUnavailable` called, once).
 * @param {{ onUnavailable?: (err: Error) => void }} [opts]
 */
export function openDraftStore({ onUnavailable } = {}) {
  let told = false;
  const tell = (err) => {
    if (told) return;
    told = true;
    onUnavailable?.(err);
  };
  const ready = idbBackend().catch((err) => {
    tell(err);
    return memoryBackend();
  });
  const call = (name) => async (...args) => (await ready)[name](...args);
  return createDraftStore(
    { get: call('get'), set: call('set'), delete: call('delete'), keys: call('keys') },
    { onUnavailable: tell },
  );
}

const quiet = (p) => Promise.resolve(p).catch((err) => console.warn('Local copy:', err));

/**
 * @param {object} opts
 * @param {object} opts.store a draft store
 * @param {string|null} opts.siteId
 * @param {object|null} opts.bar the <save-bar>
 * @param {() => object|null} opts.getView the ProseMirror view
 * @param {() => { meta: object, blocks: object[], regions: object }} opts.snapshot the post as it is now
 * @param {(record: object) => Promise|void} opts.restore put a local copy in the editor and save it
 * @param {(record: object) => Promise<string>} opts.createCopy create a draft post from a copy; resolves its id
 * @param {(id: string) => Promise<boolean|void>} opts.load open a post; resolves false when it failed
 * @param {() => Promise|void} opts.saveNow save the open post now
 * @param {() => Promise|void} [opts.flushSave] run a pending auto-save now; settles when it is done
 * @param {number} [opts.retryMs] retry interval while the app can't be reached
 * @param {number} [opts.lockWait] tab lock answer wait (tests)
 * @param {number} [opts.handoffWait] how long a takeover waits for the other tab's last save
 */
export function createEditorDrafts({
  store, siteId, bar, getView, snapshot, restore, createCopy, load, saveNow, flushSave,
  retryMs = 10000, lockWait, handoffWait = 3000,
}) {
  const drafts = createPostDrafts({ store, siteId });
  let gen = 0;          // bumped when another post (or the new post page) opens
  let ready = false;    // the controller is on the open post: edits are recorded
  let missed = false;   // an edit came before that
  let dirty = false;    // edited since the post opened
  let postId = null;
  let retry = null;
  let lock = null;
  let lockKey = null;
  let locked = false;
  let lockedAtHide = false;
  let lockEpoch = 0;    // bumped each time this tab stops editing
  let handoff = null;   // a takeover waiting for the other tab's last save: { timer, done }
  let showing = null;   // 'lock' | 'failure' | 'offer' | 'storage' | null
  let unprotected = false;

  // --- the bar ---

  let failureShown = null; // the save problem on screen, so a repeat is not announced again

  function barShow(kind, spec) {
    if (kind === 'failure') {
      const same = `${spec.tone}:${spec.text}`;
      if (showing === 'failure' && failureShown === same) return;
      failureShown = same;
    }
    showing = kind;
    bar?.show(spec);
  }

  /** Hide what `kind` showed (if it still shows); the storage warning comes back. */
  function barClear(kind) {
    if (showing !== kind) return;
    showing = null;
    if (unprotected) barShow('storage', { tone: 'warn', text: UNPROTECTED });
    else bar?.clear();
  }

  // --- retry while the app can't be reached ---

  function stopRetry() {
    clearTimeout(retry);
    retry = null;
  }

  function scheduleRetry() {
    if (retry || readOnly()) return;
    retry = setTimeout(() => {
      retry = null;
      quiet(saveNow());
    }, retryMs);
  }

  // --- one editing tab per post ---

  const setEditable = (on) => getView()?.setProps({ editable: () => on });

  /** Another tab edits this post, or this tab is taking over and waits for its last save. */
  const readOnly = () => locked || handoff != null;

  function endHandoff() {
    if (!handoff) return null;
    const { timer, done } = handoff;
    clearTimeout(timer);
    handoff = null;
    return done;
  }

  function releaseLock() {
    if (!lock) return;
    const old = lock;
    lock = null;
    lockKey = null;
    old.release();
    if (endHandoff()) {
      setEditable(true);
      barClear('reload');
    }
    if (locked) {
      locked = false;
      setEditable(true);
      barClear('lock');
    }
  }

  function lockPost(id) {
    if (typeof BroadcastChannel === 'undefined') return Promise.resolve();
    const key = postKey(siteId, id);
    if (lock && lockKey === key) return lock.claim();
    releaseLock();
    const l = createTabLock({
      key,
      wait: lockWait,
      onLocked: () => {
        if (lock !== l) return;
        // The edits not saved yet go now, while this tab may still save; then nothing more from here
        const last = Promise.resolve(flushSave?.()).catch(() => {});
        locked = true;
        lockEpoch++;
        stopRetry();
        endHandoff();
        setEditable(false);
        barShow('lock', { tone: 'info', text: LOCKED, actions: [{ label: 'Edit here instead', run: () => l.takeOver() }] });
        last.finally(() => l.handedOff());
      },
      onUnlocked: () => {
        if (lock !== l) return;
        locked = false;
        barClear('lock');
        // This tab is behind what the other tab saved: once its last save is
        // done (or after a while), show the post as it is now, then edit
        // Read-only (no edits recorded, no saves) until the post is replaced:
        // a failed reload must not let the stale view write over the other tab's work
        const id = postId;
        const done = async () => {
          const h = handoff;
          if (lock !== l || !h || h.done !== done || h.loading) return;
          clearTimeout(h.timer);
          h.loading = true;
          let ok = true;
          if (id != null && postId === id) {
            try { ok = (await load(id)) !== false; } catch { ok = false; }
          }
          if (lock !== l || handoff !== h) return; // stood down or released meanwhile
          h.loading = false;
          if (!ok) {
            barShow('reload', { tone: 'error', text: RELOAD_FAILED, actions: [{ label: 'Try again', run: done }] });
            return;
          }
          handoff = null;
          barClear('reload');
          setEditable(true);
          getView()?.focus();
        };
        endHandoff();
        handoff = { timer: setTimeout(done, handoffWait), done };
      },
      onSaved: () => handoff?.done(),
    });
    lock = l;
    lockKey = key;
    return l.claim();
  }

  // --- opening a post ---

  function begin(id) {
    gen++;
    ready = false;
    missed = false;
    dirty = false;
    postId = id;
    stopRetry();
    barClear('failure');
    barClear('offer');
    if (id == null || postKey(siteId, id) !== lockKey) releaseLock();
    return gen;
  }

  /** The controller is on the post opened as `g`: record from now on (and any edit that came early). */
  function settle(g) {
    if (g !== gen) return false;
    ready = true;
    if (missed) {
      missed = false;
      dirty = true;
      drafts.edited(snapshot());
    }
    return true;
  }

  /**
   * Opening failed part way: say copies may not be kept, and keep recording
   * when the controller did get onto this post (else nothing is written
   * rather than written under another post's key).
   */
  function recover(g, id) {
    api.storageUnavailable();
    if (g !== gen) return;
    const k = drafts.key;
    const onPost = id != null ? k === postKey(siteId, id) : Boolean(k?.startsWith(postKey(siteId, 'new-')));
    if (!onPost) return;
    settle(gen);
    if (id != null) quiet(lockPost(id));
  }

  function offerCopy(g, offer, local, serverDoc) {
    // The other-tab notice or a save problem stays on screen; the copy is
    // kept (as a version, and offered again next time).
    if (showing && showing !== 'storage') return;
    showing = 'offer';
    const act = (fn) => async () => {
      if (showing === 'offer') showing = null;
      await null; // the bar hides itself once this returns
      getView()?.focus();
      if (unprotected && !showing) barShow('storage', { tone: 'warn', text: UNPROTECTED });
      if (g !== gen) return;
      try {
        await fn();
      } catch (err) {
        console.error('Restoring a local copy:', err);
        api.saveFailed(err);
      }
    };
    bar?.showRestore(offer, {
      differences: describeDifferences(local, serverDoc),
      onRestore: act(() => restore(local)),
      onRestoreAsNew: act(async () => {
        const id = await createCopy(local);
        // The copy lives on in the new post; let this post's copy go unless typed over since
        if (g === gen && !dirty) await drafts.discard();
        await load(id);
      }),
      onDiscard: act(async () => {
        await drafts.discard();
        // Work typed since the post opened is not what was discarded: keep it
        if (g === gen && dirty) drafts.edited(snapshot());
      }),
    });
  }

  const api = {
    /** The open post changed (text or settings). */
    edited() {
      if (readOnly()) return; // the other tab's copy is the one that counts
      if (!ready) {
        missed = true;
        return;
      }
      dirty = true;
      drafts.edited(snapshot());
    },

    /** A stored post is now in the editor (call right after showing it). */
    async openPost(doc) {
      const g = begin(doc.id);
      try {
        const offer = await drafts.open(doc.id, doc);
        const local = offer ? await store.get(postKey(siteId, doc.id)) : null;
        if (!settle(g)) return;
        await lockPost(doc.id);
        if (g !== gen || locked || !offer || !local) return;
        offerCopy(g, offer, local, doc);
      } catch (err) {
        console.warn('Local copy:', err);
        recover(g, doc.id);
      }
    },

    /** The new post page is in the editor; offer a never-saved post's copy unless told not to. */
    async openNew({ offerPending = true } = {}) {
      const g = begin(null);
      try {
        const pending = offerPending ? await drafts.pendingNew() : null;
        if (g !== gen) return;
        const offer = await drafts.open(null, null, pending ? { adoptKey: pending.key } : {});
        if (!settle(g) || !offer || !pending) return;
        offerCopy(g, offer, pending.record, null);
      } catch (err) {
        console.warn('Local copy:', err);
        recover(g, null);
      }
    },

    /** Before a save request: a token for `saveConfirmed`. */
    saveStarted() {
      return ready && !readOnly() ? { gen, epoch: lockEpoch, seq: drafts.saveStarted() } : null;
    },

    /** False while another tab edits this post (or this tab waits to take over): no save may start. */
    canSave() {
      return !readOnly();
    },

    /**
     * The server accepted the save started with `token`. Ignored when
     * another post has opened since.
     * @param {object|null} token
     * @param {{ docId: string, updated: string|null, meta: object, blocks: object[], regions: object }} saved
     */
    saveConfirmed(token, saved) {
      if (!token || token.gen !== gen) return Promise.resolve();
      // Started before this tab stopped editing: the shared copy is the other tab's now
      if (token.epoch !== lockEpoch || readOnly()) return quiet(drafts.saveConfirmed(token.seq, saved, { versionOnly: true }));
      if (saved.docId !== postId) {
        postId = saved.docId; // a new post got its id
        quiet(lockPost(saved.docId));
      }
      return quiet(drafts.saveConfirmed(token.seq, saved));
    },

    /** A save failed: say so in the bar; retry while the app can't be reached. */
    saveFailed(err) {
      const msg = saveFailureMessage(err);
      if (!msg) return;
      if (isNetworkFailure(err)) scheduleRetry();
      else stopRetry();
      if (showing !== 'lock' && showing !== 'reload') barShow('failure', msg);
    },

    /** Saving is paused (a conflict, or content the editor can't show). */
    saveWarning(text) {
      stopRetry();
      if (showing !== 'lock' && showing !== 'reload') barShow('failure', { tone: 'warn', text });
    },

    /** A save worked: the save problem is over. */
    saveSucceeded() {
      stopRetry();
      barClear('failure');
    },

    /** Local copies can't be stored in this browser. */
    storageUnavailable() {
      unprotected = true;
      if (!showing) barShow('storage', { tone: 'warn', text: UNPROTECTED });
    },

    /** Warn before leaving with unsaved work; hand the tab lock on when the page goes. */
    installPageEvents({ isUnsaved, target = globalThis }) {
      target.addEventListener('beforeunload', (e) => {
        if (!isUnsaved()) return;
        e.preventDefault();
        e.returnValue = '';
      });
      target.addEventListener('pagehide', () => {
        quiet(drafts.flush());
        lockedAtHide = locked;
        releaseLock();
      });
      // Back from the back/forward cache: the lock was released, so ask again
      target.addEventListener('pageshow', async (e) => {
        if (!e.persisted || postId == null) return;
        const id = postId;
        await lockPost(id);
        if (lockedAtHide && lock?.owner && postId === id) quiet(load(id));
      });
    },

    /** The recent versions of the open post kept in this browser, newest first (Promise; [] when none). */
    versions: () => Promise.resolve(drafts.versions()).catch(() => []),

    /** How a version differs from the post as it is now, as plain lines. */
    differences: (version) => describeDifferences(version, snapshot()),

    /**
     * Put a version in the editor and save it, as a copy is restored from the
     * save bar (one undoable step). Not in a read-only tab.
     */
    async restoreVersion(version) {
      if (readOnly()) return;
      try {
        // What is in the editor now stays as a version; if that can't be kept, nothing is replaced
        if (!(await drafts.keepCurrent(snapshot()))) {
          api.storageUnavailable();
          return;
        }
        await restore(version);
      } catch (err) {
        console.error('Restoring a version:', err);
        api.saveFailed(err);
      }
    },

    /** Resolves when the local copy is written. */
    flush: () => drafts.flush(),

    /** Stop retrying and give up the tab lock. */
    release() {
      stopRetry();
      releaseLock();
    },
  };
  return api;
}
