/**
 * The alt-text check before Publish and Update: which images in a post have
 * no alt text, and the confirmation that lists them. Pure (no DOM).
 *
 * @module editor/alt-check
 */

import { mediaFileOf } from '../../../src/media/usage.js';

const BODY = 'Screen readers will announce only the file name. Add alt text in the image block, or mark the image decorative in Media.';

/**
 * Every figure whose alt is '' or absent, unless its library file is marked
 * decorative (alt ''). A linked library item (an Unsplash photo) is matched by
 * its exact URL. Other external sources and files not in the library warn.
 * Deduped by src. Without a library list (not an array: the fetch failed or
 * answered something else) there are no warnings, so publishing goes ahead.
 * @param {Array} blocks - the post's block AST
 * @param {Array<{ filename: string, alt: string|null }>|unknown} library
 * @returns {Array<{ src: string, name: string }>}
 */
export function altWarnings(blocks, library) {
  if (!Array.isArray(library)) return [];
  const decorative = new Set(library.filter((m) => m?.alt === '').map((m) => m.filename));
  // A linked item has no /media/ URL: its remote URL names it
  const linked = new Map(library.filter((m) => m?.linked && typeof m.src === 'string').map((m) => [m.src, m.filename]));
  const found = new Map();
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    if (node.type === 'figure') {
      const src = node.attrs?.src;
      const alt = node.attrs?.alt;
      if (src && (alt == null || alt === '') && !found.has(src)) {
        const file = mediaFileOf(src) ?? linked.get(src) ?? null;
        if (!(file && decorative.has(file))) found.set(src, { src, name: file || src });
      }
    }
    if (node.children) walk(node.children);
  };
  walk(blocks);
  return [...found.values()];
}

/**
 * The confirmation for `altWarnings`' result.
 * @param {Array<{ name: string }>} warnings
 * @param {'publish'|'update'} action
 * @returns {{ heading: string, body: string, items: string[], confirm: string, tone: 'primary' }}
 */
export function altWarningText(warnings, action) {
  const n = warnings.length;
  return {
    heading: n === 1 ? 'An image has no alt text' : `${n} images have no alt text`,
    body: BODY,
    items: warnings.map((w) => w.name),
    confirm: action === 'update' ? 'Update anyway' : 'Publish anyway',
    tone: 'primary',
  };
}
