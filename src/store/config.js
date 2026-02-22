/**
 * Config store for Vanilla Press.
 *
 * Simple key-value store backed by the `config` table.
 * Used for site settings like theme, site title, etc.
 *
 * @module store/config
 */

/**
 * Get a config value by key.
 * @param {import('better-sqlite3').Database} db
 * @param {string} key
 * @returns {string|null}
 */
export function getConfig(db, key) {
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key);
  return row ? row.value : null;
}

/**
 * Set a config value.
 * @param {import('better-sqlite3').Database} db
 * @param {string} key
 * @param {string} value
 */
export function setConfig(db, key, value) {
  db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(key, value);
}

/**
 * Get all config values as an object.
 * @param {import('better-sqlite3').Database} db
 * @returns {Record<string, string>}
 */
export function getAllConfig(db) {
  const rows = db.prepare('SELECT key, value FROM config ORDER BY key').all();
  const result = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}
