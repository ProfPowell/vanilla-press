/**
 * API route handlers for Vanilla Press dev server.
 *
 * Each handler wraps a store function, parsing request params/body
 * and returning JSON responses.
 *
 * @module server/api
 */

import crypto from 'node:crypto';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';
import {
  getDocument,
  listCollection,
  saveDocument,
  deleteDocument,
  searchDocuments,
  getCollections,
  getAllPublished,
} from '../store/content.js';
import { validate } from '../schema/validate.js';
import { normalizeComponents } from '../components/normalize.js';
import { syncDocument, unsyncDocument, SyncConflictError } from '../sync/to-site.js';
import { reloadFromSite } from '../sync/from-site.js';
import {
  getCollectionsConfig, preflightSave, writeMediaJson, writeVpConfig, syncAll,
} from '../sync/site-files.js';
import { writeFileAtomic } from '../sync/atomic-write.js';
import { isMissing } from '../sync/media-library.js';
import { inspectFile } from '../media/inspect.js';
import { mediaFilename, editedFilename, uniqueFilename } from '../media/names.js';
import { MAX_BYTES, LARGE_BYTES, tooLargeMessage, unsupportedMessage } from '../media/limits.js';
import { mediaUsage, mediaSrc } from '../media/usage.js';
import { kindOf } from '../media/types.js';
import { getConfig, setConfig, getAllConfig } from '../store/config.js';
import { listThemes } from '../themes/list-themes.js';
import { sendJson, readRawBody } from './router.js';

/** The notice for an attribute a save dropped. */
const droppedNotice = ({ tag, attr }) => `Removed "${attr}" from <${tag}>: this version of the component doesn't have it.`;

/**
 * Generate a document ID: doc_ + 8 random hex chars.
 * @returns {string}
 */
function generateId() {
  return 'doc_' + crypto.randomUUID().slice(0, 8);
}

/**
 * Mount all API routes on the router.
 * @param {Object} router - { add }
 * @param {import('better-sqlite3').Database} db
 * @param {Object} options
 * @param {string} options.rootDir - Project root directory
 * @param {string} options.mediaDir - Media upload directory
 * @param {import('../workspace/workspace.js').Workspace} [options.workspace] - Absent means fixture mode (sync disabled)
 * @param {string} [options.prefix='/api'] - URL prefix for every route
 * @param {(e: { docId: string|null, title: string, status: string }) => void} [options.onSynced] - Called after
 *   every successful sync (create, update, delete, reload), and once for POST /api/sync with
 *   `{ docId: null, title: 'all posts' }`. Never called in fixture mode.
 * @param {(e: { filename: string, action: 'upload'|'alt'|'delete' }) => void} [options.onMediaChanged] - Called after
 *   every media write (upload, alt edit, delete); a throwing listener never breaks the response.
 * @param {boolean} [options.statusByActions=false] - The app (Ruling P): a document save never
 *   changes `status` or `published` (PUT keeps the stored values; POST create stores a draft, or
 *   keeps an existing document's values); only Publish/Update/Unpublish change them. `vp serve`
 *   leaves this off and saves set status as before.
 * @param {() => Map<string, import('../components/describe.js').ComponentDescriptor>} [options.components] - The
 *   catalog's components, on or off (Ruling R12; publish checks which are on): POST/PUT of a document first drop the component
 *   attributes a descriptor does not declare, then validate against these descriptors, and the
 *   response adds `notices: string[]` for what was dropped, and `dropped: { tag, attr }[]` (the same, as data,
 *   for the editor to remove from its copy). Absent (`vp serve`): structural validation only.
 * @param {() => Object} [options.componentsState] - When given, `GET /api/components` answers its result.
 * @param {() => Promise<Map<string, Array<{ path: string, vpId: string|null }>>>} [options.liveMedia] - The
 *   media files the live site shows: file -> the pages committed in the site's git HEAD that show it
 *   (app/live-media.js). Those count as published uses (Used in, and DELETE refuses). Absent: none.
 */
export function mountApi(router, db, options) {
  const { rootDir, onSynced, statusByActions = false, components } = options;

  /**
   * Normalize (with `components`) and validate a candidate document.
   * @returns {{ doc: Object, result: { valid: boolean, errors: string[] }, notices?: string[],
   *   dropped?: Array<{ tag: string, attr: string }> }}
   */
  function checkDocument(doc) {
    if (!components) return { doc, result: validate(doc) };
    const index = components();
    const normalized = normalizeComponents(doc, index);
    return {
      doc: normalized.doc,
      result: validate(normalized.doc, { components: index }),
      notices: normalized.dropped.map(droppedNotice),
      dropped: normalized.dropped.map(({ tag, attr }) => ({ tag, attr })),
    };
  }
  /** The saved document, plus `notices` and `dropped` when components are checked. */
  const withNotices = (saved, notices, dropped) => (notices ? { ...saved, notices, dropped } : saved);

  /** With statusByActions: `meta` with `status`/`published` taken from `stored` (absent: a draft). */
  function keepStatus(meta, stored) {
    if (!statusByActions) return meta;
    const out = { ...meta, status: stored?.status || 'draft' };
    if (stored?.published) out.published = stored.published;
    else delete out.published;
    return out;
  }
  const prefix = (options.prefix ?? '/api').replace(/\/+$/, '');
  const route = { add: (method, pattern, handler) => router.add(method, prefix + pattern.slice('/api'.length), handler) };

  /** Report a successful sync; a throwing listener never breaks the response. */
  function synced(docId, meta = {}) {
    if (!onSynced) return;
    try {
      onSynced({ docId, title: meta.title, status: meta.status });
    } catch (err) {
      console.error('onSynced error:', err);
    }
  }
  const ws = options.workspace?.syncEnabled ? options.workspace : null;
  const mediaDir = ws ? ws.mediaDir : options.mediaDir;

  /**
   * Respond (and return true) when `candidate` must not be saved: 409 if the
   * stored version changed on disk, 422 if its sync would be rejected.
   */
  function rejectSave(res, candidate) {
    if (!ws) return false;
    const problem = preflightSave(ws, db, candidate, getCollectionsConfig(db));
    if (!problem) return false;
    const { status, ...body } = problem;
    sendJson(res, status, body);
    return true;
  }

  /**
   * Sync a saved document (preflighted, so failure is unexpected); on
   * failure respond 422. `previousDoc` is the stored version before the save.
   */
  function syncSaved(res, saved, previousDoc) {
    if (!ws) return true;
    try {
      syncDocument(ws, saved, { collectionsConfig: getCollectionsConfig(db), previousDoc });
      synced(saved.id, saved.meta);
      return true;
    } catch (err) {
      const body = { error: `Saved, but not synced: ${err.message}` };
      if (err instanceof SyncConflictError) body.path = err.path;
      sendJson(res, 422, body);
      return false;
    }
  }

  /**
   * Wrap a handler so an unexpected throw (e.g. a corrupt local manifest)
   * becomes a JSON `500 { error }` the editor can show.
   */
  const jsonErrors = (handler) => async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      console.error('API error:', err);
      if (!res.headersSent) sendJson(res, 500, { error: err.message });
    }
  };

  // --- Workspace ---

  route.add('GET', '/api/workspace', (req, res) => {
    sendJson(res, 200, {
      site: ws ? ws.siteDir : null,
      syncEnabled: Boolean(ws),
      previewUrl: getConfig(db, 'preview_url') || 'http://localhost:3000',
    });
  });

  // --- Documents ---

  route.add('GET', '/api/documents', (req, res) => {
    const { collection, status } = req.query;

    if (collection) {
      const opts = {};
      if (status) opts.status = status;
      const docs = listCollection(db, collection, opts);
      sendJson(res, 200, docs);
    } else {
      // List all documents across collections
      const collections = getCollections(db);
      const allDocs = [];
      const statuses = status ? [status] : ['published', 'draft', 'archived'];

      for (const col of collections) {
        for (const s of statuses) {
          allDocs.push(...listCollection(db, col, { status: s }));
        }
      }
      sendJson(res, 200, allDocs);
    }
  });

  route.add('GET', '/api/documents/:id', (req, res) => {
    const doc = getDocument(db, req.params.id);
    if (!doc) {
      sendJson(res, 404, { error: 'Document not found' });
      return;
    }
    sendJson(res, 200, doc);
  });

  route.add('POST', '/api/documents', jsonErrors((req, res) => {
    const body = req.body;
    if (!body) {
      sendJson(res, 400, { error: 'Request body required' });
      return;
    }

    const doc = {
      id: body.id || generateId(),
      meta: body.meta || {},
      blocks: body.blocks || [],
    };

    // Set timestamps
    const now = new Date().toISOString();
    if (!doc.meta.created) doc.meta.created = now;
    doc.meta.updated = now;
    if (!doc.meta.status) doc.meta.status = 'draft';
    const existing = getDocument(db, doc.id);
    doc.meta = keepStatus(doc.meta, existing?.meta);

    const { doc: checked, result, notices, dropped } = checkDocument(doc);
    if (!result.valid) {
      sendJson(res, 400, { error: 'Validation failed', errors: result.errors });
      return;
    }

    const previous = ws ? existing : null;
    if (rejectSave(res, checked)) return;
    const saved = saveDocument(db, checked);
    if (syncSaved(res, saved, previous)) sendJson(res, 201, withNotices(saved, notices, dropped));
  }));

  route.add('PUT', '/api/documents/:id', jsonErrors((req, res) => {
    const existing = getDocument(db, req.params.id);
    if (!existing) {
      sendJson(res, 404, { error: 'Document not found' });
      return;
    }

    const body = req.body;
    if (!body) {
      sendJson(res, 400, { error: 'Request body required' });
      return;
    }

    const doc = {
      id: req.params.id,
      meta: keepStatus({ ...existing.meta, ...body.meta, updated: new Date().toISOString() }, existing.meta),
      blocks: body.blocks !== undefined ? body.blocks : existing.blocks,
    };

    const { doc: checked, result, notices, dropped } = checkDocument(doc);
    if (!result.valid) {
      sendJson(res, 400, { error: 'Validation failed', errors: result.errors });
      return;
    }

    if (rejectSave(res, checked)) return;
    const saved = saveDocument(db, checked);
    if (syncSaved(res, saved, existing)) sendJson(res, 200, withNotices(saved, notices, dropped));
  }));

  // Replace the stored document with its version on disk (after a 409).
  route.add('POST', '/api/documents/:id/reload', jsonErrors((req, res) => {
    if (!ws) {
      sendJson(res, 400, { error: 'Sync is not enabled (no site)' });
      return;
    }
    try {
      const previous = getDocument(db, req.params.id);
      const reloaded = reloadFromSite(ws, db, req.params.id);
      synced(req.params.id, reloaded.deleted ? previous?.meta : reloaded.meta);
      sendJson(res, 200, reloaded);
    } catch (err) {
      sendJson(res, err.message.startsWith('No content file') ? 404 : 422, { error: err.message });
    }
  }));

  route.add('DELETE', '/api/documents/:id', jsonErrors((req, res) => {
    const existing = getDocument(db, req.params.id);
    if (!existing) {
      sendJson(res, 404, { error: 'Document not found' });
      return;
    }

    if (ws && existing.meta.status === 'published') {
      sendJson(res, 409, { error: 'Unpublish this post before deleting it.' });
      return;
    }

    if (ws) {
      try {
        unsyncDocument(ws, req.params.id, { previousDoc: existing, collectionsConfig: getCollectionsConfig(db) });
      } catch (err) {
        const status = err instanceof SyncConflictError ? 409 : 500;
        sendJson(res, status, { error: `Not deleted: ${err.message}`, path: err.path });
        return;
      }
    }

    deleteDocument(db, req.params.id);
    if (ws) synced(req.params.id, existing.meta);
    sendJson(res, 200, { ok: true });
  }));

  // --- Components ---

  if (typeof options.componentsState === 'function') {
    route.add('GET', '/api/components', jsonErrors((req, res) => {
      sendJson(res, 200, options.componentsState());
    }));
  }

  // --- Collections ---

  route.add('GET', '/api/collections', (req, res) => {
    const collections = getCollections(db);
    sendJson(res, 200, collections);
  });

  // --- Search ---

  route.add('GET', '/api/search', (req, res) => {
    const { q, limit } = req.query;
    if (!q) {
      sendJson(res, 400, { error: 'Query parameter "q" required' });
      return;
    }

    const results = searchDocuments(db, q, {
      limit: limit ? parseInt(limit, 10) : 20,
    });
    sendJson(res, 200, results);
  });

  // --- Media ---

  /** Slack over MAX_BYTES for the multipart envelope and the other fields. */
  const UPLOAD_LIMIT = MAX_BYTES + 1_048_576;

  /**
   * Every use of each media file: Map<filename, [{ id, title, status, liveOnly? } | { title, path, status }]>.
   * Saved bodies (draft or published), plus the pages committed in HEAD (the live site): a post whose
   * saved body dropped a file its committed page still shows is listed as published with `liveOnly`;
   * a committed page that is no post's is listed by its path. `strict`: a git failure is thrown
   * (DELETE must not guess); otherwise the live part is skipped and logged.
   */
  async function usageMap({ strict = false } = {}) {
    const docs = db.prepare('SELECT id FROM documents').all().map((r) => getDocument(db, r.id));
    const usage = mediaUsage(docs);
    if (!options.liveMedia) return usage;
    let live;
    try {
      live = await options.liveMedia();
    } catch (err) {
      if (strict) throw err;
      console.error('live media scan failed:', err);
      return usage;
    }
    const byId = new Map(docs.map((d) => [d.id, d]));
    for (const [file, pages] of live) {
      const list = usage.get(file) || [];
      for (const { path, vpId } of pages) {
        const doc = vpId ? byId.get(vpId) : null;
        if (doc) {
          const entry = list.find((u) => u.id === doc.id);
          if (!entry) list.push({ id: doc.id, title: doc.meta?.title ?? '', status: 'published', liveOnly: true });
          else if (entry.status !== 'published') Object.assign(entry, { status: 'published', liveOnly: true });
        } else if (!list.some((u) => u.path === path)) {
          list.push({ title: path, path, status: 'published' });
        }
      }
      if (list.length) usage.set(file, list);
    }
    return usage;
  }

  /** A media row as the API returns it. */
  function mediaItem(row, usage) {
    return {
      id: row.id,
      filename: row.filename,
      original_name: row.original_name,
      mime_type: row.mime_type,
      kind: kindOf(row.mime_type),
      size: row.size,
      width: row.width,
      height: row.height,
      alt: row.alt,
      edited_from: row.edited_from,
      created: row.created,
      src: mediaSrc(row.filename),
      missing: isMissing(mediaDir, row.filename),
      usedIn: usage.get(row.filename) || [],
    };
  }

  /**
   * Rewrite media.json (with a site) and tell the listener. The file and row are already
   * changed, so a failure here is logged, not turned into an error response.
   */
  function mediaChanged(filename, action) {
    try {
      if (ws) writeMediaJson(ws, db);
    } catch (err) {
      console.error('media.json write failed:', err);
    }
    try {
      options.onMediaChanged?.({ filename, action });
    } catch (err) {
      console.error('onMediaChanged error:', err);
    }
  }

  route.add('GET', '/api/media', jsonErrors(async (req, res) => {
    const usage = await usageMap();
    const rows = db.prepare('SELECT * FROM media ORDER BY created DESC, filename').all();
    sendJson(res, 200, rows.map((row) => mediaItem(row, usage)));
  }));

  route.add('POST', '/api/media', jsonErrors(async (req, res) => {
    const contentType = req.headers['content-type'] || '';

    if (!contentType.includes('multipart/form-data')) {
      sendJson(res, 400, { error: 'Content-Type must be multipart/form-data' });
      return;
    }

    const declared = Number(req.headers['content-length']);
    if (declared > UPLOAD_LIMIT) {
      sendJson(res, 413, { error: tooLargeMessage('This file', declared) });
      return;
    }

    let parsed;
    try {
      parsed = await parseMultipart(req, contentType);
    } catch (err) {
      if (err.status === 413) {
        sendJson(res, 413, { error: tooLargeMessage('This file', err.received) });
        return;
      }
      throw err;
    }
    const { file, fields } = parsed;
    if (!file) {
      sendJson(res, 400, { error: 'No file uploaded' });
      return;
    }
    if (file.data.length > MAX_BYTES) {
      sendJson(res, 413, { error: tooLargeMessage(file.filename, file.data.length) });
      return;
    }
    const info = inspectFile(file.data, file.filename);
    if (!info) {
      sendJson(res, 415, { error: unsupportedMessage(file.filename) });
      return;
    }

    let source = null;
    if (fields.edited_from) {
      source = db.prepare('SELECT * FROM media WHERE filename = ?').get(fields.edited_from);
      if (!source) {
        sendJson(res, 400, { error: 'The image being edited is no longer in the library.' });
        return;
      }
    }

    const taken = (name) => existsSync(join(mediaDir, name))
      || Boolean(db.prepare('SELECT 1 FROM media WHERE filename = ?').get(name));
    const filename = uniqueFilename(
      (id) => (source ? editedFilename(source.filename, info.ext, id) : mediaFilename(file.filename, info.ext, id)),
      taken,
    );

    writeFileAtomic(join(mediaDir, filename), file.data);
    const row = {
      id: crypto.randomUUID().slice(0, 8),
      filename,
      original_name: source ? source.original_name : file.filename,
      mime_type: info.mime,
      size: file.data.length,
      width: info.width,
      height: info.height,
      alt: source ? source.alt : ('alt' in fields ? fields.alt : null),
      edited_from: source ? source.filename : null,
      created: new Date().toISOString(),
    };
    try {
      db.prepare(`
        INSERT INTO media (id, filename, original_name, mime_type, size, width, height, alt, edited_from, created)
        VALUES (@id, @filename, @original_name, @mime_type, @size, @width, @height, @alt, @edited_from, @created)
      `).run(row);
    } catch (err) {
      rmSync(join(mediaDir, filename), { force: true });
      throw err;
    }
    mediaChanged(filename, 'upload');

    sendJson(res, 201, { ...mediaItem(row, await usageMap()), large: file.data.length > LARGE_BYTES });
  }));

  route.add('PUT', '/api/media/:id', jsonErrors(async (req, res) => {
    const row = db.prepare('SELECT * FROM media WHERE id = ?').get(req.params.id);
    if (!row) {
      sendJson(res, 404, { error: 'Media not found' });
      return;
    }
    const alt = req.body?.alt;
    if (alt !== null && typeof alt !== 'string') {
      sendJson(res, 400, { error: 'alt must be text or null' });
      return;
    }
    db.prepare('UPDATE media SET alt = ? WHERE id = ?').run(alt, row.id);
    mediaChanged(row.filename, 'alt');
    sendJson(res, 200, mediaItem({ ...row, alt }, await usageMap()));
  }));

  route.add('DELETE', '/api/media/:id', jsonErrors(async (req, res) => {
    const row = db.prepare('SELECT * FROM media WHERE id = ?').get(req.params.id);
    if (!row) {
      sendJson(res, 404, { error: 'Media not found' });
      return;
    }
    // Published uses: a published post's saved body, or any page committed in HEAD (the live site).
    let usage;
    try {
      usage = await usageMap({ strict: true });
    } catch (err) {
      console.error('live media scan failed:', err);
      sendJson(res, 503, { error: `Couldn't check whether the live site uses this file (${err.message}). Nothing was deleted. Try again.` });
      return;
    }
    const users = usage.get(row.filename) || [];
    const published = users.filter((u) => u.status === 'published')
      .map(({ id, title, path }) => (id ? { id, title } : { title, path }));
    if (published.length) {
      sendJson(res, 409, { error: 'Used by published posts. Remove it from them and Update first.', posts: published });
      return;
    }
    rmSync(join(mediaDir, row.filename), { force: true });
    db.prepare('DELETE FROM media WHERE id = ?').run(row.id);
    mediaChanged(row.filename, 'delete');
    sendJson(res, 200, { ok: true, drafts: users.map(({ id, title }) => ({ id, title })) });
  }));

  // --- Themes ---

  // Available VB themes (from node_modules/vanilla-breeze/dist/cdn)
  route.add('GET', '/api/themes', (req, res) => {
    sendJson(res, 200, listThemes(join(rootDir, 'node_modules', 'vanilla-breeze', 'dist', 'cdn')));
  });

  // --- Config ---

  route.add('GET', '/api/config', (req, res) => {
    const config = getAllConfig(db);
    sendJson(res, 200, config);
  });

  route.add('GET', '/api/config/:key', (req, res) => {
    const value = getConfig(db, req.params.key);
    if (value === null) {
      sendJson(res, 200, { key: req.params.key, value: null });
      return;
    }
    sendJson(res, 200, { key: req.params.key, value });
  });

  route.add('PUT', '/api/config/:key', (req, res) => {
    const body = req.body;
    if (!body || body.value === undefined) {
      sendJson(res, 400, { error: 'Request body with "value" field required' });
      return;
    }

    setConfig(db, req.params.key, String(body.value));
    if (ws && req.params.key === 'theme') writeVpConfig(ws, db);
    sendJson(res, 200, { key: req.params.key, value: String(body.value) });
  });

  // --- Publish ---

  route.add('POST', '/api/sync', jsonErrors((req, res) => {
    if (!ws) {
      sendJson(res, 200, { ok: true, synced: 0 });
      return;
    }
    try {
      const { synced: count, conflicts } = syncAll(ws, db);
      synced(null, { title: 'all posts' });
      sendJson(res, 200, { ok: true, synced: count, conflicts });
    } catch (err) {
      sendJson(res, 500, { error: `Sync failed: ${err.message}` });
    }
  }));
}

/**
 * Parse a multipart/form-data request (minimal implementation).
 * Handles a single file field and text fields.
 * @param {import('node:http').IncomingMessage} req
 * @param {string} contentType
 * @returns {Promise<{ file: Object|null, fields: Object }>}
 */
async function parseMultipart(req, contentType) {
  const boundaryMatch = contentType.match(/boundary=(.+?)(?:;|$)/);
  if (!boundaryMatch) throw new Error('No boundary in content-type');

  const boundary = boundaryMatch[1];
  const raw = await readRawBody(req, { limit: MAX_BYTES + 1_048_576 });
  const boundaryBuf = Buffer.from(`--${boundary}`);
  const fields = {};
  let file = null;

  // Split by boundary
  const parts = splitBuffer(raw, boundaryBuf);

  for (const part of parts) {
    const str = part.toString('utf-8', 0, Math.min(part.length, 1024));
    if (str.startsWith('--') || str.trim() === '') continue;

    // Find header/body separator
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;

    const headers = part.subarray(0, headerEnd).toString('utf-8');
    // Skip leading \r\n in body
    let body = part.subarray(headerEnd + 4);
    // Remove trailing \r\n
    if (body.length >= 2 && body[body.length - 2] === 0x0d && body[body.length - 1] === 0x0a) {
      body = body.subarray(0, body.length - 2);
    }

    const nameMatch = headers.match(/name="([^"]+)"/);
    if (!nameMatch) continue;

    const filenameMatch = headers.match(/filename="([^"]+)"/);
    if (filenameMatch) {
      const mimeMatch = headers.match(/Content-Type:\s*(.+)/i);
      file = {
        fieldName: nameMatch[1],
        filename: filenameMatch[1],
        mimeType: mimeMatch ? mimeMatch[1].trim() : 'application/octet-stream',
        data: body,
      };
    } else {
      fields[nameMatch[1]] = body.toString('utf-8');
    }
  }

  return { file, fields };
}

/**
 * Split a buffer by a delimiter buffer.
 * @param {Buffer} buf
 * @param {Buffer} delimiter
 * @returns {Buffer[]}
 */
function splitBuffer(buf, delimiter) {
  const parts = [];
  let start = 0;

  while (start < buf.length) {
    const idx = buf.indexOf(delimiter, start);
    if (idx === -1) {
      parts.push(buf.subarray(start));
      break;
    }
    if (idx > start) {
      parts.push(buf.subarray(start, idx));
    }
    start = idx + delimiter.length;
  }

  return parts;
}
