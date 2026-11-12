/**
 * @file layout-writes.js
 * @description What VP last wrote to each layout and include file of a site:
 * `{ "<site-relative path>": "<sha1>" | null }` (null: VP deleted it). Kept
 * under VP's config directory (`<configDir>/layout-writes/<siteId>.json`),
 * never in the site. Publish layout uses it to tell VP's saves apart from
 * hand edits: a file whose content still has the recorded sha1 is VP's.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileAtomic } from '../sync/atomic-write.js';

/** Where a site's record lives. */
export const layoutWritesPath = (configDir, siteId) => join(configDir, 'layout-writes', `${siteId}.json`);

/** The record; {} when there is none (or no file was given, or it can't be read). */
export function readLayoutWrites(file) {
  if (!file || !existsSync(file)) return {};
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

/** Record that VP wrote `sha` (null: deleted) to `path`. No file: nothing is recorded. */
export function recordLayoutWrite(file, path, sha) {
  if (!file) return;
  writeFileAtomic(file, JSON.stringify({ ...readLayoutWrites(file), [path]: sha }, null, 2));
}

/** Forget the records for these paths (after they were published). */
export function clearLayoutWrites(file, paths) {
  if (!file || !existsSync(file)) return;
  const data = readLayoutWrites(file);
  let changed = false;
  for (const p of paths) if (p in data) { delete data[p]; changed = true; }
  if (changed) writeFileAtomic(file, JSON.stringify(data, null, 2));
}
