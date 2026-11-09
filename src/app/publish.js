/**
 * Publish, Update and Unpublish: take a post (or its latest edits) all the
 * way live (save, sync, build check, commit, push; hosting deploys from the
 * pushed repo), and check whether the deployed page matches the page built.
 * Each stages the backup paths plus that one post's pages, never another's.
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
import { GitNotConnectedError, readHead as gitReadHead } from '../git/git.js';
import { BACKUP_PATHS, THEME_PATHS, postPages } from './site-git.js';
import {
  refreshThemeSetting, snapshotFile, restoreFile, themeSettingFile, commitWithTheme, themeConflictResolver,
} from './site-theme.js';
import { componentTags } from './components.js';
import { mediaRefs } from '../media/usage.js';
import { isMissing } from '../sync/media-library.js';

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
 * Publish, update or unpublish a document: save and sync the status change,
 * run the site's build (on failure the previous version is restored and
 * re-synced), commit the backup paths plus this post's pages (postPages),
 * push. Publish/Update also refresh config/theme.json (created when the post
 * has its own theme and the site has none, R4; restored on a failed build)
 * and commit THEME_PATHS (R3); the commit that first adds theme.json drops
 * the legacy vp.json `theme` key. Publishing an already-published post is an Update: it keeps the
 * `published` date and the commit says `Update: <title>`.
 * @param {{
 *   site?: Object,
 *   ws: import('../workspace/workspace.js').Workspace,
 *   db: import('better-sqlite3').Database,
 *   docId: string,
 *   publish: boolean,
 *   update?: boolean,
 *   deps: {
 *     ensureInstalled: Function, runBuild: Function,
 *     commitPaths: Function, push: Function, gitStatus: Function,
 *     changedSinceHead: Function, readHead: Function, hasHead: Function,
 *     collectionsConfig?: Object, readSiteUrl?: Function,
 *     components?: () => Map<string, Object>,
 *   },
 * }} options - publish/update refuse (422) a post with no title;
 *   update: refuse (422) unless the post is already published;
 *   deps.components: the components on for the site; publish/update refuse (422), before
 *   saving or building, a post that uses a component not in it, or one whose descriptor
 *   has `loadsOnLiveSite: false` (R14); publish/update also refuse (422), before building,
 *   a post that refers to a `/media/` file missing from `ws.mediaDir` (M13)
 * @returns {Promise<{ status: 'pushed'|'saved', url: string|null, sha: string|null, rebased: boolean,
 *   kind: 'publish'|'update'|'unpublish', expectedText: string|null }>}
 *   rebased: the push rebased onto commits from elsewhere (the caller re-syncs the store);
 *   themeFromElsewhere (only when true): another computer changed the theme files, GitHub's were kept;
 *   expectedText: the page this build made (publish/update), for the live check
 * @throws {BuildError|PublishRejectedError|Error} git errors propagate (GitConflictError, ...)
 */
export async function setPublished({ ws, db, docId, publish, update = false, deps }) {
  const collectionsConfig = deps.collectionsConfig || {};
  const previous = getDocument(db, docId);
  if (!previous) throw new PublishRejectedError(404, { error: 'Document not found' });
  const wasPublished = previous.meta.status === 'published';
  if (update && !wasPublished) throw new PublishRejectedError(422, { error: 'This post is not published: use Publish' });
  const kind = !publish ? 'unpublish' : wasPublished ? 'update' : 'publish';
  if (publish && !String(previous.meta.title ?? '').trim()) {
    throw new PublishRejectedError(422, { error: 'Give the post a title before publishing.' });
  }
  if (publish && deps.components) {
    const on = deps.components();
    const off = [...componentTags(previous.blocks)].find((tag) => !on.has(tag));
    if (off) {
      throw new PublishRejectedError(422, {
        error: `This post uses <${off}>, which is not on for this site. Turn it on under Components, or remove it from the post.`,
      });
    }
    // On, but Cook won't load it on the live site (R14): the page would show it inert.
    const dead = [...componentTags(previous.blocks)].map((tag) => on.get(tag)).find((d) => d.loadsOnLiveSite === false);
    if (dead) {
      throw new PublishRejectedError(422, {
        error: `This post uses <${dead.tag}>, which won't load on the live site: ${dead.liveSiteNote}. Remove it from the post to publish now.`,
      });
    }
  }

  // A published page showing a broken file (M13): refuse before saving or building.
  if (publish) {
    const missing = [...mediaRefs(previous)].filter((file) => isMissing(ws.mediaDir, file));
    if (missing.length) {
      throw new PublishRejectedError(422, {
        error: `This post uses files missing from src/media: ${missing.join(', ')}. Remove them or add the files, then publish.`,
      });
    }
  }

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

  // The theme goes live with the post (R3): refresh theme.json's files from the site as it
  // is (a post with its own theme opts the site in, R4). A failed build puts it back.
  const settingFile = themeSettingFile(ws);
  const carriesTheme = publish && (Boolean(previous.meta.theme) || existsSync(settingFile));
  const settingBefore = carriesTheme ? snapshotFile(settingFile) : null;

  // 2. Build check; on failure put the previous version back.
  const runCheck = async () => {
    try {
      await deps.ensureInstalled(ws.siteDir);
      return await deps.runBuild(ws.siteDir);
    } catch (err) {
      return { ok: false, log: err.message };
    }
  };
  let build;
  try {
    if (carriesTheme) refreshThemeSetting(ws, { create: Boolean(previous.meta.theme) });
    build = await runCheck();
  } catch (err) {
    build = { ok: false, log: `Couldn't write config/theme.json: ${err.message}` };
  }
  // The build may have vendored the site's VB copy (R5): refresh again, and build
  // once more when that changed theme.json, so the commit and the build agree.
  if (build.ok && carriesTheme) {
    const built = snapshotFile(settingFile);
    try {
      refreshThemeSetting(ws);
    } catch (err) {
      build = { ok: false, log: `Couldn't write config/theme.json: ${err.message}` };
    }
    const refreshed = snapshotFile(settingFile);
    const same = built === null ? refreshed === null : refreshed !== null && built.equals(refreshed);
    if (build.ok && !same) build = await runCheck();
  }
  // Revert only the status change on the current stored version: an edit
  // saved meanwhile is kept. `updated` goes back only if nothing else touched the doc.
  const revertStatus = () => {
    const current = getDocument(db, docId) || saved;
    const revert = {
      ...current.meta,
      status: previous.meta.status,
      published: previous.meta.published,
      updated: current.meta.updated === saved.meta.updated ? previous.meta.updated : current.meta.updated,
    };
    const restored = saveDocument(db, { ...current, meta: revert });
    syncDocument(ws, restored, { collectionsConfig, previousDoc: current });
  };
  if (!build.ok) {
    revertStatus();
    if (carriesTheme) restoreFile(settingFile, settingBefore);
    throw new BuildError(build.log);
  }

  // The page this build made, read now: Preview's dev server may rebuild dist later.
  const expectedText = publish ? builtPage(ws.siteDir, saved, collectionsConfig) : null;

  // 3. Commit the backup paths (pending saves included) and this post's pages: its
  // current page, plus any old one (renamed or unpublished) still in HEAD.
  const status = await deps.gitStatus(ws.siteDir);
  let sha = null;
  if (status.isRepo) {
    let pages;
    try {
      pages = await postPages(ws, docId, outputPaths(saved, collectionsConfig).html, {
        git: { changedSinceHead: deps.changedSinceHead, readHead: deps.readHead, hasHead: deps.hasHead }, collectionsConfig,
      });
    } catch (err) {
      // Committing without the page would report success while the old page stays live.
      revertStatus();
      throw new Error(`Nothing was committed: could not list this post's pages (${err.message})`);
    }
    const label = { publish: 'Publish', update: 'Update', unpublish: 'Unpublish' }[kind];
    // Publish/Update carry the theme setting and custom themes (R3); Unpublish does not.
    const themePaths = publish ? [...THEME_PATHS] : [];
    const commit = () => deps.commitPaths(ws.siteDir, [...BACKUP_PATHS, ...themePaths, ...pages], `${label}: ${saved.meta.title}`);
    sha = publish ? await commitWithTheme(ws, deps.readHead || gitReadHead, commit) : await commit();
  }

  const siteUrl = publish ? await (deps.readSiteUrl || readSiteUrl)(ws.siteDir) : null;
  const url = publish ? publicUrl(siteUrl, saved, collectionsConfig) : null;
  const done = (pushStatus, rebased = false) => ({ status: pushStatus, url, sha, rebased, kind, expectedText });

  // 4. Push (pushes every local commit, including earlier unpushed ones).
  if (!status.isRepo || !status.hasRemote || !status.hasUpstream) return done('saved');
  let pushResult;
  try {
    pushResult = await deps.push(ws.siteDir, { yieldUntracked: [...THEME_PATHS], resolveConflicts: themeConflictResolver(ws) });
  } catch (err) {
    if (err instanceof GitNotConnectedError) return done('saved');
    throw err;
  }
  // Another computer changed the theme meanwhile: the post went out, GitHub's theme was kept.
  const themeFromElsewhere = (pushResult?.resolved || []).some((f) => THEME_PATHS.some((p) => f === p || f.startsWith(`${p}/`)));
  return { ...done('pushed', Boolean(pushResult?.rebased)), ...(themeFromElsewhere ? { themeFromElsewhere } : {}) };
}
