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
import { mkdirSync, writeFileSync } from 'node:fs';
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
import { exportDocument, removeExport, ExportConflictError } from '../export/export.js';
import { importOne } from '../export/sync.js';
import {
  getCollectionsConfig, preflightSave, writeMediaJson, writeVpConfig, exportAll,
} from '../export/site-files.js';
import { getConfig, setConfig, getAllConfig } from '../store/config.js';
import { listThemes } from '../themes/list-themes.js';
import { sendJson, readRawBody } from './router.js';

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
 * @param {import('../workspace/workspace.js').Workspace} [options.workspace] - Absent means fixture mode (export disabled)
 */
export function mountApi(router, db, options) {
  const { rootDir } = options;
  const ws = options.workspace?.exportEnabled ? options.workspace : null;
  const mediaDir = ws ? ws.mediaDir : options.mediaDir;

  /**
   * Respond (and return true) when `candidate` must not be saved: 409 if the
   * stored version changed on disk, 422 if its export would be rejected.
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
   * Export a saved document (preflighted, so failure is unexpected); on
   * failure respond 422. `previousDoc` is the stored version before the save.
   */
  function exportSaved(res, saved, previousDoc) {
    if (!ws) return true;
    try {
      exportDocument(ws, saved, { collectionsConfig: getCollectionsConfig(db), previousDoc });
      return true;
    } catch (err) {
      const body = { error: `Saved, but not exported: ${err.message}` };
      if (err instanceof ExportConflictError) body.path = err.path;
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

  router.add('GET', '/api/workspace', (req, res) => {
    sendJson(res, 200, {
      site: ws ? ws.siteDir : null,
      exportEnabled: Boolean(ws),
      previewUrl: getConfig(db, 'preview_url') || 'http://localhost:3000',
    });
  });

  // --- Documents ---

  router.add('GET', '/api/documents', (req, res) => {
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

  router.add('GET', '/api/documents/:id', (req, res) => {
    const doc = getDocument(db, req.params.id);
    if (!doc) {
      sendJson(res, 404, { error: 'Document not found' });
      return;
    }
    sendJson(res, 200, doc);
  });

  router.add('POST', '/api/documents', jsonErrors((req, res) => {
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

    const result = validate(doc);
    if (!result.valid) {
      sendJson(res, 400, { error: 'Validation failed', errors: result.errors });
      return;
    }

    const previous = ws ? getDocument(db, doc.id) : null;
    if (rejectSave(res, doc)) return;
    const saved = saveDocument(db, doc);
    if (exportSaved(res, saved, previous)) sendJson(res, 201, saved);
  }));

  router.add('PUT', '/api/documents/:id', jsonErrors((req, res) => {
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
      meta: { ...existing.meta, ...body.meta, updated: new Date().toISOString() },
      blocks: body.blocks !== undefined ? body.blocks : existing.blocks,
    };

    const result = validate(doc);
    if (!result.valid) {
      sendJson(res, 400, { error: 'Validation failed', errors: result.errors });
      return;
    }

    if (rejectSave(res, doc)) return;
    const saved = saveDocument(db, doc);
    if (exportSaved(res, saved, existing)) sendJson(res, 200, saved);
  }));

  // Replace the stored document with its version on disk (after a 409).
  router.add('POST', '/api/documents/:id/reload', jsonErrors((req, res) => {
    if (!ws) {
      sendJson(res, 400, { error: 'Export is not enabled (no site)' });
      return;
    }
    try {
      sendJson(res, 200, importOne(ws, db, req.params.id));
    } catch (err) {
      sendJson(res, err.message.startsWith('No content file') ? 404 : 422, { error: err.message });
    }
  }));

  router.add('DELETE', '/api/documents/:id', jsonErrors((req, res) => {
    const existing = getDocument(db, req.params.id);
    if (!existing) {
      sendJson(res, 404, { error: 'Document not found' });
      return;
    }

    if (ws) {
      try {
        removeExport(ws, req.params.id, { previousDoc: existing, collectionsConfig: getCollectionsConfig(db) });
      } catch (err) {
        const status = err instanceof ExportConflictError ? 409 : 500;
        sendJson(res, status, { error: `Not deleted: ${err.message}`, path: err.path });
        return;
      }
    }

    deleteDocument(db, req.params.id);
    sendJson(res, 200, { ok: true });
  }));

  // --- Collections ---

  router.add('GET', '/api/collections', (req, res) => {
    const collections = getCollections(db);
    sendJson(res, 200, collections);
  });

  // --- Search ---

  router.add('GET', '/api/search', (req, res) => {
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

  router.add('GET', '/api/media', (req, res) => {
    const rows = db.prepare('SELECT * FROM media ORDER BY created DESC').all();
    sendJson(res, 200, rows);
  });

  router.add('POST', '/api/media', async (req, res) => {
    const contentType = req.headers['content-type'] || '';

    if (!contentType.includes('multipart/form-data')) {
      sendJson(res, 400, { error: 'Content-Type must be multipart/form-data' });
      return;
    }

    try {
      const { file, fields } = await parseMultipart(req, contentType);
      if (!file) {
        sendJson(res, 400, { error: 'No file uploaded' });
        return;
      }

      // Generate unique filename
      const ext = file.filename.includes('.')
        ? file.filename.slice(file.filename.lastIndexOf('.'))
        : '';
      const id = crypto.randomUUID().slice(0, 8);
      const filename = `${id}${ext}`;

      // Save to disk
      mkdirSync(mediaDir, { recursive: true });
      writeFileSync(join(mediaDir, filename), file.data);

      // Insert into DB
      const alt = fields.alt || '';
      db.prepare(`
        INSERT INTO media (id, filename, mime_type, size, alt, created)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, filename, file.mimeType, file.data.length, alt, new Date().toISOString());
      if (ws) writeMediaJson(ws, db);

      sendJson(res, 201, {
        id,
        filename,
        mime_type: file.mimeType,
        size: file.data.length,
        alt,
        src: `/media/${filename}`,
      });
    } catch (err) {
      sendJson(res, 500, { error: `Upload failed: ${err.message}` });
    }
  });

  // --- Themes ---

  // Available VB themes (from node_modules/vanilla-breeze/dist/cdn)
  router.add('GET', '/api/themes', (req, res) => {
    sendJson(res, 200, listThemes(join(rootDir, 'node_modules', 'vanilla-breeze', 'dist', 'cdn')));
  });

  // --- Config ---

  router.add('GET', '/api/config', (req, res) => {
    const config = getAllConfig(db);
    sendJson(res, 200, config);
  });

  router.add('GET', '/api/config/:key', (req, res) => {
    const value = getConfig(db, req.params.key);
    if (value === null) {
      sendJson(res, 200, { key: req.params.key, value: null });
      return;
    }
    sendJson(res, 200, { key: req.params.key, value });
  });

  router.add('PUT', '/api/config/:key', (req, res) => {
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

  router.add('POST', '/api/publish', jsonErrors((req, res) => {
    if (!ws) {
      sendJson(res, 200, { ok: true, exported: 0 });
      return;
    }
    try {
      const { exported, conflicts } = exportAll(ws, db);
      sendJson(res, 200, { ok: true, exported, conflicts });
    } catch (err) {
      sendJson(res, 500, { error: `Export failed: ${err.message}` });
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
  const raw = await readRawBody(req);
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
