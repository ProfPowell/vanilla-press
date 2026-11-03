/**
 * Per-site preview servers: each runs the site's own `npm run dev`.
 *
 * @module app/preview
 */

import { spawn as nodeSpawn } from 'node:child_process';
import {
  ensureInstalled as defaultEnsureInstalled,
  freePort as defaultFreePort,
  spawnNpm,
  collectLog,
} from './site-process.js';

const POLL_MS = 250;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function answers(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

/** Signal the child's whole process group (ESRCH and friends are ignored). */
function signalGroup(child, signal) {
  try {
    if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch { /* already gone */ }
}

function groupAlive(child, isGone) {
  if (process.platform === 'win32' || !child.pid) return !isGone();
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create the preview manager. Options besides `spawn` exist for tests.
 *
 * `stop`/`stopAll` while a start is still in progress cancel it: the pending
 * `start()` rejects with `Preview stopped` and no dev server is left running.
 *
 * @param {{
 *   spawn?: typeof nodeSpawn,
 *   ensureInstalled?: (dir: string) => Promise<void>,
 *   freePort?: () => Promise<number>,
 *   startTimeoutMs?: number,
 *   killGraceMs?: number,
 * }} [opts]
 */
export function createPreviews({
  spawn = nodeSpawn,
  ensureInstalled = defaultEnsureInstalled,
  freePort = defaultFreePort,
  startTimeoutMs = 60000,
  killGraceMs = 3000,
} = {}) {
  /** Sites with a ready server: id -> { url, child, ... } */
  const running = new Map();
  /** Sites mid-start: id -> { promise, ctx } */
  const starting = new Map();
  /**
   * Every spawned dev server whose process group may still be alive (starting,
   * running or stopping): npm can exit while a grandchild lives on.
   */
  const spawned = new Set();
  const forget = (entry) => { if (!groupAlive(entry.child, entry.isGone)) spawned.delete(entry); };

  /** SIGTERM the group; SIGKILL it after the grace period if anything is left. */
  async function killEntry(entry) {
    const { child } = entry;
    signalGroup(child, 'SIGTERM');
    const deadline = Date.now() + killGraceMs;
    while (groupAlive(child, entry.isGone) && Date.now() < deadline) await sleep(25);
    if (groupAlive(child, entry.isGone)) signalGroup(child, 'SIGKILL');
    await Promise.race([entry.exited, sleep(killGraceMs)]);
    forget(entry);
  }

  async function launch(site, ctx) {
    const cancelCheck = () => { if (ctx.cancelled) throw new Error('Preview stopped'); };
    await ensureInstalled(site.path);
    cancelCheck();
    const port = await freePort();
    cancelCheck();
    const url = `http://127.0.0.1:${port}`;
    const child = spawnNpm(['run', 'dev', '--', '--port', String(port)], { cwd: site.path, spawn });
    const tail = collectLog(child);
    let gone = false;
    let closed;
    const exited = new Promise((resolve) => {
      child.once('exit', () => { gone = true; resolve(); });
      child.once('error', () => { gone = true; resolve(); });
    });
    const closedP = new Promise((resolve) => { closed = resolve; });
    child.once('close', closed);
    child.once('error', closed);
    const entry = { url, child, exited, isGone: () => gone };
    ctx.entry = entry;
    spawned.add(entry);
    exited.then(() => forget(entry));

    const deadline = Date.now() + startTimeoutMs;
    let ready = false;
    while (Date.now() < deadline && !gone && !ctx.cancelled) {
      if (await answers(`${url}/`)) { ready = true; break; }
      await sleep(POLL_MS);
    }
    if (ready && !ctx.cancelled && !gone) {
      running.set(site.id, entry);
      exited.then(() => { if (running.get(site.id) === entry) running.delete(site.id); });
      return { url };
    }
    // Failed, timed out or cancelled: always take the whole group down.
    await killEntry(entry);
    if (ctx.cancelled) throw new Error('Preview stopped');
    await Promise.race([closedP, sleep(500)]);
    throw new Error(`Preview server did not start: ${tail()}`);
  }

  return {
    /** @param {{ id: string, path: string }} site */
    start(site) {
      const existing = running.get(site.id);
      if (existing && !existing.isGone()) return Promise.resolve({ url: existing.url });
      const pending = starting.get(site.id);
      if (pending) return pending.promise;
      const ctx = { cancelled: false, entry: null };
      const promise = launch(site, ctx).finally(() => starting.delete(site.id));
      starting.set(site.id, { promise, ctx });
      return promise;
    },
    /** @param {string} siteId */
    async stop(siteId) {
      const pending = starting.get(siteId);
      if (pending) {
        pending.ctx.cancelled = true;
        await pending.promise.catch(() => {});
      }
      const entry = running.get(siteId);
      running.delete(siteId);
      if (entry) await killEntry(entry);
    },
    async stopAll() {
      const ids = new Set([...running.keys(), ...starting.keys()]);
      await Promise.all([...ids].map((id) => this.stop(id)));
    },
    /**
     * SIGKILL every preview process group (running or still starting), synchronously:
     * for `process.on('exit')`, where nothing can be awaited. Previews are
     * detached, so without this they would outlive the app.
     */
    killAllSync() {
      for (const { ctx } of starting.values()) ctx.cancelled = true;
      for (const entry of spawned) signalGroup(entry.child, 'SIGKILL');
    },
  };
}
