/**
 * Publish and Unpublish: take a post all the way live (save, sync, build
 * check, commit, push; hosting deploys from the pushed repo), and check
 * whether the deployed page matches the local build.
 *
 * @module app/publish
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getDocument, saveDocument } from '../store/content.js';
import { syncDocument } from '../sync/to-site.js';
import { preflightSave } from '../sync/site-files.js';
import { outputPaths, postUrlPath } from '../sync/paths.js';
import { GitNotConnectedError } from '../git/git.js';
import { ownedPaths } from './site-git.js';

/** The site's build failed; `log` is the tail of its output. */
export class BuildError extends Error {
  constructor(log) {
    super('Build failed');
    this.name = 'BuildError';
    this.log = log;
  }
}

/** The document is missing (`status` 404) or its save was refused (`status`, `body` from preflightSave). */
export class PublishRejectedError extends Error {
  constructor(status, body) {
    super(body.error || 'Not saved');
    this.name = 'PublishRejectedError';
    this.status = status;
    this.body = body;
  }
}

/**
 * `siteUrl` from `<site>/config/data.js` (imported fresh), or null.
 * @param {string} siteDir
 * @returns {Promise<string|null>}
 */
export async function readSiteUrl(siteDir) {
  const file = join(siteDir, 'config', 'data.js');
  if (!existsSync(file)) return null;
  try {
    const mod = await import(`${pathToFileURL(file).href}?t=${Date.now()}-${Math.random()}`);
    const url = mod.default?.siteUrl;
    return typeof url === 'string' && url ? url : null;
  } catch {
    return null;
  }
}

/**
 * A page's visible text: scripts, styles, comments and tags removed, whitespace collapsed.
 * @param {string} html
 * @returns {string}
 */
export function normalizeText(html) {
  return String(html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True when `url` answers 200 and its text equals `expectedText`'s.
 * @param {{ url: string, expectedText: string, fetch?: typeof fetch }} options
 * @returns {Promise<boolean>}
 */
export async function checkLive({ url, expectedText, fetch: fetchImpl = fetch }) {
  try {
    const res = await fetchImpl(url, { cache: 'no-store', redirect: 'follow' });
    if (res.status !== 200) return false;
    return normalizeText(await res.text()) === normalizeText(expectedText);
  } catch {
    return false;
  }
}

/**
 * The public URL of a document's page, or null without a siteUrl.
 * @param {string|null} siteUrl
 * @param {Object} doc
 * @param {Object} collectionsConfig
 */
export function publicUrl(siteUrl, doc, collectionsConfig) {
  return siteUrl ? siteUrl.replace(/\/+$/, '') + postUrlPath(doc, collectionsConfig) : null;
}

/**
 * The text of the locally built page for a document (`dist<postUrlPath>index.html`), or null.
 * @param {string} siteDir
 * @param {Object} doc
 * @param {Object} collectionsConfig
 * @returns {string|null}
 */
export function builtPage(siteDir, doc, collectionsConfig) {
  const file = join(siteDir, 'dist', ...postUrlPath(doc, collectionsConfig).split('/').filter(Boolean), 'index.html');
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Publish or unpublish a document: save and sync the status change, run the
 * site's build (on failure the previous version is restored and re-synced),
 * commit the owned paths, push.
 * @param {{
 *   site?: Object,
 *   ws: import('../workspace/workspace.js').Workspace,
 *   db: import('better-sqlite3').Database,
 *   docId: string,
 *   publish: boolean,
 *   deps: {
 *     ensureInstalled: Function, runBuild: Function,
 *     commitPaths: Function, push: Function, gitStatus: Function,
 *     collectionsConfig?: Object, readSiteUrl?: Function,
 *   },
 * }} options
 * @returns {Promise<{ status: 'pushed'|'saved', url: string|null, sha: string|null }>}
 * @throws {BuildError|PublishRejectedError|Error} git errors propagate (GitConflictError, ...)
 */
export async function setPublished({ ws, db, docId, publish, deps }) {
  const collectionsConfig = deps.collectionsConfig || {};
  const previous = getDocument(db, docId);
  if (!previous) throw new PublishRejectedError(404, { error: 'Document not found' });

  // 1. Save the status change and sync it.
  const now = new Date().toISOString();
  const meta = { ...previous.meta, status: publish ? 'published' : 'draft', updated: now };
  if (publish && !meta.published) meta.published = now;
  const candidate = { ...previous, meta };
  const problem = preflightSave(ws, db, candidate, collectionsConfig);
  if (problem) {
    const { status, ...body } = problem;
    throw new PublishRejectedError(status, body);
  }
  const saved = saveDocument(db, candidate);
  syncDocument(ws, saved, { collectionsConfig, previousDoc: previous });

  // 2. Build check; on failure put the previous version back.
  let build;
  try {
    await deps.ensureInstalled(ws.siteDir);
    build = await deps.runBuild(ws.siteDir);
  } catch (err) {
    build = { ok: false, log: err.message };
  }
  if (!build.ok) {
    // Revert only the status change on the current stored version: an edit
    // saved while the build ran is kept. `updated` goes back only if nothing else touched the doc.
    const current = getDocument(db, docId) || saved;
    const revert = {
      ...current.meta,
      status: previous.meta.status,
      published: previous.meta.published,
      updated: current.meta.updated === saved.meta.updated ? previous.meta.updated : current.meta.updated,
    };
    const restored = saveDocument(db, { ...current, meta: revert });
    syncDocument(ws, restored, { collectionsConfig, previousDoc: current });
    throw new BuildError(build.log);
  }

  // 3. Commit the owned paths (pending draft saves included), plus both page paths so a removal is staged.
  const status = await deps.gitStatus(ws.siteDir);
  const pagePaths = [outputPaths(previous, collectionsConfig).html, outputPaths(saved, collectionsConfig).html];
  const paths = [...new Set([...ownedPaths(ws, collectionsConfig), ...pagePaths.filter(Boolean)])];
  const sha = status.isRepo
    ? await deps.commitPaths(ws.siteDir, paths, `${publish ? 'Publish' : 'Unpublish'}: ${saved.meta.title}`)
    : null;

  const siteUrl = publish ? await (deps.readSiteUrl || readSiteUrl)(ws.siteDir) : null;
  const url = publish ? publicUrl(siteUrl, saved, collectionsConfig) : null;

  // 4. Push (pushes every local commit, including earlier unpushed ones).
  if (!status.isRepo || !status.hasRemote || !status.hasUpstream) return { status: 'saved', url, sha };
  try {
    await deps.push(ws.siteDir);
  } catch (err) {
    if (err instanceof GitNotConnectedError) return { status: 'saved', url, sha };
    throw err;
  }
  return { status: 'pushed', url, sha };
}
