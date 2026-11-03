/**
 * Per-site preview servers: each runs the site's own `npm run dev`.
 *
 * @module app/preview
 */

import { spawn as nodeSpawn } from 'node:child_process';
import { ensureInstalled, freePort, spawnNpm, collectLog } from './site-process.js';

const POLL_MS = 250;
const START_TIMEOUT_MS = 60000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function answers(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

function killTree(child, signal) {
  try {
    if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch { /* already gone */ }
}

/**
 * @param {{ spawn?: typeof nodeSpawn }} [opts]
 */
export function createPreviews({ spawn = nodeSpawn } = {}) {
  /** @type {Map<string, { url: string, child: import('node:child_process').ChildProcess, exited: Promise<void>, isExited: () => boolean }>} */
  const running = new Map();
  /** @type {Map<string, Promise<{ url: string }>>} */
  const starting = new Map();

  async function launch(site) {
    await ensureInstalled(site.path);
    const port = await freePort();
    const url = `http://127.0.0.1:${port}`;
    const child = spawnNpm(['run', 'dev', '--', '--port', String(port)], { cwd: site.path, spawn });
    const tail = collectLog(child);
    let gone = false;
    const exited = new Promise((resolve) => {
      const done = () => { gone = true; resolve(); };
      child.once('exit', done);
      child.once('error', done);
    });
    const entry = { url, child, exited, isExited: () => gone };
    running.set(site.id, entry);
    exited.then(() => { if (running.get(site.id) === entry) running.delete(site.id); });

    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (gone) break;
      if (await answers(`${url}/`)) return { url };
      await sleep(POLL_MS);
    }
    await stopEntry(entry);
    running.delete(site.id);
    throw new Error(`Preview server did not start: ${tail()}`);
  }

  async function stopEntry(entry) {
    if (!entry.isExited()) {
      killTree(entry.child, 'SIGTERM');
      const timer = setTimeout(() => killTree(entry.child, 'SIGKILL'), 3000);
      await entry.exited;
      clearTimeout(timer);
    }
  }

  return {
    /** @param {{ id: string, path: string }} site */
    start(site) {
      const existing = running.get(site.id);
      if (existing && !existing.isExited()) return Promise.resolve({ url: existing.url });
      const pending = starting.get(site.id);
      if (pending) return pending;
      const p = launch(site).finally(() => starting.delete(site.id));
      starting.set(site.id, p);
      return p;
    },
    /** @param {string} siteId */
    async stop(siteId) {
      const entry = running.get(siteId);
      running.delete(siteId);
      if (entry) await stopEntry(entry);
    },
    async stopAll() {
      const entries = [...running.values()];
      running.clear();
      await Promise.all(entries.map(stopEntry));
    },
  };
}
