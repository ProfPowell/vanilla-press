/**
 * Database migration for Vanilla Press.
 *
 * Reads schema.sql and applies it to the given database.
 * Sets WAL mode for better concurrent read performance.
 *
 * @module store/migrate
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(__dirname, 'schema.sql');

/**
 * Add the columns `table` lacks (SQLite has no ADD COLUMN IF NOT EXISTS).
 * @param {import('better-sqlite3').Database} db
 * @param {string} table
 * @param {Record<string, string>} columns - name -> SQL type
 * @returns {string[]} the names added
 */
export function addMissingColumns(db, table, columns) {
  const have = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
  const added = [];
  for (const [name, type] of Object.entries(columns)) {
    if (have.has(name)) continue;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    added.push(name);
  }
  return added;
}

/**
 * Run migrations on a database.
 * @param {import('better-sqlite3').Database} db
 */
export function migrate(db) {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const schema = readFileSync(SCHEMA_PATH, 'utf-8');
  db.exec(schema);

  // Columns added after the first release go here, so existing databases get them.
  const mediaAdded = addMissingColumns(db, 'media', {
    original_name: 'TEXT', width: 'INTEGER', height: 'INTEGER', edited_from: 'TEXT',
  });
  addMissingColumns(db, 'documents', { image: 'TEXT', theme: 'TEXT', theme_scope: 'TEXT' });
  // Before these columns, uploads without alt text stored '' (M2): that means "never written".
  if (mediaAdded.includes('original_name')) db.exec("UPDATE media SET alt = NULL WHERE alt = ''");
}
