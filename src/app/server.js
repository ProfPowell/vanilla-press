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
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listSites, getSite, addSite, removeSite, listFolders } from './registry.js';
import { createPreviews } from './preview.js';
import * as defaultGit from '../git/git.js';
import { GitConflictError, GitStashConflictError } from '../git/git.js';
import * as defaultSiteProcess from './site-process.js';
import { createBackup } from './site-git.js';
import {
  setPublished, BuildError, PublishRejectedError, checkLive, readSiteUrl, publicUrl, builtPage,
} from './publish.js';
import { getDocument } from '../store/content.js';
import { getCollectionsConfig } from '../sync/site-files.js';
import { resolveWorkspace, openWorkspaceDb } from '../workspace/workspace.js';
import { syncFromSite } from '../sync/from-site.js';
import { createRouter, sendJson } from '../server/router.js';
import { mountApi } from '../server/api.js';
import { serveStatic, serveFile } from '../server/static.js';
import { refuseForeign } from '../server/guard.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOST = '127.0.0.1';
const PORT_ATTEMPTS = 20;
const SITE_PATH = /^\/api\/sites\/([^/]+)(?:\/|$)/;

const STATIC_MOUNTS = [
  { prefix: '/app/', dir: join(ROOT, 'app') },
  { prefix: '/editor/', dir: join(ROOT, 'editor') },
  { prefix: '/src/', dir: join(ROOT, 'src') },
  { prefix: '/assets/vb/', dir: join(ROOT, 'node_modules', 'vanilla-breeze', 'dist', 'cdn') },
  { prefix: '/assets/code-block/', dir: join(ROOT, 'node_modules', '@profpowell', 'code-block', 'dist') },
];

/**
 * Listen on `HOST`, trying `port`, `port+1`, ... (port 0: the OS picks, no fallback).
 * @param {import('node:http').Server} server
 * @param {number} port
 * @returns {Promise<number>} the bound port
 */
async function listen(server, port) {
  const attempts = port === 0 ? 1 : PORT_ATTEMPTS;
  for (let i = 0; i < attempts; i++) {
    try {
      await new Promise((resolve, reject) => {
        const onError = (err) => { server.off('listening', onListening); reject(err); };
        const onListening = () => { server.off('error', onError); resolve(); };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port + i, HOST);
      });
      return server.address().port;
    } catch (err) {
      if (err.code !== 'EADDRINUSE' || i === attempts - 1) throw err;
    }
  }
  throw new Error('unreachable');
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
 * }} [options] - git and siteProcess override the real functions one by one (for tests);
 *   backup injects the draft-backup timers; fetch is used by the live check.
 * @returns {Promise<{ server: import('node:http').Server, port: number, url: string,
 *   close: () => Promise<void>, shutdown: () => Promise<void> }>} shutdown: for quitting the
 *   app (the CLI registers it for SIGINT/SIGTERM): flushes every open site's backup, then
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
} = {}) {
  // Looked up on each use, so a caller can swap a function after start (tests do).
  const git = new Proxy({}, { get: (_, key) => gitOverrides[key] ?? defaultGit[key] });
  const siteProcess = new Proxy({}, { get: (_, key) => siteProcessOverrides[key] ?? defaultSiteProcess[key] });
  /** Open sites, cached for the life of the server: id -> { db, router, ws, backup } */
  const open = new Map();

  function openSite(site) {
    const ws = resolveWorkspace({ site: site.path, env: {}, repoRoot: ROOT });
    const db = openWorkspaceDb(ws);
    try {
      syncFromSite(ws, db);
      const backup = createBackup({
        site, ws, git, getCollectionsConfig: () => getCollectionsConfig(db), ...backupTimers,
      });
      const prefix = `/api/sites/${site.id}`;
      const router = createRouter();
      mountApi(router, db, {
        rootDir: ROOT, mediaDir: ws.mediaDir, workspace: ws, prefix,
        onSynced: ({ title, status }) => backup.noteSaved({ title, status }),
      });
      mountSiteGit(router, prefix, { site, ws, db, backup });
      const entry = { ws, db, router, backup };
      open.set(site.id, entry);
      return entry;
    } catch (err) {
      db.close();
      throw err;
    }
  }

  function closeSite(id) {
    const entry = open.get(id);
    if (!entry) return;
    open.delete(id);
    entry.backup.dispose();
    entry.db.close();
  }

  /** Publish, unpublish, backup status, live check: `<prefix>/...` on a site's router. */
  function mountSiteGit(router, prefix, { site, ws, db, backup }) {
    const publishRoute = (publish) => async (req, res) => {
      try {
        const result = await backup.exclusive(() => setPublished({
          site, ws, db, docId: req.params.id, publish,
          deps: {
            ensureInstalled: siteProcess.ensureInstalled, runBuild: siteProcess.runBuild,
            commitPaths: git.commitPaths, push: git.push, gitStatus: git.gitStatus,
            collectionsConfig: getCollectionsConfig(db),
          },
        }));
        sendJson(res, 200, { status: result.status, url: result.url });
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
    router.add('POST', `${prefix}/documents/:id/publish`, publishRoute(true));
    router.add('POST', `${prefix}/documents/:id/unpublish`, publishRoute(false));

    router.add('GET', `${prefix}/info`, async (req, res) => sendJson(res, 200, { siteUrl: await readSiteUrl(ws.siteDir) }));
    router.add('GET', `${prefix}/status`, (req, res) => sendJson(res, 200, backup.state()));
    router.add('POST', `${prefix}/backup`, async (req, res) => sendJson(res, 200, await backup.flush()));

    router.add('GET', `${prefix}/documents/:id/live`, async (req, res) => {
      const doc = getDocument(db, req.params.id);
      if (!doc) return sendJson(res, 404, { error: 'Document not found' });
      if (doc.meta.status !== 'published') return sendJson(res, 200, { live: false, url: null });
      const collectionsConfig = getCollectionsConfig(db);
      const url = publicUrl(await readSiteUrl(ws.siteDir), doc, collectionsConfig);
      const expectedText = builtPage(ws.siteDir, doc, collectionsConfig);
      const live = Boolean(url && expectedText !== null) &&
        await checkLive({ url, expectedText, fetch: fetchImpl });
      sendJson(res, 200, { live, url });
    });
  }

  const app = createRouter();

  app.add('GET', '/api/sites', async (req, res) => {
    const sites = await Promise.all(listSites({ env }).map(async (site) => {
      let status = { hasRemote: false, hasUpstream: false, branch: null };
      try { status = await git.gitStatus(site.path); } catch { /* missing folder: not connected */ }
      return { ...site, git: { connected: Boolean(status.hasRemote && status.hasUpstream), branch: status.branch ?? null } };
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

  app.add('DELETE', '/api/sites/:siteId', (req, res) => {
    const { siteId } = req.params;
    closeSite(siteId);
    previews.stop?.(siteId)?.catch?.(() => {});
    removeSite(siteId, { env });
    sendJson(res, 200, { ok: true });
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
    let entry = open.get(site.id);
    if (!entry) {
      try {
        entry = openSite(site);
      } catch (err) {
        return sendJson(res, 422, { error: `Cannot open site: ${err.message}` });
      }
    }
    if (!(await entry.router.handle(req, res))) sendJson(res, 404, { error: 'Not found' });
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

  const bound = await listen(server, port);

  async function close() {
    await new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections?.();
    });
    for (const id of [...open.keys()]) closeSite(id);
    await previews.stopAll();
  }

  async function shutdown() {
    await Promise.all([...open.values()].map((entry) => entry.backup.flush()));
    await close();
  }

  return { server, port: bound, url: `http://${HOST}:${bound}`, close, shutdown };
}
