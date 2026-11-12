import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrate, addMissingColumns } from '../../src/store/migrate.js';

const OLD_MEDIA = `CREATE TABLE media (
  id TEXT PRIMARY KEY, filename TEXT NOT NULL, mime_type TEXT NOT NULL,
  size INTEGER NOT NULL, alt TEXT, created TEXT NOT NULL)`;
const ins = (db, id, alt) => db.prepare(
  'INSERT INTO media (id, filename, mime_type, size, alt, created) VALUES (?, ?, ?, ?, ?, ?)',
).run(id, `${id}.png`, 'image/png', 1, alt, '2026-01-01T00:00:00.000Z');

describe('migrate', () => {
  it('migration adds the media columns and turns legacy empty alt into null once', () => {
    const db = new Database(':memory:');
    db.exec(OLD_MEDIA);
    ins(db, 'old', '');
    migrate(db);
    const cols = db.prepare('PRAGMA table_info(media)').all().map((c) => c.name);
    for (const c of ['original_name', 'width', 'height', 'edited_from', 'source', 'credit', 'url']) assert.ok(cols.includes(c), c);
    assert.equal(db.prepare("SELECT alt FROM media WHERE id = 'old'").get().alt, null);
    ins(db, 'new', '');
    migrate(db);
    assert.equal(db.prepare("SELECT alt FROM media WHERE id = 'new'").get().alt, '');
    db.close();
  });

  it('addMissingColumns returns only the columns it added', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE t (a TEXT)');
    assert.deepEqual(addMissingColumns(db, 't', { a: 'TEXT', b: 'INTEGER' }), ['b']);
    assert.deepEqual(addMissingColumns(db, 't', { a: 'TEXT', b: 'INTEGER' }), []);
    db.close();
  });
});

describe('migrate documents', () => {
  it('an old database gains the layout and regions columns', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE documents (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, slug TEXT NOT NULL, collection TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft', description TEXT, author_id TEXT, created TEXT NOT NULL,
      updated TEXT NOT NULL, published TEXT, tags TEXT, blocks TEXT NOT NULL, plaintext TEXT NOT NULL DEFAULT '',
      UNIQUE(collection, slug))`);
    migrate(db);
    const cols = db.prepare('PRAGMA table_info(documents)').all().map((c) => c.name);
    assert.ok(cols.includes('layout'));
    assert.ok(cols.includes('regions'));
    db.close();
  });
});
