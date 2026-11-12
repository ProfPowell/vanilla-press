/**
 * Moving past media blocks (figures, embeds, rules, leaf components) with
 * the keyboard, and the empty paragraph kept at the end of the document so
 * there is always a line to type in after the last block.
 *
 * Pure: imports only prosemirror-state and prosemirror-model, so it runs in
 * Node tests. The commands take the usual (state, dispatch, view); with a
 * view, ArrowUp/ArrowDown ask it whether the cursor is on the first or last
 * visual line, without one they use the text offset.
 *
 * @module editor/block-nav
 */

import { Plugin, PluginKey, NodeSelection, TextSelection, Selection } from 'prosemirror-state';

/** Meta set on the trailing-paragraph transaction (editor.js skips it for "Unsaved"). */
export const TRAILING_META = 'vp-trailing';

const trailingKey = new PluginKey('vp-trailing');

/**
 * A block the cursor cannot enter as text: a figure (its image), or any
 * atom or leaf block (embed, hr, component_leaf).
 * @param {import('prosemirror-model').Node} node
 */
export function isMediaBlock(node) {
  if (!node || !node.isBlock) return false;
  if (node.type.name === 'figure') return true;
  return !!node.type.spec.atom || node.isLeaf;
}

/** The selected media block's NodeSelection, or null. */
function mediaSelection(state) {
  const sel = state.selection;
  return sel instanceof NodeSelection && isMediaBlock(sel.node) ? sel : null;
}

const captionOf = (figure) =>
  figure.type.name === 'figure' && figure.childCount > 0 && figure.firstChild.type.name === 'figcaption'
    ? figure.firstChild : null;

/**
 * The block next to `pos` going `dir`, climbing out of parents that end
 * there: { node, pos } or null at the document's edge.
 */
function blockBeside(doc, pos, dir) {
  let $pos = doc.resolve(pos);
  for (;;) {
    const node = dir > 0 ? $pos.nodeAfter : $pos.nodeBefore;
    if (node) return { node, pos: dir > 0 ? $pos.pos : $pos.pos - node.nodeSize };
    if ($pos.depth === 0) return null;
    $pos = doc.resolve(dir > 0 ? $pos.after() : $pos.before());
  }
}

/**
 * Where the cursor goes on entering `block` (at `pos`) going `dir`: a media
 * block is selected whole, except a figure entered from below, which puts
 * the cursor at the end of its caption when it has one.
 */
function entering(doc, block, pos, dir) {
  if (isMediaBlock(block)) {
    const caption = dir < 0 ? captionOf(block) : null;
    if (caption) return TextSelection.create(doc, pos + 2 + caption.content.size);
    return NodeSelection.create(doc, pos);
  }
  return dir > 0
    ? Selection.findFrom(doc.resolve(pos), 1, true)
    : Selection.findFrom(doc.resolve(pos + block.nodeSize), -1, true);
}

/** Whether a text cursor is at the edge of its textblock going `dir`. */
function atTextEdge(state, dir, view, vertical) {
  const sel = state.selection;
  if (!(sel instanceof TextSelection) || !sel.empty) return false;
  const { $from } = sel;
  if (!$from.parent.isTextblock) return false;
  if (vertical && view && typeof view.endOfTextblock === 'function') {
    return view.endOfTextblock(dir > 0 ? 'down' : 'up');
  }
  return dir > 0 ? $from.parentOffset === $from.parent.content.size : $from.parentOffset === 0;
}

function move(dir, vertical) {
  return (state, dispatch, view) => {
    const { doc } = state;
    let target = null;

    const media = mediaSelection(state);
    if (media) {
      const caption = dir > 0 ? captionOf(media.node) : null;
      if (caption) {
        target = TextSelection.create(doc, media.from + 2);
      } else {
        const beside = blockBeside(doc, dir > 0 ? media.to : media.from, dir);
        if (!beside) return false;
        target = entering(doc, beside.node, beside.pos, dir);
      }
    } else if (atTextEdge(state, dir, view, vertical)) {
      const { $from } = state.selection;
      const inCaption = $from.parent.type.name === 'figcaption';
      if (inCaption && dir < 0) {
        // Up from the caption: the figure's image
        target = NodeSelection.create(doc, $from.before($from.depth - 1));
      } else {
        const beside = blockBeside(doc, dir > 0 ? $from.after() : $from.before(), dir);
        if (!beside) return false;
        // Only media is ours; plain text blocks keep the default movement,
        // except from a caption, where the default can stall in the figure
        if (!isMediaBlock(beside.node) && !inCaption) return false;
        target = entering(doc, beside.node, beside.pos, dir);
      }
    } else {
      return false;
    }

    if (!target) return false;
    if (dispatch) dispatch(state.tr.setSelection(target).scrollIntoView());
    return true;
  };
}

export const navDown = move(1, true);
export const navUp = move(-1, true);
export const navRight = move(1, false);
export const navLeft = move(-1, false);

/** A transaction putting a paragraph holding `text` after the selected media block, or null. */
function paragraphAfter(state, text) {
  const media = mediaSelection(state);
  if (!media) return null;
  const paragraph = state.schema.nodes.paragraph;
  const $after = state.doc.resolve(media.to);
  // An empty paragraph already there (the trailing one, say) takes the text,
  // so no blank line is left behind it
  if (isEmptyParagraph($after.nodeAfter)) {
    const tr = text ? state.tr.insertText(text, media.to + 1) : state.tr;
    tr.setSelection(TextSelection.create(tr.doc, media.to + 1 + text.length));
    return tr.scrollIntoView();
  }
  const index = $after.index();
  if (!$after.parent.canReplaceWith(index, index, paragraph)) return null;
  const node = paragraph.create(null, text ? state.schema.text(text) : null);
  const tr = state.tr.insert(media.to, node);
  tr.setSelection(TextSelection.create(tr.doc, media.to + 1 + text.length));
  return tr.scrollIntoView();
}

/** Enter on a selected media block: a new empty paragraph after it. */
export function enterAfterMedia(state, dispatch) {
  const tr = paragraphAfter(state, '');
  if (!tr) return false;
  if (dispatch) dispatch(tr);
  return true;
}

/**
 * Typing with a media block selected: the text goes into a new paragraph
 * after the block (which stays), cursor after the text. Null otherwise.
 * @returns {import('prosemirror-state').Transaction|null}
 */
export function typeAfterMedia(state, text) {
  return paragraphAfter(state, text);
}

/**
 * Typing with a media block selected goes through `typeAfterMedia`. Register
 * it ahead of the input rules: with a node selection their text-before is
 * the whole doc's text, so a closing `*` could match an opener in the block
 * above and replace the media.
 */
export function typeAfterMediaPlugin() {
  return new Plugin({
    props: {
      handleTextInput(view, _from, _to, text) {
        const tr = typeAfterMedia(view.state, text);
        if (!tr) return false;
        view.dispatch(tr);
        return true;
      },
    },
  });
}

const isEmptyParagraph = (node) => !!node && node.type.name === 'paragraph' && node.childCount === 0;

/**
 * The body's end: the position before the first layout region (regions.js),
 * or the doc's end. The trailing paragraph belongs to the body.
 * @param {import('prosemirror-model').Node} doc
 * @returns {{ end: number, last: import('prosemirror-model').Node }}
 */
function bodyEnd(doc) {
  let end = doc.content.size;
  let last = doc.lastChild;
  for (let i = doc.childCount - 1; i > 0 && doc.child(i).type.name === 'region'; i--) {
    end -= doc.child(i).nodeSize;
    last = doc.child(i - 1);
  }
  return { end, last };
}

/** The tracked trailing paragraph's position if it is still an empty top-level paragraph. */
function checkTracked(doc, pos) {
  if (pos == null || pos > doc.content.size) return null;
  const $pos = doc.resolve(pos);
  return $pos.depth === 0 && isEmptyParagraph($pos.nodeAfter) ? pos : null;
}

/**
 * Keeps an empty paragraph after a body (the document, less its layout
 * regions) that ends in anything but a paragraph, so there is a line to click into or arrow onto. Its
 * transactions carry `vp-trailing` and stay out of the undo history. It
 * remembers the paragraph it added; when the block above that paragraph
 * turns into an empty paragraph (an undone insert, a deleted image), the
 * added one goes again so the post does not end in two blank lines.
 */
export function trailingParagraphPlugin() {
  return new Plugin({
    key: trailingKey,
    state: {
      init(_config, state) {
        // A doc that already ends in [media, empty paragraph] is ours to manage
        const { doc } = state;
        const { end, last } = bodyEnd(doc);
        const $end = doc.resolve(end);
        const before = $end.index() >= 2 ? doc.child($end.index() - 2) : null;
        if (before && isEmptyParagraph(last) && before.type.name !== 'paragraph' && before.type.name !== 'title') {
          return end - last.nodeSize;
        }
        return null;
      },
      apply(tr, value) {
        const set = tr.getMeta(trailingKey);
        if (set !== undefined) return set;
        if (value == null || !tr.docChanged) return value;
        const mapped = tr.mapping.mapResult(value, 1);
        return mapped.deleted ? null : checkTracked(tr.doc, mapped.pos);
      },
    },
    appendTransaction(_trs, oldState, newState) {
      const { doc } = newState;
      const { end, last } = bodyEnd(doc);
      if (last.type.name !== 'paragraph') {
        const tr = newState.tr.insert(end, newState.schema.nodes.paragraph.create());
        return tr.setMeta(TRAILING_META, true).setMeta('addToHistory', false).setMeta(trailingKey, end);
      }

      const tracked = trailingKey.getState(newState);
      if (tracked == null || tracked + last.nodeSize !== end) return null;
      const before = doc.resolve(tracked).nodeBefore;
      if (!isEmptyParagraph(before)) return null;
      // Only when the block above it was not a paragraph a moment ago
      const oldTracked = trailingKey.getState(oldState);
      const oldBefore = oldTracked == null ? null : oldState.doc.resolve(oldTracked).nodeBefore;
      if (!oldBefore || oldBefore.type.name === 'paragraph' || oldBefore.type.name === 'title') return null;
      const tr = newState.tr.delete(tracked, tracked + last.nodeSize);
      return tr.setMeta(TRAILING_META, true).setMeta('addToHistory', false).setMeta(trailingKey, null);
    },
  });
}
