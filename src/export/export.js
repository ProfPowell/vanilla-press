/**
 * Export one document into a Cook site: a JSON source file plus, when
 * published, a front-matter HTML page.
 *
 * Ownership comes from the files themselves, so it survives git: an HTML page
 * belongs to the document named by its `vp_id` front matter, a JSON file to
 * the document whose `id` it holds. Only owned files are overwritten or
 * removed. The machine-local manifest (`.vp/manifest.json`) records the sha1
 * of each JSON this machine wrote or imported (to detect edits pulled or made
 * on disk) and the last paths written (a hint for removing old paths).
 *
 * @module export/export
 */

import { existsSync, readFileSync, readdirSync, rmSync, rmdirSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { render } from '../renderers/html.js';
import { frontMatter, readVpId } from './front-matter.js';
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

/** Collection names that would collide with Cook's own src/ directories. */
const RESERVED_COLLECTIONS = new Set(['layouts', 'includes', 'components', 'media', 'assets']);

function validSegment(v) {
  return typeof v === 'string' && v !== '' && !/[/\\]/.test(v) && !v.includes('..') && !v.startsWith('.');
}

function validOutputPath(path) {
  const dir = path.replace(/^\/+|\/+$/g, '');
  if (dir === '') return true;
  return dir.split('/').every((seg) => seg !== '' && seg !== '..' && !seg.includes('\\') && !seg.startsWith('.'));
}

/** True when the document's slug, collection and output path are all safe. */
function validTarget(doc, collectionsConfig) {
  const { slug, collection } = doc?.meta || {};
  return validSegment(slug) && validSegment(collection) &&
    validOutputPath(collectionOutput(collection, collectionsConfig).path);
}

/**
 * The document id an HTML page belongs to (its `vp_id`), null when it has
 * none or cannot be read, undefined when the file does not exist.
 */
function htmlOwner(ws, rel) {
  const abs = join(ws.siteDir, rel);
  if (!existsSync(abs)) return undefined;
  try {
    return readVpId(readFileSync(abs, 'utf8'));
  } catch {
    return null;
  }
}

/** The `id` inside a JSON file, null when it has none or cannot be parsed, undefined when missing. */
function jsonOwner(ws, rel) {
  const abs = join(ws.siteDir, rel);
  if (!existsSync(abs)) return undefined;
  try {
    const id = JSON.parse(readFileSync(abs, 'utf8'))?.id;
    return typeof id === 'string' ? id : null;
  } catch {
    return null;
  }
}

/**
 * Where the document's files were before this export: the local manifest
 * entry if there is one, else the paths of the previously stored version.
 * @returns {{ json: string|null, html: string|null } | null}
 */
function previousPaths(manifest, docId, previousDoc, collectionsConfig) {
  const entry = manifest.documents[docId];
  if (entry) return { json: entry.json || null, html: entry.html || null };
  if (previousDoc && validTarget(previousDoc, collectionsConfig)) return outputPaths(previousDoc, collectionsConfig);
  return null;
}

/** A rendered <code-block>: open tag, then its HTML-escaped (&, <, >) code. */
const CODE_BLOCK = /(<code-block\b)([^>]*>)([\s\S]*?)(<\/code-block>)/g;

/** Inverse of renderers/shared.js escapeHtml (& < > only). */
const unescapeHtml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/**
 * Protect a rendered page body from Cook's `${...}` interpolation, which runs
 * after Cook has parsed the page with a DOM (so HTML entities do not help).
 * - `<code-block>` elements get `data-escape` and their raw code: Cook
 *   base64-stores that content before interpolation and HTML-escapes it
 *   itself (scripts/plugins/escape-code-blocks.js). Raw code containing the
 *   text `</code-block>` would end the block early.
 * - Everywhere else `${` becomes `$<!---->{`: the empty comment breaks the
 *   placeholder and is invisible on the page.
 * @param {string} html
 * @returns {string}
 */
export function protectBody(html) {
  const split = (text) => text.replaceAll('${', '$<!---->{');
  let out = '';
  let last = 0;
  for (const m of html.matchAll(CODE_BLOCK)) {
    out += split(html.slice(last, m.index));
    out += `${m[1]} data-escape${m[2]}${unescapeHtml(m[3])}${m[4]}`;
    last = m.index + m[0].length;
  }
  return out + split(html.slice(last));
}

/** Remove a file, then any parent directories it leaves empty, up to (not including) content/ and src/. */
function removeFile(ws, rel, removed) {
  const abs = join(ws.siteDir, rel);
  if (!existsSync(abs)) return;
  rmSync(abs);
  removed.push(rel);
  const roots = [ws.contentDir, ws.srcDir];
  let dir = dirname(abs);
  while (roots.some((root) => dir.startsWith(root + sep))) {
    if (readdirSync(dir).length > 0) break;
    rmdirSync(dir);
    dir = dirname(dir);
  }
}

/**
 * Every check exportDocument makes before its first write: valid
 * slug/collection (not a reserved name) and output path; the target JSON
 * (and, on a rename, the old JSON this document owns) unchanged on disk; and
 * an HTML target that is either absent or this document's own page (its
 * `vp_id`). Writes nothing.
 * @param {import('../workspace/workspace.js').Workspace} ws
 * @param {Object} doc
 * @param {{ collectionsConfig?: Object, previousDoc?: Object }} [options] - previousDoc: the stored version, for old paths when the local manifest has no entry
 * @throws {ExportConflictError} when a JSON it would write or remove changed on disk
 * @throws {Error} on an invalid or reserved slug/collection, an invalid output path, or an HTML target owned by another document or not written by Vanilla Press
 */
export function checkExport(ws, doc, { collectionsConfig, previousDoc } = {}) {
  const { slug, collection } = doc.meta;
  for (const v of [slug, collection]) {
    if (!validSegment(v)) throw new Error(`Invalid slug/collection: ${v}`);
  }
  if (RESERVED_COLLECTIONS.has(collection)) throw new Error(`Reserved collection name: ${collection}`);
  const { path: outPath } = collectionOutput(collection, collectionsConfig);
  if (!validOutputPath(outPath)) throw new Error(`Invalid output path: ${outPath}`);

  const paths = outputPaths(doc, collectionsConfig);
  const manifest = readManifest(ws);
  const previous = previousPaths(manifest, doc.id, previousDoc, collectionsConfig);

  if (changedOnDisk(ws, doc.id, paths.json)) throw new ExportConflictError(paths.json);
  if (previous?.json && previous.json !== paths.json &&
      jsonOwner(ws, previous.json) === doc.id && changedOnDisk(ws, doc.id, previous.json)) {
    throw new ExportConflictError(previous.json);
  }

  if (paths.html) {
    const owner = htmlOwner(ws, paths.html);
    if (owner === undefined || owner === doc.id) return;
    if (owner) throw new Error(`Output path ${paths.html} is already used by document ${owner}`);
    throw new Error(`Refusing to overwrite ${paths.html}: not written by Vanilla Press`);
  }
}

/**
 * Export a document. Writes the JSON; if published, the HTML page; removes
 * this document's own files at its old paths; records the local manifest
 * entry. Everything that can fail without touching the filesystem
 * (validation, conflict checks, rendering) happens before the first write.
 *
 * Cook interpolates `${...}` in page HTML, so the rendered body is protected
 * (see protectBody); the front matter is left as is.
 * @param {import('../workspace/workspace.js').Workspace} ws
 * @param {Object} doc
 * @param {{ collectionsConfig?: Object, previousDoc?: Object, render?: Function }} [options] - previousDoc: the stored version before this save; `render` overrides the renderer (tests)
 * @returns {{ written: string[], removed: string[] }}
 * @throws {ExportConflictError} when the target JSON (or the JSON a rename would delete) changed on disk
 */
export function exportDocument(ws, doc, { collectionsConfig, previousDoc, render: renderFn = render } = {}) {
  checkExport(ws, doc, { collectionsConfig, previousDoc });
  const { layout } = collectionOutput(doc.meta.collection, collectionsConfig);
  const paths = outputPaths(doc, collectionsConfig);
  const manifest = readManifest(ws);
  const previous = previousPaths(manifest, doc.id, previousDoc, collectionsConfig);

  const jsonText = JSON.stringify(doc, null, 2) + '\n';
  const htmlText = paths.html
    ? frontMatter(doc, { layout }) +
      protectBody(renderFn(doc, { scope: 'content', bare: true })) + '\n'
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
    if (previous.json && previous.json !== paths.json && jsonOwner(ws, previous.json) === doc.id) {
      removeFile(ws, previous.json, removed);
    }
    if (previous.html && previous.html !== paths.html && htmlOwner(ws, previous.html) === doc.id) {
      removeFile(ws, previous.html, removed);
    }
  }

  manifest.documents[doc.id] = { json: paths.json, html: paths.html, jsonHash: sha1(jsonText) };
  writeManifest(ws, manifest);
  return { written, removed };
}

/**
 * Delete a document's exported files (missing files are fine) and its local
 * manifest entry. Files are found at the manifest entry's paths, else at the
 * stored version's paths; only files this document owns are removed.
 * @param {import('../workspace/workspace.js').Workspace} ws
 * @param {string} docId
 * @param {{ previousDoc?: Object, collectionsConfig?: Object }} [options] - previousDoc: the stored document
 * @returns {{ removed: string[] }}
 * @throws {ExportConflictError} when its JSON changed on disk
 */
export function removeExport(ws, docId, { previousDoc, collectionsConfig } = {}) {
  const manifest = readManifest(ws);
  const previous = previousPaths(manifest, docId, previousDoc, collectionsConfig);
  const removed = [];
  if (!previous) return { removed };
  const ownsJson = previous.json && jsonOwner(ws, previous.json) === docId;
  if (ownsJson && changedOnDisk(ws, docId, previous.json)) throw new ExportConflictError(previous.json);
  if (ownsJson) removeFile(ws, previous.json, removed);
  if (previous.html && htmlOwner(ws, previous.html) === docId) removeFile(ws, previous.html, removed);
  if (manifest.documents[docId]) {
    delete manifest.documents[docId];
    writeManifest(ws, manifest);
  }
  return { removed };
}

/**
 * Record the JSON file's current hash as the known state (after importing
 * it). When the document is published and the page at its output path is
 * its own (`vp_id`), that path is recorded as the html hint.
 * @param {import('../workspace/workspace.js').Workspace} ws
 * @param {string} docId
 * @param {string} jsonRelPath - Site-relative
 * @param {{ collectionsConfig?: Object }} [options]
 */
export function recordImported(ws, docId, jsonRelPath, { collectionsConfig } = {}) {
  const manifest = readManifest(ws);
  const text = readFileSync(join(ws.siteDir, jsonRelPath));
  const entry = manifest.documents[docId] || { json: jsonRelPath, html: null, jsonHash: '' };
  entry.json = jsonRelPath;
  entry.jsonHash = sha1(text);
  let doc = null;
  try { doc = JSON.parse(text); } catch { /* hash only */ }
  if (doc?.meta?.status === 'published' && validTarget(doc, collectionsConfig)) {
    const html = outputPaths(doc, collectionsConfig).html;
    if (htmlOwner(ws, html) === docId) entry.html = html;
  }
  manifest.documents[docId] = entry;
  writeManifest(ws, manifest);
}
