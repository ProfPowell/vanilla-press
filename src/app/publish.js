/**
 * Publish, Update and Unpublish: take a post (or its latest edits) all the
 * way live (save, sync, build check, commit, push; hosting deploys from the
 * pushed repo), and check whether the deployed page matches the page built.
 * Each stages the backup paths plus that one post's pages, never another's.
 *
 * @module app/publish
 */

import { mediaAltLookup } from '../media/alt-lookup.js';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getDocument, saveDocument } from '../store/content.js';
import { syncDocument } from '../sync/to-site.js';
import { preflightSave } from '../sync/site-files.js';
import { outputPaths, postUrlPath } from '../sync/paths.js';
import {
  GitNotConnectedError, GitConflictError, GitStashConflictError, readHead as gitReadHead,
} from '../git/git.js';
import { BACKUP_PATHS, THEME_PATHS, FEED_SNAPSHOT_PATHS, postPages } from './site-git.js';
import {
  refreshThemeSetting, snapshotFile, restoreFile, themeSettingFile, commitWithTheme, themeConflictResolver,
} from './site-theme.js';
import { componentTags } from './components.js';
import { mediaRefs } from '../media/usage.js';
import { mediaAccessWarnings } from '../access/media-warnings.js';
import { isMissing } from '../sync/media-library.js';
import { sectionAccess, documentAccess } from '../sync/section-access.js';

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
 * Install the site's packages if needed and run its build; never throws.
 * @param {import('../workspace/workspace.js').Workspace} ws
 * @param {{ ensureInstalled: Function, runBuild: Function }} deps
 * @returns {Promise<{ ok: boolean, log: string }>}
 */
export async function buildCheck(ws, deps) {
  try {
    await deps.ensureInstalled(ws.siteDir);
    return await deps.runBuild(ws.siteDir);
  } catch (err) {
    return { ok: false, log: err.message };
  }
}

/**
 * The response for an error a publish action throws: a refused publish (its own
 * status and body), a failed build (422), a git conflict (409), another git
 * failure (502); null for anything unexpected.
 * @param {unknown} err
 * @returns {{ status: number, body: Object }|null}
 */
export function publishErrorResponse(err) {
  if (err instanceof PublishRejectedError) return { status: err.status, body: err.body };
  if (err instanceof BuildError) return { status: 422, body: { error: 'Build failed', log: err.log } };
  if (err instanceof GitConflictError || err instanceof GitStashConflictError) {
    return { status: 409, body: { error: err.message, files: err.files } };
  }
  if (err?.name?.startsWith('Git')) return { status: 502, body: { error: err.message } };
  return null;
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
 * The text of the locally built page for a document, or null: `dist<postUrlPath>index.html`
 * for a public post; a friends or private post (its own level or its section's,
 * documentAccess) exists only in that level's tree, `dist/_l/<level><postUrlPath>index.html`.
 * @param {string} siteDir
 * @param {Object} doc
 * @param {Object} collectionsConfig
 * @returns {string|null}
 */
export function builtPage(siteDir, doc, collectionsConfig) {
  const access = documentAccess(siteDir, doc?.meta);
  const tree = access === 'public' ? ['dist'] : ['dist', '_l', access];
  const file = join(siteDir, ...tree, ...postUrlPath(doc, collectionsConfig).split('/').filter(Boolean), 'index.html');
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
 *   confirmAccessWarnings: publish/update of a post that uses media more restricted than the post
 *   refuse (409, body `accessWarnings`: [{ filename, access }]), before saving or building, until true;
 *   deps.components: the components on for the site; publish/update refuse (422), before
 *   saving or building, a post that uses a component not in it, or one whose descriptor
 *   has `loadsOnLiveSite: false` (R14); publish/update also refuse (422), before building,
 *   a post that refers to a `/media/` file missing from `ws.mediaDir` (M13)
 * @returns {Promise<{ status: 'pushed'|'saved', url: string|null, sha: string|null, rebased: boolean,
 *   kind: 'publish'|'update'|'unpublish', expectedText: string|null,
 *   restricted?: true, access?: 'friends'|'private' }>}
 *   restricted, access (publish/update of a friends or private post only; its own level or its
 *   section's): the page is not on the public URL, so there is no live check;
 *   rebased: the push rebased onto commits from elsewhere (the caller re-syncs the store);
 *   themeFromElsewhere (only when true): another computer changed the theme files, GitHub's were kept;
 *   expectedText: the page this build made (publish/update), for the live check
 * @throws {BuildError|PublishRejectedError|Error} git errors propagate (GitConflictError, ...)
 */
export async function setPublished({ ws, db, docId, publish, update = false, confirmAccessWarnings = false, deps }) {
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
    const off = [...componentTags(previous)].find((tag) => !on.has(tag));
    if (off) {
      throw new PublishRejectedError(422, {
        error: `This post uses <${off}>, which is not on for this site. Turn it on under Components, or remove it from the post.`,
      });
    }
    // On, but Cook won't load it on the live site (R14): the page would show it inert.
    const dead = [...componentTags(previous)].map((tag) => on.get(tag)).find((d) => d.loadsOnLiveSite === false);
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

  // Media more restricted than the page would be left out of the public build: ask first.
  if (publish && !confirmAccessWarnings) {
    const accessWarnings = mediaAccessWarnings(previous, db.prepare('SELECT filename, access FROM media').all(), {
      sectionAccess: sectionAccess(ws.siteDir, previous.meta.section),
    });
    if (accessWarnings.length) {
      throw new PublishRejectedError(409, {
        error: `This post uses media that is more restricted than the post: ${accessWarnings.map((w) => `${w.filename} (${w.access})`).join(', ')}. Confirm to publish anyway.`,
        accessWarnings,
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
  syncDocument(ws, saved, { mediaAlt: mediaAltLookup(db), collectionsConfig, previousDoc: previous });

  // The theme goes live with the post (R3): refresh theme.json's files from the site as it
  // is (a post with its own theme opts the site in, R4). A failed build puts it back.
  const settingFile = themeSettingFile(ws);
  const carriesTheme = publish && (Boolean(previous.meta.theme) || existsSync(settingFile));
  const settingBefore = carriesTheme ? snapshotFile(settingFile) : null;

  // 2. Build check; on failure put the previous version back.
  const runCheck = () => buildCheck(ws, deps);
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
    syncDocument(ws, restored, { mediaAlt: mediaAltLookup(db), collectionsConfig, previousDoc: current });
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
    // All three carry the feed snapshots: the build ran, so they are current.
    const themePaths = publish ? [...THEME_PATHS] : [];
    const commit = () => deps.commitPaths(ws.siteDir, [...BACKUP_PATHS, ...themePaths, ...FEED_SNAPSHOT_PATHS, ...pages], `${label}: ${saved.meta.title}`);
    sha = publish ? await commitWithTheme(ws, deps.readHead || gitReadHead, commit) : await commit();
  }

  const siteUrl = publish ? await (deps.readSiteUrl || readSiteUrl)(ws.siteDir) : null;
  const url = publish ? publicUrl(siteUrl, saved, collectionsConfig) : null;
  // A friends or private page is not on the public URL: the live check cannot see it.
  const access = publish ? documentAccess(ws.siteDir, saved.meta) : 'public';
  const restricted = access !== 'public' ? { restricted: true, access } : {};
  const done = (pushStatus, rebased = false) => ({ status: pushStatus, url, sha, rebased, kind, expectedText, ...restricted });

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
