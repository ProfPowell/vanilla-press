/**
 * Emoji lookup for the editors: `:shortcode:` resolution and search for the
 * `:` suggestions and the picker. The curated list (chars/emoji-core.js,
 * from Vanilla Breeze) is there at once; VB's full gemoji list
 * (/assets/vb/emoji-extended.js) is added when it has loaded. A curated
 * shortcode or alias always wins over an extended one.
 *
 * @module editor/chars/emoji-index
 */

import { CORE_EMOJI, CORE_ALIASES } from './emoji-core.js';

/** @typedef {{ shortcode: string, emoji: string, name: string, group: string, keywords: string[] }} EmojiEntry */

/** VB's registry for the extended list (dist/cdn/emoji-extended.js pushes its rows here). */
const EXTENDED_REGISTRY = Symbol.for('vanilla-breeze.emoji-extended');

/**
 * An index over emoji rows.
 * @param {Array} core - [shortcode, emoji, name, group, keywords?] rows
 * @param {Array<[string, string]>} [aliases] - [alias, shortcode] pairs into `core`
 */
export function createEmojiIndex(core, aliases = []) {
  /** @type {Map<string, EmojiEntry>} */
  const byCode = new Map();
  /** @type {EmojiEntry[]} */
  const all = [];
  const add = ([shortcode, emoji, name, group, keywords = []]) => {
    if (byCode.has(shortcode)) return;
    const entry = { shortcode, emoji, name, group, keywords };
    byCode.set(shortcode, entry);
    all.push(entry);
  };
  core.forEach(add);
  const aliasMap = new Map(aliases.filter(([, to]) => byCode.has(to)));

  return {
    /** Add rows (the extended list); known shortcodes keep their entry. */
    addRows(rows) { rows.forEach(add); },
    /** The emoji for a shortcode (or alias), or null. */
    resolve(shortcode) {
      const code = String(shortcode).toLowerCase();
      const entry = byCode.get(code) || byCode.get(aliasMap.get(code));
      return entry ? entry.emoji : null;
    },
    /**
     * Entries matching `query`, best first: shortcode starts with it, then
     * a word of the shortcode or name starts with it, then a keyword does,
     * then it appears anywhere in the shortcode or name.
     * @param {string} query
     * @param {number} [limit]
     * @returns {EmojiEntry[]}
     */
    search(query, limit = 8) {
      const q = String(query).toLowerCase().trim().replace(/\s+/g, '_');
      if (!q) return [];
      const aliased = aliasMap.has(q) ? byCode.get(aliasMap.get(q)) : null;
      const rank = (e) => {
        const name = e.name.toLowerCase();
        if (e.shortcode.startsWith(q)) return 0;
        if (e.shortcode.split(/[_-]/).some(w => w.startsWith(q)) || name.split(/[\s-]+/).some(w => w.startsWith(q.replace(/_/g, ' ')))) return 1;
        if (e.keywords.some(k => k.startsWith(q))) return 2;
        if (e.shortcode.includes(q) || name.includes(q.replace(/_/g, ' '))) return 3;
        return -1;
      };
      const hits = [];
      for (const e of all) {
        const r = rank(e);
        if (r >= 0) hits.push([r, e]);
      }
      hits.sort((a, b) => a[0] - b[0] || a[1].shortcode.length - b[1].shortcode.length);
      const out = hits.map(([, e]) => e);
      if (aliased && !out.includes(aliased)) out.unshift(aliased);
      return out.slice(0, limit);
    },
  };
}

let shared = null;

/**
 * The editors' shared index: the curated list now, the extended list once
 * /assets/vb/emoji-extended.js has loaded (a failed load keeps the curated).
 */
export function emojiIndex() {
  if (shared) return shared;
  shared = createEmojiIndex(CORE_EMOJI, CORE_ALIASES);
  if (typeof document !== 'undefined') {
    import('/assets/vb/emoji-extended.js').then(() => {
      for (const rows of globalThis[EXTENDED_REGISTRY] || []) shared.addRows(rows);
    }).catch(() => {});
  }
  return shared;
}
