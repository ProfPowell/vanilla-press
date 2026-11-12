/**
 * @file layout-routes.js
 * @description The layout editor's routes on a site's router: list, read, save,
 * create (new, built on, copy) and delete layouts and include fragments. A
 * name or kind is validated in layout-store.js and is the only path input.
 * Writes run inside the site's document write lock. The preview route renders
 * unsaved sources in a working copy outside the site (layout-preview.js).
 */

import { sendJson } from '../server/router.js';
import {
  listLayoutFiles, readLayoutFile, saveLayoutFile, createLayoutFile, deleteLayoutFile, publishLayouts, layoutContext, LayoutError,
} from './layout-store.js';
import { GitConflictError, GitStashConflictError } from '../git/git.js';
import { getDocument, getCollections } from '../store/content.js';
import { getCollectionsConfig } from '../sync/site-files.js';
import { collectionOutput } from '../sync/paths.js';
import { mediaAltLookup } from '../media/alt-lookup.js';

const isRecord = (v) => v == null || (typeof v === 'object' && !Array.isArray(v));

/**
 * @param {{ add: Function }} router
 * @param {string} prefix - `/api/sites/<id>`
 * @param {{ ws: { siteDir: string }, writes: (fn: Function) => Promise<any>, backup?: object, deps?: object,
 *   db?: object, preview?: () => ReturnType<typeof import('./layout-preview.js').createLayoutPreview>,
 *   components?: () => { components: object, layoutElements: object } }} context -
 *   preview: the site's layout preview, created on first use; components: what the inspector knows
 *   about components and VB's layout elements (components.js layoutComponents)
 */
export function mountLayoutRoutes(router, prefix, { ws, writes, backup, deps, db, preview, components }) {
  const body = (req) => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});

  const handle = (fn, { write = false } = {}) => async (req, res) => {
    try {
      const run = () => fn(req, res);
      await (write ? writes(run) : run());
    } catch (err) {
      if (err instanceof LayoutError) return sendJson(res, err.status, { error: err.message, ...err.body });
      if (err instanceof GitConflictError || err instanceof GitStashConflictError) {
        return sendJson(res, 409, { error: err.message, files: err.files });
      }
      if (err?.name?.startsWith('Git')) return sendJson(res, 502, { error: err.message });
      console.error('Layout error:', err);
      sendJson(res, 500, { error: err.message });
    }
  };

  router.add('GET', `${prefix}/layout-files`, handle(async (req, res) => {
    sendJson(res, 200, await listLayoutFiles(ws.siteDir));
  }));

  // The inspector's context: fields, lists, document fields, components and layout elements
  router.add('GET', `${prefix}/layout-files/context`, handle(async (req, res) => {
    const collections = db ? [...new Set([...getCollections(db), ...Object.keys(getCollectionsConfig(db))])] : [];
    const out = await layoutContext(ws.siteDir, { collections });
    sendJson(res, 200, { ...out, ...(components ? components() : { components: {}, layoutElements: {} }) });
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

  // Publish layout: commit the unpublished layout files VP can see (or just those named) and push.
  // Lock order as Theme Apply: the backup's git queue, then the write lock (inside publishLayouts).
  router.add('POST', `${prefix}/layout-files/publish`, handle(async (req, res) => {
    const { files = [] } = body(req);
    const out = await publishLayouts(ws, { backup, deps, names: files, writes });
    if (out.pushError) return sendJson(res, 502, { error: out.pushError, committed: true, sha: out.sha });
    sendJson(res, 200, { status: out.status, sha: out.sha, files: out.files });
  }));

  // Preview unsaved layout and include sources (with a document draft, or a sample page).
  // A failed build is { ok: false, log } with 200: the pane shows the log, the editor carries on.
  router.add('POST', `${prefix}/layout-preview`, handle(async (req, res) => {
    if (!preview) return sendJson(res, 404, { error: 'Layout preview is not available' });
    const { layouts = {}, includes = {}, docId = null, layout = null } = body(req);
    if (!isRecord(layouts) || !isRecord(includes)) return sendJson(res, 422, { error: 'layouts and includes must be objects' });
    let doc = null;
    let mediaAlt;
    if (docId != null) {
      doc = db && typeof docId === 'string' ? getDocument(db, docId) : null;
      if (!doc) return sendJson(res, 404, { error: 'Document not found' });
      mediaAlt = mediaAltLookup(db);
    }
    const effective = layout || (doc && (doc.meta.layout || collectionOutput(doc.meta.collection, getCollectionsConfig(db)).layout));
    if (typeof effective !== 'string' || !effective) return sendJson(res, 422, { error: 'layout is required' });
    sendJson(res, 200, await preview().render({ layouts: layouts || {}, includes: includes || {}, doc, layout: effective, mediaAlt }));
  }));
}
