/**
 * A collection's data file in the site repo (`content/catalogs/<slug>.json`):
 * `{ version: 1, catalog, items }`, its published items sorted by title with every
 * field (the build leaves out what a level must not show). Plus the photo check
 * a publish makes: photos less restricted than the item that shows them.
 *
 * @module sync/catalog-files
 */

import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileAtomic } from './atomic-write.js';
import { getCatalog, listItems } from '../store/catalogs.js';
import { getAllPublished } from '../store/content.js';
import { effectiveLevel } from '../catalogs/model.js';
import { accessRank } from '../access/levels.js';
import { usedFiles } from '../access/media-warnings.js';

export const CATALOG_FILE_VERSION = 1;

/**
 * @param {import('../workspace/workspace.js').Workspace} ws
 * @param {string} slug
 * @returns {string} `<site>/content/catalogs/<slug>.json`
 */
export function catalogFilePath(ws, slug) {
  return join(ws.contentDir, 'catalogs', `${slug}.json`);
}

const byTitle = (a, b) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }) || a.id.localeCompare(b.id);

/**
 * Write a collection's data file (atomically): its published items only.
 * @param {import('../workspace/workspace.js').Workspace} ws
 * @param {import('better-sqlite3').Database} db
 * @param {string} catalogId
 * @returns {string} the file's path
 */
export function writeCatalogFile(ws, db, catalogId) {
  const catalog = getCatalog(db, catalogId);
  if (!catalog) throw new Error(`No collection ${catalogId}`);
  const items = listItems(db, catalogId).filter((i) => i.status === 'published').sort(byTitle);
  const path = catalogFilePath(ws, catalog.slug);
  writeFileAtomic(path, JSON.stringify({ version: CATALOG_FILE_VERSION, catalog, items }, null, 2) + '\n');
  return path;
}

/**
 * Remove a collection's data file (nothing happens when there is none).
 * @param {import('../workspace/workspace.js').Workspace} ws
 * @param {string} slug
 */
export function removeCatalogFile(ws, slug) {
  rmSync(catalogFilePath(ws, slug), { force: true });
}

/**
 * Photos whose media level is below the level of the item showing them (the
 * higher of the collection's and the item's own): the photo would be in a tree
 * the item is not. `posts` names the published posts (blocks or featured image)
 * using the same file, which raising its level would take it from too.
 * A photo with no media row counts as public.
 * @param {import('better-sqlite3').Database} db
 * @param {Object} catalog
 * @param {Object[]} items
 * @returns {Array<{ item: { id: string, title: string }, file: string, access: string, needed: string, posts: string[] }>}
 */
export function photoAccessWarnings(db, catalog, items) {
  const levelOf = db.prepare('SELECT access FROM media WHERE filename = ?');
  let published = null; // read once, only when there is a warning
  const postsUsing = (file) => {
    published ??= getAllPublished(db).map((doc) => ({ title: doc.meta?.title ?? '', files: usedFiles(doc) }));
    return published.filter((p) => p.files.has(file)).map((p) => p.title).sort((a, b) => a.localeCompare(b));
  };
  const out = [];
  for (const item of items) {
    const needed = effectiveLevel(catalog, item);
    for (const file of new Set((item.photos ?? []).map((p) => p?.file).filter(Boolean))) {
      const access = levelOf.get(file)?.access ?? 'public';
      if (accessRank(access) >= accessRank(needed)) continue;
      out.push({ item: { id: item.id, title: item.title }, file, access, needed, posts: postsUsing(file) });
    }
  }
  return out;
}
