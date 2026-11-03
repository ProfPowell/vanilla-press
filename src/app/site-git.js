/**
 * Which paths in a site Vanilla Press owns (the only ones it ever stages), and
 * the draft backup: saves are committed and pushed to GitHub after a pause.
 *
 * @module app/site-git
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectionOutput } from '../sync/paths.js';
import { readManifest } from '../sync/manifest.js';
import { readVpId } from '../sync/front-matter.js';
import { GitNotConnectedError } from '../git/git.js';

export const QUIET_MS = 30_000;
export const MAX_WAIT_MS = 120_000;
const SKIP = ' [CI Skip]';
const MAX_TITLES = 3;

const trimSlashes = (p) => p.replace(/^\/+|\/+$/g, '');

function listDir(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * Site-relative paths Vanilla Press owns: `content`, `src/media`,
 * `config/vp.json`, `src/<dir>` for each collection in `content/` whose
 * output dir is not `''`, and, for a `''` dir (pages), each `src/*.html`
 * whose front matter has `vp_id` plus every html path in the local manifest
 * (never `src/` itself). Paths may not exist; commitPaths skips those.
 * @param {import('../workspace/workspace.js').Workspace} ws
 * @param {Object} [collectionsConfig]
 * @returns {string[]}
 */
export function ownedPaths(ws, collectionsConfig = {}) {
  const paths = new Set(['content', 'src/media', 'config/vp.json']);
  let rootPages = false;
  for (const entry of listDir(join(ws.siteDir, 'content'))) {
    if (!entry.isDirectory()) continue;
    const dir = trimSlashes(collectionOutput(entry.name, collectionsConfig).path);
    if (dir) paths.add(`src/${dir}`);
    else rootPages = true;
  }
  if (rootPages) {
    for (const entry of listDir(join(ws.siteDir, 'src'))) {
      if (!entry.isFile() || !entry.name.endsWith('.html')) continue;
      let text;
      try { text = readFileSync(join(ws.siteDir, 'src', entry.name), 'utf8'); } catch { continue; }
      if (readVpId(text)) paths.add(`src/${entry.name}`);
    }
    let manifest = { documents: {} };
    try { manifest = readManifest(ws); } catch { /* corrupt: sync reports it */ }
    for (const doc of Object.values(manifest.documents || {})) {
      if (typeof doc?.html === 'string' && doc.html.startsWith('src/') && doc.html.endsWith('.html')) paths.add(doc.html);
    }
  }
  return [...paths];
}

/**
 * Up to three titles, then `and N more`.
 * @param {string[]} titles
 * @returns {string}
 */
export function commitTitle(titles) {
  if (titles.length <= MAX_TITLES) return titles.join(', ');
  return `${titles.slice(0, MAX_TITLES).join(', ')} and ${titles.length - MAX_TITLES} more`;
}

/** True when a staged file is a page the build publishes (an HTML file under src/, not media). */
function isPage(file) {
  return file.startsWith('src/') && !file.startsWith('src/media/') && file.endsWith('.html');
}

/**
 * The backup commit message for the staged files: `Draft: <titles> [CI Skip]`
 * when no published page changed, otherwise `Update: <titles>` (it must deploy).
 * @param {string[]} titles
 * @param {string[]} files
 * @returns {string}
 */
export function backupMessage(titles, files) {
  const t = commitTitle(titles.length ? titles : ['changes']);
  return files.some(isPage) ? `Update: ${t}` : `Draft: ${t}${SKIP}`;
}

/**
 * @typedef {{ pending: number, lastPushAt: string|null, error: string|null, connected: boolean }} BackupState
 */

/**
 * Draft backup for one site: push QUIET_MS after the last save, at most
 * MAX_WAIT_MS after the first unpushed one. All git work runs one at a time.
 * @param {{
 *   site?: Object,
 *   ws: import('../workspace/workspace.js').Workspace,
 *   git: { commitPaths: Function, push: Function, gitStatus: Function },
 *   getCollectionsConfig?: () => Object,
 *   now?: () => number,
 *   setTimer?: (fn: Function, ms: number) => any,
 *   clearTimer?: (handle: any) => void,
 * }} options
 */
export function createBackup({
  ws,
  git,
  getCollectionsConfig = () => ({}),
  now = Date.now,
  setTimer = (fn, ms) => {
    const handle = setTimeout(fn, ms);
    handle.unref?.(); // never keeps the process alive; quitting flushes instead
    return handle;
  },
  clearTimer = (h) => clearTimeout(h),
}) {
  let pending = 0;
  let titles = [];
  let firstAt = null;
  let timer = null;
  let lastPushAt = null;
  let error = null;
  let connected = true;
  let needsPush = false; // a local commit that has not reached the remote
  let queue = Promise.resolve();
  // Owned paths seen this session: a page VP removed is no longer listed by ownedPaths, but its deletion must be staged.
  const known = new Set();

  const state = () => ({ pending, lastPushAt, error, connected });

  function paths() {
    for (const p of ownedPaths(ws, getCollectionsConfig())) known.add(p);
    return [...known];
  }

  function cancel() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  function schedule() {
    cancel();
    const t = now();
    const delay = Math.max(0, Math.min(t + QUIET_MS, firstAt + MAX_WAIT_MS) - t);
    timer = setTimer(() => { timer = null; return flush(); }, delay);
  }

  function serial(fn) {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  }

  function pushed() {
    pending = 0;
    titles = [];
    firstAt = null;
    error = null;
    connected = true;
    needsPush = false;
    lastPushAt = new Date(now()).toISOString();
  }

  /**
   * Record a synced save.
   * @param {{ title?: string, status?: string }} save
   */
  function noteSaved({ title } = {}) {
    pending++;
    if (title && !titles.includes(title)) titles.push(title);
    if (firstAt === null) firstAt = now();
    paths();
    schedule();
  }

  /**
   * Commit the owned paths and push. Never rejects; errors land in state().
   * @returns {Promise<BackupState>}
   */
  function flush() {
    cancel();
    return serial(async () => {
      if (pending === 0 && !needsPush && error === null) return state();
      try {
        const status = await git.gitStatus(ws.siteDir);
        if (!status.isRepo) {
          connected = false;
          return state();
        }
        const committed = titles.slice();
        const sha = await git.commitPaths(ws.siteDir, paths(), (files) => backupMessage(committed, files));
        if (sha) {
          needsPush = true;
          titles = titles.filter((t) => !committed.includes(t));
        }
        await git.push(ws.siteDir);
        pushed();
      } catch (err) {
        if (err instanceof GitNotConnectedError) {
          connected = false;
          error = null;
        } else {
          error = err.message;
        }
      }
      return state();
    });
  }

  /**
   * Run a publish or unpublish in the git queue: the backup timer is
   * cancelled (pending drafts go into that commit, they are in the owned
   * paths). `fn` resolves to `{ status: 'pushed'|'saved' }`.
   * @template T
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  function exclusive(fn) {
    cancel();
    return serial(async () => {
      try {
        const result = await fn();
        if (result?.status === 'pushed') pushed();
        else {
          titles = [];
          if (result?.status === 'saved') connected = false;
        }
        return result;
      } catch (err) {
        if (err?.name?.startsWith('Git')) {
          needsPush = true;
          error = err.message;
        }
        if (pending > 0) {
          if (firstAt === null) firstAt = now();
          schedule();
        }
        throw err;
      }
    });
  }

  /** Cancel the timer without flushing (the app is closing). */
  function dispose() {
    cancel();
  }

  return { noteSaved, flush, state, exclusive, dispose, paths };
}
