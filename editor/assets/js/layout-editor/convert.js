/**
 * Layout tree (cook-ssg/layouts parseLayout) ↔ ProseMirror doc.
 *
 * `treeToDoc` puts the body (and a child's slot pieces) into the layout
 * schema; everything else rides in `meta`. `docToTree` rebuilds the tree
 * exactly, with `info.slots` recomputed from the `slot_ref` nodes (and a
 * base's `${slot:head}` head item). Slot entries live in `meta.info.slots`
 * keyed by name, never on the nodes: entries still referenced are kept
 * whole in their order, new names follow in document order as
 * `{ label: name }`, names no longer referenced are dropped. The inspector
 * edits labels with `setSlotLabel`.
 *
 * Nothing is lost: a tree shape this module doesn't know throws rather
 * than being dropped (Review Focus 5).
 *
 * @module editor/layout-editor/convert
 */

import { MARK_TAGS } from './schema.js';

const clone = (value) => (value === undefined ? undefined : structuredClone(value));

/** The common block attrs of a tree block (or li, or slot piece). */
const commonAttrs = (block) => ({
  attrs: clone(block.attrs ?? []),
  if: block.if ?? null,
  unless: block.unless ?? null,
  repeat: clone(block.repeat ?? null),
});

/** The tree's common fields back from node attrs: absent ones stay absent. */
function commonFields(attrs) {
  const out = { attrs: clone(attrs.attrs ?? []) };
  if (attrs.if !== null && attrs.if !== undefined) out.if = attrs.if;
  if (attrs.unless !== null && attrs.unless !== undefined) out.unless = attrs.unless;
  if (attrs.repeat) out.repeat = clone(attrs.repeat);
  return out;
}

const fail = (what, value) => {
  throw new Error(`layout convert: can't place ${what} ${JSON.stringify(value).slice(0, 80)}`);
};

// TREE → DOC
// -----------------------------
/**
 * Convert a layout tree into a layout-schema doc.
 * @param {Object} tree - from parseLayout
 * @param {import('prosemirror-model').Schema} schema - layoutSchema
 * @returns {{ doc: import('prosemirror-model').Node, meta: Object }}
 */
export function treeToDoc(tree, schema) {
  const n = schema.nodes;
  let keys = 0;

  const inline = (runs = [], marks = [], parentKey = null) => runs.flatMap((run) => {
    if ('field' in run) return [n.field.create({ name: run.field }, null, marks)];
    if ('text' in run) return run.text ? [schema.text(run.text, marks)] : [];
    if ('component' in run) {
      return [n.inline_component.create({ tag: run.component, attrs: clone(run.attrs ?? []), html: run.html ?? '' }, null, marks)];
    }
    if (run.tag === 'br') return [n.hard_break.create({ attrs: clone(run.attrs ?? []) }, null, marks)];
    if (run.tag === 'img') return [n.inline_image.create({ attrs: clone(run.attrs ?? []) }, null, marks)];
    if (!MARK_TAGS.includes(run.tag)) fail('inline', run);
    if (!run.inline || run.inline.length === 0) {
      return [n.empty_inline.create({ tag: run.tag, attrs: clone(run.attrs ?? []) }, null, marks)];
    }
    const key = parentKey === null ? `${++keys}` : `${parentKey}/${++keys}`;
    const mark = schema.marks[run.tag].create({ attrs: clone(run.attrs ?? []), key });
    return inline(run.inline, [...marks, mark], key);
  });

  const slotRef = (block) => n.slot_ref.create({ name: block.name, attrs: clone(block.attrs ?? []) });

  const block = (b, { inFigure = false } = {}) => {
    switch (b.type) {
      case 'content': return n.content.create({ attrs: clone(b.attrs ?? []) });
      case 'slot': return slotRef(b);
      case 'comment': return n.comment.create({ text: b.text, attrs: clone(b.attrs ?? []) });
      case 'text':
        if (inFigure && b.tag === 'figcaption') return n.figcaption.createChecked(commonAttrs(b), inline(b.inline));
        return n.text_block.createChecked({ tag: b.tag, ...commonAttrs(b) }, inline(b.inline));
      case 'image': return n.image.create({ tag: b.tag, html: b.html ?? null, ...commonAttrs(b) });
      case 'include': return n.include.create({ path: b.path, ...commonAttrs(b) });
      case 'component': return n.component.create({ tag: b.tag, html: b.html ?? '', ...commonAttrs(b) });
      case 'menu': return n.menu.createChecked({ tag: b.tag, ...commonAttrs(b) }, (b.items ?? []).map(item));
      case 'container':
        if (b.tag === 'figure') {
          return n.figure.createChecked(commonAttrs(b), (b.body ?? []).map(c => block(c, { inFigure: true })));
        }
        return n.container.createChecked({ tag: b.tag, ...commonAttrs(b) }, blocks(b.body));
      default: return fail('block', b);
    }
  };
  const blocks = (list = []) => list.map(b => block(b));

  const item = (li) => (li.body
    ? n.menu_item_blocks.createChecked(commonAttrs(li), blocks(li.body))
    : n.menu_item.createChecked(commonAttrs(li), inline(li.inline)));

  const piece = (slot) => (slot.name === 'head'
    ? n.head_piece.create({ items: clone(slot.body ?? []), ...commonAttrs(slot) })
    : n.slot_piece.createChecked({ name: slot.name, ...commonAttrs(slot) }, blocks(slot.body)));

  let body;
  if (tree.kind === 'base') {
    body = n.base_body.createChecked(null, (tree.body ?? []).map(b => (
      b.type === 'container' ? n.region.createChecked({ tag: b.tag, ...commonAttrs(b) }, blocks(b.body)) : block(b))));
  } else if (tree.kind === 'child') {
    body = n.child_body.createChecked(null, [...blocks(tree.body), ...(tree.slots ?? []).map(piece)]);
  } else if (tree.kind === 'fragment') {
    body = n.fragment_body.createChecked(null, blocks(tree.body));
  } else {
    fail('layout kind', tree.kind);
  }

  const meta = {
    kind: tree.kind,
    info: clone(tree.info ?? null),
    parent: tree.parent ?? null,
    vars: clone(tree.vars ?? []),
    pageLayout: tree.pageLayout ?? null,
    htmlAttrs: clone(tree.htmlAttrs ?? []),
    head: clone(tree.head ?? []),
  };
  return { doc: n.doc.createChecked(null, [body]), meta };
}

// DOC → TREE
// -----------------------------
/** Depth of a mark in its nesting path; marks added by the editor (no key) come last. */
const markDepth = (mark) => (mark.attrs.key == null ? Number.MAX_SAFE_INTEGER : mark.attrs.key.split('/').length);

/** A node's marks in tie-break order: keyed by nesting depth, then keyless in rank order. */
const markOrder = (node) => [...node.marks].sort((a, b) => markDepth(a) - markDepth(b));

function leafRun(node) {
  switch (node.type.name) {
    case 'text': return { text: node.text };
    case 'field': return { field: node.attrs.name };
    case 'hard_break': return { tag: 'br', attrs: clone(node.attrs.attrs) };
    case 'inline_image': return { tag: 'img', attrs: clone(node.attrs.attrs) };
    case 'empty_inline': return { tag: node.attrs.tag, attrs: clone(node.attrs.attrs), inline: [] };
    case 'inline_component': return { component: node.attrs.tag, attrs: clone(node.attrs.attrs), html: node.attrs.html };
    default: return fail('inline node', node.type.name);
  }
}

/**
 * Inline runs from `{ node, marks }` items (`marks`: the ones not yet
 * opened by an outer element). At each item the outer element is the mark
 * whose run covers the most consecutive items; ties go to the earlier mark
 * in `markOrder` (keyed outer-first, then keyless), so source nesting is
 * kept and a mark added across several elements wraps them once.
 */
function runsAt(items) {
  const out = [];
  for (let i = 0; i < items.length;) {
    const { node, marks } = items[i];
    if (marks.length === 0) {
      const run = leafRun(node);
      const last = out.at(-1);
      if ('text' in run && last && 'text' in last) last.text += run.text;
      else out.push(run);
      i++;
      continue;
    }
    let best = null;
    let end = i;
    for (const mark of marks) {
      let j = i + 1;
      while (j < items.length && items[j].marks.some(m => m.eq(mark))) j++;
      if (j > end) { best = mark; end = j; }
    }
    const inner = items.slice(i, end).map(it => ({ node: it.node, marks: it.marks.filter(m => !m.eq(best)) }));
    out.push({ tag: best.type.name, attrs: clone(best.attrs.attrs), inline: runsAt(inner) });
    i = end;
  }
  return out;
}

/** The inline runs of a text-level node. */
function inlineRuns(node) {
  const items = [];
  node.forEach(child => items.push({ node: child, marks: markOrder(child) }));
  return runsAt(items);
}

function blockOf(node) {
  const a = node.attrs;
  switch (node.type.name) {
    case 'content': return { type: 'content', attrs: clone(a.attrs) };
    case 'slot_ref': return { type: 'slot', name: a.name, attrs: clone(a.attrs) };
    case 'comment': return { type: 'comment', attrs: clone(a.attrs), text: a.text };
    case 'text_block': return { type: 'text', tag: a.tag, ...commonFields(a), inline: inlineRuns(node) };
    case 'figcaption': return { type: 'text', tag: 'figcaption', ...commonFields(a), inline: inlineRuns(node) };
    case 'image': {
      const out = { type: 'image', tag: a.tag, ...commonFields(a) };
      if (a.html !== null) out.html = a.html;
      return out;
    }
    case 'include': return { type: 'include', path: a.path, ...commonFields(a) };
    case 'component': return { type: 'component', tag: a.tag, ...commonFields(a), html: a.html };
    case 'menu': {
      const items = [];
      node.forEach(child => items.push(itemOf(child)));
      return { type: 'menu', tag: a.tag, ...commonFields(a), items };
    }
    case 'container':
    case 'region':
      return { type: 'container', tag: a.tag, ...commonFields(a), body: blocksOf(node) };
    case 'figure': return { type: 'container', tag: 'figure', ...commonFields(a), body: blocksOf(node) };
    default: return fail('node', node.type.name);
  }
}

function blocksOf(node) {
  const out = [];
  node.forEach(child => out.push(blockOf(child)));
  return out;
}

function itemOf(node) {
  if (node.type.name === 'menu_item_blocks') return { ...commonFields(node.attrs), body: blocksOf(node) };
  if (node.type.name === 'menu_item') return { ...commonFields(node.attrs), inline: inlineRuns(node) };
  return fail('menu item', node.type.name);
}

function pieceOf(node) {
  const a = node.attrs;
  const { attrs, if: cond, unless } = commonFields(a);
  const out = { name: node.type.name === 'head_piece' ? 'head' : a.name, attrs };
  if (cond !== undefined) out.if = cond;
  if (unless !== undefined) out.unless = unless;
  out.body = node.type.name === 'head_piece' ? clone(a.items) : blocksOf(node);
  return out;
}

/**
 * The info block's slots: the entries in `meta.info.slots` for the names
 * still referenced (a slot_ref, or a base's `${slot:head}` head item), in
 * their order, then `{ label: name }` for new names in document order.
 */
function slotsOf(doc, meta) {
  const used = [];
  if (meta.kind === 'base' && (meta.head ?? []).some(item => item.slot === 'head')) used.push('head');
  doc.descendants((node) => {
    if (node.type.name === 'slot_ref' && !used.includes(node.attrs.name)) used.push(node.attrs.name);
  });
  const declared = meta.info?.slots ?? {};
  const slots = {};
  for (const name of Object.keys(declared)) {
    if (used.includes(name)) slots[name] = clone(declared[name]);
  }
  for (const name of used) if (!(name in slots)) slots[name] = { label: name };
  return slots;
}

/**
 * Set a slot's label in `meta.info.slots`, keeping the entry's other keys
 * (an entry is created for a new name). For the inspector.
 * @param {Object} meta - from treeToDoc
 * @param {string} name
 * @param {string} label
 * @returns {Object} meta
 */
export function setSlotLabel(meta, name, label) {
  if (!meta.info) return meta;
  if (!meta.info.slots || typeof meta.info.slots !== 'object') meta.info.slots = {};
  const entry = meta.info.slots[name];
  meta.info.slots[name] = entry && typeof entry === 'object' && !Array.isArray(entry)
    ? { ...entry, label }
    : { label };
  return meta;
}

/**
 * Convert a layout-schema doc (and its meta) back into a layout tree.
 * @param {import('prosemirror-model').Node} doc
 * @param {Object} meta - from treeToDoc
 * @returns {Object} the layout tree
 */
export function docToTree(doc, meta) {
  const body = doc.firstChild;
  const tree = {
    kind: meta.kind,
    info: clone(meta.info ?? null),
    parent: meta.parent ?? null,
    vars: clone(meta.vars ?? []),
    pageLayout: meta.pageLayout ?? null,
    htmlAttrs: clone(meta.htmlAttrs ?? []),
    head: clone(meta.head ?? []),
    body: [],
    slots: [],
  };
  body.forEach((node) => {
    if (node.type.name === 'slot_piece' || node.type.name === 'head_piece') tree.slots.push(pieceOf(node));
    else tree.body.push(blockOf(node));
  });
  if (tree.info) tree.info.slots = slotsOf(doc, meta);
  return tree;
}
