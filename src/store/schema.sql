-- Vanilla Press schema
-- Documents table: stores content as JSON blocks with denormalized metadata

CREATE TABLE IF NOT EXISTS documents (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  slug        TEXT NOT NULL,
  collection  TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'draft',
  description TEXT,
  author_id   TEXT,
  created     TEXT NOT NULL,
  updated     TEXT NOT NULL,
  published   TEXT,
  tags        TEXT, -- JSON array
  image       TEXT, -- featured image URL (/media/<file>)
  theme       TEXT, -- page theme id (meta.theme)
  theme_scope TEXT, -- 'page' | 'article' (meta.themeScope)
  layout      TEXT, -- page layout name (meta.layout)
  section     TEXT, -- the post's section id (meta.section)
  access      TEXT NOT NULL DEFAULT 'public', -- 'public' | 'friends' | 'private' (meta.access; absent when public)
  regions     TEXT, -- JSON object: region name -> block AST array
  blocks      TEXT NOT NULL, -- JSON array of block AST
  plaintext   TEXT NOT NULL DEFAULT '',
  UNIQUE(collection, slug)
);

CREATE INDEX IF NOT EXISTS idx_documents_collection ON documents(collection);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_slug ON documents(collection, slug);
CREATE INDEX IF NOT EXISTS idx_documents_published ON documents(published);

-- Full-text search via FTS5
CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
  title,
  description,
  plaintext,
  tags,
  content='documents',
  content_rowid='rowid'
);

-- Keep FTS in sync with triggers
CREATE TRIGGER IF NOT EXISTS documents_ai AFTER INSERT ON documents BEGIN
  INSERT INTO documents_fts(rowid, title, description, plaintext, tags)
  VALUES (new.rowid, new.title, new.description, new.plaintext, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS documents_ad AFTER DELETE ON documents BEGIN
  INSERT INTO documents_fts(documents_fts, rowid, title, description, plaintext, tags)
  VALUES ('delete', old.rowid, old.title, old.description, old.plaintext, old.tags);
END;

CREATE TRIGGER IF NOT EXISTS documents_au AFTER UPDATE ON documents BEGIN
  INSERT INTO documents_fts(documents_fts, rowid, title, description, plaintext, tags)
  VALUES ('delete', old.rowid, old.title, old.description, old.plaintext, old.tags);
  INSERT INTO documents_fts(rowid, title, description, plaintext, tags)
  VALUES (new.rowid, new.title, new.description, new.plaintext, new.tags);
END;

-- Media table: tracks uploaded assets
CREATE TABLE IF NOT EXISTS media (
  id          TEXT PRIMARY KEY,
  filename    TEXT NOT NULL,
  original_name TEXT,
  mime_type   TEXT NOT NULL,
  size        INTEGER NOT NULL,
  width       INTEGER,
  height      INTEGER,
  alt         TEXT, -- NULL: never written, '': decorative
  edited_from TEXT,
  created     TEXT NOT NULL,
  source      TEXT, -- 'openverse' | 'pexels' | 'pixabay' | 'unsplash' | 'manual' | NULL
  credit      TEXT, -- JSON Credit (media/credit.js), or NULL
  url         TEXT, -- a linked item's remote image (https://images.unsplash.com/...): no file; NULL for a file
  access      TEXT NOT NULL DEFAULT 'public' -- 'public' | 'friends' | 'private' (schema/content-schema.js validAccess)
);

-- Authors table
CREATE TABLE IF NOT EXISTS authors (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT,
  url         TEXT,
  avatar      TEXT
);

-- Config table: key-value store for site settings (theme, etc.)
CREATE TABLE IF NOT EXISTS config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Where each program was added from (Update from source): local to this computer, never in the repo
CREATE TABLE IF NOT EXISTS program_sources (
  area   TEXT NOT NULL,
  slug   TEXT NOT NULL,
  source TEXT NOT NULL,
  PRIMARY KEY (area, slug)
);

-- Collections ("catalogs" internally: "collection" already means a document type)
CREATE TABLE IF NOT EXISTS catalogs (
  id          TEXT PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  access      TEXT NOT NULL DEFAULT 'public', -- 'public' | 'friends' | 'private'
  template    TEXT,
  design      TEXT NOT NULL, -- JSON: fields, lists, grading, sort
  created     TEXT NOT NULL,
  updated     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS catalog_items (
  id          TEXT PRIMARY KEY,
  catalog_id  TEXT NOT NULL REFERENCES catalogs(id),
  slug        TEXT NOT NULL,
  title       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'draft', -- 'draft' | 'published'
  access      TEXT NOT NULL DEFAULT 'public',
  rating      INTEGER,
  description TEXT NOT NULL DEFAULT '',
  video       TEXT NOT NULL DEFAULT '',
  links       TEXT NOT NULL DEFAULT '[]',    -- JSON [{label, url}]
  tags        TEXT NOT NULL DEFAULT '[]',    -- JSON [string]
  categories  TEXT NOT NULL DEFAULT '{}',    -- JSON {listId: [choiceId]}
  grade       TEXT,                          -- JSON or NULL
  fields      TEXT NOT NULL DEFAULT '{}',    -- JSON {fieldId: value}
  photos      TEXT NOT NULL DEFAULT '[]',    -- JSON [{file, main}]
  created     TEXT NOT NULL,
  updated     TEXT NOT NULL,
  published   TEXT,
  UNIQUE(catalog_id, slug)
);
