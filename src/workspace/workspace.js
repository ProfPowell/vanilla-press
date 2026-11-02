/**
 * Workspace resolution: which Cook site Vanilla Press is editing.
 *
 * With a site (`--site <path>` or `VP_SITE`), the store lives in
 * `<site>/.vp/content.db` and export is enabled. Without one, Vanilla Press
 * runs in fixture mode: the repo's own content.db and media/, export disabled.
 *
 * @module workspace/workspace
 */

import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { migrate } from '../store/migrate.js';

/**
 * @typedef {Object} Workspace
 * @property {string|null} siteDir
 * @property {string} dbPath
 * @property {string} mediaDir
 * @property {string|null} contentDir
 * @property {string|null} srcDir
 * @property {string|null} configDir
 * @property {boolean} exportEnabled
 */

/**
 * Resolve the workspace from an explicit site, the environment, or neither.
 * @param {Object} options
 * @param {string} [options.site] - Site directory (overrides env.VP_SITE)
 * @param {Object} [options.env] - Environment (defaults to process.env)
 * @param {string} options.repoRoot - Vanilla Press repo root (fixture mode paths)
 * @returns {Workspace}
 */
export function resolveWorkspace({ site, env = process.env, repoRoot }) {
  const siteDir = site || env.VP_SITE || null;

  if (!siteDir) {
    return {
      siteDir: null,
      dbPath: join(repoRoot, 'content.db'),
      mediaDir: join(repoRoot, 'media'),
      contentDir: null,
      srcDir: null,
      configDir: null,
      exportEnabled: false,
    };
  }

  if (!existsSync(siteDir) || !statSync(siteDir).isDirectory()) {
    throw new Error(`Site directory not found: ${siteDir}`);
  }

  return {
    siteDir,
    dbPath: join(siteDir, '.vp', 'content.db'),
    mediaDir: join(siteDir, 'src', 'media'),
    contentDir: join(siteDir, 'content'),
    srcDir: join(siteDir, 'src'),
    configDir: join(siteDir, 'config'),
    exportEnabled: true,
  };
}

/**
 * Open the workspace database, creating its directory and running migrations.
 * @param {Workspace} ws
 * @returns {import('better-sqlite3').Database}
 */
export function openWorkspaceDb(ws) {
  mkdirSync(dirname(ws.dbPath), { recursive: true });
  const db = new Database(ws.dbPath);
  migrate(db);
  return db;
}
