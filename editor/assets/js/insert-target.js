/**
 * Where a block goes once an async choice (the media picker) settles.
 *
 * The palette knows its insert position when it opens the picker, but the
 * doc can change while the picker is open (a save's clean-up, a remote
 * reload). This plugin maps tracked positions through every transaction, and
 * `insertAtTarget` checks the place still fits before using it: the `/`
 * paragraph must still hold exactly its text, and an "after this block"
 * position must still be a block boundary. Otherwise the block goes at the
 * end of the doc; a paragraph that no longer matches is never replaced.
 * No DOM: tested in Node.
 *
 * @module editor/insert-target
 */

import { Plugin, PluginKey, Selection, NodeSelection } from 'prosemirror-state';
import { Fragment } from 'prosemirror-model';

export const insertTargetKey = new PluginKey('insertTarget');

/** @typedef {{ kind: 'replace'|'after', pos: number, text?: string, gone: boolean }} Target */

/** Keeps the tracked targets mapped through every transaction. */
export function insertTargetPlugin() {
  return new Plugin({
    key: insertTargetKey,
    state: {
      init: () => new Map(),
      apply(tr, targets) {
        const meta = tr.getMeta(insertTargetKey);
        let next = targets;
        if (tr.docChanged && targets.size) {
          next = new Map();
          for (const [id, t] of targets) {
            // assoc -1: text typed at the spot stays after it
            const r = tr.mapping.mapResult(t.pos, -1);
            next.set(id, { ...t, pos: r.pos, gone: t.gone || r.deleted });
          }
        }
        if (meta?.add) {
          next = new Map(next);
          next.set(meta.add.id, meta.add.target);
        }
        if (meta?.remove) {
          next = new Map(next);
          next.delete(meta.remove);
        }
        return next;
      },
    },
  });
}

let seq = 0;

/**
 * Start tracking a place: `{ replace: pos }` (a position in the `/`
 * paragraph, which the block will replace) or `{ after: pos }` (just after a
 * block). Dispatch the returned transaction (it changes neither the doc nor
 * the undo history).
 * @param {import('prosemirror-state').EditorState} state
 * @param {{ replace?: number, after?: number }} where
 * @returns {{ tr: import('prosemirror-state').Transaction, id: string }}
 */
export function trackTarget(state, where) {
  const id = `t${++seq}`;
  /** @type {Target} */
  const target = where.replace != null
    ? { kind: 'replace', pos: where.replace, text: state.doc.resolve(where.replace).parent.textContent, gone: false }
    : { kind: 'after', pos: where.after, gone: false };
  const tr = state.tr.setMeta(insertTargetKey, { add: { id, target } }).setMeta('addToHistory', false);
  return { tr, id };
}

/** Stop tracking a place (the choice was cancelled). */
export function untrackTarget(state, id) {
  return state.tr.setMeta(insertTargetKey, { remove: id }).setMeta('addToHistory', false);
}

/** The range to replace or position to insert at, or null when the target no longer fits. */
function placeFor(doc, t, frag) {
  if (t.gone || t.pos < 0 || t.pos > doc.content.size) return null;
  const $pos = doc.resolve(t.pos);
  if (t.kind === 'replace') {
    if ($pos.depth < 1 || $pos.parent.type.name !== 'paragraph' || $pos.parent.textContent !== t.text) return null;
    const from = $pos.before();
    const to = $pos.after();
    const $from = doc.resolve(from);
    if (!$from.parent.canReplace($from.index(), $from.index() + 1, frag)) return null;
    return { from, to };
  }
  if ($pos.parent.isTextblock || $pos.textOffset !== 0) return null; // mid-block: never split it
  if (!$pos.parent.canReplace($pos.index(), $pos.index(), frag)) return null;
  return { from: t.pos, to: t.pos };
}

/**
 * Insert `nodes` at a tracked target, or at the end of the doc when the
 * target no longer fits. The cursor goes into the first inserted node (or
 * selects it when it holds no text). Null when the target is unknown (the
 * editor's state was replaced, e.g. another post opened): insert nothing.
 * @param {import('prosemirror-state').EditorState} state
 * @param {string} id
 * @param {import('prosemirror-model').Node[]} nodes
 * @returns {{ tr: import('prosemirror-state').Transaction, pos: number, placed: 'target'|'end' } | null}
 */
export function insertAtTarget(state, id, nodes) {
  const t = insertTargetKey.getState(state)?.get(id);
  if (!t) return null;
  const frag = Fragment.fromArray(nodes);
  const { doc } = state;
  let place = placeFor(doc, t, frag);
  const placed = place ? 'target' : 'end';
  if (!place) place = { from: doc.content.size, to: doc.content.size };

  const tr = state.tr.replaceWith(place.from, place.to, frag);
  tr.setMeta(insertTargetKey, { remove: id });
  const pos = place.from;
  const inserted = tr.doc.nodeAt(pos);
  const text = Selection.findFrom(tr.doc.resolve(pos), 1, true);
  if (text && inserted && text.from < pos + inserted.nodeSize) tr.setSelection(text);
  else if (inserted) tr.setSelection(NodeSelection.create(tr.doc, pos));
  return { tr: tr.scrollIntoView(), pos, placed };
}
