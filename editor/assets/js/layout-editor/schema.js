/**
 * ProseMirror schema for the layout editor: one node type per block of
 * Cook's layout tree (cook-ssg/layouts parseLayout), with content
 * expressions that follow the format-1 nesting rules.
 *
 * - The doc holds exactly one body, by layout kind: `base_body` (regions,
 *   includes, comments), `child_body` (blocks, then `<template slot>`
 *   pieces) or `fragment_body` (blocks).
 * - Every block carries the tree's common fields as node attrs: `attrs`
 *   (attribute pairs, block attributes excepted), `if`, `unless` (null
 *   when absent) and `repeat` (`{ source, pipes, alias, index? }` or null).
 * - Text-level content: text with marks for the inline elements (a, strong,
 *   em, span, time, abbr, code), a `field` atom for `${name}`, and atoms for
 *   br, inline img, an empty inline element and an inline component.
 *   Inline marks don't exclude themselves (`<span><span>` nests) and carry
 *   a `key`: a path of instance ids (`"3"`, `"3/4"`) that tells two equal
 *   neighbouring elements apart and records nesting order, which mark rank
 *   alone would lose.
 *
 * The tree text block is `text_block` here: ProseMirror reserves `text`.
 *
 * @module editor/layout-editor/schema
 */

import { Schema } from 'prosemirror-model';

/** Inline element tags kept as marks (br and img are atoms). */
export const MARK_TAGS = ['a', 'strong', 'em', 'span', 'time', 'abbr', 'code'];

/** Base body region tags. */
export const REGION_TAGS = ['header', 'nav', 'main', 'aside', 'footer'];

/** The tree's common block fields. */
const common = {
  attrs: { default: [] },
  if: { default: null },
  unless: { default: null },
  repeat: { default: null },
};

/** Editor-only DOM attributes for a block: never the layout's own attributes. */
const blockDom = (kind, node, extra = {}) => {
  const out = { class: `le-block le-${kind}`, ...extra };
  if (node.attrs.if !== null) out['data-le-if'] = node.attrs.if;
  if (node.attrs.unless !== null) out['data-le-unless'] = node.attrs.unless;
  if (node.attrs.repeat) out['data-le-repeat'] = node.attrs.repeat.alias;
  return out;
};

const atom = { atom: true, selectable: true, draggable: true };

const nodes = {
  doc: { content: 'base_body | child_body | fragment_body' },

  base_body: {
    content: '(region | include | comment)+',
    toDOM: () => ['div', { class: 'le-body le-base-body' }, 0],
  },
  child_body: {
    content: 'block* (slot_piece | head_piece)*',
    toDOM: () => ['div', { class: 'le-body le-child-body' }, 0],
  },
  fragment_body: {
    content: 'block*',
    toDOM: () => ['div', { class: 'le-body le-fragment-body' }, 0],
  },

  // BLOCKS
  // -----------------------------
  /** A base body region: header, nav, main, aside or footer. */
  region: {
    content: 'block*',
    attrs: { tag: { default: 'main' }, ...common },
    isolating: true,
    defining: true,
    toDOM: (node) => ['section', blockDom('region', node, { 'data-tag': node.attrs.tag }), 0],
  },

  /** Sectioning, header/footer, `div[data-layout]` and `layout-*` elements. */
  container: {
    group: 'block',
    content: 'block*',
    attrs: { tag: { default: 'section' }, ...common },
    defining: true,
    draggable: true,
    toDOM: (node) => ['div', blockDom('container', node, { 'data-tag': node.attrs.tag }), 0],
  },

  /** `<figure>`: images and a caption. */
  figure: {
    group: 'block',
    content: '(image | figcaption | comment)*',
    attrs: { ...common },
    defining: true,
    draggable: true,
    toDOM: (node) => ['figure', blockDom('figure', node), 0],
  },

  /** `<figcaption>` directly inside a figure (elsewhere it is a text_block). */
  figcaption: {
    content: 'inline*',
    attrs: { ...common },
    toDOM: (node) => ['figcaption', blockDom('figcaption', node), 0],
  },

  /** h1–h6, p, small, figcaption, blockquote: text with fields and inline elements. */
  text_block: {
    group: 'block',
    content: 'inline*',
    attrs: { tag: { default: 'p' }, ...common },
    draggable: true,
    toDOM: (node) => ['div', blockDom('text', node, { 'data-tag': node.attrs.tag }), 0],
  },

  /** `<img>`, or `<picture>` with its inner HTML kept verbatim. */
  image: {
    group: 'block',
    ...atom,
    attrs: { tag: { default: 'img' }, html: { default: null }, ...common },
    toDOM: (node) => ['div', blockDom('image', node, { 'data-tag': node.attrs.tag })],
  },

  /** ul, ol, menu: list items only. */
  menu: {
    group: 'block',
    content: '(menu_item | menu_item_blocks)*',
    attrs: { tag: { default: 'ul' }, ...common },
    draggable: true,
    toDOM: (node) => ['div', blockDom('menu', node, { 'data-tag': node.attrs.tag }), 0],
  },

  /** An `li` holding text-level content. */
  menu_item: {
    content: 'inline*',
    attrs: { ...common },
    toDOM: (node) => ['div', blockDom('menu-item', node), 0],
  },

  /** An `li` holding blocks. */
  menu_item_blocks: {
    content: 'block+',
    attrs: { ...common },
    toDOM: (node) => ['div', blockDom('menu-item menu-item-blocks', node), 0],
  },

  /** `<div data-include="path">`. */
  include: {
    group: 'block',
    ...atom,
    attrs: { path: { default: '' }, ...common },
    toDOM: (node) => ['div', blockDom('include', node, { 'data-path': node.attrs.path })],
  },

  /** A custom element (not a layout element): its inner HTML kept verbatim. */
  component: {
    group: 'block',
    ...atom,
    attrs: { tag: { default: '' }, html: { default: '' }, ...common },
    toDOM: (node) => ['div', blockDom('component', node, { 'data-tag': node.attrs.tag })],
  },

  /** An HTML comment between blocks, its text kept verbatim. */
  comment: {
    group: 'block',
    ...atom,
    attrs: { text: { default: '' }, attrs: { default: [] } },
    toDOM: () => ['div', { class: 'le-block le-comment' }],
  },

  /** `${content}`: where the document body goes. */
  content: {
    group: 'block',
    ...atom,
    attrs: { attrs: { default: [] } },
    toDOM: () => ['div', { class: 'le-block le-content' }],
  },

  /**
   * `${slot:name}`. The slot's info entry (its label…) lives in
   * `meta.info.slots`, keyed by name (convert.js `setSlotLabel`).
   */
  slot_ref: {
    group: 'block',
    ...atom,
    attrs: {
      name: { default: '' },
      attrs: { default: [] },
    },
    toDOM: (node) => ['div', { class: 'le-block le-slot-ref', 'data-slot': node.attrs.name }],
  },

  /** A child's `<template slot="name">` filling one of the parent's regions. */
  slot_piece: {
    content: 'block*',
    attrs: { name: { default: '' }, ...common },
    isolating: true,
    defining: true,
    toDOM: (node) => ['section', blockDom('slot-piece', node, { 'data-slot': node.attrs.name }), 0],
  },

  /** A child's `<template slot="head">`: head items (`items`), edited outside the canvas. */
  head_piece: {
    ...atom,
    attrs: { items: { default: [] }, ...common },
    toDOM: (node) => ['div', blockDom('head-piece', node)],
  },

  // INLINE
  // -----------------------------
  text: { group: 'inline' },

  /** `${name}`. */
  field: {
    group: 'inline',
    inline: true,
    ...atom,
    attrs: { name: { default: '' } },
    toDOM: (node) => ['span', { class: 'le-field', 'data-field': node.attrs.name }, node.attrs.name],
  },

  /** `<br>`. */
  hard_break: {
    group: 'inline',
    inline: true,
    selectable: false,
    attrs: { attrs: { default: [] } },
    toDOM: () => ['br'],
  },

  /** An `<img>` inside text. */
  inline_image: {
    group: 'inline',
    inline: true,
    ...atom,
    attrs: { attrs: { default: [] } },
    toDOM: () => ['span', { class: 'le-inline-image' }],
  },

  /** An inline element with nothing inside (`<span class="icon"></span>`). */
  empty_inline: {
    group: 'inline',
    inline: true,
    ...atom,
    attrs: { tag: { default: 'span' }, attrs: { default: [] } },
    toDOM: (node) => ['span', { class: 'le-empty-inline', 'data-tag': node.attrs.tag }],
  },

  /** A component inside text, its inner HTML kept verbatim. */
  inline_component: {
    group: 'inline',
    inline: true,
    ...atom,
    attrs: { tag: { default: '' }, attrs: { default: [] }, html: { default: '' } },
    toDOM: (node) => ['span', { class: 'le-inline-component', 'data-tag': node.attrs.tag }],
  },
};

/** One mark per inline element tag; `attrs` holds its attribute pairs (data-if included). */
const marks = Object.fromEntries(MARK_TAGS.map(tag => [tag, {
  attrs: { attrs: { default: [] }, key: { default: null } },
  excludes: '',
  inclusive: tag !== 'a',
  toDOM: () => [tag, { class: `le-mark le-mark-${tag}` }, 0],
}]));

/** The layout editor's schema. */
export const layoutSchema = new Schema({ nodes, marks });
