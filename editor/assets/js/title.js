/**
 * The post title as the document's first line (the schema's `title` node).
 *
 * The title holds `meta.title` as plain text: no marks, no blocks. These
 * commands keep the edge between the title and the first block behaving
 * like a title: Enter leaves it, Backspace returns to it, Delete never pulls
 * a block into it, Mod-a selects it, and a paste, a drop or typing over a
 * selection that runs into the body lands as one line of text.
 * The node never enters the stored block AST (ast.js skips it).
 *
 * @module editor/title
 */

import { Plugin, TextSelection } from 'prosemirror-state';
import { Slice } from 'prosemirror-model';
import { dropPoint } from 'prosemirror-transform';

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
 * empty paragraph first when that block can't hold the cursor. A selection
 * that runs from the title into the body is deleted first.
 * @type {Command}
 */
function enterFromTitle(state, dispatch) {
  if (!selectionInTitle(state) && !selectionCrossesTitleEnd(state)) return false;
  if (dispatch) {
    const tr = state.tr;
    if (selectionCrossesTitleEnd(state)) deleteAcrossTitleEnd(tr);
    const at = titleEnd(tr.doc);
    if (!tr.doc.child(1).isTextblock) tr.insert(at, state.schema.nodes.paragraph.create());
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
 * Backspace or Delete over a selection that runs from the title into the
 * body: remove it without joining the body's text into the title.
 * @type {Command}
 */
function deleteSelectionAcrossTitleEnd(state, dispatch) {
  if (!selectionCrossesTitleEnd(state)) return false;
  if (dispatch) {
    const tr = state.tr;
    deleteAcrossTitleEnd(tr);
    dispatch(tr.scrollIntoView());
  }
  return true;
}

/** The first command that applies. */
const first = (...commands) => (state, dispatch, view) => commands.some((c) => c(state, dispatch, view));

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
  for (const key of back) keys[key] = first(deleteSelectionAcrossTitleEnd, backspaceIntoTitle);
  for (const key of forward) keys[key] = first(deleteSelectionAcrossTitleEnd, deleteAtTitleEnd);
  return keys;
}

/** The selection starts in the title and ends in a block below it. */
function selectionCrossesTitleEnd(state) {
  const { $from, $to } = state.selection;
  return isTitle($from.parent) && !isTitle($to.parent);
}

/** A slice's text on one line: blocks and newlines become spaces, marks are dropped. */
const plainText = (slice) => slice.content.textBetween(0, slice.content.size, ' ', ' ').replace(/\r\n?|\n/g, ' ');

/**
 * Remove a selection that runs from the title into the body, keeping the
 * title and the rest of the block it ends in as separate nodes (a plain
 * deleteSelection would join that block's text into the title). Removes the
 * body part first, then the title part, so the title positions hold.
 * @param {import('prosemirror-state').Transaction} tr
 * @returns {number} where the cursor lands, in the title
 */
function deleteAcrossTitleEnd(tr) {
  const { from, to } = tr.selection;
  const end = titleEnd(tr.doc);
  if (to > end) tr.delete(end, to);
  tr.delete(from, end - 1);
  tr.setSelection(TextSelection.create(tr.doc, from));
  return from;
}

/**
 * Move a selection that runs from the title into the body to `pos` in the
 * body (ProseMirror's own moved drop would join body text into the title):
 * the source is removed edge-safely, and the title part lands as a paragraph.
 * @param {EditorState} state
 * @param {number} pos - the drop position, in the body
 * @param {Slice} slice - the dragged selection's content
 * @returns {import('prosemirror-state').Transaction}
 */
function dropAcrossTitleEnd(state, pos, slice) {
  const { content } = slice;
  const head = content.firstChild;
  const body = isTitle(head)
    ? new Slice(content.replaceChild(0, state.schema.nodes.paragraph.create(null, head.content)), slice.openStart, slice.openEnd)
    : slice;
  const insertAt = dropPoint(state.doc, pos, body) ?? pos;
  const tr = state.tr;
  deleteAcrossTitleEnd(tr);
  const from = tr.mapping.map(insertAt);
  const steps = tr.mapping.maps.length;
  tr.replaceRange(from, from, body);
  const to = tr.mapping.slice(steps).map(from, 1);
  tr.setSelection(TextSelection.between(tr.doc.resolve(from), tr.doc.resolve(Math.max(from, to))));
  return tr.setMeta('uiEvent', 'drop').scrollIntoView();
}

/**
 * Text that lands in the title stays one line of plain text:
 * - pasting into the title, or over a selection that starts in it, inserts
 *   the slice's plain text (newlines turned into spaces);
 * - typing over a selection that runs from the title into the body replaces
 *   it without moving body text into the title;
 * - dropping onto the title inserts the dropped content's plain text (a
 *   drop with no text, such as a rule, changes nothing);
 * - dragging a selection that runs from the title into the body and dropping
 *   it in the body moves it without joining body text into the title;
 * - cutting a selection that runs from the title into the body removes it
 *   the same way (the clipboard keeps what was cut).
 * @returns {Plugin}
 */
export function titlePastePlugin() {
  let pendingCut = null;
  return new Plugin({
    filterTransaction(tr, state) {
      if (!pendingCut || tr.getMeta('uiEvent') !== 'cut') return true;
      const view = pendingCut;
      pendingCut = null;
      if (!selectionCrossesTitleEnd(state)) return true;
      queueMicrotask(() => deleteSelectionAcrossTitleEnd(view.state, view.dispatch));
      return false;
    },
    props: {
      handlePaste(view, event, slice) {
        const { state } = view;
        const { $from, from, to } = state.selection;
        if (!isTitle($from.parent)) return false;
        const tr = state.tr;
        if (selectionCrossesTitleEnd(state)) tr.insertText(plainText(slice), deleteAcrossTitleEnd(tr));
        else tr.insertText(plainText(slice), from, to);
        view.dispatch(tr.scrollIntoView());
        return true;
      },
      // Cut over a selection across the edge: the clipboard is already filled
      // when ProseMirror dispatches its deleteSelection; replace that delete.
      handleDOMEvents: {
        cut(view) {
          if (selectionCrossesTitleEnd(view.state)) pendingCut = view;
          return false;
        },
      },
      handleTextInput(view, from, to, text) {
        const { state } = view;
        if (!selectionCrossesTitleEnd(state)) return false;
        const tr = state.tr;
        const at = deleteAcrossTitleEnd(tr);
        view.dispatch(tr.insertText(text, at).scrollIntoView());
        return true;
      },
      handleDrop(view, event, slice, moved) {
        const found = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (!found) return false;
        const { state } = view;
        // A drag within the editor moves its source: a dragged node (the
        // gutter handle), otherwise the selection
        const draggedNode = view.dragging?.node;
        if (!isTitle(state.doc.resolve(found.pos).parent)) {
          if (!moved || draggedNode || !selectionCrossesTitleEnd(state)) return false;
          view.dispatch(dropAcrossTitleEnd(state, found.pos, slice));
          return true;
        }
        const text = plainText(slice);
        // Nothing to put in the title (a rule, an image): keep the source
        if (!text.trim()) return true;
        const tr = state.tr;
        if (moved && draggedNode) draggedNode.replace(tr);
        else if (moved && selectionCrossesTitleEnd(state)) deleteAcrossTitleEnd(tr);
        else if (moved) tr.deleteSelection();
        const at = tr.mapping.map(found.pos);
        tr.insertText(text, at);
        tr.setSelection(TextSelection.create(tr.doc, at, at + text.length));
        view.dispatch(tr.scrollIntoView());
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
