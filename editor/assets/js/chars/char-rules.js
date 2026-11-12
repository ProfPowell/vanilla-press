/**
 * Input rules shared by the post and layout editors:
 * - `&hearts;`, `&#9829;`, `&#x2665;` become their character as the `;` is typed
 * - `:heart:` becomes its emoji as the closing `:` is typed. The opening colon
 *   must not follow a letter, digit, `_` or `:`, so times and ratios
 *   ("10:30:45", "a:b:c") are left alone (VB's emoji-init rule).
 * Unknown names stay as typed. Nothing converts inside code (a code block, or
 * text with a code mark). Backspace straight after a conversion undoes it
 * (prosemirror-inputrules' undoInputRule, bound in both editors' keymaps).
 * The rules are plain specs, `{ match, handler }`: each editor wraps them in
 * prosemirror-inputrules' InputRule (`new InputRule(match, handler)`).
 *
 * @module editor/chars/char-rules
 */

import { decodeReference } from './symbols.js';
import { emojiIndex } from './emoji-index.js';

/** Whether `pos` is in code: a code node, or a code mark at that point. */
export function inCode(state, pos) {
  const $pos = state.doc.resolve(pos);
  if ($pos.parent.type.spec.code) return true;
  const marks = state.storedMarks || $pos.marks();
  return marks.some(m => m.type.name === 'code' || m.type.spec.code);
}

export const REFERENCE_RULE = /&(?:#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});$/;
export const SHORTCODE_RULE = /(?:^|[^\w:]):([A-Za-z0-9_+-]{1,50}):$/;

/**
 * @param {object} [deps]
 * @param {(ref: string) => string|null} [deps.decode] - reference decoder
 * @param {(code: string) => string|null} [deps.resolveEmoji] - shortcode lookup
 * @returns {{ match: RegExp, handler: Function }[]}
 */
export function charRuleSpecs({ decode = decodeReference, resolveEmoji = (c) => emojiIndex().resolve(c) } = {}) {
  const reference = { match: REFERENCE_RULE, handler: (state, match, start, end) => {
    if (inCode(state, start)) return null;
    const char = decode(match[0]);
    return char ? state.tr.insertText(char, start, end) : null;
  } };
  const shortcode = { match: SHORTCODE_RULE, handler: (state, match, start, end) => {
    const from = start + match[0].length - match[1].length - 2;
    if (inCode(state, from)) return null;
    const emoji = resolveEmoji(match[1]);
    return emoji ? state.tr.insertText(emoji, from, end) : null;
  } };
  return [reference, shortcode];
}
