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
  source      TEXT, -- 'openverse' | 'pexels' | 'pixabay' | 'manual' | NULL
  credit      TEXT  -- JSON Credit (media/credit.js), or NULL
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
