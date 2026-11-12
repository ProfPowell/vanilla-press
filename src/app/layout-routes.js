/**
 * @file layout-routes.js
 * @description The layout editor's routes on a site's router: list, read, save,
 * create (new, built on, copy) and delete layouts and include fragments. A
 * name or kind is validated in layout-store.js and is the only path input.
 * Writes run inside the site's document write lock.
 */

import { sendJson } from '../server/router.js';
import {
  listLayoutFiles, readLayoutFile, saveLayoutFile, createLayoutFile, deleteLayoutFile, LayoutError,
} from './layout-store.js';

/**
 * @param {{ add: Function }} router
 * @param {string} prefix - `/api/sites/<id>`
 * @param {{ ws: { siteDir: string }, writes: (fn: Function) => Promise<any> }} context
 */
export function mountLayoutRoutes(router, prefix, { ws, writes }) {
  const body = (req) => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});

  const handle = (fn, { write = false } = {}) => async (req, res) => {
    try {
      const run = () => fn(req, res);
      await (write ? writes(run) : run());
    } catch (err) {
      if (err instanceof LayoutError) return sendJson(res, err.status, { error: err.message, ...err.body });
      console.error('Layout error:', err);
      sendJson(res, 500, { error: err.message });
    }
  };

  router.add('GET', `${prefix}/layout-files`, handle(async (req, res) => {
    sendJson(res, 200, await listLayoutFiles(ws.siteDir));
  }));

  router.add('GET', `${prefix}/layout-files/:kind/:name`, handle(async (req, res) => {
    sendJson(res, 200, await readLayoutFile(ws.siteDir, req.params.kind, req.params.name));
  }));

  router.add('PUT', `${prefix}/layout-files/:kind/:name`, handle(async (req, res) => {
    const { tree, hash = null } = body(req);
    sendJson(res, 200, await saveLayoutFile(ws.siteDir, req.params.kind, req.params.name, { tree, hash }));
  }, { write: true }));

  router.add('POST', `${prefix}/layout-files`, handle(async (req, res) => {
    const { kind, name, label, start } = body(req);
    sendJson(res, 201, await createLayoutFile(ws.siteDir, { kind, name, label, start }));
  }, { write: true }));

  router.add('DELETE', `${prefix}/layout-files/:kind/:name`, handle(async (req, res) => {
    await deleteLayoutFile(ws.siteDir, req.params.kind, req.params.name);
    sendJson(res, 200, { deleted: true });
  }, { write: true }));
}
