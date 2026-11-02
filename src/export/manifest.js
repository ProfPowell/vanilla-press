/**
 * Export manifest: records which files Vanilla Press wrote for each document,
 * and the sha1 of each JSON it wrote (used to detect edits made on disk).
 *
 * Stored at `<site>/content/.vp-manifest.json`.
 *
 * @module export/manifest
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileAtomic } from './atomic-write.js';

/**
 * @typedef {{ json: string, html: string|null, jsonHash: string }} ManifestEntry
 * @typedef {{ version: 1, documents: Object<string, ManifestEntry> }} Manifest
 */

/**
 * sha1 hex digest.
 * @param {string|Buffer} data
 * @returns {string}
 */
export function sha1(data) {
  return createHash('sha1').update(data).digest('hex');
}

/**
 * Absolute manifest path for a workspace.
 * @param {{ contentDir: string }} ws
 * @returns {string}
 */
export function manifestPath(ws) {
  return join(ws.contentDir, '.vp-manifest.json');
}

/**
 * Read the manifest (an empty one if missing or unreadable).
 * @param {{ contentDir: string }} ws
 * @returns {Manifest}
 */
export function readManifest(ws) {
  const file = manifestPath(ws);
  if (existsSync(file)) {
    try {
      const m = JSON.parse(readFileSync(file, 'utf8'));
      if (m && typeof m.documents === 'object' && m.documents) return { version: 1, documents: m.documents };
    } catch { /* fall through to empty */ }
  }
  return { version: 1, documents: {} };
}

/**
 * Write the manifest atomically.
 * @param {{ contentDir: string }} ws
 * @param {Manifest} manifest
 */
export function writeManifest(ws, manifest) {
  writeFileAtomic(manifestPath(ws), JSON.stringify(manifest, null, 2) + '\n');
}
