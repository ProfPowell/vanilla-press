/**
 * Sync the local store from committed content JSON. The JSON files in the
 * Cook site are the source of truth; this brings changes made on disk (git
 * pull, another machine, hand edits) back into SQLite.
 *
 * @module export/sync
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { validate } from '../schema/validate.js';
import { getDocument, saveDocument, deleteDocument } from '../store/content.js';
import { changedOnDisk, recordImported, readManifest } from './export.js';

/** Content files that are not documents. */
const NON_DOCUMENTS = new Set(['media.json', '.vp-manifest.json']);

/** Site-relative (posix) paths of every document JSON under contentDir. */
function listJson(ws) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') return;
      throw err;
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.isFile() && e.name.endsWith('.json')) {
        if (dir === ws.contentDir && NON_DOCUMENTS.has(e.name)) continue;
        out.push(relative(ws.siteDir, abs).split(sep).join('/'));
      }
    }
  };
  walk(ws.contentDir);
  return out;
}

/** Parse a file; returns { doc } or { error }. */
function readDoc(ws, rel) {
  let doc;
  try {
    doc = JSON.parse(readFileSync(join(ws.siteDir, rel), 'utf8'));
  } catch (err) {
    return { error: err.message };
  }
  const result = validate(doc);
  if (!result.valid) return { doc, error: JSON.stringify(result.errors) };
  return { doc };
}

/**
 * Import every changed or new content JSON into the store. Files that fail to
 * parse or validate are skipped with a warning. With `replace`, store
 * documents that have no JSON file are deleted from the store (files are
 * never touched).
 * @param {import('../workspace/workspace.js').Workspace} ws
 * @param {import('better-sqlite3').Database} db
 * @param {{ replace?: boolean }} [options]
 * @returns {{ imported: string[], skipped: string[], removed: string[] }} document ids (a file's path when it has no usable id)
 */
export function syncFromContent(ws, db, { replace = false } = {}) {
  const imported = [];
  const skipped = [];
  const removed = [];
  const seen = new Set();

  for (const rel of listJson(ws)) {
    const { doc, error } = readDoc(ws, rel);
    if (typeof doc?.id === 'string') seen.add(doc.id);
    if (error) {
      console.warn(`import:content: skipping ${rel}: ${error}`);
      skipped.push(typeof doc?.id === 'string' ? doc.id : rel);
      continue;
    }
    if (getDocument(db, doc.id) && !changedOnDisk(ws, doc.id, rel)) {
      skipped.push(doc.id);
      continue;
    }
    saveDocument(db, doc);
    recordImported(ws, doc.id, rel);
    imported.push(doc.id);
  }

  if (replace) {
    const ids = db.prepare('SELECT id FROM documents').all().map((r) => r.id);
    for (const id of ids) {
      if (!seen.has(id) && deleteDocument(db, id)) removed.push(id);
    }
  }
  return { imported, skipped, removed };
}

/**
 * Import one document's JSON unconditionally and record it as the known state.
 * Finds the file via the manifest entry, falling back to scanning content/.
 * @param {import('../workspace/workspace.js').Workspace} ws
 * @param {import('better-sqlite3').Database} db
 * @param {string} docId
 * @returns {Object} The saved document
 * @throws {Error} when no content file exists for the document, or it is invalid
 */
export function importOne(ws, db, docId) {
  let rel = readManifest(ws).documents[docId]?.json;
  let found = rel ? readDoc(ws, rel) : null;
  if (!found || (found.error && !found.doc)) {
    rel = null;
    found = null;
    for (const candidate of listJson(ws)) {
      const r = readDoc(ws, candidate);
      if (r.doc?.id === docId) { rel = candidate; found = r; break; }
    }
  }
  if (!rel || !found) throw new Error(`No content file for document ${docId}`);
  if (found.error) throw new Error(`Invalid content file ${rel}: ${found.error}`);
  const saved = saveDocument(db, found.doc);
  recordImported(ws, docId, rel);
  return saved;
}
