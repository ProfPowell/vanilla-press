/**
 * The Theme screen's routes on a site's router: its state and the custom
 * theme library. Library writes are queued writes (server.js isQueuedWrite):
 * they wait for a running publish. Every response is JSON; `dropped` and
 * `skipped` are raw text from the user's CSS, for the client to show as text.
 *
 * @module app/theme-routes
 */

import { join } from 'node:path';
import { sendJson } from '../server/router.js';
import { skippedTokens } from '../themes/theme-css.js';
import { settingIds } from '../themes/theme-setting.js';
import { GitConflictError, GitStashConflictError } from '../git/git.js';
import {
  themeState, saveCustomTheme, importCustomTheme, renameCustomTheme, deleteCustomTheme, readSetting, ThemeError,
} from './site-theme.js';
import { applyTheme, htmlThemeAttr } from './theme-apply.js';
import { BuildError, readSiteUrl } from './publish.js';

/**
 * @param {{ add: Function }} router
 * @param {string} prefix - `/api/sites/<id>`
 * @param {{ site: { id: string }, ws: object, db: object, backup?: object, writes?: Function,
 *   deps?: { git?: object, ensureInstalled?: Function, runBuild?: Function, commitPaths?: Function,
 *     push?: Function, gitStatus?: Function, readHead?: Function },
 *   vpRoot: string, fetch?: typeof fetch, onBuilt?: () => void }} context - deps.git
 *   (headCommit, headTree, readBlobs) checks committed HEAD before a delete; backup, writes,
 *   the rest of deps and fetch are for Apply and the live check; onBuilt runs after an
 *   Apply that reached its build (the site's VB copy may have been vendored).
 */
export function mountThemeRoutes(router, prefix, {
  site, ws, db, vpRoot, deps = {}, backup, writes, fetch: fetchImpl = globalThis.fetch, onBuilt = () => {},
}) {
  const options = { siteId: site.id, vpCdnDir: join(vpRoot, 'node_modules', 'vanilla-breeze', 'dist', 'cdn') };
  /** The ids the last Apply this run made live; else theme.json's (the applied state, R2). */
  let lastApplied = null;

  /** Run a handler, sending a ThemeError as its status and body. */
  const handle = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof ThemeError) return sendJson(res, err.status, { error: err.message, ...err.body });
      console.error('Theme error:', err);
      sendJson(res, 500, { error: err.message });
    }
  };
  const body = (req) => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});

  router.add('GET', `${prefix}/theme`, handle((req, res) => sendJson(res, 200, themeState(ws, db, options))));

  router.add('POST', `${prefix}/theme/custom`, handle((req, res) => {
    const { name, base, tokens } = body(req);
    const theme = saveCustomTheme(ws, { name, base, tokens }, options);
    sendJson(res, 201, { theme, skipped: skippedTokens(tokens) });
  }));

  router.add('POST', `${prefix}/theme/import`, handle((req, res) => {
    const { name, css } = body(req);
    sendJson(res, 201, importCustomTheme(ws, { name, css }, options));
  }));

  router.add('PATCH', `${prefix}/theme/custom/:id`, handle((req, res) => {
    sendJson(res, 200, { theme: renameCustomTheme(ws, req.params.id, body(req).name, options) });
  }));

  // Apply to site: like Update, it waits for document writes and runs in the backup's git queue.
  router.add('POST', `${prefix}/theme/apply`, async (req, res) => {
    const { name, mode, adjustments } = body(req);
    try {
      const result = await backup.exclusive(() => writes(() => applyTheme({
        ws, db, body: { name, mode, adjustments }, deps, options,
      })));
      lastApplied = result.ids;
      onBuilt();
      sendJson(res, 200, { status: result.status, url: result.url, ids: result.ids });
    } catch (err) {
      if (err instanceof ThemeError) return sendJson(res, err.status, { error: err.message, ...err.body });
      if (err instanceof BuildError) {
        onBuilt();
        return sendJson(res, 422, { error: 'Build failed', log: err.log });
      }
      if (err instanceof GitConflictError || err instanceof GitStashConflictError) {
        onBuilt();
        return sendJson(res, 409, { error: err.message, files: err.files });
      }
      if (err?.name?.startsWith('Git')) return sendJson(res, 502, { error: err.message });
      console.error('Apply theme error:', err);
      sendJson(res, 500, { error: err.message });
    }
  });

  // R15: live when the home page answers 200 and its <html data-theme> is the applied ids.
  router.add('GET', `${prefix}/theme/live`, handle(async (req, res) => {
    const siteUrl = await readSiteUrl(ws.siteDir);
    const url = siteUrl ? `${siteUrl.replace(/\/+$/, '')}/` : null;
    const ids = lastApplied ?? settingIds(readSetting(ws));
    let live = false;
    if (url && ids) {
      try {
        const page = await fetchImpl(url, { cache: 'no-store', redirect: 'follow' });
        live = page.status === 200 && htmlThemeAttr(await page.text()) === ids;
      } catch {
        live = false;
      }
    }
    sendJson(res, 200, { live, url });
  }));

  router.add('DELETE', `${prefix}/theme/custom/:id`, handle(async (req, res) => {
    await deleteCustomTheme(ws, db, req.params.id, deps.git ? { git: deps.git } : {});
    sendJson(res, 200, { ok: true });
  }));
}
