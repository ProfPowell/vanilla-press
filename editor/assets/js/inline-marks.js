/**
 * Inline Markdown as you type: recognise a just-closed `**bold**`, `*it*`,
 * `` `code` ``, `~~strike~~`, `==highlight==` or `[text](url)` at the end of a
 * text block and turn it into marked text. Pure (no view or input-rules
 * import) so it can be tested in Node.
 *
 * @module editor/inline-marks
 */

import { schema } from './schema.js';
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
  { mark: 'em', re: /(?<![*\w])\*([^\s*](?:[^*]*[^\s*])?)\*$/ },
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

/**
 * Replace the matched range with its inner text carrying the mark, and stop
 * the mark from continuing as the user keeps typing.
 * @param {import('prosemirror-state').EditorState} state
 * @param {{ mark: string, text: string, attrs?: object }} match
 * @param {number} from - document position where the opening delimiter begins
 * @param {number} to - document position the range ends at
 * @returns {import('prosemirror-state').Transaction}
 */
export function applyInlineMark(state, match, from, to) {
  const type = schema.marks[MARK_KEY[match.mark]];
  const base = state.doc.nodeAt(from)?.marks ?? [];
  const marked = type.create(match.attrs).addToSet(base);
  const tr = state.tr.replaceWith(from, to, schema.text(match.text, marked));
  return tr.removeStoredMark(type);
}
