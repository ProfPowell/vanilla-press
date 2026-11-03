/**
 * Reads a package's custom-elements.json (Custom Elements Manifest) into
 * per-tag attribute definitions the editor can build settings forms from.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** @typedef {{ name: string, type: 'string'|'number'|'boolean', enum?: string[], description?: string, default?: string }} AttrDef */

const QUOTED = /^(['"])(.*)\1$/;

/**
 * Turn a CEM type string into an editor field type.
 * `boolean` and `number` map directly; a union of only quoted literals is a
 * string enum; `undefined` and `null` members are dropped; anything else
 * (or a missing type) is a plain string.
 * @param {string|undefined} text
 * @returns {{ type: 'string'|'number'|'boolean', enum?: string[] }}
 */
export function parseCemType(text) {
  if (typeof text !== 'string') return { type: 'string' };
  const parts = text
    .split('|')
    .map((p) => p.trim())
    .filter((p) => p && p !== 'undefined' && p !== 'null');
  if (parts.length === 1 && (parts[0] === 'boolean' || parts[0] === 'number')) {
    return { type: parts[0] };
  }
  if (parts.length && parts.every((p) => QUOTED.test(p))) {
    return { type: 'string', enum: parts.map((p) => p.match(QUOTED)[2]) };
  }
  return { type: 'string' };
}

/**
 * Read a package directory's manifest.
 * @param {string} pkgDir
 * @returns {Map<string, { attributes: AttrDef[], description?: string }>}
 *   keyed by tag; empty when the manifest is missing or unreadable
 */
export function readManifest(pkgDir) {
  const tags = new Map();
  let file = join(pkgDir, 'custom-elements.json');
  try {
    const pj = join(pkgDir, 'package.json');
    if (existsSync(pj)) {
      const ref = JSON.parse(readFileSync(pj, 'utf8')).customElements;
      if (typeof ref === 'string') file = join(pkgDir, ref);
    }
  } catch { /* fall back to the default file name */ }
  let cem;
  try {
    cem = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return tags;
  }
  for (const mod of cem.modules ?? []) {
    for (const decl of mod.declarations ?? []) {
      if (!decl.tagName) continue;
      const seen = new Set();
      const attributes = [];
      for (const a of decl.attributes ?? []) {
        if (!a.name || seen.has(a.name)) continue;
        seen.add(a.name);
        /** @type {AttrDef} */
        const def = { name: a.name, ...parseCemType(a.type?.text) };
        if (a.description) def.description = a.description;
        if (typeof a.default === 'string') def.default = a.default.replace(QUOTED, '$2');
        attributes.push(def);
      }
      const entry = { attributes };
      if (decl.description) entry.description = decl.description;
      tags.set(decl.tagName, entry);
    }
  }
  return tags;
}
