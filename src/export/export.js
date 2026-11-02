/**
 * Export one document into a Cook site: a JSON source file plus, when
 * published, a front-matter HTML page. Tracks what it wrote in a manifest so
 * it only ever removes its own files and can detect edits made on disk.
 *
 * @module export/export
 */

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { render } from '../renderers/html.js';
import { frontMatter } from './front-matter.js';
import { collectionOutput, outputPaths } from './paths.js';
import { writeFileAtomic } from './atomic-write.js';
import { readManifest, writeManifest, sha1 } from './manifest.js';

export { readManifest, writeManifest } from './manifest.js';
export { writeFileAtomic } from './atomic-write.js';

/** Thrown when the JSON on disk was changed outside Vanilla Press. */
export class ExportConflictError extends Error {
  /** @param {string} path - Site-relative path of the conflicting file */
  constructor(path) {
    super(`${path} changed on disk`);
    this.name = 'ExportConflictError';
    this.path = path;
  }
}

function fileHash(ws, rel) {
  return sha1(readFileSync(join(ws.siteDir, rel)));
}

/**
 * True when the JSON at `jsonRelPath` exists and either has no manifest entry
 * for `docId` or its sha1 differs from the entry's `jsonHash`.
 * @param {import('../workspace/workspace.js').Workspace} ws
 * @param {string} docId
 * @param {string} jsonRelPath - Site-relative
 * @returns {boolean}
 */
export function changedOnDisk(ws, docId, jsonRelPath) {
  if (!existsSync(join(ws.siteDir, jsonRelPath))) return false;
  const entry = readManifest(ws).documents[docId];
  if (!entry || entry.json !== jsonRelPath) return true;
  return fileHash(ws, jsonRelPath) !== entry.jsonHash;
}

function validSegment(v) {
  return typeof v === 'string' && v !== '' && !/[/\\]/.test(v) && !v.includes('..') && !v.startsWith('.');
}

function removeFile(ws, rel, removed) {
  const abs = join(ws.siteDir, rel);
  if (existsSync(abs)) {
    rmSync(abs);
    removed.push(rel);
  }
}

/** Another manifest entry (not `docId`) that claims `rel`, or undefined. */
function claimant(manifest, docId, rel) {
  return Object.keys(manifest.documents).find(
    (id) => id !== docId && (manifest.documents[id].json === rel || manifest.documents[id].html === rel),
  );
}

function validOutputPath(path) {
  const dir = path.replace(/^\/+|\/+$/g, '');
  if (dir === '') return true;
  return dir.split('/').every((seg) => seg !== '' && seg !== '..' && !seg.includes('\\') && !seg.startsWith('.'));
}

/**
 * Every check exportDocument makes before its first write: valid
 * slug/collection and output path, the target JSON (and, on a rename, the old
 * JSON) unchanged on disk, and an HTML target that no other document claims
 * and that is not a file Vanilla Press did not write. Writes nothing.
 * @param {import('../workspace/workspace.js').Workspace} ws
 * @param {Object} doc
 * @param {{ collectionsConfig?: Object }} [options]
 * @throws {ExportConflictError} when a JSON it would write or remove changed on disk
 * @throws {Error} on an invalid slug/collection/output path, or an HTML collision / foreign file
 */
export function checkExport(ws, doc, { collectionsConfig } = {}) {
  const { slug, collection } = doc.meta;
  for (const v of [slug, collection]) {
    if (!validSegment(v)) throw new Error(`Invalid slug/collection: ${v}`);
  }
  const { path: outPath } = collectionOutput(collection, collectionsConfig);
  if (!validOutputPath(outPath)) throw new Error(`Invalid output path: ${outPath}`);

  const paths = outputPaths(doc, collectionsConfig);
  const manifest = readManifest(ws);
  const previous = manifest.documents[doc.id];

  if (changedOnDisk(ws, doc.id, paths.json)) throw new ExportConflictError(paths.json);
  if (previous && previous.json !== paths.json && changedOnDisk(ws, doc.id, previous.json)) {
    throw new ExportConflictError(previous.json);
  }

  if (paths.html) {
    const other = claimant(manifest, doc.id, paths.html);
    if (other) throw new Error(`Output path ${paths.html} is already used by document ${other}`);
    if (existsSync(join(ws.siteDir, paths.html)) && previous?.html !== paths.html) {
      throw new Error(`Refusing to overwrite ${paths.html}: not written by Vanilla Press`);
    }
  }
}

/**
 * Export a document. Writes the JSON; if published, the HTML page; removes
 * paths this document owned before that are no longer wanted; records the
 * manifest entry. Everything that can fail without touching the filesystem
 * (validation, conflict checks, rendering) happens before the first write.
 * @param {import('../workspace/workspace.js').Workspace} ws
 * @param {Object} doc
 * @param {{ collectionsConfig?: Object, render?: Function }} [options] - `render` overrides the renderer (tests)
 * @returns {{ written: string[], removed: string[] }}
 * @throws {ExportConflictError} when the target JSON (or the JSON a rename would delete) changed on disk
 */
export function exportDocument(ws, doc, { collectionsConfig, render: renderFn = render } = {}) {
  checkExport(ws, doc, { collectionsConfig });
  const { layout } = collectionOutput(doc.meta.collection, collectionsConfig);
  const paths = outputPaths(doc, collectionsConfig);
  const manifest = readManifest(ws);
  const previous = manifest.documents[doc.id];

  const jsonText = JSON.stringify(doc, null, 2) + '\n';
  const htmlText = paths.html
    ? frontMatter(doc, { layout }) + renderFn(doc, { scope: 'content', bare: true }) + '\n'
    : null;

  const written = [];
  const removed = [];

  writeFileAtomic(join(ws.siteDir, paths.json), jsonText);
  written.push(paths.json);
  if (paths.html) {
    writeFileAtomic(join(ws.siteDir, paths.html), htmlText);
    written.push(paths.html);
  }

  if (previous) {
    for (const old of [previous.json, previous.html]) {
      if (old && old !== paths.json && old !== paths.html && !claimant(manifest, doc.id, old)) {
        removeFile(ws, old, removed);
      }
    }
  }

  manifest.documents[doc.id] = { json: paths.json, html: paths.html, jsonHash: sha1(jsonText) };
  writeManifest(ws, manifest);
  return { written, removed };
}

/**
 * Delete a document's exported files (missing files are fine) and its
 * manifest entry. Paths another entry still claims are left alone.
 * @param {import('../workspace/workspace.js').Workspace} ws
 * @param {string} docId
 * @returns {{ removed: string[] }}
 * @throws {ExportConflictError} when the recorded JSON changed on disk
 */
export function removeExport(ws, docId) {
  const manifest = readManifest(ws);
  const entry = manifest.documents[docId];
  const removed = [];
  if (!entry) return { removed };
  if (changedOnDisk(ws, docId, entry.json)) throw new ExportConflictError(entry.json);
  for (const rel of [entry.json, entry.html]) {
    if (rel && !claimant(manifest, docId, rel)) removeFile(ws, rel, removed);
  }
  delete manifest.documents[docId];
  writeManifest(ws, manifest);
  return { removed };
}

/**
 * Record the JSON file's current hash as the known state (after importing it).
 * @param {import('../workspace/workspace.js').Workspace} ws
 * @param {string} docId
 * @param {string} jsonRelPath - Site-relative
 */
export function recordImported(ws, docId, jsonRelPath) {
  const manifest = readManifest(ws);
  const entry = manifest.documents[docId] || { json: jsonRelPath, html: null, jsonHash: '' };
  entry.json = jsonRelPath;
  entry.jsonHash = fileHash(ws, jsonRelPath);
  manifest.documents[docId] = entry;
  writeManifest(ws, manifest);
}
