/**
 * Which paths in a site Vanilla Press owns (the only ones it ever stages), the
 * page set of one post (what Publish, Update and Unpublish stage), and the
 * backup: saves are committed and pushed to GitHub after a pause. A backup
 * never stages a page, so it never changes the live site.
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
/** What a backup stages: the JSON, uploads and settings, never a page. */
export const BACKUP_PATHS = Object.freeze(['content', 'src/media', 'config/vp.json']);
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

/** The output dir (under `src/`, `''` for src itself) of each collection in `content/`. */
function collectionDirs(ws, collectionsConfig) {
  const dirs = new Set();
  for (const entry of listDir(join(ws.siteDir, 'content'))) {
    if (!entry.isDirectory()) continue;
    dirs.add(trimSlashes(collectionOutput(entry.name, collectionsConfig).path));
  }
  return dirs;
}

/** True when `path` is an `.html` file a collection with one of `dirs` writes (`''`: directly in src/). */
function inCollectionDirs(path, dirs) {
  if (!path.endsWith('.html')) return false;
  for (const dir of dirs) {
    if (dir === '' ? /^src\/[^/]+$/.test(path) : path.startsWith(`src/${dir}/`)) return true;
  }
  return false;
}

/** The `vp_id` of the page at a site-relative path, or null. */
function vpIdAt(siteDir, path) {
  try { return readVpId(readFileSync(join(siteDir, path), 'utf8')); } catch { return null; }
}

/**
 * The pages one post's Publish, Update or Unpublish stages: its current page
 * (when it exists and is this post's), plus every page tracked in HEAD whose
 * `vp_id` is this post's and that is modified or deleted in the working tree
 * (an old slug after a rename, or the page an unpublish removed, even from an
 * earlier run). Never another post's page, never a hand-written one.
 * @param {import('../workspace/workspace.js').Workspace} ws
 * @param {string} docId
 * @param {string|null} currentHtmlPath - the post's page now (null when it has none)
 * @param {{ git: { changedSinceHead: Function, readHead: Function }, collectionsConfig?: Object }} options
 * @returns {Promise<string[]>}
 */
export async function postPages(ws, docId, currentHtmlPath, { git, collectionsConfig = {} }) {
  const out = new Set();
  if (currentHtmlPath && vpIdAt(ws.siteDir, currentHtmlPath) === docId) out.add(currentHtmlPath);
  const dirs = collectionDirs(ws, collectionsConfig);
  if (dirs.size === 0) return [...out];
  const roots = [...new Set([...dirs].map((d) => (d ? `src/${d}` : 'src')))];
  let candidates;
  try {
    candidates = await git.changedSinceHead(ws.siteDir, roots);
  } catch {
    return [...out]; // no commit yet: nothing in HEAD to remove
  }
  for (const path of candidates) {
    if (out.has(path) || !inCollectionDirs(path, dirs)) continue;
    const text = await git.readHead(ws.siteDir, path);
    if (text !== null && readVpId(text) === docId) out.add(path);
  }
  return [...out];
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
  const paths = new Set(BACKUP_PATHS);
  const dirs = collectionDirs(ws, collectionsConfig);
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

/**
 * The backup commit message: `Draft: <titles>` when every save in the batch
 * was a draft, otherwise `Edit: <titles>`; always with the CI skip marker (a
 * backup never changes the live site).
 * @param {string[]} titles
 * @param {boolean} allDraft
 * @returns {string}
 */
export function backupMessage(titles, allDraft) {
  const t = commitTitle(titles.length ? titles : ['changes']);
  return `${allDraft ? 'Draft' : 'Edit'}: ${t}${SKIP}`;
}

/**
 * @typedef {{
 *   pending: number, lastPushAt: string|null, error: string|null, connected: boolean,
 *   lastPushKind: 'draft'|'publish'|null,
 * }} BackupState - lastPushKind: what the last push carried: backups only
 *   (`Draft:`/`Edit:`), or a publish, update or unpublish
 */

/**
 * Backup for one site (stages only BACKUP_PATHS): push QUIET_MS after the last save, at most
 * MAX_WAIT_MS after the first unpushed one. All git work runs one at a time.
 * @param {{
 *   site?: Object,
 *   ws: import('../workspace/workspace.js').Workspace,
 *   git: { commitPaths: Function, push: Function, gitStatus: Function },
 *   onRebased?: () => void,
 *   now?: () => number,
 *   setTimer?: (fn: Function, ms: number) => any,
 *   clearTimer?: (handle: any) => void,
 * }} options
 */
export function createBackup({
  ws,
  git,
  onRebased = () => {},
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
  let allDraft = true; // every uncommitted save was a draft
  let firstAt = null; // first save of the current window (uncommitted saves)
  let timer = null;
  let lastPushAt = null;
  let lastPushKind = null;
  let error = null;
  let connected = false; // until init() reads git status; pushed() sets it true
  let initPromise = null;
  let closed = false;
  let queue = Promise.resolve();
  const state = () => ({ pending: uncommitted + unpushed, lastPushAt, error, connected, lastPushKind });

  function cancel() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  function schedule() {
    cancel();
    if (closed) return;
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
    const snapshot = { count: uncommitted, titles, allDraft };
    uncommitted = 0;
    titles = [];
    allDraft = true;
    firstAt = null;
    return snapshot;
  }

  /** Nothing was committed: the taken saves are uncommitted again (in a fresh window). */
  function giveBack(snapshot) {
    uncommitted += snapshot.count;
    titles = [...snapshot.titles, ...titles.filter((t) => !snapshot.titles.includes(t))];
    allDraft = snapshot.allDraft && allDraft;
    if (uncommitted > 0 && firstAt === null) firstAt = now();
  }

  /** A push rebased onto commits from elsewhere: let the store pick them up. */
  function afterPush(result) {
    if (!result?.rebased) return;
    try { onRebased(); } catch (err) { console.warn(`Re-sync after rebase failed: ${err.message}`); }
  }

  function pushed(kind) {
    lastPushKind = kind === 'publish' ? 'publish' : 'draft';
    unpushed = 0;
    error = null;
    connected = true;
    lastPushAt = new Date(now()).toISOString();
  }

  /**
   * Record a synced save.
   * @param {{ title?: string, status?: string }} save
   */
  function noteSaved({ title, status } = {}) {
    uncommitted++;
    if (title && !titles.includes(title)) titles.push(title);
    if (status !== 'draft') allDraft = false;
    if (firstAt === null) firstAt = now();
    schedule();
  }

  /**
   * Commit the owned paths and push. Never rejects; errors land in state().
   * @returns {Promise<BackupState>}
   */
  function flush() {
    cancel();
    return serial(flushNow);
  }

  /** Commit the owned paths and push (call inside the git queue). */
  async function flushNow() {
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
      await git.commitPaths(ws.siteDir, [...BACKUP_PATHS], backupMessage(snapshot.titles, snapshot.allDraft));
      unpushed += snapshot.count; // committed (or nothing to commit): only the push is left
      snapshot = null;
      const result = await git.push(ws.siteDir);
      pushed('backup');
      afterPush(result);
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
        unpushed += snapshot.count;
        if (result?.status === 'pushed') {
          pushed('publish');
          afterPush(result);
        }
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
    closed = true;
    cancel();
  }

  /**
   * Flush, then run `fn` (closing the site), both in the git queue, so a
   * running publish finishes first and no save is left unpushed. Later
   * saves schedule nothing. Never rejects because of the flush.
   * @param {() => (void|Promise<void>)} fn
   * @returns {Promise<void>}
   */
  function close(fn) {
    closed = true;
    cancel();
    return serial(async () => {
      await flushNow();
      await fn();
    });
  }

  return { noteSaved, flush, state, exclusive, dispose, close, init };
}
