/**
 * Typing in the layout editor's text:
 * - `${name}` becomes a field token when its `}` is typed (`${title}`,
 *   `${post.title}`). `${content}` and `${slot:…}` stay text: they are
 *   blocks, offered in the `/` menu.
 * - Markdown closes into inline elements, as in the post editor:
 *   `**bold**` → <strong>, `*it*` / `_it_` → <em>, `` `c` `` → <code>,
 *   `[text](/url/)` → <a href>. A layout has no strike or highlight element,
 *   so `~~s~~` and `==h==` stay text.
 * - Mod-b / Mod-i / Mod-e toggle <strong>, <em>, <code> on the selection.
 * Rules are plain `{ match, handler }` specs (main.js wraps them in
 * InputRule) so they run in Node tests.
 *
 * @module editor/layout-editor/text-rules
 */

import { toggleMark } from 'prosemirror-commands';
import { inlineMarkHandler, LAYOUT_MARK_NAMES } from '../inline-marks.js';

/** `${name}` just closed: a dotted name, no pipes or slot prefix. */
export const FIELD_RULE = /\$\{([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*)\}$/;

/** Names that are blocks, not fields. */
const BLOCK_NAMES = new Set(['content']);

/** Whether the caret's text is in an inline <code>: nothing converts there. */
function inCodeMark(state, pos) {
  const code = state.schema.marks.code;
  return Boolean(code && code.isInSet(state.doc.resolve(pos).marks()));
}

function fieldHandler(state, match, start, end) {
  const name = match[1];
  if (BLOCK_NAMES.has(name) || inCodeMark(state, start)) return null;
  const $start = state.doc.resolve(start);
  const type = state.schema.nodes.field;
  if (!type || !$start.parent.inlineContent || !$start.parent.type.contentMatch.matchType(type)) return null;
  return state.tr.replaceWith(start, end, type.create({ name }));
}

/**
 * The layout editor's text input rules.
 * @returns {Array<{ match: RegExp, handler: Function }>}
 */
export function layoutTextRuleSpecs() {
  return [
    { match: FIELD_RULE, handler: fieldHandler },
    ...['*', '_', '`', ')'].map(ch => ({
      match: new RegExp(`${ch.replace(/[*)]/, '\\$&')}$`),
      handler: (state, _match, start, end) => inlineMarkHandler(state, ch, start, end, LAYOUT_MARK_NAMES),
    })),
  ];
}

/**
 * Toggle an inline element (`strong`, `em`, `code`) on the selection.
 * @param {string} name - the layout schema's mark name
 */
export function toggleLayoutMark(name) {
  return (state, dispatch, view) => {
    const type = state.schema.marks[name];
    return type ? toggleMark(type)(state, dispatch, view) : false;
  };
}
