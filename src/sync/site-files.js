/**
 * Site-wide files Vanilla Press writes into a Cook site besides documents
 * (`content/media.json`), plus the helpers shared by the
 * API and CLI to sync after a save and to sync everything.
 *
 * @module sync/site-files
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getConfig } from '../store/config.js';
import { getDocument } from '../store/content.js';
import {
  syncDocument, checkSync, changedOnDisk, SyncConflictError, readManifest, writeFileAtomic,
} from './to-site.js';
import { outputPaths } from './paths.js';
import { normalizeCredit } from '../media/credit.js';

/** The media.json / media-table columns, in the order they are written. */
export const MEDIA_FIELDS = [
  'id', 'filename', 'original_name', 'mime_type', 'size', 'width', 'height', 'alt', 'edited_from', 'created',
  'source', 'credit',
];

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
 * Decide, before saving `candidate` to the store, whether the save may go
 * ahead. Nothing is written.
 * - The stored version's JSON (as recorded in the local manifest, else
 *   derived) changed on disk → 409: the file wins, offer to load it.
 * - The candidate's sync would be rejected (HTML owned by another document
 *   or hand-written, unowned target JSON, invalid or reserved path) → 422:
 *   not saved, no reload offered.
 * Throws (e.g. a corrupt local manifest) are left to the caller.
 * @param {import('../workspace/workspace.js').Workspace} ws
 * @param {import('better-sqlite3').Database} db
 * @param {Object} candidate - The document exactly as it would be saved
 * @param {Object} collectionsConfig
 * @returns {null | { status: 409|422, error: string, path?: string }}
 */
export function preflightSave(ws, db, candidate, collectionsConfig) {
  const manifest = readManifest(ws); // a corrupt manifest throws: unexpected, not a rejected save
  const existing = getDocument(db, candidate.id);
  if (existing) {
    const rel = manifest.documents[existing.id]?.json || outputPaths(existing, collectionsConfig).json;
    // Changed on disk, or renamed/deleted there (the JSON this machine recorded is gone).
    const gone = Boolean(manifest.documents[existing.id]?.json) && !existsSync(join(ws.siteDir, rel));
    if (gone || changedOnDisk(ws, existing.id, rel)) {
      return { status: 409, error: 'This document changed on disk (e.g. git pull).', path: rel };
    }
  }
  try {
    checkSync(ws, candidate, { collectionsConfig, previousDoc: existing });
  } catch (err) {
    return { status: 422, error: `Not saved: ${err.message}` };
  }
  return null;
}

/**
 * Write every media row to `content/media.json` (ordered by created, then id).
 * @param {import('../workspace/workspace.js').Workspace} ws
 * @param {import('better-sqlite3').Database} db
 */
export function writeMediaJson(ws, db) {
  // The credit is stored as JSON text; media.json holds it as an object, for people to read.
  const rows = db.prepare('SELECT * FROM media ORDER BY created, id').all()
    .map((row) => Object.fromEntries(MEDIA_FIELDS.map((f) => [f, f === 'credit' ? normalizeCredit(row.credit) : row[f] ?? null])));
  writeFileAtomic(join(ws.contentDir, 'media.json'), JSON.stringify(rows, null, 2) + '\n');
}

/**
 * Sync every document (skipping, not overwriting, any that conflict or
 * collide), then write media.json.
 * @param {import('../workspace/workspace.js').Workspace} ws
 * @param {import('better-sqlite3').Database} db
 * @returns {{ synced: number, conflicts: string[] }} conflicts: site-relative paths or error messages
 * @throws {Error} when the manifest is corrupt
 */
export function syncAll(ws, db) {
  readManifest(ws); // a corrupt manifest fails the whole sync up front
  const collectionsConfig = getCollectionsConfig(db);
  const ids = db.prepare('SELECT id FROM documents ORDER BY id').all().map((r) => r.id);
  let synced = 0;
  const conflicts = [];
  for (const id of ids) {
    const doc = getDocument(db, id);
    try {
      syncDocument(ws, doc, { collectionsConfig, previousDoc: doc });
      synced++;
    } catch (err) {
      conflicts.push(err instanceof SyncConflictError ? err.path : `${id}: ${err.message}`);
    }
  }
  writeMediaJson(ws, db);
  return { synced, conflicts };
}
