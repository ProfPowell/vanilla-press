/**
 * Export manifest: records which files Vanilla Press wrote for each document,
 * and the sha1 of each JSON it wrote (used to detect edits made on disk).
 *
 * Stored at `<site>/.vp/manifest.json`: machine-local (the site gitignores
 * `.vp/`), so a pulled edit is never mistaken for one this machine wrote.
 * Ownership of HTML pages is not taken from here but from each page's `vp_id`
 * front matter; the `html` field is only a hint for removing old paths. An
 * old `content/.vp-manifest.json` is obsolete and ignored.
 *
 * @module export/manifest
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
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

const LABEL = '.vp/manifest.json';

/**
 * Absolute manifest path for a workspace.
 * @param {{ siteDir: string }} ws
 * @returns {string}
 */
export function manifestPath(ws) {
  return join(ws.siteDir, '.vp', 'manifest.json');
}

/**
 * Read the manifest (an empty one only if the file does not exist; throws if unreadable or corrupt).
 * @param {{ siteDir: string }} ws
 * @returns {Manifest}
 */
export function readManifest(ws) {
  let text;
  try {
    text = readFileSync(manifestPath(ws), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { version: 1, documents: {} };
    throw new Error(`Cannot read ${LABEL}: ${err.message}`);
  }
  let m;
  try {
    m = JSON.parse(text);
  } catch (err) {
    throw new Error(`Cannot read ${LABEL}: ${err.message}`);
  }
  if (!m || typeof m.documents !== 'object' || !m.documents) {
    throw new Error(`Cannot read ${LABEL}: missing "documents"`);
  }
  return { version: 1, documents: m.documents };
}

/**
 * Write the manifest atomically.
 * @param {{ siteDir: string }} ws
 * @param {Manifest} manifest
 */
export function writeManifest(ws, manifest) {
  writeFileAtomic(manifestPath(ws), JSON.stringify(manifest, null, 2) + '\n');
}
