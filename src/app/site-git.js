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

/** Site-relative `.html` files under `src/<rel>` (recursively; top level only for `''`) whose front matter has `vp_id`. */
function vpPages(siteDir, rel, recursive) {
  const out = [];
  const base = rel ? `src/${rel}` : 'src';
  for (const entry of listDir(join(siteDir, base))) {
    const path = `${base}/${entry.name}`;
    if (entry.isDirectory()) {
      if (recursive) out.push(...vpPages(siteDir, `${rel}/${entry.name}`, true));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.html')) continue;
    let text;
    try { text = readFileSync(join(siteDir, path), 'utf8'); } catch { continue; }
    if (readVpId(text)) out.push(path);
  }
  return out;
}

/**
 * Site-relative paths Vanilla Press owns: `content`, `src/media`,
 * `config/vp.json` and, for each collection in `content/`, the pages in its
 * output dir that VP wrote: each `.html` file whose front matter has
 * `vp_id` (under `src/<dir>`, or directly in `src/` for a `''` dir such as
 * pages), plus every html path in the local manifest so a removed page's
 * deletion is staged. Never a collection folder wholesale, so hand-written
 * files there stay the user's. Paths may not exist; commitPaths skips those.
 * @param {import('../workspace/workspace.js').Workspace} ws
 * @param {Object} [collectionsConfig]
 * @returns {string[]}
 */
export function ownedPaths(ws, collectionsConfig = {}) {
  const paths = new Set(['content', 'src/media', 'config/vp.json']);
  const dirs = new Set();
  for (const entry of listDir(join(ws.siteDir, 'content'))) {
    if (!entry.isDirectory()) continue;
    dirs.add(trimSlashes(collectionOutput(entry.name, collectionsConfig).path));
  }
  if (dirs.size === 0) return [...paths];
  for (const dir of dirs) {
    for (const page of vpPages(ws.siteDir, dir, dir !== '')) paths.add(page);
  }
  let manifest = { documents: {} };
  try { manifest = readManifest(ws); } catch { /* corrupt: sync reports it */ }
  for (const doc of Object.values(manifest.documents || {})) {
    if (typeof doc?.html === 'string' && doc.html.startsWith('src/') && doc.html.endsWith('.html')) paths.add(doc.html);
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
  // Saves are counted in two parts: `uncommitted` (with their `titles`) were
  // saved after the last commit was taken; `unpushed` went into a local
  // commit (or a commit attempt) that has not reached the remote yet. Only a
  // snapshot taken when the commit starts moves from one to the other, so a
  // save that arrives during a slow commit or push stays pending.
  let uncommitted = 0;
  let unpushed = 0;
  let titles = [];
  let firstAt = null; // first save of the current window (uncommitted saves)
  let timer = null;
  let lastPushAt = null;
  let error = null;
  let connected = false; // until init() reads git status; pushed() sets it true
  let initPromise = null;
  let queue = Promise.resolve();
  // Owned paths seen this session: a page VP removed is no longer listed by ownedPaths, but its deletion must be staged.
  // Seeded now and refreshed after every save and publish, so a page that exists at
  // any point (for example before a slug rename) has its deletion committed later.
  const known = new Set();

  const state = () => ({ pending: uncommitted + unpushed, lastPushAt, error, connected });

  function paths() {
    for (const p of ownedPaths(ws, getCollectionsConfig())) known.add(p);
    return [...known];
  }

  try { paths(); } catch { /* unreadable site: the first save retries */ }

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

  /** Take the uncommitted saves for a commit; a new window starts for later saves. */
  function take() {
    const snapshot = { count: uncommitted, titles };
    uncommitted = 0;
    titles = [];
    firstAt = null;
    return snapshot;
  }

  /** Nothing was committed: the taken saves are uncommitted again (in a fresh window). */
  function giveBack(snapshot) {
    uncommitted += snapshot.count;
    titles = [...snapshot.titles, ...titles.filter((t) => !snapshot.titles.includes(t))];
    if (uncommitted > 0 && firstAt === null) firstAt = now();
  }

  function pushed() {
    unpushed = 0;
    error = null;
    connected = true;
    lastPushAt = new Date(now()).toISOString();
  }

  /**
   * Record a synced save.
   * @param {{ title?: string, status?: string }} save
   */
  function noteSaved({ title } = {}) {
    uncommitted++;
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
      if (uncommitted === 0 && unpushed === 0 && error === null) return state();
      let snapshot = null;
      try {
        const status = await git.gitStatus(ws.siteDir);
        if (!status.isRepo) {
          connected = false;
          firstAt = uncommitted > 0 ? now() : null; // next save waits for a full pause
          return state();
        }
        snapshot = take();
        await git.commitPaths(ws.siteDir, paths(), (files) => backupMessage(snapshot.titles, files));
        unpushed += snapshot.count; // committed (or nothing to commit): only the push is left
        snapshot = null;
        await git.push(ws.siteDir);
        pushed();
      } catch (err) {
        if (snapshot) giveBack(snapshot);
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
   * paths). `fn` resolves to `{ status: 'pushed'|'saved' }`. Saves made
   * while it runs stay pending.
   * @template T
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  function exclusive(fn) {
    cancel();
    return serial(async () => {
      const snapshot = take();
      try {
        const result = await fn();
        paths(); // the page this publish wrote (or removed) is known for later backups
        unpushed += snapshot.count;
        if (result?.status === 'pushed') pushed();
        else if (result?.status === 'saved') connected = false;
        return result;
      } catch (err) {
        if (err?.name?.startsWith('Git')) {
          unpushed += snapshot.count; // committed; the push is retried on the next flush
          error = err.message;
        } else {
          giveBack(snapshot); // e.g. a failed build: nothing was committed
        }
        if (uncommitted > 0 && timer === null) schedule();
        throw err;
      }
    });
  }

  /**
   * Read git status once so state().connected is right before any push:
   * connected means a repo with a remote and an upstream. Never rejects.
   * @returns {Promise<BackupState>}
   */
  function init() {
    initPromise ??= serial(async () => {
      try {
        const status = await git.gitStatus(ws.siteDir);
        connected = Boolean(status.isRepo && status.hasRemote && status.hasUpstream);
      } catch {
        connected = false;
      }
      return state();
    });
    return initPromise.then(() => state());
  }

  /** Cancel the timer without flushing (the app is closing). */
  function dispose() {
    cancel();
  }

  return { noteSaved, flush, state, exclusive, dispose, paths, init };
}
