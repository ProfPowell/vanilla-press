/**
 * The media library follows the site: `content/media.json` is loaded into the
 * store, and files dropped into `src/media` get an entry.
 *
 * @module sync/media-library
 */

import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { inspectFile } from '../media/inspect.js';
import { writeMediaJson, MEDIA_FIELDS } from './site-files.js';
import { storedCredit, mediaSource } from '../media/credit.js';
import { linkedUrl } from '../media/usage.js';

export { MEDIA_FIELDS };

const nonEmpty = (v) => typeof v === 'string' && v !== '';

/**
 * Whether `url` is a remote image a linked item may point at: https on
 * images.unsplash.com, no user, password or port (Unsplash photos are used by link only).
 * @param {unknown} url
 * @returns {boolean}
 */
export const isLinkedUrl = (url) => linkedUrl(url) !== null;

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
  if (!nonEmpty(entry.mime_type) || !Number.isFinite(entry.size) || entry.size < 0 || !nonEmpty(entry.created)) {
    console.warn(`media.json: skipping ${entry.filename}: it needs a mime_type, a size and a created date`);
    return null;
  }
  const hasUrl = entry.url !== undefined && entry.url !== null && entry.url !== '';
  const remote = hasUrl ? linkedUrl(entry.url) : null;
  if (hasUrl && !remote) {
    console.warn(`media.json: skipping ${entry.filename}: its url is not an https://images.unsplash.com/ image`);
    return null;
  }
  // An Unsplash photo is used by link only: a file claiming to be one is not kept.
  if (!remote && entry.source === 'unsplash') {
    console.warn(`media.json: skipping ${entry.filename}: an Unsplash entry needs its url (Unsplash photos are linked, never copied)`);
    return null;
  }
  const legacy = !('original_name' in entry);
  const str = (v) => (typeof v === 'string' ? v : null);
  const int = (v) => (Number.isInteger(v) ? v : null);
  const alt = str(entry.alt);
  return {
    id: entry.id,
    filename: entry.filename,
    original_name: nonEmpty(entry.original_name) ? entry.original_name : entry.filename,
    mime_type: entry.mime_type,
    size: entry.size,
    width: int(entry.width),
    height: int(entry.height),
    alt: legacy && alt === '' ? null : alt,
    edited_from: str(entry.edited_from),
    created: entry.created,
    source: mediaSource(entry.source),
    credit: storedCredit(entry.credit),
    url: remote ? remote.href : null,
  };
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
  const rows = [];
  const ids = new Set();
  const names = new Set();
  const dropped = [];
  for (const row of entries.map(normalizeEntry).filter(Boolean)) {
    if (ids.has(row.id) || names.has(row.filename)) { dropped.push(`${row.id} (${row.filename})`); continue; }
    ids.add(row.id);
    names.add(row.filename);
    rows.push(row);
  }
  if (dropped.length) {
    console.warn(`media.json lists some ids or files twice; kept the first of each and dropped: ${dropped.join(', ')}. Remove the duplicates from content/media.json.`);
  }
  const insert = db.prepare(
    `INSERT OR REPLACE INTO media (${MEDIA_FIELDS.join(', ')}) VALUES (${MEDIA_FIELDS.map((f) => `@${f}`).join(', ')})`,
  );
  db.transaction(() => {
    db.prepare('DELETE FROM media').run();
    for (const row of rows) insert.run(row);
  })();
  return { loaded: rows.length };
}

// Sniffing a type needs only a file's first bytes.
const SNIFF_BYTES = 65_536;

function readHead(path, size) {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(Math.min(size, SNIFF_BYTES));
    const n = readSync(fd, buf, 0, buf.length, 0);
    return buf.subarray(0, n);
  } finally {
    closeSync(fd);
  }
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
    const size = statSync(path).size;
    let info = inspectFile(readHead(path, size), name);
    if (!info) { skipped.push(name); continue; }
    // Dimensions can sit past the first bytes (a JPEG with a large profile): read the rest only then.
    if (info.kind === 'image' && info.width === null && size > SNIFF_BYTES) info = inspectFile(readFileSync(path), name) ?? info;
    insert.run({
      id: randomBytes(4).toString('hex'),
      filename: name,
      original_name: name,
      mime_type: info.mime,
      size,
      width: info.width ?? null,
      height: info.height ?? null,
      alt: null,
      edited_from: null,
      created: statSync(path).mtime.toISOString(),
      source: null,
      credit: null,
      url: null,
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
 * Whether a library entry's file is gone from the media folder. A linked
 * entry (one with a `url`) has no file, so it is never missing.
 * @param {string} mediaDir
 * @param {string} filename
 * @param {string|null} [url] the entry's remote image, for a linked entry
 * @returns {boolean}
 */
export function isMissing(mediaDir, filename, url = null) {
  if (url) return false;
  return !existsSync(join(mediaDir, filename));
}
