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
 * Run migrations on a database.
 * @param {import('better-sqlite3').Database} db
 */
export function migrate(db) {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const schema = readFileSync(SCHEMA_PATH, 'utf-8');
  db.exec(schema);
}
