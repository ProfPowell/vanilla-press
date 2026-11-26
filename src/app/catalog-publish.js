/**
 * Publish a collection ("catalog") to the site: an item's Publish or Unpublish, or
 * the collection's own design or level. Same steps as a post's (setPublished):
 * checks, status change, data file, build check (a failure puts the status and
 * the file back), commit, push.
 *
 * @module app/catalog-publish
 */

import { GitNotConnectedError } from '../git/git.js';
import { getCatalog, listItems, getItem, updateItem, restoreItem } from '../store/catalogs.js';
import { catalogFilePath, writeCatalogFile, photoAccessWarnings } from '../sync/catalog-files.js';
import { writeMediaJson } from '../sync/site-files.js';
import { isMissing } from '../sync/media-library.js';
import { higherAccess } from '../access/levels.js';
import { snapshotFile, restoreFile } from './site-theme.js';
import { BuildError, PublishRejectedError, buildCheck, readSiteUrl } from './publish.js';

const photoFiles = (items) => [...new Set(items.flatMap((i) => (i.photos ?? []).map((p) => p?.file).filter(Boolean)))];

/**
 * @param {{
 *   ws: import('../workspace/workspace.js').Workspace,
 *   db: import('better-sqlite3').Database,
 *   catalogId: string,
 *   change: { itemId: string, publish: boolean } | null,
 *   confirmRaisePhotoAccess?: boolean,
 *   deps: { ensureInstalled: Function, runBuild: Function, commitPaths: Function, push: Function,
 *     gitStatus: Function, readSiteUrl?: Function },
 * }} options - change: an item's Publish (`publish: true`) or Unpublish; null re-publishes
 *   the collection itself (its design or level) with the items already published.
 *   The items going live (the item published, or every published item for null) are
 *   refused (422) with no title or with a photo missing from src/media, and (409, body
 *   `photoWarnings` from photoAccessWarnings) when a photo is less restricted than the
 *   item, until confirmRaisePhotoAccess: then each such photo's media level is raised to
 *   what its items need and content/media.json rewritten.
 * @returns {Promise<{ status: 'pushed'|'saved', sha: string|null, url: string|null }>}
 *   url: the item's (or collection's) page, null for Unpublish or without a siteUrl
 * @throws {BuildError|PublishRejectedError|Error} git errors propagate (GitConflictError, ...)
 */
export async function publishCatalog({ ws, db, catalogId, change = null, confirmRaisePhotoAccess = false, deps }) {
  const catalog = getCatalog(db, catalogId);
  if (!catalog) throw new PublishRejectedError(404, { error: 'Collection not found' });
  const previous = change ? getItem(db, change.itemId) : null;
  if (change && (!previous || previous.catalogId !== catalog.id)) throw new PublishRejectedError(404, { error: 'Item not found' });

  const going = !change ? listItems(db, catalog.id).filter((i) => i.status === 'published')
    : change.publish ? [previous] : [];
  const untitled = going.find((i) => !String(i.title ?? '').trim());
  if (untitled) throw new PublishRejectedError(422, { error: 'Give the item a title before publishing.' });
  const linked = db.prepare('SELECT url FROM media WHERE filename = ?');
  const missing = photoFiles(going).filter((file) => isMissing(ws.mediaDir, file, linked.get(file)?.url ?? null));
  if (missing.length) {
    throw new PublishRejectedError(422, {
      error: `Photos missing from src/media: ${missing.join(', ')}. Remove them or add the files, then publish.`,
    });
  }

  // A photo less restricted than its item would show in a tree the item is not in: ask first.
  const photoWarnings = photoAccessWarnings(db, catalog, going);
  if (photoWarnings.length && !confirmRaisePhotoAccess) {
    throw new PublishRejectedError(409, {
      error: `These photos are less restricted than the items using them: ${photoWarnings.map((w) => `${w.file} (${w.access}, needs ${w.needed})`).join(', ')}. Confirm to raise them.`,
      photoWarnings,
    });
  }
  if (photoWarnings.length) {
    const raise = new Map();
    for (const w of photoWarnings) raise.set(w.file, higherAccess(raise.get(w.file), w.needed));
    const set = db.prepare('UPDATE media SET access = ? WHERE filename = ?');
    db.transaction(() => { for (const [file, access] of raise) set.run(access, file); })();
    writeMediaJson(ws, db);
  }

  // 1. The status change (a first publish sets `published`), then the data file.
  const file = catalogFilePath(ws, catalog.slug);
  const fileBefore = snapshotFile(file);
  const item = change ? updateItem(db, previous.id, { status: change.publish ? 'published' : 'draft' }) : null;
  const undo = () => {
    if (previous) restoreItem(db, previous);
    restoreFile(file, fileBefore);
  };
  try {
    writeCatalogFile(ws, db, catalog.id);
  } catch (err) {
    undo();
    throw err;
  }

  // 2. Build check; on failure put the previous status and file back.
  const build = await buildCheck(ws, deps);
  if (!build.ok) {
    undo();
    throw new BuildError(build.log);
  }

  // 3. Commit the data file, media.json and the photos.
  const status = await deps.gitStatus(ws.siteDir);
  let sha = null;
  if (status.isRepo) {
    const photos = photoFiles(change ? [item] : going).map((f) => `src/media/${f}`);
    const paths = [`content/catalogs/${catalog.slug}.json`, 'content/media.json', ...photos];
    const message = !change ? `Update collection: ${catalog.title}`
      : `${change.publish ? 'Publish' : 'Unpublish'} collection item: ${item.title}`;
    sha = await deps.commitPaths(ws.siteDir, paths, message);
  }

  let url = null;
  if (!change || change.publish) {
    const siteUrl = await (deps.readSiteUrl || readSiteUrl)(ws.siteDir);
    const path = `/collections/${catalog.slug}/${change ? `${item.slug}/` : ''}`;
    url = siteUrl ? siteUrl.replace(/\/+$/, '') + path : null;
  }

  // 4. Push (every local commit, earlier unpushed ones included).
  if (!status.isRepo || !status.hasRemote || !status.hasUpstream) return { status: 'saved', sha, url };
  try {
    await deps.push(ws.siteDir);
  } catch (err) {
    if (err instanceof GitNotConnectedError) return { status: 'saved', sha, url };
    throw err;
  }
  return { status: 'pushed', sha, url };
}
