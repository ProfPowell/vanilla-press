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

/** The href of the first link in the selection, or '' when it has none. */
export function linkHref(state) {
  const { from, to } = state.selection;
  let href = '';
  state.doc.nodesBetween(from, to, (node) => {
    if (href) return false;
    const mark = schema.marks.link.isInSet(node.marks);
    if (mark) href = mark.attrs.href;
    return true;
  });
  return href;
}

/** Make the selection a link to `href`, replacing any link it already has. */
export function setLink(href) {
  return (state, dispatch) => {
    const { from, to, empty } = state.selection;
    if (empty) return false;
    if (dispatch) {
      const { link } = schema.marks;
      dispatch(state.tr.removeMark(from, to, link).addMark(from, to, link.create({ href, title: null })).scrollIntoView());
    }
    return true;
  };
}

/** Remove the link from the selection. */
export const removeLink = (state, dispatch) => {
  const { from, to, empty } = state.selection;
  if (empty || !markActive(state, schema.marks.link)) return false;
  if (dispatch) dispatch(state.tr.removeMark(from, to, schema.marks.link));
  return true;
};

const markItem = (id, label, title, markType) => ({
  id, label, title,
  command: toggleMark(markType),
  active: (state) => markActive(state, markType),
});

/**
 * The format toolbar's commands. `primary` are its buttons; `more` fill the
 * More menu. The `wrap` item has no command: the toolbar lists one menu entry
 * per inline component in its place (see wrapInComponent). The `link`
 * item's command removes the link; the toolbar's URL field sets it.
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
      command: removeLink,
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
