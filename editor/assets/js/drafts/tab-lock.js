/**
 * One editing tab per post. When the same post is open in two browser tabs,
 * only one may edit; the other is read-only until the person chooses to edit
 * there instead. Tabs talk over a BroadcastChannel.
 *
 * Messages (all carry the post `key` and the sender's `tab` id):
 *   open     a tab is asking who edits this post
 *   owned    the editing tab's answer to `open`
 *   take     a tab is taking over editing
 *   release  the editing tab is going away
 *   saved    a tab that stood down for a `take` has finished its last save
 *
 * Two tabs asking at once are settled by tab id: the lower one edits.
 *
 * @module editor/drafts/tab-lock
 */

/**
 * @param {object} opts
 * @param {string} opts.key post key
 * @param {BroadcastChannel} [opts.channel] shared channel; closed on release only when created here
 * @param {number} [opts.wait] ms to wait for an `owned` reply
 * @param {() => void} [opts.onLocked] this tab must become read-only
 * @param {() => void} [opts.onUnlocked] this tab may edit
 * @param {() => void} [opts.onSaved] the tab this one took over from has finished its last save
 */
export function createTabLock({ key, channel, wait = 150, onLocked, onUnlocked, onSaved } = {}) {
  const ownChannel = !channel;
  const bus = channel ?? new BroadcastChannel('vp-edit-lock');
  const tab = globalThis.crypto.randomUUID();

  let owner = false;
  let locked = false;
  let timer = null;
  let settle = null; // resolves the pending claim
  let lost = false; // pending claim lost
  let closed = false;

  const send = (type) => bus.postMessage({ type, key, tab });

  function lock() {
    if (locked) return;
    locked = true;
    owner = false;
    onLocked?.();
  }

  function unlock() {
    owner = true;
    if (locked) {
      locked = false;
      onUnlocked?.();
    }
  }

  function endClaim() {
    clearTimeout(timer);
    timer = null;
    const done = settle;
    settle = null;
    done?.();
  }

  /** A pending claim lost to another tab. */
  function loseClaim() {
    lost = true;
    lock();
    endClaim();
  }

  function onMessage({ data }) {
    if (closed || !data || data.key !== key || data.tab === tab) return;
    switch (data.type) {
      case 'open':
        if (owner) send('owned');
        else if (settle && data.tab < tab) loseClaim();
        break;
      case 'owned':
        if (settle) loseClaim();
        break;
      case 'take':
        if (settle) loseClaim();
        else if (owner) lock();
        break;
      case 'release':
        // Waiting tabs ask again; the tie-break picks one.
        if (locked) claim();
        break;
      case 'saved':
        if (owner) onSaved?.();
        break;
    }
  }

  bus.addEventListener('message', onMessage);

  /** Ask whether anyone else is editing; resolves once this tab knows. */
  function claim() {
    if (closed || owner) return Promise.resolve();
    if (settle) return new Promise((r) => { const prev = settle; settle = () => { prev(); r(); }; });
    lost = false;
    return new Promise((resolve) => {
      settle = resolve;
      timer = setTimeout(() => {
        if (!lost) unlock();
        endClaim();
      }, wait);
      send('open');
    });
  }

  /** Become the editing tab; the previous one is told to stand down. */
  function takeOver() {
    if (closed || owner) return;
    endClaim();
    unlock();
    send('take');
  }

  /** After standing down: tell the new editing tab this tab's last save is done (or failed). */
  function handedOff() {
    if (!closed) send('saved');
  }

  /** Stop taking part; hand editing on if this tab had it. */
  function release() {
    if (closed) return;
    if (owner) send('release');
    closed = true;
    owner = false;
    endClaim();
    bus.removeEventListener('message', onMessage);
    if (ownChannel) bus.close();
  }

  return {
    claim,
    takeOver,
    handedOff,
    release,
    get owner() { return owner; },
  };
}
