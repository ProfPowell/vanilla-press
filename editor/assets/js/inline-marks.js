/**
 * Inline Markdown as you type: recognise a just-closed `**bold**`, `*it*`,
 * `` `code` ``, `~~strike~~`, `==highlight==` or `[text](url)` at the end of a
 * text block and turn it into marked text. Pure (no view or input-rules
 * import) so it can be tested in Node.
 *
 * @module editor/inline-marks
 */

import { normalizeLinkUrl } from './link-url.js';

/** Logical mark name -> schema mark key. */
const MARK_KEY = {
  strong: 'strong',
  em: 'em',
  code: 'code',
  strikethrough: 'strikethrough',
  highlight: 'highlight',
  link: 'link',
};

/** Patterns tried in order; each must end at the end of the text. Group 1 is the inner text. */
const PATTERNS = [
  { mark: 'link', re: /(?<!!)\[([^\s\][](?:[^\][]*[^\s\][])?)\]\(([^)\s]+)\)$/ },
  { mark: 'strong', re: /\*\*([^\s*](?:[^*]*[^\s*])?)\*\*$/ },
  { mark: 'strong', re: /(?<!\w)__([^\s_](?:[^_]*[^\s_])?)__$/ },
  { mark: 'strikethrough', re: /~~([^\s~](?:[^~]*[^\s~])?)~~$/ },
  { mark: 'highlight', re: /==([^\s=](?:[^=]*[^\s=])?)==$/ },
  { mark: 'code', re: /`([^\s`](?:[^`]*[^\s`])?)`$/ },
  // A `*` may open inside a word (`x*it*`, as CommonMark); `_` may not (snake_case)
  { mark: 'em', re: /(?<!\*)\*([^\s*](?:[^*]*[^\s*])?)\*$/ },
  { mark: 'em', re: /(?<![_\w])_([^\s_](?:[^_]*[^\s_])?)_$/ },
];

/**
 * Find a completed inline Markdown span ending at the end of `textBefore`.
 * @param {string} textBefore - block text up to the cursor, including the character just typed
 * @returns {{ mark: string, start: number, text: string, attrs?: { href: string } } | null}
 */
export function matchInlineMark(textBefore) {
  for (const { mark, re } of PATTERNS) {
    const m = re.exec(textBefore);
    if (!m) continue;
    if (mark === 'link') {
      const href = normalizeLinkUrl(m[2]);
      if (!href) return null;
      return { mark, start: m.index, text: m[1], attrs: { href } };
    }
    return { mark, start: m.index, text: m[1] };
  }
  return null;
}

/** Length of each mark's opening delimiter. */
const OPEN_LENGTH = { link: 1, strong: 2, strikethrough: 2, highlight: 2, code: 1, em: 1 };

/**
 * Unwrap the matched span: drop its delimiters, mark the inner text, and
 * stop the mark from continuing as the user keeps typing. Marks already on
 * the inner text (an italic word inside new bold) are kept.
 * @param {import('prosemirror-state').EditorState} state
 * @param {{ mark: string, text: string, attrs?: object }} match
 * @param {number} from - document position where the opening delimiter begins
 * @param {number} to - where the range ends: after the closing delimiter, or
 *   before its last character when that is the one being typed
 * @param {Record<string, string>} [names] - logical mark name -> the schema's mark name
 * @returns {import('prosemirror-state').Transaction|null} null when the schema has no such mark
 */
export function applyInlineMark(state, match, from, to, names = MARK_KEY) {
  const type = state.schema.marks[names[match.mark]];
  if (!type) return null;
  const innerFrom = from + OPEN_LENGTH[match.mark];
  const innerTo = innerFrom + match.text.length;
  const tr = state.tr.delete(innerTo, to).delete(from, innerFrom);
  tr.addMark(from, from + match.text.length, type.create(match.attrs ? toMarkAttrs(type, match.attrs) : null));
  return tr.removeStoredMark(type);
}

/** A link's attrs in the schema's shape: the post schema's `href`, the layout schema's attribute pairs. */
function toMarkAttrs(type, attrs) {
  if (type.spec.attrs && 'href' in type.spec.attrs) return attrs;
  return { attrs: Object.entries(attrs) };
}

/**
 * Input-rule handler for a closing delimiter `ch` typed over [start, end).
 * Declines (returns null) unless the input is at an empty text cursor, so a
 * typed character over a selection behaves like ordinary typing.
 * Skips code blocks, the title and text already in code.
 * @param {import('prosemirror-state').EditorState} state
 * @param {string} ch - the character just typed
 * @param {number} start
 * @param {number} end
 * @returns {import('prosemirror-state').Transaction | null}
 */
export function inlineMarkHandler(state, ch, start, end, names = MARK_KEY) {
  if (start !== end || !state.selection.empty) return null;
  const $end = state.doc.resolve(end);
  const parent = $end.parent;
  if (!parent.isTextblock) return null;
  if (parent.type.name === 'code_block' || parent.type.name === 'title') return null;
  const before = parent.textBetween(0, $end.parentOffset, null, '\ufffc');
  const found = matchInlineMark(before + ch);
  if (!found) return null;
  const from = end - (before.length - found.start);
  const code = state.schema.marks[names.code];
  if (code && state.doc.rangeHasMark(from, end, code)) return null;
  return applyInlineMark(state, found, from, end, names);
}

/** The layout schema's marks for the same Markdown (it has no strike or highlight). */
export const LAYOUT_MARK_NAMES = { strong: 'strong', em: 'em', code: 'code', link: 'a' };
