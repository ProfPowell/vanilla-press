/**
 * The app server: one local process that holds the site registry and serves
 * each registered Cook site's API under `/api/sites/<id>/...`.
 *
 * Registry routes are matched first, by method and exact path, so they never
 * reach a site's router. A site whose id is literally `clone` is shadowed for
 * `POST /api/sites/clone` only; its other routes work.
 *
 * @module app/server
 */

import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { realpathSync, statSync, existsSync } from 'node:fs';
import { join, dirname, extname, relative, isAbsolute, sep, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listSites, getSite, addSite, removeSite, listFolders, configDir } from './registry.js';
import { createLayoutPreview } from './layout-preview.js';
import { createPreviews } from './preview.js';
import * as defaultGit from '../git/git.js';
import { GitConflictError, GitStashConflictError } from '../git/git.js';
import * as defaultSiteProcess from './site-process.js';
import { createBackup, BACKUP_PATHS, THEME_PATHS, pageNotLive } from './site-git.js';
import { migrateVpTheme } from './site-theme.js';
import { mountThemeRoutes } from './theme-routes.js';
import { mountLayoutRoutes } from './layout-routes.js';
import { mountProgramRoutes } from './program-routes.js';
import { mountServiceRoutes } from './service-routes.js';
import { createImageSearch } from '../services/image-search.js';
import { clearTmp } from '../programs/import.js';
import { createLivePrograms } from '../programs/usage.js';
import { findSiteVb } from '../themes/site-vb.js';
import { HOST, listen } from '../server/listen.js';
import { startProgramServer } from '../programs/program-server.js';
import { createLiveMedia } from './live-media.js';
import {
  setPublished, BuildError, PublishRejectedError, checkLive, readSiteUrl, publicUrl, builtPage,
} from './publish.js';
import { getDocument } from '../store/content.js';
import { outputPaths } from '../sync/paths.js';
import { getCollectionsConfig } from '../sync/site-files.js';
import { resolveWorkspace, openWorkspaceDb } from '../workspace/workspace.js';
import { syncFromSite } from '../sync/from-site.js';
import { createRouter, sendJson } from '../server/router.js';
import { mountApi } from '../server/api.js';
import { serveStatic, serveFile, MEDIA_HEADERS } from '../server/static.js';
import { refuseForeign } from '../server/guard.js';
import { CATALOG } from '../components/catalog.js';
import { packageDir } from '../components/describe.js';
import { setComponent, componentsState, enabledComponents, catalogComponents, ComponentError } from './components.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SITE_PATH = /^\/api\/sites\/([^/]+)(?:\/|$)/;
/** `/sites/<id>/media/<file>`: a site's uploads (its `src/media`), for the editor to display. */
const SITE_MEDIA_PATH = /^\/sites\/([^/]+)\/media\//;
/** `/sites/<id>/components/<pkg>/<path>`: a catalog package's files, for the editor to load. */
const SITE_COMPONENTS_PATH = /^\/sites\/([^/]+)\/components\//;
/** `/sites/<id>/site/<path>`: the site's VB copy and custom themes (its `src/`), for theme previews. */
const SITE_FILES_PATH = /^\/sites\/([^/]+)\/site\//;
/** What `/sites/<id>/site/` serves: stylesheets, scripts, fonts and images, never pages. */
const SITE_FILE_TYPES = new Set(['.css', '.js', '.mjs', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.woff', '.woff2']);
/** Custom themes (and vp-site.css), relative to the site's `src/`. */
const CUSTOM_THEMES_DIR = 'assets/themes';
/** In the VB copy's folder: its own top-level files, and these subfolders. */
const VB_OWN_FILE = /^vanilla-breeze(\.[a-z0-9]+)*\.(css|js|mjs)$/;
const VB_SUBFOLDERS = ['themes', 'fonts'];

const STATIC_MOUNTS = [
  { prefix: '/app/', dir: join(ROOT, 'app') },
  { prefix: '/editor/', dir: join(ROOT, 'editor') },
  { prefix: '/src/', dir: join(ROOT, 'src') },
  // Brand master copy (docs/design/brand/README.md): favicons, seals, manifest, tokens.css
  { prefix: '/brand/', dir: join(ROOT, 'docs', 'design', 'brand') },
  { prefix: '/assets/vb/', dir: join(ROOT, 'node_modules', 'vanilla-breeze', 'dist', 'cdn') },
  { prefix: '/assets/code-block/', dir: join(ROOT, 'node_modules', '@profpowell', 'code-block', 'dist') },
  { prefix: '/assets/pdf-viewer/', dir: join(ROOT, 'node_modules', '@profpowell', 'pdf-viewer', 'dist') },
  { prefix: '/assets/image-editor/', dir: join(ROOT, 'node_modules', '@profpowell', 'image-editor', 'dist') },
];

/** Actions with their own queue (they take the write lock inside the backup queue). */
const ACTION_PATH = /\/documents\/[^/]+\/(publish|update|unpublish)$/;

/**
 * A write that changes a site's files (document create, save, reload, delete, sync;
 * media upload, alt edit, delete): it waits for a running publish/update/unpublish
 * (Ruling O). Theme library and program writes take the locks themselves
 * (theme-routes.js, program-routes.js).
 * @param {string} method
 * @param {string} pathname
 * @returns {boolean}
 */
export function isQueuedWrite(method, pathname) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return false;
  const rest = pathname.replace(/^\/api\/sites\/[^/]+/, '');
  if (rest === '/sync') return true;
  if (rest === '/media' || rest.startsWith('/media/')) return true;
  return (rest === '/documents' || rest.startsWith('/documents/')) && !ACTION_PATH.test(rest);
}

/** A lock: `lock(fn)` runs fn after every earlier call has settled. */
function createLock() {
  let tail = Promise.resolve();
  return (fn) => {
    const run = tail.then(fn, fn);
    tail = run.catch(() => {});
    return run;
  };
}

/**
 * Start the app server.
 * @param {{
 *   port?: number,
 *   env?: NodeJS.ProcessEnv,
 *   previews?: ReturnType<typeof createPreviews>,
 *   git?: Object,
 *   siteProcess?: { ensureInstalled?: Function, runBuild?: Function },
 *   backup?: { now?: () => number, setTimer?: Function, clearTimer?: Function },
 *   fetch?: typeof fetch,
 *   components?: { catalog?: Object[], vpRoot?: string },
 * }} [options] - git and siteProcess override the real functions one by one (for tests);
 *   backup injects the draft-backup timers; fetch is used by the live check;
 *   components: the component catalog and the VP root its packages (and npm ranges) come from.
 * @returns {Promise<{ server: import('node:http').Server, port: number, url: string, programsUrl: string,
 *   close: () => Promise<void>, shutdown: () => Promise<void> }>} shutdown: for quitting the
 *   app (the CLI registers it for SIGINT/SIGTERM/SIGHUP): flushes every open site's backup, then
 *   stops previews and closes. close stops without flushing.
 */
export async function startApp({
  port = 3007,
  env = process.env,
  previews = createPreviews(),
  git: gitOverrides = {},
  siteProcess: siteProcessOverrides = {},
  backup: backupTimers = {},
  fetch: fetchImpl = globalThis.fetch,
  components: { catalog = CATALOG, vpRoot = ROOT } = {},
} = {}) {
  // Looked up on each use, so a caller can swap a function after start (tests do).
  const git = new Proxy({}, { get: (_, key) => gitOverrides[key] ?? defaultGit[key] });
  const siteProcess = new Proxy({}, { get: (_, key) => siteProcessOverrides[key] ?? defaultSiteProcess[key] });
  // One web image search for the app: its cache is what imports and the image proxy read from.
  const imageSearch = createImageSearch({ env, fetch: fetchImpl });
  /** Open sites, cached for the life of the server: id -> { db, router, ws, backup, writes } */
  const open = new Map();

  /** Layout previews (working copy + static server), created on first use: id -> preview. */
  const layoutPreviews = new Map();
  const layoutPreview = (site) => () => {
    let p = layoutPreviews.get(site.id);
    if (!p) {
      p = createLayoutPreview({ site, configDir: configDir(env) });
      layoutPreviews.set(site.id, p);
    }
    return p;
  };
  const closeLayoutPreview = async (id) => {
    const p = layoutPreviews.get(id);
    layoutPreviews.delete(id);
    await p?.close();
  };

  /** Opens in progress: id -> Promise<entry>, so concurrent requests open a site once. */
  const opening = new Map();

  /**
   * Another machine may have pushed: fast-forward first when that is safe (an
   * upstream, no uncommitted changes in the backup paths; a held page edit
   * does not count, git itself refuses a fast-forward that would overwrite
   * it). Never merges or rebases; any failure is logged and the site opens as it is.
   */
  async function pullOnOpen(site, ws, db) {
    try {
      const status = await git.gitStatus(ws.siteDir);
      if (!status.isRepo || !status.hasUpstream) return;
      const dirty = await git.changedFiles(ws.siteDir, [...BACKUP_PATHS]);
      if (dirty.length > 0) {
        console.warn(`${site.name || site.id}: not pulling, uncommitted changes in ${dirty.slice(0, 3).join(', ')}`);
        return;
      }
      // An unapplied local theme.json or custom theme gives way to the one GitHub has;
      // openSite migrates vp.json afterwards only if theme.json is still missing.
      const { yielded = [] } = (await git.pullFastForward(ws.siteDir, { yieldUntracked: [...THEME_PATHS] })) || {};
      if (yielded.length) console.warn(`${site.name || site.id}: kept GitHub's ${yielded.join(', ')} (the local copy was not applied)`);
    } catch (err) {
      console.warn(`${site.name || site.id}: pull skipped: ${err.message}`);
    }
  }

  async function openSite(site) {
    const ws = resolveWorkspace({ site: site.path, env: {}, repoRoot: ROOT });
    const db = openWorkspaceDb(ws);
    try {
      await pullOnOpen(site, ws, db);
      // Strays adopted into the library rewrite media.json: back that up as a draft (M5, M10).
      let backup;
      const syncSite = () => {
        const { adopted } = syncFromSite(ws, db);
        if (adopted.length > 0) backup.noteSaved({ title: 'media library', status: 'draft' });
      };
      // A legacy vp.json theme moves to config/theme.json (R1) when there is none; a failure only logs.
      const migrate = () => {
        try {
          migrateVpTheme(ws);
        } catch (err) {
          console.warn(`${site.name || site.id}: theme migration skipped: ${err.message}`);
        }
      };
      backup = createBackup({
        site, ws, git, ...backupTimers,
        onRebased: () => { migrate(); syncSite(); },
      });
      migrate();
      syncSite();
      // Stages left by a run that stopped mid-copy: no program route is mounted yet, so none is in progress.
      try {
        clearTmp(ws.siteDir);
      } catch (err) {
        console.warn(`${site.name || site.id}: could not clear .vp/tmp: ${err.message}`);
      }
      const prefix = `/api/sites/${site.id}`;
      const router = createRouter();
      const roots = { siteDir: ws.siteDir, vpRoot, catalog };
      mountApi(router, db, {
        rootDir: ROOT, mediaDir: ws.mediaDir, workspace: ws, prefix, siteId: site.id,
        webImages: imageSearch, // import copies a result this search cached
        statusByActions: true, // Ruling P: only Publish/Update/Unpublish change status
        onSynced: ({ title, status }) => backup.noteSaved({ title, status }),
        onMediaChanged: ({ filename }) => backup.noteSaved({ title: filename, status: 'draft' }),
        // Saves check the whole catalog (R12): a post keeps a component turned off since;
        // Publish/Update refuse it (setPublished, against the enabled ones).
        components: () => catalogComponents(roots),
        componentsState: () => componentsState(roots),
        // The pages committed in HEAD are the live site: a file they show can't be deleted.
        liveMedia: createLiveMedia(ws.siteDir, { headCommit: git.headCommit, headTree: git.headTree, readBlobs: git.readBlobs }),
      });
      const writes = createLock();
      mountSiteGit(router, prefix, { site, ws, db, backup, writes, roots });
      mountLayoutRoutes(router, prefix, { ws, writes, backup, deps: git, db, preview: layoutPreview(site) });
      mountThemeRoutes(router, prefix, {
        site, ws, db, backup, writes, vpRoot, fetch: fetchImpl,
        onBuilt: () => vbCache.delete(site.id), // Apply's build may have vendored the site's VB copy
        deps: {
          git, // the delete check reads committed HEAD (headCommit, headTree, readBlobs)
          ensureInstalled: siteProcess.ensureInstalled, runBuild: siteProcess.runBuild,
          commitPaths: git.commitPaths, push: git.push, gitStatus: git.gitStatus, readHead: git.readHead,
        },
      });
      // git is the override Proxy, read on each use. programsUrl is read per request: the
      // program server binds after the app server.
      mountProgramRoutes(router, prefix, {
        site, ws, db, backup, writes, deps: git, liveRefs: createLivePrograms(ws.siteDir, git),
        programsUrl: () => programsUrl,
      });
      const entry = { ws, db, router, backup, writes };
      open.set(site.id, entry);
      return entry;
    } catch (err) {
      db.close();
      throw err;
    }
  }

  /** The open site's entry, opening it (once) if needed. */
  function getOpen(site) {
    const entry = open.get(site.id);
    if (entry) return Promise.resolve(entry);
    let pending = opening.get(site.id);
    if (!pending) {
      pending = openSite(site).finally(() => opening.delete(site.id));
      opening.set(site.id, pending);
    }
    return pending;
  }

  /**
   * Close an open site. With `flush`, its backup is flushed first and the
   * database closed in the backup's queue, after any running publish.
   * @param {string} id
   * @param {{ flush?: boolean }} [options]
   */
  async function closeSite(id, { flush = false } = {}) {
    await opening.get(id)?.catch(() => {});
    const entry = open.get(id);
    if (!entry) return;
    open.delete(id);
    if (flush) return entry.backup.close(() => entry.db.close());
    entry.backup.dispose();
    entry.db.close();
  }

  /**
   * Publish, update, unpublish, backup status, live check: `<prefix>/...` on a
   * site's router. POST publish on an already-published post is an Update too;
   * POST update refuses (422) a post that is not published.
   */
  function mountSiteGit(router, prefix, { site, ws, db, backup, writes, roots }) {
    /** What the live check expects after a publish or update this run: docId -> { url, text }. */
    const expected = new Map();
    const publishRoute = (action) => async (req, res) => {
      const docId = req.params.id;
      try {
        // Document writes wait (Ruling O): nothing changes between the build check and the commit.
        const result = await backup.exclusive(() => writes(() => setPublished({
          site, ws, db, docId, publish: action !== 'unpublish', update: action === 'update',
          deps: {
            ensureInstalled: siteProcess.ensureInstalled, runBuild: siteProcess.runBuild,
            commitPaths: git.commitPaths, push: git.push, gitStatus: git.gitStatus,
            changedSinceHead: git.changedSinceHead, readHead: git.readHead, hasHead: git.hasHead,
            collectionsConfig: getCollectionsConfig(db),
            components: () => enabledComponents(roots),
          },
        })));
        vbCache.delete(site.id); // the build may have vendored or moved the site's VB copy
        if (result.expectedText != null) expected.set(docId, { url: result.url, text: result.expectedText });
        else expected.delete(docId);
        sendJson(res, 200, {
          status: result.status, url: result.url,
          ...(result.themeFromElsewhere ? { theme: 'The theme was changed on another computer: the version on GitHub was kept.' } : {}),
        });
      } catch (err) {
        if (err instanceof PublishRejectedError) return sendJson(res, err.status, err.body);
        if (err instanceof BuildError) return sendJson(res, 422, { error: 'Build failed', log: err.log });
        if (err instanceof GitConflictError || err instanceof GitStashConflictError) {
          return sendJson(res, 409, { error: err.message, files: err.files });
        }
        if (err?.name?.startsWith('Git')) return sendJson(res, 502, { error: err.message });
        console.error('Publish error:', err);
        sendJson(res, 500, { error: err.message });
      }
    };
    router.add('POST', `${prefix}/documents/:id/publish`, publishRoute('publish'));
    router.add('POST', `${prefix}/documents/:id/update`, publishRoute('update'));
    router.add('POST', `${prefix}/documents/:id/unpublish`, publishRoute('unpublish'));

    // Whether a published post has saved edits that are not live yet (survives a reload).
    router.add('GET', `${prefix}/documents/:id/state`, async (req, res) => {
      const doc = getDocument(db, req.params.id);
      if (!doc) return sendJson(res, 404, { error: 'Document not found' });
      const collectionsConfig = getCollectionsConfig(db);
      let notLive = false;
      try {
        notLive = await pageNotLive(ws, doc.id, outputPaths(doc, collectionsConfig).html, { git, collectionsConfig });
      } catch { /* not a repo, or git failed: no hint */ }
      sendJson(res, 200, { notLive });
    });

    // Turn a component package on or off (npm in the site, then a commit of its package files).
    router.add('PUT', `${prefix}/components/:pkg`, async (req, res) => {
      try {
        const state = await setComponent({
          ws, db, pkg: req.params.pkg, enabled: req.body?.enabled,
          deps: {
            runNpm: siteProcess.runNpm, gitStatus: git.gitStatus, hasHead: git.hasHead,
            changedSinceHead: git.changedSinceHead, commitPaths: git.commitPaths,
            backup, writes, vpRoot: roots.vpRoot, catalog: roots.catalog,
          },
        });
        sendJson(res, 200, state);
      } catch (err) {
        if (err instanceof ComponentError) return sendJson(res, err.status, err.body);
        if (err?.name?.startsWith('Git')) return sendJson(res, 502, { error: err.message });
        console.error('Components error:', err);
        sendJson(res, 500, { error: err.message });
      }
    });

    router.add('GET', `${prefix}/info`, async (req, res) => sendJson(res, 200, { siteUrl: await readSiteUrl(ws.siteDir) }));
    router.add('GET', `${prefix}/status`, async (req, res) => { await backup.init(); sendJson(res, 200, backup.state()); });
    router.add('POST', `${prefix}/backup`, async (req, res) => sendJson(res, 200, await backup.flush()));

    router.add('GET', `${prefix}/documents/:id/live`, async (req, res) => {
      const doc = getDocument(db, req.params.id);
      if (!doc) return sendJson(res, 404, { error: 'Document not found' });
      if (doc.meta.status !== 'published') return sendJson(res, 200, { live: false, url: null });
      // The page the last publish/update built (dist may have been rebuilt since by
      // Preview, from edits that are not live); without one (an earlier run), dist.
      const snapshot = expected.get(doc.id);
      const collectionsConfig = getCollectionsConfig(db);
      const url = snapshot?.url || publicUrl(await readSiteUrl(ws.siteDir), doc, collectionsConfig);
      const expectedText = snapshot ? snapshot.text : builtPage(ws.siteDir, doc, collectionsConfig);
      const live = Boolean(url && expectedText !== null) &&
        await checkLive({ url, expectedText, fetch: fetchImpl });
      sendJson(res, 200, { live, url });
    });
  }

  const app = createRouter();

  mountServiceRoutes(app, { env, imageSearch, fetch: fetchImpl });

  app.add('GET', '/api/sites', async (req, res) => {
    const sites = await Promise.all(listSites({ env }).map(async (site) => {
      let status = { hasRemote: false, hasUpstream: false, branch: null };
      try { status = await git.gitStatus(site.path); } catch { /* missing folder: not connected */ }
      const counts = status.hasUpstream ? await git.aheadBehind(site.path).catch(() => null) : null;
      const lastBackupAt = status.hasUpstream ? await git.lastVpCommitAt(site.path).catch(() => null) : null;
      const siteUrl = await readSiteUrl(site.path).catch(() => null);
      return {
        ...site,
        siteUrl,
        git: {
          connected: Boolean(status.hasRemote && status.hasUpstream),
          branch: status.branch ?? null,
          ahead: counts ? counts.ahead : null,
          behind: counts ? counts.behind : null,
          lastBackupAt,
        },
      };
    }));
    sendJson(res, 200, sites);
  });

  app.add('POST', '/api/sites', (req, res) => {
    const { path, name } = req.body || {};
    if (!path) return sendJson(res, 422, { error: 'path is required' });
    try {
      sendJson(res, 201, addSite({ path, name }, { env }));
    } catch (err) {
      sendJson(res, 422, { error: err.message });
    }
  });

  app.add('POST', '/api/sites/clone', async (req, res) => {
    const { url, dest, name } = req.body || {};
    if (!url || !dest) return sendJson(res, 422, { error: 'url and dest are required' });
    try {
      await git.cloneRepo(url, dest);
      sendJson(res, 201, addSite({ path: dest, name }, { env }));
    } catch (err) {
      sendJson(res, 422, { error: err.message });
    }
  });

  app.add('DELETE', '/api/sites/:siteId', async (req, res) => {
    const { siteId } = req.params;
    removeSite(siteId, { env }); // first, so no new request reopens it
    vbCache.delete(siteId);
    previews.stop?.(siteId)?.catch?.(() => {});
    closeLayoutPreview(siteId).catch(() => {});
    await closeSite(siteId, { flush: true });
    sendJson(res, 200, { ok: true });
  });

  app.add('POST', '/api/sites/:siteId/preview', async (req, res) => {
    const site = getSite(req.params.siteId, { env });
    if (!site) return sendJson(res, 404, { error: 'Unknown site' });
    try {
      const { url } = await previews.start(site);
      vbCache.delete(site.id); // a preview build may have vendored the site's VB copy
      sendJson(res, 200, { url });
    } catch (err) {
      sendJson(res, 502, { error: err.message });
    }
  });

  app.add('GET', '/api/folders', (req, res) => {
    try {
      sendJson(res, 200, listFolders(req.query.path || homedir()));
    } catch (err) {
      sendJson(res, 422, { error: err.code === 'ENOENT' || err.code === 'ENOTDIR' ? `Not a folder: ${req.query.path}` : err.message });
    }
  });

  async function handleSite(req, res, pathname) {
    const match = pathname.match(SITE_PATH);
    let id;
    try { id = decodeURIComponent(match[1]); } catch { id = null; }
    const site = id && getSite(id, { env });
    if (!site) return sendJson(res, 404, { error: 'Unknown site' });
    let entry;
    try {
      entry = await getOpen(site);
    } catch (err) {
      return sendJson(res, 422, { error: `Cannot open site: ${err.message}` });
    }
    const handle = () => entry.router.handle(req, res);
    const handled = isQueuedWrite(req.method, pathname) ? await entry.writes(handle) : await handle();
    if (!handled) sendJson(res, 404, { error: 'Not found' });
  }

  /** Serve `/sites/<id>/media/<file>` from that site's `src/media`; false when not served. */
  function serveSiteMedia(req, res, pathname) {
    const match = pathname.match(SITE_MEDIA_PATH);
    let id;
    try { id = decodeURIComponent(match[1]); } catch { return false; }
    const site = getSite(id, { env });
    if (!site) return false;
    return serveStatic(req, res, [{ prefix: `/sites/${id}/media/`, dir: join(site.path, 'src', 'media') }],
      { headers: MEDIA_HEADERS });
  }

  /**
   * Serve `/sites/<id>/components/<pkg>/<path>` from where that catalog package is
   * installed (the site's copy first, else VP's); false when not served.
   */
  function serveSiteComponent(req, res, pathname) {
    let decoded;
    try { decoded = decodeURIComponent(pathname); } catch { return false; }
    const match = decoded.match(SITE_COMPONENTS_PATH);
    if (!match) return false;
    const id = match[1];
    const site = getSite(id, { env });
    if (!site) return false;
    const rest = decoded.slice(match[0].length);
    const entry = catalog.find((e) => rest.startsWith(`${e.package}/`));
    if (!entry) return false;
    const found = packageDir(entry.package, { siteDir: site.path, vpRoot });
    if (!found) return false;
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return serveStatic(req, res, [{ prefix: `${match[0]}${entry.package}/`, dir: found.dir }]);
  }

  /**
   * Serve `/sites/<id>/site/<path>` (GET/HEAD) from the site's `src/`, only
   * VB's own files in its VB copy's folder (vanilla-breeze.*, themes/, fonts/)
   * and assets/themes/, only asset types, never a dotfile, and
   * only when the real path (symlinks resolved) is still there; false when not served.
   */
  /** Where each site's VB copy is: siteId -> { path, vb }; dropped when a build may have moved it. */
  const vbCache = new Map();
  /** The site's VB copy (findSiteVb), cached while its file is still there; no copy is not cached. */
  function siteVb(site) {
    const hit = vbCache.get(site.id);
    if (hit && hit.path === site.path && existsSync(join(site.path, 'src', hit.vb.url))) return hit.vb;
    const vb = findSiteVb(site.path);
    if (vb) vbCache.set(site.id, { path: site.path, vb });
    else vbCache.delete(site.id);
    return vb;
  }

  function serveSiteFiles(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    const match = pathname.match(SITE_FILES_PATH);
    let id;
    let rel;
    try {
      id = decodeURIComponent(match[1]);
      rel = decodeURIComponent(pathname.slice(match[0].length));
    } catch { return false; }
    const parts = rel.split('/');
    if (parts.some((p) => !p || p.startsWith('.') || /[\\:\u0000-\u001f\u007f]/.test(p))) return false;
    if (!SITE_FILE_TYPES.has(extname(rel).toLowerCase())) return false;
    const site = getSite(id, { env });
    if (!site) return false;
    const vb = siteVb(site);
    const vbDir = vb ? posix.dirname(vb.url).slice(1) : null;
    const vbPrefix = vbDir ? `${vbDir}/` : '';
    const allowed = (p) => {
      if (p.startsWith(`${CUSTOM_THEMES_DIR}/`)) return true;
      if (vbDir === null || !p.startsWith(vbPrefix)) return false;
      const inVb = p.slice(vbPrefix.length);
      return (!inVb.includes('/') && VB_OWN_FILE.test(inVb)) || VB_SUBFOLDERS.some((d) => inVb.startsWith(`${d}/`));
    };
    if (!allowed(rel)) return false;
    let real;
    try {
      const srcReal = realpathSync.native(join(site.path, 'src'));
      const fileReal = realpathSync.native(join(srcReal, ...parts));
      const inside = relative(srcReal, fileReal);
      if (!inside || isAbsolute(inside) || inside.split(sep).some((p) => p === '..' || p.startsWith('.'))) return false;
      if (!allowed(inside.split(sep).join('/')) || !statSync(fileReal).isFile()) return false;
      real = fileReal;
    } catch { return false; }
    return serveFile(res, real, { req, headers: MEDIA_HEADERS });
  }

  const server = createServer(async (req, res) => {
    try {
      if (refuseForeign(req, res, server.address().port)) return;
      const pathname = new URL(req.url, 'http://local').pathname;
      if (await app.handle(req, res)) return;
      if (SITE_PATH.test(pathname)) return await handleSite(req, res, pathname);
      if (pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Not found' });

      if (pathname === '/') {
        if (serveFile(res, join(ROOT, 'app', 'index.html'))) return;
      } else if (pathname === '/app' || pathname === '/editor') {
        res.writeHead(302, { Location: `${pathname}/` });
        return res.end();
      } else if (SITE_MEDIA_PATH.test(pathname)) {
        if (serveSiteMedia(req, res, pathname)) return;
      } else if (SITE_COMPONENTS_PATH.test(pathname)) {
        if (serveSiteComponent(req, res, pathname)) return;
      } else if (SITE_FILES_PATH.test(pathname)) {
        if (serveSiteFiles(req, res, pathname)) return;
      } else if (serveStatic(req, res, STATIC_MOUNTS)) {
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    } catch (err) {
      if (!res.headersSent) {
        const status = err.message === 'Invalid JSON body' ? 400 : 500;
        if (status === 500) console.error('App server error:', err);
        sendJson(res, status, { error: err.message });
      }
    }
  });

  /** The program server's origin, once it is up (it binds after the app server). */
  let programsUrl = null;
  const bound = await listen(server, port);

  // The program server (R1): up before startApp returns, so programsUrl is known when sites mount
  // routes. Its own origin; any registered site works, not only opened ones.
  let programs;
  try {
    programs = await startProgramServer({
      port: port === 0 ? 0 : bound + 1,
      resolveSite: (siteId) => {
        const site = getSite(siteId, { env });
        return site ? { siteDir: site.path } : null;
      },
    });
  } catch (err) {
    await new Promise((resolve) => { server.close(() => resolve()); });
    throw err;
  }
  programsUrl = programs.url;

  // However the process ends (a second Ctrl-C, process.exit, a crash), no detached preview survives it.
  const killPreviews = () => {
    previews.killAllSync?.();
    for (const p of layoutPreviews.values()) p.killSync();
  };
  process.on('exit', killPreviews);

  async function close() {
    await Promise.all([
      new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
      programs.close(),
    ]);
    await Promise.all([...new Set([...open.keys(), ...opening.keys()])].map((id) => closeSite(id)));
    await Promise.all([previews.stopAll(), ...[...layoutPreviews.keys()].map(closeLayoutPreview)]);
    process.off('exit', killPreviews); // only once every preview is down
  }

  async function shutdown() {
    await Promise.all([...open.values()].map((entry) => entry.backup.flush()));
    await close();
  }

  /**
   * The GET-capable route tables, for the test that audits them: the app router's, and
   * the (opened) site router's for a site id. Read-only `{ method, pattern }` lists.
   */
  async function routeTables(siteId) {
    const site = getSite(siteId, { env });
    return { app: app.routes(), site: site ? (await getOpen(site)).router.routes() : [] };
  }

  return { server, port: bound, url: `http://${HOST}:${bound}`, programsUrl, close, shutdown, routeTables };
}
