/**
 * Vanilla Press Content Schema
 *
 * The single source of truth for block types. This module is consumed by:
 * - Schema validator (validation on write)
 * - HTML renderer (block → custom element mapping)
 * - Markdown renderer (block → markdown equivalent)
 * - Editor (ProseMirror schema derivation, block palette)
 *
 * @module content-schema
 */

/**
 * @typedef {Object} BlockDef
 * @property {string} category - Grouping: prose, media, code, component
 * @property {string|string[]|undefined} children - Content model: 'inline', 'block', specific types, or undefined for leaf
 * @property {boolean} [optionalChildren] - True if the children key may be absent (figure without a caption)
 * @property {boolean} [leaf] - True if block has no children (uses value instead)
 * @property {Object} [attrs] - Attribute definitions
 */

/** @type {Record<string, BlockDef>} */
export const blockTypes = {

  // --- Prose ---
  paragraph:    { category: 'prose',     children: 'inline' },
  heading:      { category: 'prose',     children: 'inline',    attrs: { level: { type: 'number', required: true, min: 2, max: 6 } } },
  blockquote:   { category: 'prose',     children: 'block' },
  list:         { category: 'prose',     children: 'list_item', attrs: { ordered: { type: 'boolean', default: false } } },
  list_item:    { category: 'prose',     children: 'block' },
  hr:           { category: 'prose',     leaf: true,             attrs: { variant: { type: 'string', enum: ['default', 'decorative'] } } },
  table:        { category: 'prose',     children: 'table_row',  attrs: {
                    striped:  { type: 'boolean', default: false },
                    bordered: { type: 'boolean', default: false },
                    compact:  { type: 'boolean', default: false },
                    caption:  { type: 'string' },
                 }},
  table_row:    { category: 'prose',     children: ['table_cell', 'table_header'] },
  table_header: { category: 'prose',     children: 'inline',     attrs: {
                    align: { type: 'string', enum: ['left', 'center', 'right'] },
                 }},
  table_cell:   { category: 'prose',     children: 'inline',     attrs: {
                    align:   { type: 'string', enum: ['left', 'center', 'right'] },
                    numeric: { type: 'boolean', default: false },
                 }},
  definition_list: { category: 'prose',  children: ['definition_term', 'definition_desc'] },
  definition_term: { category: 'prose',  children: 'inline' },
  definition_desc: { category: 'prose',  children: 'block' },

  // --- Media ---
  figure:       { category: 'media',     children: ['figcaption'], optionalChildren: true, attrs: { src: { type: 'string', required: true }, alt: { type: 'string', required: true }, variant: { type: 'string', enum: ['default', 'full', 'bordered', 'float-start', 'float-end', 'centered'] } } },
  figcaption:   { category: 'media',     children: 'inline' },
  embed:        { category: 'media',     leaf: true,             attrs: { url: { type: 'string', required: true }, type: { type: 'string', enum: ['video', 'audio', 'codepen', 'observable'] } } },

  // --- Code ---
  code_block:   { category: 'code',      leaf: true,             attrs: { language: { type: 'string', default: 'text' }, filename: { type: 'string' } } },

  // --- Components (Vanilla Breeze) ---
  callout:      { category: 'component', children: 'block',      attrs: { variant: { type: 'string', required: true, enum: ['note', 'tip', 'warning', 'danger'] } } },
  collapsible:  { category: 'component', children: 'block',      attrs: { summary: { type: 'string', required: true } } },
  card:         { category: 'component', children: 'block',      attrs: { href: { type: 'string' } } },
  tabs:         { category: 'component', children: 'tab' },
  tab:          { category: 'component', children: 'block',      attrs: { label: { type: 'string', required: true } } },
  steps:        { category: 'component', children: 'step' },
  step:         { category: 'component', children: 'block',      attrs: { title: { type: 'string', required: true } } },

  // Generic web-component node. tag/attrs/value/wrap/children are checked by
  // validate.js (children depend on the component's kind), not by this table.
  component:    { category: 'component', children: 'component' },
};

/**
 * Inline node types. Appear inside blocks with children: 'inline'.
 */
export const inlineTypes = {
  text:         { marks: ['strong', 'em', 'code', 'strikethrough', 'mark', 'kbd', 'sub', 'sup'] },
  link:         { children: 'inline', attrs: { href: { type: 'string', required: true }, title: { type: 'string' } } },
  footnote_ref: { leaf: true,          attrs: { id: { type: 'string', required: true } } },
  component:    { children: 'inline' },
};

/**
 * Valid marks for text nodes.
 */
export const validMarks = ['strong', 'em', 'code', 'strikethrough', 'mark', 'kbd', 'sub', 'sup'];

/**
 * Block types grouped by category for editor palette.
 * @returns {Record<string, string[]>}
 */
export function categorizedBlocks() {
  const groups = {};
  for (const [name, def] of Object.entries(blockTypes)) {
    // Skip child-only types that aren't inserted independently
    if (name === 'component') continue; // palette lists components from descriptors
    if (['list_item', 'figcaption', 'tab', 'step', 'table_row', 'table_header', 'table_cell', 'definition_term', 'definition_desc'].includes(name)) continue;
    const cat = def.category;
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(name);
  }
  return groups;
}

/**
 * Required meta fields for a valid document.
 */
export const requiredMeta = ['title', 'slug', 'collection', 'status'];

/**
 * Valid document statuses.
 */
export const validStatuses = ['draft', 'published', 'archived'];
