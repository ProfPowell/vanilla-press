/**
 * Character references and symbols for the editors: decoding `&name;`,
 * `&#123;` and `&#x7B;` as typed, and the Symbols list the `&` suggestions
 * and the Insert character picker offer (typographic characters an emoji
 * picker doesn't cover).
 *
 * @module editor/chars/symbols
 */

/** @typedef {{ char: string, name: string, entity: string, invisible?: boolean, short?: string }} SymbolEntry */

/** @type {SymbolEntry[]} */
export const SYMBOLS = [
  // Spaces and joiners: shown as markers in the editor, saved as references
  { char: '\u00a0', name: 'Non-breaking space', entity: 'nbsp', invisible: true, short: 'nbsp' },
  { char: '\u00ad', name: 'Soft hyphen', entity: 'shy', invisible: true, short: 'shy' },
  { char: '\u200b', name: 'Zero-width space', entity: '#8203', invisible: true, short: 'zwsp' },
  { char: '\u2060', name: 'Word joiner', entity: '#8288', invisible: true, short: 'wj' },
  // Punctuation
  { char: '—', name: 'Em dash', entity: 'mdash' },
  { char: '–', name: 'En dash', entity: 'ndash' },
  { char: '…', name: 'Ellipsis', entity: 'hellip' },
  { char: '‘', name: 'Left single quote', entity: 'lsquo' },
  { char: '’', name: 'Right single quote, apostrophe', entity: 'rsquo' },
  { char: '“', name: 'Left double quote', entity: 'ldquo' },
  { char: '”', name: 'Right double quote', entity: 'rdquo' },
  { char: '«', name: 'Left guillemet', entity: 'laquo' },
  { char: '»', name: 'Right guillemet', entity: 'raquo' },
  { char: '•', name: 'Bullet', entity: 'bull' },
  { char: '·', name: 'Middle dot', entity: 'middot' },
  { char: '§', name: 'Section', entity: 'sect' },
  { char: '¶', name: 'Pilcrow, paragraph', entity: 'para' },
  { char: '†', name: 'Dagger', entity: 'dagger' },
  { char: '‡', name: 'Double dagger', entity: 'Dagger' },
  { char: '′', name: 'Prime, feet, minutes', entity: 'prime' },
  { char: '″', name: 'Double prime, inches, seconds', entity: 'Prime' },
  { char: '¿', name: 'Inverted question mark', entity: 'iquest' },
  { char: '¡', name: 'Inverted exclamation mark', entity: 'iexcl' },
  // Legal and commerce
  { char: '©', name: 'Copyright', entity: 'copy' },
  { char: '®', name: 'Registered', entity: 'reg' },
  { char: '™', name: 'Trade mark', entity: 'trade' },
  { char: '€', name: 'Euro', entity: 'euro' },
  { char: '£', name: 'Pound', entity: 'pound' },
  { char: '¥', name: 'Yen', entity: 'yen' },
  { char: '¢', name: 'Cent', entity: 'cent' },
  // Maths and units
  { char: '×', name: 'Multiplication, times', entity: 'times' },
  { char: '÷', name: 'Division', entity: 'divide' },
  { char: '±', name: 'Plus or minus', entity: 'plusmn' },
  { char: '−', name: 'Minus', entity: 'minus' },
  { char: '≠', name: 'Not equal', entity: 'ne' },
  { char: '≈', name: 'Approximately equal', entity: 'asymp' },
  { char: '≤', name: 'Less than or equal', entity: 'le' },
  { char: '≥', name: 'Greater than or equal', entity: 'ge' },
  { char: '∞', name: 'Infinity', entity: 'infin' },
  { char: '√', name: 'Square root', entity: 'radic' },
  { char: '°', name: 'Degree', entity: 'deg' },
  { char: 'µ', name: 'Micro', entity: 'micro' },
  { char: '‰', name: 'Per mille', entity: 'permil' },
  { char: '½', name: 'One half', entity: 'frac12' },
  { char: '¼', name: 'One quarter', entity: 'frac14' },
  { char: '¾', name: 'Three quarters', entity: 'frac34' },
  // Arrows
  { char: '→', name: 'Right arrow', entity: 'rarr' },
  { char: '←', name: 'Left arrow', entity: 'larr' },
  { char: '↑', name: 'Up arrow', entity: 'uarr' },
  { char: '↓', name: 'Down arrow', entity: 'darr' },
  { char: '↔', name: 'Left right arrow', entity: 'harr' },
  { char: '⇒', name: 'Double right arrow, implies', entity: 'rArr' },
  // Marks and suits
  { char: '✓', name: 'Check mark', entity: 'check' },
  { char: '✗', name: 'Ballot X, cross', entity: 'cross' },
  { char: '★', name: 'Black star', entity: 'starf' },
  { char: '☆', name: 'White star', entity: 'star' },
  { char: '♥', name: 'Heart suit', entity: 'hearts' },
  { char: '♦', name: 'Diamond suit', entity: 'diams' },
  { char: '♣', name: 'Club suit', entity: 'clubs' },
  { char: '♠', name: 'Spade suit', entity: 'spades' },
];

/** Characters the editors mark and the writers save as references. */
export const INVISIBLE_CHARS = SYMBOLS.filter(s => s.invisible).map(s => s.char);

/**
 * A code point a reference may stand for: not NUL, a surrogate, a
 * noncharacter, or a C0/C1 control other than tab and line feed.
 */
function allowedCodePoint(cp) {
  if (!Number.isInteger(cp) || cp <= 0 || cp > 0x10ffff) return false;
  if (cp >= 0xd800 && cp <= 0xdfff) return false;
  if ((cp & 0xfffe) === 0xfffe || (cp >= 0xfdd0 && cp <= 0xfdef)) return false;
  if ((cp < 0x20 && cp !== 0x09 && cp !== 0x0a) || (cp >= 0x7f && cp <= 0x9f)) return false;
  return true;
}

/** The browser's decoder: what `&name;` means in HTML. */
function domDecode(ref) {
  if (typeof document === 'undefined') return null;
  const t = document.createElement('textarea');
  t.innerHTML = ref;
  return t.value;
}

/**
 * The character(s) a typed reference stands for, or null when it is not one.
 * @param {string} ref - `&…;` as typed
 * @param {(ref: string) => string|null} [decode] - named-reference decoder (the browser's by default)
 * @returns {string|null}
 */
export function decodeReference(ref, decode = domDecode) {
  const m = /^&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z][A-Za-z0-9]{1,31}));$/.exec(ref);
  if (!m) return null;
  if (m[1] || m[2]) {
    const cp = m[1] ? parseInt(m[1], 10) : parseInt(m[2], 16);
    return allowedCodePoint(cp) ? String.fromCodePoint(cp) : null;
  }
  const out = decode(ref);
  // Unknown names come back as typed; a known one is one or two characters
  return out && out !== ref && [...out].length <= 2 ? out : null;
}

/**
 * Symbols matching `query` (entity name or a word of the name), best first.
 * @param {string} query
 * @param {number} [limit]
 * @returns {SymbolEntry[]}
 */
export function searchSymbols(query, limit = 8) {
  const q = String(query).toLowerCase().trim();
  if (!q) return [];
  const rank = (s) => {
    const ent = s.entity.toLowerCase();
    if (ent === q) return 0;
    if (ent.startsWith(q)) return 1;
    if (s.name.toLowerCase().split(/[\s,]+/).some(w => w.startsWith(q))) return 2;
    if (s.name.toLowerCase().includes(q)) return 3;
    return -1;
  };
  return SYMBOLS.map(s => [rank(s), s]).filter(([r]) => r >= 0)
    .sort((a, b) => a[0] - b[0]).map(([, s]) => s).slice(0, limit);
}
