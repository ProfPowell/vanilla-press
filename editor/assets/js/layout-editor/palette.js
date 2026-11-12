/**
 * The layout editor's `/` palette: the blocks the schema allows at the
 * caret, less those that break a rule the content expressions can't hold
 * (`layoutViolations`): a second `${content}`, a second `<main>`, a third
 * `<nav>`, a second fragment wrapper, a slot that isn't alone in its
 * element, a nested `<a>`. `layoutRulesPlugin` refuses any other change
 * that adds one (a drag, a paste). Cook's check on save is the backstop.
 *
 * Where an entry goes (`insertionTarget`): in place of an empty text block
 * at the caret, after the caret's text block or the selected block, or
 * inside a selected empty container or region. An inline entry (the
 * inline component) goes at the caret, in text only. A component is
 * inserted unnamed and selected: the inspector picks its tag.
 *
 * @module editor/layout-editor/palette
 */

import { Plugin, Selection, NodeSelection } from 'prosemirror-state';
import { placePopover } from '../popover-place.js';

/** VB layout elements offered as containers. */
const LAYOUT_ELEMENTS = [
  'layout-stack', 'layout-grid', 'layout-cluster', 'layout-sidebar', 'layout-center', 'layout-cover',
  'layout-columns', 'layout-switcher', 'layout-reel', 'layout-imposter', 'layout-card', 'layout-text',
];

/** Fragment wrappers: at most one at the top of a fragment. */
const WRAPPERS = ['header', 'nav', 'footer'];

const tb = (tag) => (s) => s.nodes.text_block.create({ tag });
const box = (tag) => (s) => s.nodes.container.create({ tag });
const reg = (tag, attrs = []) => (s) => s.nodes.region.create({ tag, attrs });

/** A slot name not yet used in `doc`. */
function freshSlotName(doc) {
  const used = new Set();
  doc?.descendants((node) => { if (node.type.name === 'slot_ref') used.add(node.attrs.name); });
  for (let i = 1; ; i++) {
    const name = i === 1 ? 'region' : `region${i}`;
    if (!used.has(name)) return name;
  }
}

/**
 * Every palette entry. `create(schema, doc)` gives the node.
 * @type {Array<{ id: string, label: string, description: string, icon: string, category: string, create: Function }>}
 */
export const ENTRIES = [
  // Text
  { id: 'p', label: 'Paragraph', description: 'Text with fields', icon: '¶', category: 'text', create: tb('p') },
  ...[1, 2, 3, 4, 5, 6].map(n => ({
    id: `h${n}`, label: `Heading ${n}`, description: `<h${n}>`, icon: `H${n}`, category: 'text', create: tb(`h${n}`),
  })),
  { id: 'small', label: 'Small print', description: '<small>', icon: 's', category: 'text', create: tb('small') },
  { id: 'blockquote', label: 'Quote', description: '<blockquote>', icon: '“', category: 'text', create: tb('blockquote') },
  { id: 'figcaption', label: 'Caption', description: 'A figure\'s caption', icon: '—', category: 'text', create: (s) => s.nodes.figcaption.create() },

  // Containers
  ...['section', 'article', 'aside', 'nav', 'header', 'footer'].map(tag => ({
    id: tag, label: tag[0].toUpperCase() + tag.slice(1), description: `<${tag}>`, icon: '□', category: 'container', create: box(tag),
  })),
  ...LAYOUT_ELEMENTS.map(tag => ({
    id: tag, label: tag.slice('layout-'.length).replace(/^./, c => c.toUpperCase()), description: `<${tag}>`,
    icon: '▦', category: 'container', create: box(tag),
  })),

  // Lists and media
  { id: 'ul', label: 'Bullet list', description: '<ul>', icon: '•', category: 'list', create: (s) => s.nodes.menu.create({ tag: 'ul' }, s.nodes.menu_item.create()) },
  { id: 'ol', label: 'Numbered list', description: '<ol>', icon: '1.', category: 'list', create: (s) => s.nodes.menu.create({ tag: 'ol' }, s.nodes.menu_item.create()) },
  { id: 'menu', label: 'Menu', description: '<menu>', icon: '≡', category: 'list', create: (s) => s.nodes.menu.create({ tag: 'menu' }, s.nodes.menu_item.create()) },
  { id: 'menu_item', label: 'List item', description: '<li>', icon: '•', category: 'list', create: (s) => s.nodes.menu_item.create() },
  { id: 'image', label: 'Image', description: '<img>', icon: '▧', category: 'media', create: (s) => s.nodes.image.create({ attrs: [['src', ''], ['alt', '']] }) },
  {
    id: 'figure', label: 'Figure', description: 'An image with a caption', icon: '▣', category: 'media',
    create: (s) => s.nodes.figure.create(null, [s.nodes.image.create({ attrs: [['src', ''], ['alt', '']] }), s.nodes.figcaption.create()]),
  },

  // Layout pieces
  { id: 'content', label: 'Document body', description: 'Where the document goes', icon: '▓', category: 'layout', create: (s) => s.nodes.content.create() },
  { id: 'slot', label: 'Region', description: 'An area layouts built on this one fill', icon: '⬚', category: 'layout', create: (s, doc) => s.nodes.slot_ref.create({ name: freshSlotName(doc) }) },
  { id: 'include', label: 'Include', description: 'A shared fragment (<div data-include>)', icon: '⧉', category: 'layout', create: (s) => s.nodes.include.create({ path: '' }) },
  { id: 'comment', label: 'Comment', description: 'A note in the HTML', icon: '#', category: 'layout', create: (s) => s.nodes.comment.create({ text: ' ' }) },

  // Components: named (and given attributes) in the inspector
  { id: 'component', label: 'Component', description: 'A custom element, such as <site-search>', icon: '◇', category: 'component', create: (s) => s.nodes.component.create({ tag: '' }) },
  {
    id: 'inline-component', label: 'Inline component', description: 'A custom element inside the text', icon: '◆', category: 'component',
    inline: true, create: (s) => s.nodes.inline_component.create({ tag: '' }),
  },

  // Base regions
  { id: 'region-header', label: 'Header', description: '<header> region', icon: '▀', category: 'region', create: reg('header') },
  { id: 'region-nav', label: 'Navigation', description: '<nav> region', icon: '☰', category: 'region', create: reg('nav') },
  { id: 'region-main', label: 'Main', description: '<main> region', icon: '█', category: 'region', create: reg('main') },
  { id: 'region-aside', label: 'Sidebar', description: '<aside> region', icon: '▌', category: 'region', create: reg('aside') },
  { id: 'region-footer', label: 'Footer', description: '<footer> region', icon: '▄', category: 'region', create: reg('footer') },
];

/**
 * A child's entries for the parent's regions it doesn't fill yet: each puts
 * a `<template slot="name">` (a slot_piece) after the child's blocks,
 * labelled as the parent labels the region (e.g. `Sidebar`).
 * @param {Array<{ name: string, label?: string }>} slots - the parent's regions (head excluded)
 * @param {import('prosemirror-model').Node} doc
 * @param {string} [parent] - the parent layout's name, for the description
 */
export function fillEntries(slots, doc, parent = 'parent') {
  const filled = new Set();
  doc?.descendants((node) => { if (node.type.name === 'slot_piece') filled.add(node.attrs.name); });
  return (Array.isArray(slots) ? slots : [])
    .filter(s => s && typeof s.name === 'string' && s.name && s.name !== 'head' && !filled.has(s.name))
    .map(s => ({
      id: `fill-${s.name}`, label: s.label || s.name, description: `Fill ${parent}'s ${s.name} region`, icon: '▌', category: 'region',
      create: (schema) => schema.nodes.slot_piece.create({ name: s.name }),
    }));
}

export const CATEGORY_LABELS = {
  text: 'Text', container: 'Containers', list: 'Lists', media: 'Images', layout: 'Layout', component: 'Components', region: 'Regions',
};

// RULES
// -----------------------------
/** A slot stands alone in its element: comments beside it are allowed (Cook's check). */
const slotAlone = (parent) => {
  let others = 0;
  parent.forEach((child) => { if (child.type.name !== 'comment') others++; });
  return others === 1;
};

/**
 * The rules a layout-schema doc breaks that its content expressions can't
 * prevent, one string per breach (so a count compares).
 * @param {import('prosemirror-model').Node} doc
 * @returns {string[]}
 */
export function layoutViolations(doc) {
  const out = [];
  const body = doc.firstChild;
  if (!body) return out;
  const kind = body.type.name.replace(/_body$/, '');
  let contents = 0;
  doc.descendants((node, pos, parent) => {
    const name = node.type.name;
    if (name === 'content') {
      contents++;
      if (contents > 1) out.push('${content} appears more than once');
      const $pos = doc.resolve(pos);
      const above = [];
      for (let d = $pos.depth; d > 0; d--) above.push($pos.node(d));
      if (kind === 'fragment') out.push('a fragment has no ${content}');
      if (kind === 'base' && !above.some(n => n.type.name === 'region' && n.attrs.tag === 'main')) out.push('${content} must be inside <main>');
      if (kind === 'child' && above.some(n => n.type.name === 'slot_piece')) out.push("${content} can't be inside a slot template");
    }
    if (name === 'slot_ref' && !slotAlone(parent)) out.push(`\${slot:${node.attrs.name}} must be alone inside its element`);
    if (node.isInline && node.marks.filter(m => m.type.name === 'a').length > 1) out.push('a link inside a link');
    return true;
  });
  if (kind === 'base') {
    let mains = 0;
    let navs = 0;
    body.forEach((node) => {
      if (node.type.name !== 'region') return;
      if (node.attrs.tag === 'main') mains++;
      if (node.attrs.tag === 'nav') navs++;
    });
    if (mains > 1) out.push('a base layout has exactly one <main>');
    if (navs > 2) out.push('a base layout has at most two <nav>');
  }
  if (kind === 'fragment') {
    let wrappers = 0;
    body.forEach((node) => { if (node.type.name === 'container' && WRAPPERS.includes(node.attrs.tag)) wrappers++; });
    if (wrappers > 1) out.push('a fragment has at most one header, nav or footer wrapper');
  }
  return out;
}

/**
 * Whether `after` breaks a rule `before` didn't: some breach shows up more
 * often (so removing one breach never pays for adding another).
 * @param {string[]} before
 * @param {string[]} after
 */
export function addsViolation(before, after) {
  const count = new Map();
  for (const v of before) count.set(v, (count.get(v) || 0) + 1);
  for (const v of after) {
    const left = count.get(v) || 0;
    if (left === 0) return true;
    count.set(v, left - 1);
  }
  return false;
}

/** Refuses a change that adds a rule breach (a drag, a paste, a palette entry). */
export function layoutRulesPlugin() {
  return new Plugin({
    filterTransaction(tr, state) {
      if (!tr.docChanged) return true;
      return !addsViolation(layoutViolations(state.doc), layoutViolations(tr.doc));
    },
  });
}

// WHERE AN ENTRY GOES
// -----------------------------
/**
 * The range an entry replaces (empty for an insert).
 * @param {import('prosemirror-state').EditorState} state
 * @returns {{ from: number, to: number }}
 */
export function insertionTarget(state) {
  const sel = state.selection;
  const { $from } = sel;
  if (sel instanceof NodeSelection && !sel.node.isInline) {
    const node = sel.node;
    // A selected empty container or region: inside it
    if (!node.isLeaf && node.content.size === 0 && !node.inlineContent) return { from: sel.from + 1, to: sel.from + 1 };
    return { from: sel.to, to: sel.to };
  }
  if ($from.parent.inlineContent) {
    const d = $from.depth;
    if ($from.parent.type.name === 'text_block' && $from.parent.content.size === 0) {
      return { from: $from.before(d), to: $from.after(d) };
    }
    return { from: $from.after(d), to: $from.after(d) };
  }
  return { from: $from.pos, to: $from.pos };
}

/** The transaction that puts `node` at `target`, or null when it doesn't fit there. */
function placeNode(state, target, node) {
  const $at = state.doc.resolve(target.from);
  const parent = $at.parent;
  const index = $at.index();
  const end = target.to > target.from ? index + 1 : index;
  if (!parent.canReplaceWith(index, end, node.type)) return null;
  let tr;
  try {
    tr = state.tr.replaceWith(target.from, target.to, node);
  } catch {
    return null;
  }
  if (!tr.doc.resolve(target.from).nodeAfter?.eq(node)) return null;
  return tr;
}

/** The transaction that puts an inline `node` in place of the text selection, or null. */
function placeInline(state, node) {
  const { $from, $to } = state.selection;
  if (state.selection instanceof NodeSelection && !state.selection.node.isInline) return null;
  if (!$from.parent.inlineContent || !$from.sameParent($to)) return null;
  if (!$from.parent.type.contentMatch.matchType(node.type)) return null;
  let tr;
  try {
    tr = state.tr.replaceWith($from.pos, $to.pos, node);
  } catch {
    return null;
  }
  if (!tr.doc.nodeAt($from.pos)?.eq(node)) return null;
  return tr;
}

/** Where an entry goes and the transaction that puts it there (or null). */
function place(state, entry, node) {
  if (entry.inline) return { from: state.selection.from, tr: placeInline(state, node) };
  const target = insertionTarget(state);
  return { from: target.from, tr: placeNode(state, target, node) };
}

/**
 * The entries that fit at the caret.
 * @param {import('prosemirror-state').EditorState} state
 * @param {Array<Object>} [extra] - entries for this layout only (a child's `fillEntries`)
 */
export function paletteItems(state, extra = []) {
  const before = layoutViolations(state.doc);
  return [...ENTRIES, ...extra].filter((entry) => {
    const { tr } = place(state, entry, entry.create(state.schema, state.doc));
    return tr !== null && !addsViolation(before, layoutViolations(tr.doc));
  });
}

/**
 * The transaction that inserts `entry` at the caret, with the caret in the
 * new block (or the block selected when it holds no text); null when it
 * doesn't fit.
 */
export function insertEntry(state, entry) {
  const node = entry.create(state.schema, state.doc);
  const { from, tr } = place(state, entry, node);
  if (!tr) return null;
  const end = from + node.nodeSize;
  const inside = node.isAtom ? null : Selection.findFrom(tr.doc.resolve(from), 1, true);
  if (inside && inside.from < end) tr.setSelection(inside);
  else tr.setSelection(NodeSelection.create(tr.doc, from));
  return tr.scrollIntoView();
}

// THE MENU
// -----------------------------
/**
 * The `/` menu: a listbox of the entries that fit, filtered by typing,
 * arrow keys to move, Enter to insert, Escape to close. Same look as the
 * post editor's block palette (`.block-palette`, _palette.css).
 */
export class LayoutPalette {
  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'block-palette le-palette';
    this.el.setAttribute('role', 'listbox');
    this.el.setAttribute('aria-label', 'Blocks');
    this.el.id = `le-palette-${Math.random().toString(36).slice(2, 8)}`;
    document.body.appendChild(this.el);
    this.view = null;
    this.visible = false;
    this.filter = '';
    this.selected = 0;
    this.items = [];
    /** Entries for this layout only, at open (the page sets it: a child's fillEntries). */
    this.extraEntries = () => [];
    this.onOutside = (e) => { if (this.visible && !this.el.contains(e.target)) this.close(); };
    document.addEventListener('mousedown', this.onOutside);
  }

  open(view) {
    this.view = view;
    this.entries = paletteItems(view.state, this.extraEntries(view.state));
    this.filter = '';
    this.selected = 0;
    this.visible = true;
    this.render();
    this.el.classList.add('open');
    this.position();
  }

  close() {
    this.visible = false;
    this.filter = '';
    this.el.classList.remove('open');
  }

  destroy() {
    document.removeEventListener('mousedown', this.onOutside);
    this.el.remove();
  }

  position() {
    if (!this.view || typeof this.view.coordsAtPos !== 'function' || typeof window === 'undefined' || !window.innerHeight) return;
    let coords;
    try { coords = this.view.coordsAtPos(this.view.state.selection.from); } catch { return; }
    const p = placePopover(coords, { width: this.el.offsetWidth, height: this.el.offsetHeight },
      { width: document.documentElement.clientWidth, height: window.innerHeight });
    this.el.style.left = `${p.left}px`;
    this.el.style.top = `${p.top}px`;
    this.el.style.maxHeight = p.maxHeight != null ? `${p.maxHeight}px` : '';
  }

  /** Keys while open; true when the palette used the key. */
  handleKey(event) {
    if (!this.visible) return false;
    switch (event.key) {
      case 'ArrowDown': this.move(1); return true;
      case 'ArrowUp': this.move(-1); return true;
      case 'Enter': this.choose(this.items[this.selected]?.entry); return true;
      case 'Escape': this.close(); return true;
      case 'Backspace':
        if (!this.filter) { this.close(); return true; }
        this.filter = this.filter.slice(0, -1);
        this.selected = 0;
        this.render();
        return true;
      default:
        if (event.key.length === 1 && !event.metaKey && !event.ctrlKey) {
          this.filter += event.key;
          this.selected = 0;
          this.render();
          return true;
        }
        return false;
    }
  }

  move(by) {
    if (!this.items.length) return;
    this.selected = (this.selected + by + this.items.length) % this.items.length;
    this.highlight();
    this.items[this.selected].el.scrollIntoView?.({ block: 'nearest' });
  }

  choose(entry) {
    if (!entry || !this.view) return;
    const tr = insertEntry(this.view.state, entry);
    this.close();
    if (tr) this.view.dispatch(tr);
    this.view.focus();
  }

  highlight() {
    this.items.forEach((item, i) => {
      item.el.classList.toggle('selected', i === this.selected);
      item.el.setAttribute('aria-selected', String(i === this.selected));
    });
  }

  render() {
    const q = this.filter.toLowerCase();
    const shown = this.entries.filter(e => [e.label, e.description, e.id, e.category].some(s => s.toLowerCase().includes(q)));
    this.el.replaceChildren();
    this.items = [];
    let category = null;
    for (const entry of shown) {
      if (entry.category !== category) {
        category = entry.category;
        const cat = document.createElement('div');
        cat.className = 'palette-category';
        cat.textContent = CATEGORY_LABELS[category] || category;
        this.el.append(cat);
      }
      const idx = this.items.length;
      const item = document.createElement('div');
      item.className = 'palette-item';
      item.setAttribute('role', 'option');
      item.id = `${this.el.id}-${idx}`;
      const icon = document.createElement('span');
      icon.className = 'palette-icon';
      icon.textContent = entry.icon;
      const text = document.createElement('span');
      text.className = 'palette-text';
      const label = document.createElement('span');
      label.className = 'palette-label';
      label.textContent = entry.label;
      const desc = document.createElement('span');
      desc.className = 'palette-description';
      desc.textContent = entry.description;
      text.append(label, desc);
      item.append(icon, text);
      item.addEventListener('mousedown', (e) => { e.preventDefault(); this.choose(entry); });
      item.addEventListener('mousemove', () => { if (this.selected !== idx) { this.selected = idx; this.highlight(); } });
      this.el.append(item);
      this.items.push({ entry, el: item });
    }
    if (!this.items.length) {
      const empty = document.createElement('div');
      empty.className = 'palette-empty';
      empty.textContent = this.entries.length ? `No blocks matching "${this.filter}"` : 'No blocks fit here';
      this.el.append(empty);
    }
    this.highlight();
  }
}

/**
 * The `/` key opens the palette in an empty text block, or with a block
 * selected; while it is open it takes the keys.
 * @param {LayoutPalette} palette
 */
export function palettePlugin(palette) {
  return new Plugin({
    props: {
      handleKeyDown(view, event) {
        if (palette.visible) {
          if (palette.handleKey(event)) { event.preventDefault(); return true; }
          return false;
        }
        if (event.key !== '/' || event.metaKey || event.ctrlKey) return false;
        const sel = view.state.selection;
        const emptyText = sel.$from.parent.type.name === 'text_block' && sel.$from.parent.content.size === 0;
        if (!(sel instanceof NodeSelection) && !emptyText) return false;
        event.preventDefault();
        palette.open(view);
        return true;
      },
    },
  });
}
