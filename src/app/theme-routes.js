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
import {
  themeState, saveCustomTheme, importCustomTheme, renameCustomTheme, deleteCustomTheme, ThemeError,
} from './site-theme.js';

/**
 * @param {{ add: Function }} router
 * @param {string} prefix - `/api/sites/<id>`
 * @param {{ site: { id: string }, ws: object, db: object, backup?: object, writes?: Function,
 *   deps?: object, vpRoot: string, fetch?: typeof fetch }} context - backup, writes, deps and
 *   fetch are for Apply and the live check.
 */
export function mountThemeRoutes(router, prefix, { site, ws, db, vpRoot }) {
  const options = { siteId: site.id, vpCdnDir: join(vpRoot, 'node_modules', 'vanilla-breeze', 'dist', 'cdn') };

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

  router.add('DELETE', `${prefix}/theme/custom/:id`, handle((req, res) => {
    deleteCustomTheme(ws, db, req.params.id);
    sendJson(res, 200, { ok: true });
  }));
}
