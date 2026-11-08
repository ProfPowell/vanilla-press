/**
 * The media library follows the site: `content/media.json` is loaded into the
 * store, and files dropped into `src/media` get an entry.
 *
 * @module sync/media-library
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { inspectFile } from '../media/inspect.js';
import { writeMediaJson } from './site-files.js';

export const MEDIA_FIELDS = [
  'id', 'filename', 'original_name', 'mime_type', 'size', 'width', 'height', 'alt', 'edited_from', 'created',
];

const nonEmpty = (v) => typeof v === 'string' && v !== '';

/**
 * A media.json entry as a store row, or null (with a warning) when unusable.
 * An entry with no `original_name` key predates 3b: its `alt: ''` meant "never
 * written", not decorative (M2).
 * @param {Object} entry
 * @returns {Object|null}
 */
export function normalizeEntry(entry) {
  if (!entry || !nonEmpty(entry.id) || !nonEmpty(entry.filename) || /[/\\]/.test(entry.filename)) {
    console.warn(`media.json: skipping an entry with a missing id or an invalid filename: ${JSON.stringify(entry)}`);
    return null;
  }
  const legacy = !('original_name' in entry);
  const row = {};
  for (const f of MEDIA_FIELDS) row[f] = entry[f] ?? null;
  if (legacy) {
    row.original_name = entry.filename;
    if (row.alt === '') row.alt = null;
  }
  return row;
}

/**
 * Replace every media row with the entries in `content/media.json` (the site wins).
 * @param {import('../workspace/workspace.js').Workspace} ws
 * @param {import('better-sqlite3').Database} db
 * @returns {{ loaded: number }|null} null when the file is absent or unparsable (the store is left alone)
 */
export function loadMediaJson(ws, db) {
  const file = join(ws.contentDir, 'media.json');
  if (!existsSync(file)) return null;
  let entries;
  try {
    entries = JSON.parse(readFileSync(file, 'utf8'));
    if (!Array.isArray(entries)) throw new Error('not an array');
  } catch (err) {
    console.warn(`media.json could not be read (${err.message}); the media library is unchanged. Fix or remove content/media.json.`);
    return null;
  }
  const rows = entries.map(normalizeEntry).filter(Boolean);
  const insert = db.prepare(
    `INSERT OR REPLACE INTO media (${MEDIA_FIELDS.join(', ')}) VALUES (${MEDIA_FIELDS.map((f) => `@${f}`).join(', ')})`,
  );
  db.transaction(() => {
    db.prepare('DELETE FROM media').run();
    for (const row of rows) insert.run(row);
  })();
  return { loaded: rows.length };
}

/**
 * Give every supported file in `mediaDir` that has no row an entry.
 * @param {import('better-sqlite3').Database} db
 * @param {string} mediaDir
 * @returns {string[]} the file names adopted
 */
export function adoptStrayFiles(db, mediaDir) {
  let names;
  try {
    names = readdirSync(mediaDir, { withFileTypes: true })
      .filter((e) => e.isFile() && !e.name.startsWith('.')).map((e) => e.name).sort();
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const known = new Set(db.prepare('SELECT filename FROM media').all().map((r) => r.filename));
  const insert = db.prepare(
    `INSERT INTO media (${MEDIA_FIELDS.join(', ')}) VALUES (${MEDIA_FIELDS.map((f) => `@${f}`).join(', ')})`,
  );
  const adopted = [];
  const skipped = [];
  for (const name of names) {
    if (known.has(name)) continue;
    const path = join(mediaDir, name);
    const bytes = readFileSync(path);
    const info = inspectFile(bytes, name);
    if (!info) { skipped.push(name); continue; }
    insert.run({
      id: randomBytes(4).toString('hex'),
      filename: name,
      original_name: name,
      mime_type: info.mime,
      size: bytes.length,
      width: info.width ?? null,
      height: info.height ?? null,
      alt: null,
      edited_from: null,
      created: statSync(path).mtime.toISOString(),
    });
    adopted.push(name);
  }
  if (skipped.length) {
    console.warn(`src/media has files that are not a supported type and were left out of the library: ${skipped.join(', ')}. Remove them or convert them.`);
  }
  return adopted;
}

/**
 * Follow the site: load media.json, then adopt stray files (rewriting
 * media.json when any were adopted, so the file and the store agree).
 * @param {import('../workspace/workspace.js').Workspace} ws
 * @param {import('better-sqlite3').Database} db
 * @returns {{ adopted: string[] }}
 */
export function syncMediaFromSite(ws, db) {
  loadMediaJson(ws, db);
  const adopted = adoptStrayFiles(db, ws.mediaDir);
  if (adopted.length) writeMediaJson(ws, db);
  return { adopted };
}

/**
 * Whether a library entry's file is gone from the media folder.
 * @param {string} mediaDir
 * @param {string} filename
 * @returns {boolean}
 */
export function isMissing(mediaDir, filename) {
  return !existsSync(join(mediaDir, filename));
}
