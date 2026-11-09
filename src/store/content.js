/**
 * Content store for Vanilla Press.
 *
 * All functions take `db` as first argument for dependency injection
 * (works with both better-sqlite3 locally and Cloudflare D1).
 *
 * @module store/content
 */

/**
 * Extract plaintext from a blocks array for FTS indexing.
 * Recursively walks the block tree, collecting all text values.
 * @param {Object[]} blocks
 * @returns {string}
 */
export function extractPlaintext(blocks) {
  if (!Array.isArray(blocks)) return '';
  const parts = [];

  for (const block of blocks) {
    if (!block) continue;

    if (block.value && typeof block.value === 'string') {
      parts.push(block.value);
    }

    if (Array.isArray(block.children)) {
      parts.push(extractPlaintext(block.children));
    }
  }

  return parts.filter(Boolean).join(' ');
}

/**
 * Convert a database row to the document shape renderers expect.
 * @param {Object} row
 * @returns {Object}
 */
function rowToDocument(row) {
  return {
    id: row.id,
    meta: {
      title: row.title,
      slug: row.slug,
      collection: row.collection,
      status: row.status,
      description: row.description || undefined,
      author_id: row.author_id || undefined,
      created: row.created,
      updated: row.updated,
      published: row.published || undefined,
      tags: row.tags ? JSON.parse(row.tags) : undefined,
      image: row.image || undefined,
      theme: row.theme || undefined,
      themeScope: (row.theme && row.theme_scope) || undefined,
    },
    blocks: JSON.parse(row.blocks),
  };
}

/**
 * Get a single document by ID.
 * @param {import('better-sqlite3').Database} db
 * @param {string} id
 * @returns {Object|null}
 */
export function getDocument(db, id) {
  const row = db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
  return row ? rowToDocument(row) : null;
}

/**
 * Get a document by collection and slug.
 * @param {import('better-sqlite3').Database} db
 * @param {string} collection
 * @param {string} slug
 * @returns {Object|null}
 */
export function getDocumentBySlug(db, collection, slug) {
  const row = db.prepare(
    'SELECT * FROM documents WHERE collection = ? AND slug = ?'
  ).get(collection, slug);
  return row ? rowToDocument(row) : null;
}

/**
 * List documents in a collection, optionally filtered by tag.
 * Returns published documents sorted by published date descending.
 * @param {import('better-sqlite3').Database} db
 * @param {string} collection
 * @param {Object} [options]
 * @param {string} [options.tag] - Filter by tag
 * @param {string} [options.status='published'] - Filter by status
 * @param {number} [options.limit]
 * @param {number} [options.offset=0]
 * @returns {Object[]}
 */
export function listCollection(db, collection, options = {}) {
  const { tag, status = 'published', limit, offset = 0 } = options;

  let sql = 'SELECT * FROM documents WHERE collection = ? AND status = ?';
  const params = [collection, status];

  if (tag) {
    sql += " AND tags LIKE ?";
    params.push(`%"${tag}"%`);
  }

  sql += ' ORDER BY published DESC, created DESC';

  if (limit) {
    sql += ' LIMIT ? OFFSET ?';
    params.push(limit, offset);
  }

  const rows = db.prepare(sql).all(...params);
  return rows.map(rowToDocument);
}

/**
 * Save a document (insert or update).
 * @param {import('better-sqlite3').Database} db
 * @param {Object} doc - Document with id, meta, blocks
 * @returns {Object} The saved document
 */
export function saveDocument(db, doc) {
  const { id, meta, blocks } = doc;
  const plaintext = extractPlaintext(blocks);
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO documents (id, title, slug, collection, status, description, author_id, created, updated, published, tags, image, theme, theme_scope, blocks, plaintext)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      slug = excluded.slug,
      collection = excluded.collection,
      status = excluded.status,
      description = excluded.description,
      author_id = excluded.author_id,
      updated = excluded.updated,
      published = excluded.published,
      tags = excluded.tags,
      image = excluded.image,
      theme = excluded.theme,
      theme_scope = excluded.theme_scope,
      blocks = excluded.blocks,
      plaintext = excluded.plaintext
  `).run(
    id,
    meta.title,
    meta.slug,
    meta.collection,
    meta.status || 'draft',
    meta.description || null,
    meta.author_id || null,
    meta.created || now,
    meta.updated || now,
    meta.published || null,
    meta.tags ? JSON.stringify(meta.tags) : null,
    meta.image || null,
    meta.theme || null,
    (meta.theme && meta.themeScope) || null,
    JSON.stringify(blocks),
    plaintext,
  );

  return getDocument(db, id);
}

/**
 * Delete a document by ID.
 * @param {import('better-sqlite3').Database} db
 * @param {string} id
 * @returns {boolean} True if a document was deleted
 */
export function deleteDocument(db, id) {
  const result = db.prepare('DELETE FROM documents WHERE id = ?').run(id);
  return result.changes > 0;
}

/**
 * Full-text search across documents.
 * @param {import('better-sqlite3').Database} db
 * @param {string} query
 * @param {Object} [options]
 * @param {number} [options.limit=20]
 * @returns {Object[]}
 */
export function searchDocuments(db, query, options = {}) {
  const { limit = 20 } = options;
  const rows = db.prepare(`
    SELECT d.* FROM documents d
    JOIN documents_fts fts ON d.rowid = fts.rowid
    WHERE documents_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `).all(query, limit);
  return rows.map(rowToDocument);
}

/**
 * Get all unique tags across published documents.
 * @param {import('better-sqlite3').Database} db
 * @returns {string[]}
 */
export function getAllTags(db) {
  const rows = db.prepare(
    "SELECT DISTINCT tags FROM documents WHERE status = 'published' AND tags IS NOT NULL"
  ).all();

  const tagSet = new Set();
  for (const row of rows) {
    const tags = JSON.parse(row.tags);
    for (const tag of tags) {
      tagSet.add(tag);
    }
  }

  return [...tagSet].sort();
}

/**
 * Get all distinct collections.
 * @param {import('better-sqlite3').Database} db
 * @returns {string[]}
 */
export function getCollections(db) {
  const rows = db.prepare(
    'SELECT DISTINCT collection FROM documents ORDER BY collection'
  ).all();
  return rows.map(r => r.collection);
}

/**
 * Get all published documents across all collections.
 * @param {import('better-sqlite3').Database} db
 * @returns {Object[]}
 */
export function getAllPublished(db) {
  const rows = db.prepare(
    "SELECT * FROM documents WHERE status = 'published' ORDER BY published DESC, created DESC"
  ).all();
  return rows.map(rowToDocument);
}

/**
 * Every document (drafts included) in one query.
 * @param {import('better-sqlite3').Database} db
 * @returns {Object[]}
 */
export function getAllDocuments(db) {
  return db.prepare('SELECT * FROM documents').all().map(rowToDocument);
}

/**
 * The folder a program was added from, or null.
 * @param {import('better-sqlite3').Database} db
 * @param {string} area
 * @param {string} slug
 * @returns {string|null}
 */
export function getProgramSource(db, area, slug) {
  const row = db.prepare('SELECT source FROM program_sources WHERE area = ? AND slug = ?').get(area, slug);
  return row ? row.source : null;
}

/**
 * Remember the folder a program was added from (replacing any earlier one).
 * @param {import('better-sqlite3').Database} db
 * @param {string} area
 * @param {string} slug
 * @param {string} source
 */
export function setProgramSource(db, area, slug, source) {
  db.prepare('INSERT OR REPLACE INTO program_sources (area, slug, source) VALUES (?, ?, ?)').run(area, slug, source);
}

/**
 * Forget a program's source folder.
 * @param {import('better-sqlite3').Database} db
 * @param {string} area
 * @param {string} slug
 */
export function deleteProgramSource(db, area, slug) {
  db.prepare('DELETE FROM program_sources WHERE area = ? AND slug = ?').run(area, slug);
}
