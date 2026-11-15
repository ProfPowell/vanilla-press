import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTabLock } from '../../editor/assets/js/drafts/tab-lock.js';

const WAIT = 20;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = () => sleep(WAIT * 4);

/** A fake tab: its own channel, recording lock callbacks. */
function tab(key, name = 'vp-test-' + Math.random()) {
  const channel = new BroadcastChannel(name);
  const events = [];
  const lock = createTabLock({
    key, channel, wait: WAIT,
    onLocked: () => events.push('locked'),
    onUnlocked: () => events.push('unlocked'),
  });
  return { lock, events, channel };
}

/** Two tabs on the same bus (same channel name). */
function pair(keyA, keyB = keyA) {
  const name = 'vp-test-' + Math.random();
  return [tab(keyA, name), tab(keyB, name)];
}

const closeAll = (...tabs) => tabs.forEach((t) => { t.lock.release(); t.channel.close(); });

test('a lone tab claims and owns the post', async () => {
  const [a, b] = pair('p1');
  await a.lock.claim();
  assert.equal(a.lock.owner, true);
  assert.deepEqual(a.events, []);
  closeAll(a, b);
});

test('the second tab to claim is locked', async () => {
  const [a, b] = pair('p1');
  await a.lock.claim();
  await b.lock.claim();
  assert.equal(a.lock.owner, true);
  assert.equal(b.lock.owner, false);
  assert.deepEqual(b.events, ['locked']);
  closeAll(a, b);
});

test('different posts do not interact', async () => {
  const [a, b] = pair('p1', 'p2');
  await a.lock.claim();
  await b.lock.claim();
  assert.equal(a.lock.owner, true);
  assert.equal(b.lock.owner, true);
  assert.deepEqual(b.events, []);
  closeAll(a, b);
});

test('takeOver swaps the owner', async () => {
  const [a, b] = pair('p1');
  await a.lock.claim();
  await b.lock.claim();
  b.lock.takeOver();
  assert.equal(b.lock.owner, true);
  await settle();
  assert.equal(a.lock.owner, false);
  assert.deepEqual(a.events, ['locked']);
  assert.deepEqual(b.events, ['locked', 'unlocked']);
  closeAll(a, b);
});

test('after a takeover the new owner answers later claimers', async () => {
  const name = 'vp-test-' + Math.random();
  const a = tab('p1', name), b = tab('p1', name), c = tab('p1', name);
  await a.lock.claim();
  await b.lock.claim();
  b.lock.takeOver();
  await settle();
  await c.lock.claim();
  assert.deepEqual(c.events, ['locked']);
  closeAll(a, b, c);
});

test('release unlocks the waiting tab', async () => {
  const [a, b] = pair('p1');
  await a.lock.claim();
  await b.lock.claim();
  a.lock.release();
  await settle();
  assert.equal(a.lock.owner, false);
  assert.equal(b.lock.owner, true);
  assert.deepEqual(b.events, ['locked', 'unlocked']);
  closeAll(a, b);
});

test('release lets exactly one of several waiting tabs take over', async () => {
  const name = 'vp-test-' + Math.random();
  const a = tab('p1', name), b = tab('p1', name), c = tab('p1', name);
  await a.lock.claim();
  await b.lock.claim();
  await c.lock.claim();
  a.lock.release();
  await settle();
  assert.equal([b, c].filter((t) => t.lock.owner).length, 1);
  assert.equal([b, c].filter((t) => t.events.includes('unlocked')).length, 1);
  closeAll(a, b, c);
});

test('simultaneous claims leave exactly one owner', async () => {
  const [a, b] = pair('p1');
  await Promise.all([a.lock.claim(), b.lock.claim()]);
  await settle();
  assert.equal([a, b].filter((t) => t.lock.owner).length, 1);
  const loser = a.lock.owner ? b : a;
  assert.deepEqual(loser.events, ['locked']);
  closeAll(a, b);
});

test('a channel the caller passed stays open after release', async () => {
  const [a, b] = pair('p1');
  await a.lock.claim();
  a.lock.release();
  assert.doesNotThrow(() => a.channel.postMessage({ type: 'noop' }));
  closeAll(a, b);
});

test('the tab that gave up editing tells the taker once its last save is done', async () => {
  const name = 'vp-test-' + Math.random();
  const ca = new BroadcastChannel(name);
  const cb = new BroadcastChannel(name);
  const saved = [];
  let a;
  a = createTabLock({ key: 'p1', channel: ca, wait: WAIT, onLocked: () => setTimeout(() => a.handedOff(), 5) });
  const b = createTabLock({ key: 'p1', channel: cb, wait: WAIT, onSaved: () => saved.push('b') });
  try {
    await a.claim();
    await b.claim();
    assert.equal(b.owner, false);
    b.takeOver();
    assert.deepEqual(saved, []);
    await settle();
    assert.deepEqual(saved, ['b']);
  } finally {
    a.release(); b.release(); ca.close(); cb.close();
  }
});

test('a tab that claims while a lower tab is still claiming is locked, whichever heard whom', async () => {
  // The first tab's `open` goes before the second listens; the second's id is higher
  const ids = ['tab-1', 'tab-2'];
  const real = globalThis.crypto.randomUUID;
  globalThis.crypto.randomUUID = () => ids.shift();
  const name = 'vp-test-' + Math.random();
  const chA = new BroadcastChannel(name);
  let a;
  let b;
  try {
    a = createTabLock({ key: 'p1', channel: chA, wait: WAIT });
    // B is not listening yet: it misses A's `open`
    const claimA = a.claim();
    await sleep(WAIT / 4);
    const chB2 = new BroadcastChannel(name);
    b = createTabLock({ key: 'p1', channel: chB2, wait: WAIT });
    try {
      await Promise.all([claimA, b.claim()]);
      assert.equal(a.owner, true);
      assert.equal(b.owner, false);
    } finally {
      b.release();
      chB2.close();
    }
  } finally {
    globalThis.crypto.randomUUID = real;
    a?.release();
    chA.close();
  }
});
