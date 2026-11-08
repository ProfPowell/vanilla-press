/**
 * The Theme screen's routes on a site's router: its state, the custom theme
 * library, Apply and the live check. Library writes take the backup's git
 * queue and then the write lock (so they wait for a running publish or
 * Apply) and are committed at once, pushed like a backup. Every response is JSON; `dropped` and
 * `skipped` are raw text from the user's CSS, for the client to show as text.
 *
 * @module app/theme-routes
 */

import { join } from 'node:path';
import { sendJson } from '../server/router.js';
import { skippedTokens } from '../themes/theme-css.js';
import { GitConflictError, GitStashConflictError, readHead as gitReadHead } from '../git/git.js';
import {
  themeState, saveCustomTheme, importCustomTheme, renameCustomTheme, deleteCustomTheme, readSetting, commitWithTheme,
  ThemeError,
} from './site-theme.js';
import { applyTheme, liveThemeIds, htmlThemeAttr, THEME_CHANGED } from './theme-apply.js';
import { libraryMessage } from './site-git.js';
import { BuildError, readSiteUrl } from './publish.js';

const NOT_COMMITTED = (why) => `Saved on this computer, but not committed (${why}). It goes to GitHub with the next Apply or Publish.`;

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

  /**
   * Commit a library change at once (config/theme.json, the theme's file or its
   * removal, and vp.json when this is theme.json's first commit). Without a repo,
   * or when git fails, the files stay on disk and the response says so.
   */
  async function commitLibrary(id, what) {
    try {
      const status = await deps.gitStatus(ws.siteDir);
      if (!status.isRepo) return { committed: false, note: NOT_COMMITTED('this site folder is not a git repository') };
      const paths = ['config/theme.json', ...(id ? [`src/assets/themes/${id}.css`] : [])];
      const sha = await commitWithTheme(ws, deps.readHead || gitReadHead,
        (dropped) => deps.commitPaths(ws.siteDir, dropped ? [...paths, 'config/vp.json'] : paths, libraryMessage(what)));
      return { committed: true, sha };
    } catch (err) {
      return { committed: false, note: NOT_COMMITTED(err.message) };
    }
  }

  /**
   * A library route: in the backup's git queue, then the write lock (the order Apply and
   * Publish take them), run the change and commit it; pushed like a backup.
   * `run` resolves to `{ send, id, what }`: the JSON to send, the custom theme id whose
   * file changed (null for a rename), and the commit message text.
   */
  const library = (status, run) => handle(async (req, res) => {
    const out = await backup.commitLater(() => writes(async () => {
      const { send, id, what } = await run(req);
      return { send, ...(await commitLibrary(id, what)) };
    }));
    sendJson(res, status, { ...out.send, committed: out.committed, ...(out.note ? { note: out.note } : {}) });
  });

  router.add('POST', `${prefix}/theme/custom`, library(201, (req) => {
    const { name, base, tokens } = body(req);
    const theme = saveCustomTheme(ws, { name, base, tokens }, options);
    return { send: { theme, skipped: skippedTokens(tokens) }, id: theme.id, what: `save ${theme.name}` };
  }));

  router.add('POST', `${prefix}/theme/import`, library(201, (req) => {
    const { name, css } = body(req);
    const out = importCustomTheme(ws, { name, css }, options);
    return { send: out, id: out.theme.id, what: `import ${out.theme.name}` };
  }));

  router.add('PATCH', `${prefix}/theme/custom/:id`, library(200, (req) => {
    const theme = renameCustomTheme(ws, req.params.id, body(req).name, options);
    return { send: { theme }, id: null, what: `rename ${theme.id} to ${theme.name}` };
  }));

  // Apply to site: like Update, it waits for document writes and runs in the backup's git queue.
  router.add('POST', `${prefix}/theme/apply`, async (req, res) => {
    const { name, mode, adjustments } = body(req);
    try {
      const result = await backup.exclusive(() => writes(() => applyTheme({
        ws, db, body: { name, mode, adjustments }, deps, options,
      })));
      onBuilt();
      // GitHub's theme won (another computer applied meanwhile): it is the setting now.
      if (result.themeChanged) return sendJson(res, 409, { error: THEME_CHANGED });
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

  // R15: live when the home page answers 200 and its <html data-theme> is what Cook writes
  // there: the applied setting read from disk each time (R2), or the committed home
  // page's own page theme (M4).
  router.add('GET', `${prefix}/theme/live`, handle(async (req, res) => {
    const siteUrl = await readSiteUrl(ws.siteDir);
    const url = siteUrl ? `${siteUrl.replace(/\/+$/, '')}/` : null;
    const home = await (deps.readHead || gitReadHead)(ws.siteDir, 'src/index.html').catch(() => null);
    const ids = liveThemeIds(readSetting(ws), home);
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

  router.add('DELETE', `${prefix}/theme/custom/:id`, library(200, async (req) => {
    await deleteCustomTheme(ws, db, req.params.id, deps.git ? { git: deps.git } : {});
    return { send: { ok: true }, id: req.params.id, what: `delete ${req.params.id}` };
  }));
}
