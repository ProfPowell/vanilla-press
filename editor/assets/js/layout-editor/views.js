/**
 * The layout editor's canvas: NodeViews that draw each block as a labelled
 * box in its real nesting. Regions are bands named for what they are
 * (`Header`, `Main`, `Sidebar`…), `${content}` is a fixed
 * `Document body goes here` band, a slot is `Region: <label>` (its label
 * from `meta.info.slots`), a repeating block carries
 * `Repeats for each <alias> in <source> (<limit>)`, includes and
 * components are single tiles, fields are tokens (`Title`, `post.title`).
 *
 * Labels are editor chrome (`contenteditable=false`); the layout's own
 * attributes never reach the DOM.
 *
 * @module editor/layout-editor/views
 */

/** Cook's document fields (cook-ssg/layouts DOCUMENT_FIELDS): shown in Title Case. */
export const DOCUMENT_FIELDS = [
  'title', 'description', 'date', 'published', 'updated', 'author', 'tags',
  'image', 'imageAlt', 'theme', 'themeScope', 'layout', 'slug', 'vp_id',
  'url', 'pageLayout',
];

/** An attribute's value from a block's `attrs` pairs, or null. */
export const attrOf = (node, name) => (node.attrs.attrs || []).find(([k]) => k === name)?.[1] ?? null;

/**
 * A field token's text: a document field in Title Case (`imageAlt` →
 * `Image alt`), anything else as written (`post.title`, `siteTitle`).
 * @param {string} name
 */
export function fieldLabel(name) {
  if (!DOCUMENT_FIELDS.includes(name)) return name;
  const words = name.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return words[0].toUpperCase() + words.slice(1);
}

/**
 * A base region's name.
 * @param {import('prosemirror-model').Node} node - a region
 */
export function regionLabel(node) {
  switch (node.attrs.tag) {
    case 'header': return 'Header';
    case 'main': return 'Main';
    case 'aside': return 'Sidebar';
    case 'footer': return 'Footer';
    case 'nav': return /^section\b/i.test(attrOf(node, 'aria-label') || '') ? 'Section menu' : 'Navigation';
    default: return node.attrs.tag;
  }
}

/**
 * `Repeats for each <alias> in <source>`, plus ` (<limit>)` with a limit.
 * @param {{ source: string, alias: string, pipes?: string[] }} repeat
 */
export function repeatLabel(repeat) {
  const limit = (repeat.pipes || []).map(p => /^limit:\s*(\d+)$/.exec(p)).find(Boolean);
  return `Repeats for each ${repeat.alias} in ${repeat.source}${limit ? ` (${limit[1]})` : ''}`;
}

/** A slot's label from the layout's info block, else its name. */
export function slotLabel(meta, name) {
  const entry = meta?.info?.slots?.[name];
  return (entry && typeof entry === 'object' && typeof entry.label === 'string' && entry.label) || name;
}

/** `Region: <label>`. */
export const slotText = (meta, name) => `Region: ${slotLabel(meta, name)}`;

/** A container's name: its tag, with `data-layout` when it has one. */
function containerLabel(node) {
  const layout = attrOf(node, 'data-layout');
  return layout ? `${node.attrs.tag} · ${layout}` : node.attrs.tag;
}

const MENU_LABELS = { ul: 'Bullet list', ol: 'Numbered list', menu: 'Menu' };

function el(tag, attrs = {}, text = null) {
  const out = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) out.setAttribute(k, v);
  if (text !== null) out.textContent = text;
  return out;
}

/** The chrome above a block: its name, then its repeat and conditions. */
function chrome(node, name) {
  const bar = el('div', { class: 'le-label', contenteditable: 'false' });
  bar.append(el('span', { class: 'le-name' }, name));
  const { repeat, if: cond, unless } = node.attrs;
  if (repeat) bar.append(el('span', { class: 'le-repeat' }, repeatLabel(repeat)));
  if (cond != null) bar.append(el('span', { class: 'le-cond' }, `Show only when ${cond}`));
  if (unless != null) bar.append(el('span', { class: 'le-cond' }, `Show only when not ${unless}`));
  return bar;
}

/** A box with a label bar and editable content. */
function boxView(cls, node, name, tag = 'div') {
  const dom = el(tag, { class: `le-block ${cls}` });
  if (node.attrs.tag) dom.dataset.tag = node.attrs.tag;
  dom.append(chrome(node, name));
  const contentDOM = el('div', { class: 'le-children' });
  dom.append(contentDOM);
  return {
    dom,
    contentDOM,
    ignoreMutation: (m) => !contentDOM.contains(m.target),
  };
}

/** A single tile (an atom block). */
function tileView(cls, node, name, detail = null) {
  const dom = el('div', { class: `le-block le-tile ${cls}`, contenteditable: 'false' });
  dom.append(chrome(node, name));
  if (detail !== null) dom.append(el('div', { class: 'le-detail' }, detail));
  return { dom, ignoreMutation: () => true };
}

/** A child's filled region: `Region: <the parent's label>`, else its name. */
export function pieceText(slots, name) {
  const found = (Array.isArray(slots) ? slots : []).find(s => s?.name === name);
  return `Region: ${(found && typeof found.label === 'string' && found.label) || name}`;
}

/**
 * The NodeViews for an EditorView.
 * @param {() => Object} getMeta - the layout's meta (slot labels)
 * @param {() => Array<{ name: string, label?: string }>} [getParentSlots] - a child's parent regions
 */
export function nodeViews(getMeta, getParentSlots = () => []) {
  return {
    region: (node) => boxView('le-region', node, regionLabel(node), 'section'),
    container: (node) => boxView('le-container', node, containerLabel(node)),
    figure: (node) => boxView('le-figure', node, 'figure'),
    figcaption: (node) => boxView('le-text le-figcaption', node, 'figcaption'),
    text_block: (node) => boxView('le-text', node, node.attrs.tag),
    menu: (node) => boxView('le-menu', node, MENU_LABELS[node.attrs.tag] || node.attrs.tag),
    menu_item: (node) => boxView('le-menu-item', node, 'li'),
    menu_item_blocks: (node) => boxView('le-menu-item le-menu-item-blocks', node, 'li'),
    slot_piece: (node) => {
      const view = boxView('le-slot-piece', node, pieceText(getParentSlots(), node.attrs.name), 'section');
      view.dom.dataset.slot = node.attrs.name;
      return view;
    },

    content: () => {
      const dom = el('div', { class: 'le-block le-content', contenteditable: 'false' }, 'Document body goes here');
      return { dom, ignoreMutation: () => true };
    },
    slot_ref: (node) => {
      const dom = el('div', { class: 'le-block le-slot-ref', contenteditable: 'false', 'data-slot': node.attrs.name },
        slotText(getMeta(), node.attrs.name));
      return { dom, ignoreMutation: () => true };
    },
    include: (node) => tileView('le-include', node, 'Include', node.attrs.path || '(no path yet)'),
    component: (node) => tileView('le-component', node, node.attrs.tag ? `<${node.attrs.tag}>` : 'Component (no name yet)'),
    image: (node) => tileView('le-image', node, node.attrs.tag === 'picture' ? 'Picture' : 'Image', attrOf(node, 'src') || null),
    comment: (node) => tileView('le-comment', node, 'Comment', node.attrs.text.trim() || null),
    head_piece: (node) => tileView('le-head-piece', node, 'Head', `${node.attrs.items.length} items`),

    field: (node) => {
      const dom = el('span', { class: 'le-field', contenteditable: 'false', 'data-field': node.attrs.name, title: `\${${node.attrs.name}}` },
        fieldLabel(node.attrs.name));
      return { dom, ignoreMutation: () => true };
    },
    inline_component: (node) => {
      const dom = el('span', { class: 'le-inline-component', contenteditable: 'false' }, node.attrs.tag ? `<${node.attrs.tag}>` : 'Component (no name yet)');
      return { dom, ignoreMutation: () => true };
    },
    inline_image: () => {
      const dom = el('span', { class: 'le-inline-image', contenteditable: 'false' }, 'Image');
      return { dom, ignoreMutation: () => true };
    },
    empty_inline: (node) => {
      const dom = el('span', { class: 'le-empty-inline', contenteditable: 'false' }, `<${node.attrs.tag}>`);
      return { dom, ignoreMutation: () => true };
    },
  };
}

/**
 * Redraw the slot labels after `meta.info.slots` changed (the inspector).
 * @param {import('prosemirror-view').EditorView} view
 * @param {Object} meta
 */
export function refreshSlotLabels(view, meta) {
  for (const dom of view.dom.querySelectorAll('.le-slot-ref[data-slot]')) {
    dom.textContent = slotText(meta, dom.getAttribute('data-slot'));
  }
}

