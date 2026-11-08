/**
 * Files dropped on or pasted into the writing area: each one uploads to the
 * media library and lands as its block (a figure, an audio or video embed,
 * a PDF viewer or link) where it was dropped.
 *
 * While a file uploads, a placeholder widget holds its place. The widgets
 * are a DecorationSet keyed by id that maps through every transaction, so
 * typing above a placeholder moves it. A file that fails keeps its widget
 * with the error and a Dismiss button; the others carry on.
 *
 * The widget's DOM belongs to the decoration: progress and errors re-create
 * it (a new `key`), nothing writes into the editor's own DOM.
 * Pure logic, no DOM at import: tested in Node.
 *
 * @module editor/media-drop
 */

import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { Fragment } from 'prosemirror-model';
import { closeHistory } from 'prosemirror-history';
import { createUploadQueue } from './media-upload.js';
import { nodesFor } from './media-insert.js';

/** @typedef {import('prosemirror-model').Node} PMNode */

/**
 * Whether a drop or paste should upload its files: it has files and no
 * `text/html` (a paste of web content keeps ProseMirror's normal paste).
 * @param {DataTransfer|null|undefined} dataTransfer
 */
export function shouldUpload(dataTransfer) {
  if (!dataTransfer?.files?.length) return false;
  return !Array.from(dataTransfer.types || []).includes('text/html');
}

/** Position just after the title: the start of the body. */
const titleEnd = (doc) => doc.firstChild.nodeSize;

/**
 * Where a file dropped at `pos` goes:
 * - in the title: the start of the body;
 * - in an empty top-level paragraph: that paragraph (it is replaced);
 * - between top-level blocks: there;
 * - otherwise: after the top-level block holding `pos`.
 * @param {PMNode} doc
 * @param {number} pos
 * @returns {{ from: number, to: number }}
 */
export function insertRangeFor(doc, pos) {
  const end = titleEnd(doc);
  if (pos < end) return { from: end, to: end };
  const $pos = doc.resolve(pos);
  if ($pos.depth === 0) return { from: pos, to: pos };
  const top = $pos.node(1);
  const start = $pos.before(1);
  if (top.type.name === 'paragraph' && top.content.size === 0) return { from: start, to: start + top.nodeSize };
  const after = $pos.after(1);
  return { from: after, to: after };
}

/** A top-level block boundary at or after `pos` (never inside the title or a block). */
function blockBoundary(doc, pos) {
  const p = Math.max(0, Math.min(pos, doc.content.size));
  if (p < titleEnd(doc)) return titleEnd(doc);
  const $pos = doc.resolve(p);
  return $pos.depth === 0 ? p : $pos.after(1);
}

export const placeholderKey = new PluginKey('mediaDropPlaceholder');

let order = 0;

/** The widget for a placeholder spec. */
function widgetFor(pos, spec) {
  const key = `${spec.id}:${spec.error ? 'error' : Math.round(spec.progress * 100)}`;
  return Decoration.widget(pos, (view) => placeholderDOM(view, spec), {
    ...spec,
    key,
    side: spec.side,
    ignoreSelection: true,
    stopEvent: () => true,
  });
}

/** The placeholder's DOM: "Uploading <name>…" with a progress bar, or the error with Dismiss. */
function placeholderDOM(view, spec) {
  const doc = view.dom.ownerDocument;
  const box = doc.createElement('div');
  box.className = 'media-drop-placeholder';
  box.contentEditable = 'false';
  box.dataset.id = spec.id;
  if (spec.error) {
    box.dataset.state = 'error';
    const p = doc.createElement('p');
    p.className = 'media-drop-error';
    p.setAttribute('role', 'alert');
    p.textContent = `${spec.name}: ${spec.error}`;
    const dismiss = doc.createElement('button');
    dismiss.type = 'button';
    dismiss.textContent = 'Dismiss';
    dismiss.addEventListener('click', () => {
      view.dispatch(view.state.tr.setMeta(placeholderKey, { remove: { id: spec.id } }).setMeta('addToHistory', false));
      spec.onDismiss?.();
      view.focus();
    });
    box.append(p, dismiss);
  } else {
    box.dataset.state = 'uploading';
    const label = doc.createElement('span');
    label.textContent = `Uploading ${spec.name}…`;
    const bar = doc.createElement('progress');
    bar.max = 1;
    bar.value = spec.progress;
    bar.setAttribute('aria-label', `Uploading ${spec.name}`);
    box.append(label, ' ', bar);
  }
  return box;
}

/**
 * The placeholders: a DecorationSet of widgets keyed by id. Meta actions:
 * `{ add: { id, pos, name, replace? } }`, `{ progress: { id, value } }`,
 * `{ fail: { id, error } }`, `{ remove: { id } }`. Every placeholder maps
 * through every transaction and stays at a top-level block boundary (a
 * deletion around it moves it rather than dropping it).
 * @returns {Plugin}
 */
export function placeholderPlugin() {
  return new Plugin({
    key: placeholderKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, set) {
        let next = set;
        if (tr.docChanged && set !== DecorationSet.empty) {
          next = DecorationSet.create(tr.doc, set.find().map((d) =>
            widgetFor(blockBoundary(tr.doc, tr.mapping.map(d.from, 1)), d.spec)));
        }
        const meta = tr.getMeta(placeholderKey);
        if (!meta) return next;
        if (meta.add) {
          const { id, pos, name, replace = false, onDismiss } = meta.add;
          const spec = { id, name, progress: 0, error: null, replace, side: ++order, onDismiss };
          return next.add(tr.doc, [widgetFor(blockBoundary(tr.doc, pos), spec)]);
        }
        const id = meta.progress?.id ?? meta.fail?.id ?? meta.remove?.id;
        const found = next.find(undefined, undefined, (spec) => spec.id === id);
        if (!found.length) return next;
        next = next.remove(found);
        if (meta.remove) return next;
        const [old] = found;
        const spec = meta.progress
          ? { ...old.spec, progress: meta.progress.value }
          : { ...old.spec, error: meta.fail.error };
        return next.add(tr.doc, [widgetFor(old.from, spec)]);
      },
    },
    props: {
      decorations: (state) => placeholderKey.getState(state),
    },
  });
}

/**
 * Where placeholder `id` is now, or null when it is gone.
 * @param {import('prosemirror-state').EditorState} state
 * @param {string} id
 * @returns {number|null}
 */
export function findPlaceholder(state, id) {
  const set = placeholderKey.getState(state);
  return set?.find(undefined, undefined, (spec) => spec.id === id)[0]?.from ?? null;
}

const specOf = (state, id) =>
  placeholderKey.getState(state)?.find(undefined, undefined, (spec) => spec.id === id)[0]?.spec ?? null;

let seq = 0;

const PLACE_FAILED = "it uploaded, but couldn't be inserted here. Insert it from the media library: type / and choose Image, Audio, Video or PDF.";

/**
 * Drop or paste files to upload them and insert their blocks.
 * @param {{
 *   upload: (file: File, opts: { onProgress: (f: number) => void }) => Promise<object>,
 *   plan: (item: object) => object|Promise<object>,
 *   onInserted?: (view: import('prosemirror-view').EditorView, pos: number, plan: object) => void,
 * }} opts
 *   `upload` sends one file and resolves its MediaItem; `plan` turns the
 *   item into an insert plan (media-insert.js `insertPlan`); `onInserted`
 *   runs after the block is in (focus the alt field, add a save note).
 * @returns {Plugin[]}
 */
export function mediaDropPlugin({ upload, plan, onInserted = () => {} }) {
  /** Per editor view: its queue and which placeholder each queue entry fills. */
  const views = new WeakMap();

  function uploaderFor(view) {
    let u = views.get(view);
    if (u) return u;
    const ids = new Map(); // entry key → placeholder id
    const seen = new Map(); // entry key → last state or progress shown
    const queue = createUploadQueue({
      upload,
      concurrency: 1, // one at a time keeps the blocks in the order they were dropped
      onChange: () => sync(view, queue, ids, seen),
    });
    u = { queue, ids, seen };
    views.set(view, u);
    return u;
  }

  function sync(view, queue, ids, seen) {
    if (view.isDestroyed) return;
    for (const entry of queue.entries()) {
      const id = ids.get(entry.key);
      if (!id) continue;
      const shown = seen.get(entry.key);
      if (entry.state === 'uploading' || entry.state === 'waiting') {
        const pct = Math.round(entry.progress * 100);
        if (shown === pct) continue;
        seen.set(entry.key, pct);
        if (findPlaceholder(view.state, id) == null) continue;
        view.dispatch(view.state.tr.setMeta(placeholderKey, { progress: { id, value: entry.progress } }).setMeta('addToHistory', false));
      } else if (shown !== entry.state) {
        seen.set(entry.key, entry.state);
        if (entry.state === 'error') {
          if (findPlaceholder(view.state, id) == null) continue;
          view.dispatch(view.state.tr.setMeta(placeholderKey, { fail: { id, error: entry.error } }).setMeta('addToHistory', false));
        } else {
          place(view, id, entry.item).catch(() => {
            if (view.isDestroyed || findPlaceholder(view.state, id) == null) return;
            view.dispatch(view.state.tr.setMeta(placeholderKey, { fail: { id, error: PLACE_FAILED } }).setMeta('addToHistory', false));
          });
        }
      }
    }
  }

  /** Replace placeholder `id` with the uploaded item's block. */
  async function place(view, id, item) {
    const p = await plan(item);
    if (view.isDestroyed) return;
    const { state } = view;
    const pos = findPlaceholder(state, id);
    if (pos == null) return; // another post was opened: the file stays in the library
    const spec = specOf(state, id);
    const node = state.doc.nodeAt(pos);
    const to = spec?.replace && node?.type.name === 'paragraph' && node.content.size === 0 ? pos + node.nodeSize : pos;
    const tr = closeHistory(state.tr)
      .replaceWith(pos, to, Fragment.fromArray(nodesFor(p, state.schema)))
      .setMeta(placeholderKey, { remove: { id } });
    view.dispatch(tr);
    onInserted(view, pos, p);
  }

  /** Placeholders at the place for `pos`, then the uploads. */
  function start(view, files, pos) {
    const { queue, ids, seen } = uploaderFor(view);
    const range = insertRangeFor(view.state.doc, pos);
    const list = Array.from(files);
    const keyOf = new Map(); // placeholder id → queue entry key
    const added = list.map((file, i) => {
      const id = `drop${++seq}`;
      return {
        id,
        pos: range.from,
        name: file.name,
        // Only the first file replaces an empty paragraph; the rest follow it
        replace: i === 0 && range.to > range.from,
        // Dismiss also drops the queue's record of the failed file
        onDismiss: () => { const key = keyOf.get(id); if (key) queue.dismiss(key); },
      };
    });
    for (const add of added) {
      view.dispatch(view.state.tr.setMeta(placeholderKey, { add }).setMeta('addToHistory', false));
    }
    const before = queue.entries().length;
    queue.add(list);
    queue.entries().slice(before).forEach((entry, i) => {
      ids.set(entry.key, added[i].id);
      keyOf.set(added[i].id, entry.key);
    });
    sync(view, queue, ids, seen);
  }

  const handler = new Plugin({
    props: {
      handleDrop(view, event) {
        if (!shouldUpload(event.dataTransfer)) return false;
        const found = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (!found) return false;
        start(view, event.dataTransfer.files, found.pos);
        return true;
      },
      handlePaste(view, event) {
        if (!shouldUpload(event.clipboardData)) return false;
        start(view, event.clipboardData.files, view.state.selection.from);
        return true;
      },
    },
  });

  return [placeholderPlugin(), handler];
}
