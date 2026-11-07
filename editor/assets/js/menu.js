/**
 * Formatting commands for the floating format toolbar (format-toolbar.js).
 * Reads PM editor state; the toolbar dispatches the commands.
 *
 * @module editor/menu
 */

import { toggleMark, lift } from 'prosemirror-commands';
import { TextSelection } from 'prosemirror-state';
import { schema } from './schema.js';

/**
 * @typedef {Object} FormatItem
 * @property {string} id
 * @property {string} label - short visible text (primary) or menu text (More)
 * @property {string} title - accessible name, with the shortcut when there is one
 * @property {Function} [command] - (state, dispatch, view) => boolean
 * @property {Function} [active] - (state) => boolean
 */

export function markActive(state, markType) {
  const { from, $from, to, empty } = state.selection;
  if (empty) return !!markType.isInSet(state.storedMarks || $from.marks());
  return state.doc.rangeHasMark(from, to, markType);
}

/**
 * Wrap the selected text in an inline component. Applies only when the
 * selection is non-empty, inside one textblock, and covers text alone
 * (no footnotes or other components); the text keeps its marks.
 * @param {{ tag: string, attrs: Object }} attrs
 */
export function wrapInComponent(attrs) {
  return (state, dispatch) => {
    const type = schema.nodes.component_inline;
    const sel = state.selection;
    if (sel.empty || !(sel instanceof TextSelection)) return false;
    const { $from, $to, from, to } = sel;
    if (!$from.sameParent($to) || !$from.parent.inlineContent) return false;
    const parent = $from.parent;
    const start = $from.start();
    const content = parent.cut(from - start, to - start).content;
    let textOnly = content.size > 0;
    content.forEach(n => { if (!n.isText) textOnly = false; });
    if (!textOnly || !type.validContent(content)) return false;
    if (!parent.canReplaceWith($from.index(), $to.indexAfter(), type)) return false;
    if (dispatch) {
      dispatch(state.tr.replaceWith(from, to, type.create(attrs, content)).scrollIntoView());
    }
    return true;
  };
}

/** The toolbar's visible buttons, in order. */
export const PRIMARY_IDS = ['bold', 'italic', 'code', 'highlight', 'link'];

/**
 * Link command: removes the link when the selection has one, else asks for a URL.
 * Same behavior as the Mod+K shortcut.
 */
function toggleLink(state, dispatch) {
  const { link } = schema.marks;
  if (markActive(state, link)) return toggleMark(link)(state, dispatch);
  if (!dispatch) return true;
  const href = prompt('Enter URL:');
  if (!href) return true;
  return toggleMark(link, { href, title: null })(state, dispatch);
}

const markItem = (id, label, title, markType) => ({
  id, label, title,
  command: toggleMark(markType),
  active: (state) => markActive(state, markType),
});

/**
 * The format toolbar's commands. `primary` are its buttons; `more` fill the
 * More menu. The `wrap` item has no command: the toolbar lists one menu entry
 * per inline component in its place (see wrapInComponent).
 * Block types are not here; the `/` palette and input rules cover them.
 * @returns {{ primary: FormatItem[], more: FormatItem[] }}
 */
export function formatItems() {
  const { marks } = schema;
  const all = [
    markItem('bold', 'B', 'Bold (Mod+B)', marks.strong),
    markItem('italic', 'i', 'Italic (Mod+I)', marks.em),
    markItem('code', '</>', 'Inline code (Mod+E)', marks.code),
    markItem('highlight', 'Highlight', 'Highlight', marks.highlight),
    {
      id: 'link', label: 'Link', title: 'Link (Mod+K)',
      command: toggleLink,
      active: (state) => markActive(state, marks.link),
    },
    markItem('strikethrough', 'Strikethrough', 'Strikethrough (Mod+Shift+X)', marks.strikethrough),
    markItem('kbd', 'Keyboard', 'Keyboard', marks.kbd),
    markItem('subscript', 'Subscript', 'Subscript', marks.subscript),
    markItem('superscript', 'Superscript', 'Superscript', marks.superscript),
    { id: 'lift', label: 'Lift out of block', title: 'Lift out of enclosing block (Mod+[)', command: lift },
    { id: 'wrap', label: 'Wrap in component\u2026', title: 'Wrap the selected text in a component' },
  ];
  return {
    primary: all.filter((i) => PRIMARY_IDS.includes(i.id)),
    more: all.filter((i) => !PRIMARY_IDS.includes(i.id)),
  };
}
