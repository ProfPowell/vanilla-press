/**
 * Collections ("catalog") store for Vanilla Press.
 *
 * All functions take `db` as first argument, like store/content.js.
 *
 * @module store/catalogs
 */

import { newId, slugify, uniqueSlug } from '../catalogs/model.js';

/** Thrown when a delete is refused because published items exist. */
export class CatalogHasPublishedError extends Error {
  constructor(message = 'Published items must be unpublished first') {
    super(message);
    this.name = 'CatalogHasPublishedError';
  }
}

const now = () => new Date().toISOString();

function rowToCatalog(row) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    access: row.access,
    template: row.template,
    design: JSON.parse(row.design),
    created: row.created,
    updated: row.updated,
  };
}

function rowToItem(row) {
  return {
    id: row.id,
    catalogId: row.catalog_id,
    slug: row.slug,
    title: row.title,
    status: row.status,
    access: row.access,
    rating: row.rating,
    description: row.description,
    video: row.video,
    links: JSON.parse(row.links),
    tags: JSON.parse(row.tags),
    categories: JSON.parse(row.categories),
    grade: row.grade ? JSON.parse(row.grade) : null,
    fields: JSON.parse(row.fields),
    photos: JSON.parse(row.photos),
    created: row.created,
    updated: row.updated,
    published: row.published,
  };
}

/** @param {import('better-sqlite3').Database} db */
export function listCatalogs(db) {
  return db.prepare('SELECT * FROM catalogs ORDER BY title').all().map(rowToCatalog);
}

export function getCatalog(db, id) {
  const row = db.prepare('SELECT * FROM catalogs WHERE id = ?').get(id);
  return row ? rowToCatalog(row) : null;
}

export function getCatalogBySlug(db, slug) {
  const row = db.prepare('SELECT * FROM catalogs WHERE slug = ?').get(slug);
  return row ? rowToCatalog(row) : null;
}

function hasPublished(db, catalogId) {
  return !!db.prepare("SELECT 1 FROM catalog_items WHERE catalog_id = ? AND status = 'published' LIMIT 1").get(catalogId);
}

// Slugs are part of published URLs: locked once any item was ever published.
function everPublished(db, catalogId) {
  return !!db.prepare('SELECT 1 FROM catalog_items WHERE catalog_id = ? AND published IS NOT NULL LIMIT 1').get(catalogId);
}

function isSlugCollision(e) {
  return e?.code === 'SQLITE_CONSTRAINT_UNIQUE' || /UNIQUE constraint/.test(e?.message ?? '');
}

export function createCatalog(db, { title, template = null, design, access = 'public', description = '' }) {
  const taken = new Set(db.prepare('SELECT slug FROM catalogs').all().map((r) => r.slug));
  const slug = uniqueSlug(slugify(title), taken);
  const id = newId('cat');
  const t = now();
  db.prepare(`INSERT INTO catalogs (id, slug, title, description, access, template, design, created, updated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, slug, title, description, access, template, JSON.stringify(design), t, t);
  return getCatalog(db, id);
}

/**
 * @throws {Error} when the slug changes while any item is published
 */
export function updateCatalog(db, id, patch) {
  const cur = getCatalog(db, id);
  if (!cur) return null;
  if (patch.slug != null && patch.slug !== cur.slug && everPublished(db, id)) {
    throw new Error('The slug cannot change once any item has been published');
  }
  const next = { ...cur, ...patch, id, created: cur.created, updated: now() };
  try {
    db.prepare(`UPDATE catalogs SET slug = ?, title = ?, description = ?, access = ?, template = ?, design = ?, updated = ?
      WHERE id = ?`).run(next.slug, next.title, next.description, next.access, next.template, JSON.stringify(next.design), next.updated, id);
  } catch (e) {
    if (isSlugCollision(e)) throw new Error(`The slug "${next.slug}" is already in use`);
    throw e;
  }
  return getCatalog(db, id);
}

/** @throws {CatalogHasPublishedError} */
export function deleteCatalog(db, id) {
  if (hasPublished(db, id)) throw new CatalogHasPublishedError();
  db.transaction(() => {
    db.prepare('DELETE FROM catalog_items WHERE catalog_id = ?').run(id);
    db.prepare('DELETE FROM catalogs WHERE id = ?').run(id);
  })();
}

export function listItems(db, catalogId) {
  return db.prepare('SELECT * FROM catalog_items WHERE catalog_id = ? ORDER BY title').all(catalogId).map(rowToItem);
}

export function getItem(db, id) {
  const row = db.prepare('SELECT * FROM catalog_items WHERE id = ?').get(id);
  return row ? rowToItem(row) : null;
}

function itemParams(item) {
  return [
    item.catalogId, item.slug, item.title, item.status, item.access, item.rating ?? null,
    item.description, item.video, JSON.stringify(item.links), JSON.stringify(item.tags),
    JSON.stringify(item.categories), item.grade ? JSON.stringify(item.grade) : null,
    JSON.stringify(item.fields), JSON.stringify(item.photos), item.created, item.updated, item.published ?? null,
  ];
}

function insertItem(db, item) {
  db.prepare(`INSERT INTO catalog_items
    (id, catalog_id, slug, title, status, access, rating, description, video, links, tags, categories, grade, fields, photos, created, updated, published)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(item.id, ...itemParams(item));
}

function saveItem(db, item) {
  try {
    db.prepare(`UPDATE catalog_items SET catalog_id = ?, slug = ?, title = ?, status = ?, access = ?, rating = ?, description = ?,
      video = ?, links = ?, tags = ?, categories = ?, grade = ?, fields = ?, photos = ?, created = ?, updated = ?, published = ?
      WHERE id = ?`).run(...itemParams(item), item.id);
  } catch (e) {
    if (isSlugCollision(e)) throw new Error(`The slug "${item.slug}" is already in use`);
    throw e;
  }
}

export function createItem(db, catalogId, partial) {
  const taken = new Set(db.prepare('SELECT slug FROM catalog_items WHERE catalog_id = ?').all(catalogId).map((r) => r.slug));
  const t = now();
  const status = partial.status ?? 'draft';
  const id = newId('item');
  insertItem(db, {
    access: 'public', rating: null, description: '', video: '', links: [], tags: [],
    categories: {}, grade: null, fields: {}, photos: [],
    ...partial,
    id,
    catalogId,
    slug: uniqueSlug(partial.slug || slugify(partial.title), taken),
    status,
    created: t,
    updated: t,
    published: status === 'published' ? t : null,
  });
  return getItem(db, id);
}

/**
 * @throws {Error} when the slug changes on a published item
 */
export function updateItem(db, id, patch) {
  const cur = getItem(db, id);
  if (!cur) return null;
  if (patch.slug != null && patch.slug !== cur.slug && cur.published) {
    throw new Error('The slug cannot change once an item is published');
  }
  const t = now();
  const next = { ...cur, ...patch, id, catalogId: cur.catalogId, created: cur.created, updated: t };
  if (next.status === 'published' && !cur.published) next.published = t;
  else next.published = cur.published;
  saveItem(db, next);
  return getItem(db, id);
}

/** @throws {CatalogHasPublishedError} */
export function deleteItem(db, id) {
  const cur = getItem(db, id);
  if (!cur) return;
  if (cur.status === 'published') throw new CatalogHasPublishedError('A published item must be unpublished first');
  db.prepare('DELETE FROM catalog_items WHERE id = ?').run(id);
}

/** Distinct tags across a catalog's items, sorted. */
export function usedTags(db, catalogId) {
  return db.prepare(`SELECT DISTINCT j.value AS tag FROM catalog_items i, json_each(i.tags) j
    WHERE i.catalog_id = ? ORDER BY j.value`).all(catalogId).map((r) => r.tag);
}
