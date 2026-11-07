/**
 * The post title as the document's first line (the schema's `title` node).
 *
 * The title holds `meta.title` as plain text: no marks, no blocks. These
 * commands keep the edge between the title and the first block behaving
 * like a title: Enter leaves it, Backspace returns to it, Delete never pulls
 * a block into it, Mod-a selects it, and a paste lands as one line of text.
 * The node never enters the stored block AST (ast.js skips it).
 *
 * @module editor/title
 */

import { Plugin, TextSelection } from 'prosemirror-state';

/** @typedef {import('prosemirror-state').EditorState} EditorState */
/** @typedef {import('prosemirror-state').Command} Command */

const isTitle = (node) => node?.type.name === 'title';
const mac = typeof navigator !== 'undefined' && /Mac|iP(hone|[oa]d)/.test(navigator.platform || '');

/**
 * The title text of a document ('' when empty).
 * @param {import('prosemirror-model').Node} pmDoc
 * @returns {string}
 */
export function titleOf(pmDoc) {
  const first = pmDoc.firstChild;
  return isTitle(first) ? first.textContent : '';
}

/**
 * A transaction that replaces the title text with `text`.
 * @param {EditorState} state
 * @param {string} text
 */
export function setTitleTr(state, text) {
  const tr = state.tr;
  const end = 1 + state.doc.firstChild.content.size;
  if (text) tr.replaceWith(1, end, state.schema.text(text));
  else tr.delete(1, end);
  return tr;
}

/** Both ends of the selection are in the title. */
function selectionInTitle(state) {
  const { $from, $to } = state.selection;
  return isTitle($from.parent) && isTitle($to.parent);
}

/** Position just after the title node: the start of the first block. */
const titleEnd = (doc) => doc.firstChild.nodeSize;

/**
 * Enter in the title: move to the start of the first block, inserting an
 * empty paragraph first when that block can't hold the cursor.
 * @type {Command}
 */
function enterFromTitle(state, dispatch) {
  if (!selectionInTitle(state)) return false;
  if (dispatch) {
    const at = titleEnd(state.doc);
    const tr = state.tr;
    if (!state.doc.child(1).isTextblock) tr.insert(at, state.schema.nodes.paragraph.create());
    tr.setSelection(TextSelection.create(tr.doc, at + 1));
    dispatch(tr.scrollIntoView());
  }
  return true;
}

/**
 * Backspace at the start of the first block (a top-level textblock): move to
 * the end of the title instead of joining the block into it. An empty first
 * block is removed on the way, unless it is the only block.
 * @type {Command}
 */
function backspaceIntoTitle(state, dispatch) {
  const { $cursor } = /** @type {TextSelection} */ (state.selection);
  if (!$cursor || $cursor.depth !== 1 || $cursor.index(0) !== 1 || $cursor.parentOffset !== 0) return false;
  if (dispatch) {
    const tr = state.tr;
    if ($cursor.parent.content.size === 0 && state.doc.childCount > 2) tr.delete($cursor.before(), $cursor.after());
    tr.setSelection(TextSelection.create(tr.doc, titleEnd(tr.doc) - 1));
    dispatch(tr.scrollIntoView());
  }
  return true;
}

/**
 * Delete at the end of the title: never join the first block into the title.
 * An empty first block is removed, unless it is the only block; otherwise
 * nothing happens.
 * @type {Command}
 */
function deleteAtTitleEnd(state, dispatch) {
  const { $cursor } = /** @type {TextSelection} */ (state.selection);
  if (!$cursor || !isTitle($cursor.parent) || $cursor.parentOffset !== $cursor.parent.content.size) return false;
  const first = state.doc.child(1);
  if (dispatch && first.isTextblock && first.content.size === 0 && state.doc.childCount > 2) {
    const at = titleEnd(state.doc);
    dispatch(state.tr.delete(at, at + first.nodeSize));
  }
  return true;
}

/**
 * Mod-a in the title: select the title text only.
 * @type {Command}
 */
function selectTitle(state, dispatch) {
  if (!selectionInTitle(state)) return false;
  if (dispatch) {
    const end = 1 + state.doc.firstChild.content.size;
    dispatch(state.tr.setSelection(TextSelection.create(state.doc, 1, end)));
  }
  return true;
}

/**
 * Keys for the title/body edge. Goes before the other keymaps.
 * @returns {Record<string, Command>}
 */
export function titleKeymap() {
  const keys = { Enter: enterFromTitle, 'Mod-a': selectTitle };
  // The keys prosemirror-commands' base keymap binds to joinBackward / joinForward
  const back = ['Backspace', 'Mod-Backspace', 'Shift-Backspace', ...(mac ? ['Ctrl-h', 'Alt-Backspace'] : [])];
  const forward = ['Delete', 'Mod-Delete', ...(mac ? ['Ctrl-d', 'Alt-Delete', 'Ctrl-Alt-Backspace', 'Alt-d'] : [])];
  for (const key of back) keys[key] = backspaceIntoTitle;
  for (const key of forward) keys[key] = deleteAtTitleEnd;
  return keys;
}

/**
 * Pasting into the title inserts the pasted content's plain text on one line.
 * @returns {Plugin}
 */
export function titlePastePlugin() {
  return new Plugin({
    props: {
      handlePaste(view, event, slice) {
        const { state } = view;
        if (!selectionInTitle(state)) return false;
        const text = slice.content.textBetween(0, slice.content.size, ' ', ' ').replace(/\r\n?|\n/g, ' ');
        const { from, to } = state.selection;
        view.dispatch(state.tr.insertText(text, from, to).scrollIntoView());
        return true;
      },
    },
  });
}

/**
 * The line above the title: "Published Nov 3, 2026 · posts" or "Draft · posts".
 * @param {{ status?: string, published?: string, collection?: string }} meta
 * @param {string} [locale] - for the date; the browser's by default, as the Posts list
 * @returns {string}
 */
export function metaLineText(meta, locale) {
  const collection = meta.collection || 'posts';
  if (meta.status !== 'published') return `Draft · ${collection}`;
  const date = meta.published ? new Date(meta.published) : null;
  const day = date && !Number.isNaN(date.getTime())
    ? ` ${date.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' })}`
    : '';
  return `Published${day} · ${collection}`;
}
