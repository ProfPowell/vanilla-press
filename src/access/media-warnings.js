// Which media a page uses that is more restricted than the page. Pure and browser-safe.

import { validAccess } from '../schema/content-schema.js';
import { mediaFileOf } from '../media/usage.js';
import { allBlockLists } from '../schema/blocks.js';

/** Rank of a level: its index in `validAccess`; absent is public, an unknown level is private (fail closed). */
const rank = (level) => {
  if (level == null || level === '') return 0;
  const i = validAccess.indexOf(level);
  return i < 0 ? validAccess.length - 1 : i;
};

/** Every `/media/<file>` found in `text` (decoded file names). */
function filesIn(text) {
  const out = [];
  for (const m of text.matchAll(/(?<![\w.-])\/media\/[^\s"'()<>\\]+/g)) {
    const file = mediaFileOf(m[0]);
    if (file) out.push(file);
  }
  return out;
}

/**
 * The media files a document uses: its `meta.image` and any `/media/<file>`
 * in its blocks (attrs and text values, regions included).
 * @param {{ meta?: Object, blocks?: Array, regions?: Object }} doc
 * @returns {Set<string>}
 */
function usedFiles(doc) {
  const found = new Set();
  const add = (url) => { const f = mediaFileOf(url); if (f) found.add(f); };
  add(doc?.meta?.image);
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (typeof node === 'string') return filesIn(node).forEach((f) => found.add(f));
    if (!node || typeof node !== 'object') return;
    for (const v of Object.values(node)) walk(v);
  };
  for (const list of allBlockLists(doc || {})) walk(list);
  return found;
}

/**
 * Media used by `doc` whose level is above the document's.
 * @param {{ meta?: { access?: string, image?: string }, blocks?: Array }} doc
 * @param {Array<{ filename: string, access?: string }>} mediaItems
 * @returns {Array<{ filename: string, access: string }>}
 */
export function mediaAccessWarnings(doc, mediaItems) {
  const docRank = rank(doc?.meta?.access);
  const used = usedFiles(doc);
  const out = [];
  const seen = new Set();
  for (const item of mediaItems || []) {
    if (!used.has(item.filename) || seen.has(item.filename)) continue;
    if (rank(item.access) > docRank) {
      seen.add(item.filename);
      out.push({ filename: item.filename, access: item.access });
    }
  }
  return out;
}
