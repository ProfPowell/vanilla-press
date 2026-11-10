/**
 * Moving and adding blocks: the `+` and drag handles in the gutter of the
 * hovered (or cursor) block, the keyboard move (Alt+Shift+↑/↓), and the
 * "Type / for blocks" placeholder on the cursor's empty line.
 *
 * The movable block is a list item, tab or step (always within its parent),
 * or a block that shares its parent with other blocks (a lone child moves
 * with its container). The title never
 * moves and nothing moves above it.
 *
 * @module editor/block-handles
 */

import { Plugin, Selection, TextSelection, NodeSelection } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { Fragment } from 'prosemirror-model';
import { dropPoint } from 'prosemirror-transform';

/** @typedef {import('prosemirror-model').Node} PMNode */
/** @typedef {import('prosemirror-model').ResolvedPos} ResolvedPos */
/** @typedef {import('prosemirror-state').Command} Command */
/** @typedef {{ depth: number, pos: number }} BlockRef */

export const PLACEHOLDER = 'Type / for blocks';

const mac = typeof navigator !== 'undefined' && /Mac|iP(hone|[oa]d)/.test(navigator.platform || '');
/** Items that move within their parent (a list, tabs, steps), never out of it */
const ITEMS = new Set(['list_item', 'tab', 'step']);
const isBlock = (node) => (node.type.spec.group || '').split(' ').includes('block');

/**
 * Whether `node`, child `index` of `parent`, is a block that moves on its own.
 * @param {PMNode} node
 * @param {PMNode} parent
 * @param {number} index
 */
function isMovable(node, parent, index) {
  if (ITEMS.has(node.type.name)) return true;
  if (!isBlock(node) || parent.childCount < 2) return false;
  // An item's first line stands for the item (and its nested list)
  return !(index === 0 && ITEMS.has(parent.type.name) && node.isTextblock);
}

/**
 * The innermost ancestor of `$pos` that moves as a block: a list item, tab
 * or step, or a block whose parent holds more than one child. Never the title.
 * @param {ResolvedPos} $pos
 * @returns {BlockRef | null}
 */
export function movableBlockAt($pos) {
  for (let d = $pos.depth; d > 0; d--) {
    if (isMovable($pos.node(d), $pos.node(d - 1), $pos.index(d - 1))) return { depth: d, pos: $pos.before(d) };
  }
  return null;
}

/**
 * The block a selection moves: a selected movable node itself, otherwise the
 * movable block around the selection's start.
 * @param {Selection} selection
 * @returns {BlockRef | null}
 */
function blockOfSelection(selection) {
  const { $from } = selection;
  if (selection instanceof NodeSelection && isMovable(selection.node, $from.parent, $from.index())) {
    return { depth: $from.depth + 1, pos: selection.from };
  }
  return movableBlockAt($from);
}

/**
 * The block at a `posAtCoords` result: a leaf block (rule, embed) itself,
 * otherwise the movable block around the position. null over the title.
 * @param {PMNode} doc
 * @param {{ pos: number, inside: number }} found
 * @returns {BlockRef | null}
 */
function blockAtCoords(doc, found) {
  if (found.inside >= 0) {
    const node = doc.nodeAt(found.inside);
    const $inside = doc.resolve(found.inside);
    if (node?.isLeaf && isBlock(node)) {
      return isMovable(node, $inside.parent, $inside.index())
        ? { depth: $inside.depth + 1, pos: found.inside } : movableBlockAt($inside);
    }
    if (node && !node.isLeaf) return movableBlockAt(doc.resolve(found.inside + 1));
  }
  return movableBlockAt(doc.resolve(found.pos));
}

/**
 * The selection after a block moved by `delta`: shifted with it when it lay
 * inside the block, otherwise on the block.
 */
function followSelection(selection, doc, from, to, delta) {
  if (selection.from >= from && selection.to <= to) {
    const json = selection.toJSON();
    for (const key of ['anchor', 'head', 'pos']) if (typeof json[key] === 'number') json[key] += delta;
    return Selection.fromJSON(doc, json);
  }
  return Selection.near(doc.resolve(from + delta + 1));
}

/**
 * Swap the movable block with its previous (-1) or next (1) sibling in the
 * same parent; the selection moves with it. False at the first or last
 * sibling, and never past the title.
 * @param {-1|1} dir
 * @returns {Command}
 */
export function moveBlock(dir) {
  return (state, dispatch) => {
    const block = blockOfSelection(state.selection);
    if (!block) return false;
    const $block = state.doc.resolve(block.pos);
    const parent = $block.parent;
    const index = $block.index();
    const other = index + dir;
    if (other < 0 || other >= parent.childCount) return false;
    const node = parent.child(index);
    const sibling = parent.child(other);
    if (sibling.type.name === 'title') return false;
    const swapped = Fragment.fromArray(dir < 0 ? [node, sibling] : [sibling, node]);
    const first = Math.min(index, other);
    if (!parent.canReplace(first, first + 2, swapped)) return false;
    if (dispatch) {
      const start = dir < 0 ? block.pos - sibling.nodeSize : block.pos;
      const delta = dir * sibling.nodeSize;
      const tr = state.tr.replaceWith(start, start + node.nodeSize + sibling.nodeSize, swapped);
      tr.setSelection(followSelection(state.selection, tr.doc, block.pos, block.pos + node.nodeSize, delta));
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/**
 * Whether dropping a dragged item (list item, tab, step) at `pos` must be
 * refused: it lands only where its kind of parent holds it directly, never
 * unwrapped into a paragraph or the title, or wrapped into a new container.
 * @param {PMNode} doc
 * @param {number} pos - the drop position
 * @param {import('prosemirror-model').Slice} slice - the dragged item
 * @param {PMNode} item
 * @returns {boolean}
 */
export function itemDropRefused(doc, pos, slice, item) {
  const at = dropPoint(doc, pos, slice);
  if (at == null) return true;
  const $at = doc.resolve(at);
  return !$at.parent.canReplaceWith($at.index(), $at.index(), item.type);
}

/**
 * "Type / for blocks" on the empty paragraph that holds the cursor
 * (a decoration: never part of the document).
 * @param {import('prosemirror-state').EditorState} state
 */
function placeholderDecorations(state) {
  const { selection } = state;
  if (!(selection instanceof TextSelection) || !selection.empty) return null;
  const { $from } = selection;
  if ($from.parent.type.name !== 'paragraph' || $from.parent.content.size !== 0) return null;
  return DecorationSet.create(state.doc, [
    Decoration.node($from.before(), $from.after(), { 'data-placeholder': PLACEHOLDER }),
  ]);
}

const iconButton = (label, path, extra = {}) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('aria-label', label);
  button.title = label;
  Object.assign(button, extra);
  button.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">${path}</svg>`;
  return button;
};

const PLUS_ICON = '<path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';
const GRIP_ICON = [[9, 6], [15, 6], [9, 12], [15, 12], [9, 18], [15, 18]]
  .map(([cx, cy]) => `<circle cx="${cx}" cy="${cy}" r="1.6" fill="currentColor"/>`).join('');

/** The gutter handles for one editor view. */
class BlockHandles {
  /**
   * @param {import('prosemirror-view').EditorView} view
   * @param {(view: import('prosemirror-view').EditorView, pos: number) => void} [addAt]
   * @param {{ item: PMNode | null }} drag - the item being dragged by the grip, shared with handleDrop
   */
  constructor(view, addAt, drag) {
    this.view = view;
    this.addAt = addAt;
    this.drag = drag;
    /** @type {BlockRef | null} the block under the pointer */
    this.hovered = null;
    /** @type {BlockRef | null} the block the handles are showing for */
    this.target = null;

    this.el = document.createElement('div');
    this.el.className = 'block-handles';
    this.el.hidden = true;
    this.addButton = iconButton('Add block after', PLUS_ICON);
    this.dragButton = iconButton('Drag to move', GRIP_ICON, { draggable: true });
    this.el.append(this.addButton, this.dragButton);
    this.host = view.dom.parentNode;
    this.host.appendChild(this.el);

    this.onMouseMove = (e) => this.pointerAt(e);
    this.onMouseLeave = () => { this.hovered = null; this.update(this.view); };
    this.host.addEventListener('mousemove', this.onMouseMove);
    this.host.addEventListener('mouseleave', this.onMouseLeave);
    // Focus shows or hides the cursor block's handles (after a blur, once focus has landed)
    this.onFocusChange = () => requestAnimationFrame(() => { if (!this.view.isDestroyed) this.update(this.view); });
    view.dom.addEventListener('focus', this.onFocusChange);
    view.dom.addEventListener('blur', this.onFocusChange);

    // The editor keeps focus (and its selection) on a mouse click
    this.addButton.addEventListener('mousedown', (e) => e.preventDefault());
    this.addButton.addEventListener('click', () => this.addAfter());
    this.dragButton.addEventListener('dragstart', (e) => this.dragStart(e));
    this.endDrag = () => { delete this.host.dataset.blockDragging; };
    this.host.addEventListener('drop', this.endDrag);
    this.dragButton.addEventListener('dragend', () => {
      this.endDrag();
      const { dragging } = this.view;
      const { item } = this.drag;
      setTimeout(() => {
        if (this.view.dragging === dragging) this.view.dragging = null;
        if (this.drag.item === item) this.drag.item = null;
      }, 50);
    });
  }

  /** Track the block under the pointer; over the handles, keep the last one. */
  pointerAt(event) {
    if (this.el.contains(event.target) || !this.view.dom.contains(event.target)) return;
    const found = this.view.posAtCoords({ left: event.clientX, top: event.clientY });
    if (!found) return;
    const { doc } = this.view.state;
    const overTitle = doc.resolve(found.pos).parent.type.name === 'title';
    const block = overTitle ? null : blockAtCoords(doc, found);
    if (block || overTitle) this.hovered = block;
    if (block?.pos !== this.target?.pos) this.update(this.view);
  }

  /** The `+` handle: open the block palette, inserting after the block. */
  addAfter() {
    const block = this.target;
    if (!block || !this.addAt) return;
    const node = this.view.state.doc.nodeAt(block.pos);
    this.view.focus();
    this.addAt(this.view, block.pos + node.nodeSize);
  }

  /** The drag handle: select the block and drag it with ProseMirror's own drop. */
  dragStart(event) {
    const block = this.target;
    if (!block || !event.dataTransfer) { event.preventDefault(); return; }
    const { view } = this;
    // Before selecting: a selected figure or embed would show its fields and grow
    this.host.dataset.blockDragging = '';
    const selection = NodeSelection.create(view.state.doc, block.pos);
    view.dispatch(view.state.tr.setSelection(selection));
    const slice = selection.content();
    const { dom, text } = view.serializeForClipboard(slice);
    event.dataTransfer.clearData();
    event.dataTransfer.setData('text/html', dom.innerHTML);
    event.dataTransfer.setData('text/plain', text);
    event.dataTransfer.effectAllowed = 'copyMove';
    const blockDom = view.nodeDOM(block.pos);
    if (blockDom instanceof Element) event.dataTransfer.setDragImage(blockDom, 0, 0);
    // ProseMirror's drop reads this: it moves `node` (Alt/Ctrl-drag copies)
    view.dragging = { slice, move: !event[mac ? 'altKey' : 'ctrlKey'], node: selection };
    // ProseMirror may clear view.dragging before handleDrop runs: keep the item here
    this.drag.item = ITEMS.has(selection.node.type.name) ? selection.node : null;
  }

  /** The block to show handles for: hovered, else the cursor's (while focused). None over a text selection. */
  targetFor(view) {
    const { selection } = view.state;
    if (selection instanceof TextSelection && !selection.empty) return null;
    if (this.hovered) return this.hovered;
    const focused = view.hasFocus() || this.el.contains(document.activeElement);
    return focused ? blockOfSelection(selection) : null;
  }

  update(view, prevState) {
    if (prevState && !prevState.doc.eq(view.state.doc)) this.hovered = null;
    this.target = this.targetFor(view);
    const blockDom = this.target && view.nodeDOM(this.target.pos);
    if (!(blockDom instanceof Element)) {
      this.target = null;
      this.el.hidden = true;
      return;
    }
    this.el.hidden = false;
    const host = this.host.getBoundingClientRect();
    const rect = blockDom.getBoundingClientRect();
    const line = this.firstLine(this.target.pos, rect);
    const height = this.el.offsetHeight;
    this.el.style.top = `${line.top + (line.bottom - line.top) / 2 - height / 2 - host.top}px`;
    // At the column's text edge (not a nested block's), so they never cover text
    const column = view.dom.getBoundingClientRect();
    const padding = parseFloat(getComputedStyle(view.dom).paddingInlineStart) || 0;
    this.el.style.left = `${column.left + padding - host.left}px`;
  }

  /** The vertical extent of the block's first line (its box, for a block with no text). */
  firstLine(pos, rect) {
    const { doc } = this.view.state;
    const node = doc.nodeAt(pos);
    const text = node.isLeaf ? null : Selection.findFrom(doc.resolve(pos + 1), 1, true);
    if (text && text.from < pos + node.nodeSize) {
      try {
        const coords = this.view.coordsAtPos(text.from);
        return { top: coords.top, bottom: coords.bottom };
      } catch { /* not rendered (a node view): fall back to the box */ }
    }
    return { top: rect.top, bottom: Math.min(rect.bottom, rect.top + 2 * this.el.offsetHeight) };
  }

  destroy() {
    this.host.removeEventListener('mousemove', this.onMouseMove);
    this.host.removeEventListener('mouseleave', this.onMouseLeave);
    this.host.removeEventListener('drop', this.endDrag);
    this.endDrag();
    this.view.dom.removeEventListener('focus', this.onFocusChange);
    this.view.dom.removeEventListener('blur', this.onFocusChange);
    this.el.remove();
  }
}

/**
 * The gutter handles (`+` adds a block after, the grip drags it) for the
 * hovered or cursor block, and the empty-line placeholder.
 * @param {{ addAt?: (view: import('prosemirror-view').EditorView, pos: number) => void }} [options]
 *   addAt: the `+` handle's action (open the block palette inserting at `pos`)
 * @returns {Plugin}
 */
export function blockHandlesPlugin({ addAt } = {}) {
  const drag = { item: null };
  return new Plugin({
    view: (view) => new BlockHandles(view, addAt, drag),
    props: {
      decorations: placeholderDecorations,
      // A list item, tab or step dragged by the grip stays in its kind of parent
      handleDrop(view, event, slice) {
        const { item } = drag;
        if (!item || slice.content.firstChild !== item) return false;
        const found = view.posAtCoords({ left: event.clientX, top: event.clientY });
        return !found || itemDropRefused(view.state.doc, found.pos, slice, item);
      },
    },
  });
}
