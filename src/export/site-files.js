/**
 * Site-wide files Vanilla Press writes into a Cook site besides documents
 * (`content/media.json`, `config/vp.json`), plus the helpers shared by the
 * API and CLI to export after a save and to export everything.
 *
 * @module export/site-files
 */

import { join } from 'node:path';
import { getConfig } from '../store/config.js';
import { getDocument } from '../store/content.js';
import { exportDocument, ExportConflictError, readManifest, writeFileAtomic } from './export.js';

let warnedCollections = false;

/**
 * The `collections` config value, parsed. An invalid value is treated as `{}`
 * (warned once per process).
 * @param {import('better-sqlite3').Database} db
 * @returns {Object}
 */
export function getCollectionsConfig(db) {
  const raw = getConfig(db, 'collections');
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    throw new Error('not an object');
  } catch (err) {
    if (!warnedCollections) {
      warnedCollections = true;
      console.warn(`config "collections" is not a valid JSON object (${err.message}); using defaults`);
    }
    return {};
  }
}

/**
 * Write every media row to `content/media.json` (ordered by created, then id).
 * @param {import('../workspace/workspace.js').Workspace} ws
 * @param {import('better-sqlite3').Database} db
 */
export function writeMediaJson(ws, db) {
  const rows = db.prepare('SELECT * FROM media ORDER BY created, id').all();
  writeFileAtomic(join(ws.contentDir, 'media.json'), JSON.stringify(rows, null, 2) + '\n');
}

/**
 * Write `{ theme }` to `config/vp.json`.
 * @param {import('../workspace/workspace.js').Workspace} ws
 * @param {import('better-sqlite3').Database} db
 */
export function writeVpConfig(ws, db) {
  const theme = getConfig(db, 'theme') || 'default';
  writeFileAtomic(join(ws.configDir, 'vp.json'), JSON.stringify({ theme }, null, 2) + '\n');
}

/**
 * Export every document (skipping, not overwriting, any that conflict or
 * collide), then write media.json and vp.json.
 * @param {import('../workspace/workspace.js').Workspace} ws
 * @param {import('better-sqlite3').Database} db
 * @returns {{ exported: number, conflicts: string[] }} conflicts: site-relative paths or error messages
 * @throws {Error} when the manifest is corrupt
 */
export function exportAll(ws, db) {
  readManifest(ws); // a corrupt manifest fails the whole export up front
  const collectionsConfig = getCollectionsConfig(db);
  const ids = db.prepare('SELECT id FROM documents ORDER BY id').all().map((r) => r.id);
  let exported = 0;
  const conflicts = [];
  for (const id of ids) {
    const doc = getDocument(db, id);
    try {
      exportDocument(ws, doc, { collectionsConfig });
      exported++;
    } catch (err) {
      conflicts.push(err instanceof ExportConflictError ? err.path : `${id}: ${err.message}`);
    }
  }
  writeMediaJson(ws, db);
  writeVpConfig(ws, db);
  return { exported, conflicts };
}
