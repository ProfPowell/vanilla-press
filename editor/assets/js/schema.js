/**
 * ProseMirror schema for the Vanilla Press editor.
 *
 * Hand-authored (not auto-derived) but references content-schema.js
 * for attribute definitions. Links are marks in PM, nodes in VP AST.
 * Lists use separate bullet_list/ordered_list types.
 *
 * @module editor/schema
 */

import { Schema } from 'prosemirror-model';
import { blockTypes, inlineTypes } from '../../../src/schema/content-schema.js';

// Pull attr defs from content-schema for reference
const codeAttrs = blockTypes.code_block.attrs;
const calloutAttrs = blockTypes.callout.attrs;
const collapsibleAttrs = blockTypes.collapsible.attrs;
const cardAttrs = blockTypes.card.attrs;
const tabAttrs = blockTypes.tab.attrs;
const stepAttrs = blockTypes.step.attrs;
const figureAttrs = blockTypes.figure.attrs;
const embedAttrs = blockTypes.embed.attrs;
const headingAttrs = blockTypes.heading.attrs;

/** @type {import('prosemirror-model').NodeSpec} */
const doc = {
  content: 'block+',
};

const paragraph = {
  content: 'inline*',
  group: 'block',
  parseDOM: [{ tag: 'p' }],
  toDOM() { return ['p', 0]; },
};

const heading = {
  content: 'inline*',
  group: 'block',
  attrs: { level: { default: 2, validate: 'number' } },
  parseDOM: [2, 3, 4, 5, 6].map(level => ({
    tag: `h${level}`,
    attrs: { level },
  })),
  toDOM(node) { return [`h${node.attrs.level}`, 0]; },
};

const blockquote = {
  content: 'block+',
  group: 'block',
  defining: true,
  parseDOM: [{ tag: 'blockquote' }],
  toDOM() { return ['blockquote', 0]; },
};

const bullet_list = {
  content: 'list_item+',
  group: 'block',
  parseDOM: [{ tag: 'ul' }],
  toDOM() { return ['ul', 0]; },
};

const ordered_list = {
  content: 'list_item+',
  group: 'block',
  attrs: { start: { default: 1, validate: 'number' } },
  parseDOM: [{
    tag: 'ol',
    getAttrs(dom) {
      return { start: dom.hasAttribute('start') ? +dom.getAttribute('start') : 1 };
    },
  }],
  toDOM(node) {
    return node.attrs.start === 1 ? ['ol', 0] : ['ol', { start: node.attrs.start }, 0];
  },
};

const list_item = {
  content: 'block+',
  defining: true,
  parseDOM: [{ tag: 'li' }],
  toDOM() { return ['li', 0]; },
};

const hr = {
  group: 'block',
  attrs: {
    variant: { default: 'default' },
  },
  parseDOM: [{
    tag: 'hr',
    getAttrs(dom) {
      return { variant: dom.classList.contains('decorative') ? 'decorative' : 'default' };
    },
  }],
  toDOM(node) {
    if (node.attrs.variant === 'decorative') return ['hr', { class: 'decorative' }];
    return ['hr'];
  },
};

const code_block = {
  content: 'text*',
  group: 'block',
  code: true,
  marks: '',
  defining: true,
  isolating: true,
  attrs: {
    language: { default: 'text' },
    filename: { default: '' },
  },
  parseDOM: [{
    tag: 'code-block',
    getAttrs(dom) {
      return {
        language: dom.getAttribute('data-language') || 'text',
        filename: dom.getAttribute('data-filename') || '',
      };
    },
    contentElement: 'code',
  }],
  toDOM(node) {
    const attrs = { 'data-language': node.attrs.language };
    if (node.attrs.filename) attrs['data-filename'] = node.attrs.filename;
    return ['code-block', attrs, ['pre', ['code', 0]]];
  },
};

// VP callout variants ↔ VB status-message variants (mirrors html.js)
export const CALLOUT_TO_VB = { note: 'info', tip: 'success', warning: 'warning', danger: 'error' };
const VB_TO_CALLOUT = Object.fromEntries(Object.entries(CALLOUT_TO_VB).map(([k, v]) => [v, k]));

const callout = {
  content: 'block+',
  group: 'block',
  defining: true,
  isolating: true,
  attrs: {
    variant: { default: 'note' },
  },
  // Published as VB <status-message data-variant="info|success|warning|error">
  // with a <div data-content> body (src/renderers/html.js renderCallout).
  // The AST keeps VP variant names (note/tip/warning/danger).
  parseDOM: [{
    tag: 'status-message',
    getAttrs(dom) {
      return { variant: VB_TO_CALLOUT[dom.getAttribute('data-variant')] || 'note' };
    },
    contentElement(dom) {
      return dom.querySelector(':scope > [data-content]') || dom;
    },
  }, {
    // Legacy pre-VB markup
    tag: 'ui-callout',
    getAttrs(dom) {
      return { variant: dom.getAttribute('data-variant') || 'note' };
    },
  }],
  toDOM(node) {
    return ['status-message', { 'data-variant': CALLOUT_TO_VB[node.attrs.variant] || 'info' },
      ['div', { 'data-content': '' }, 0]];
  },
};

const collapsible = {
  content: 'block+',
  group: 'block',
  defining: true,
  isolating: true,
  attrs: {
    summary: { default: '' },
  },
  parseDOM: [{
    tag: 'details',
    getAttrs(dom) {
      const summaryEl = dom.querySelector('summary');
      return { summary: summaryEl ? summaryEl.textContent : '' };
    },
    contentElement(dom) {
      // Skip the <summary> element — content is everything after it
      const wrapper = document.createElement('div');
      for (const child of dom.children) {
        if (child.tagName !== 'SUMMARY') wrapper.appendChild(child.cloneNode(true));
      }
      return wrapper;
    },
  }],
  toDOM(node) {
    return ['details', { open: 'open' },
      ['summary', node.attrs.summary],
      ['div', { class: 'collapsible-content' }, 0],
    ];
  },
};

const card = {
  content: 'block+',
  group: 'block',
  defining: true,
  attrs: {
    href: { default: '' },
  },
  // Published as <layout-card data-variant="elevated"><section>…</section></layout-card>,
  // wrapped in <a class="card-link" href> when linked (renderCard). The
  // editor carries the link as data-href so pasted cards keep it.
  parseDOM: [{
    tag: 'layout-card',
    getAttrs(dom) {
      const link = dom.closest('a.card-link');
      return { href: dom.getAttribute('data-href') || (link && link.getAttribute('href')) || '' };
    },
    contentElement(dom) {
      return dom.querySelector(':scope > section') || dom;
    },
  }, {
    // Legacy pre-VB markup
    tag: 'content-card',
    getAttrs(dom) {
      return { href: dom.getAttribute('href') || '' };
    },
  }],
  toDOM(node) {
    const attrs = { 'data-variant': 'elevated' };
    if (node.attrs.href) attrs['data-href'] = node.attrs.href;
    return ['layout-card', attrs, ['section', 0]];
  },
};

const tabs = {
  content: 'tab+',
  group: 'block',
  isolating: true,
  // Published as <tab-set> of <details name><summary>label</summary><div>…</div></details>
  // (renderTabs). The editor renders TabsView over plain div.tab-panel
  // children instead of VB's tab-set, which takes over its <details>
  // children and would fight ProseMirror. parseDOM also accepts the
  // published markup so pasted VB tabs come in as tabs.
  parseDOM: [{ tag: 'div.pm-tabs' }, { tag: 'tab-set' }, { tag: 'ui-tabs' }],
  toDOM() { return ['div', { class: 'pm-tabs' }, 0]; },
};

const tab = {
  content: 'block+',
  isolating: true,
  attrs: {
    label: { default: 'Tab' },
  },
  parseDOM: [{
    tag: 'tab-set > details',
    priority: 60, // ahead of the generic collapsible <details> rule
    getAttrs(dom) {
      const summary = dom.querySelector(':scope > summary');
      return { label: summary ? summary.textContent : 'Tab' };
    },
    contentElement(dom) {
      return dom.querySelector(':scope > div') || dom;
    },
  }, {
    tag: 'div.tab-panel',
    getAttrs(dom) {
      if (dom.hasAttribute('data-label')) return { label: dom.getAttribute('data-label') };
      // Get the label from the preceding <label> element
      const label = dom.previousElementSibling;
      return { label: label && label.tagName === 'LABEL' ? label.textContent : 'Tab' };
    },
  }],
  toDOM(node) {
    return ['div', { class: 'tab-panel', 'data-label': node.attrs.label }, 0];
  },
};

const steps = {
  content: 'step+',
  group: 'block',
  isolating: true,
  // priority: ahead of the generic ordered_list 'ol' rule
  parseDOM: [{ tag: 'ol[data-steps]', priority: 60 }],
  toDOM() { return ['ol', { 'data-steps': '' }, 0]; },
};

const step = {
  content: 'block+',
  isolating: true,
  attrs: {
    title: { default: '' },
  },
  parseDOM: [{
    tag: 'li[data-step-title]',
    priority: 60, // ahead of list_item's generic 'li'
    getAttrs(dom) {
      return { title: dom.getAttribute('data-step-title') || '' };
    },
  }],
  toDOM(node) {
    return ['li', { 'data-step-title': node.attrs.title }, 0];
  },
};

const figure = {
  content: 'figcaption?',
  group: 'block',
  attrs: {
    src: { default: '' },
    alt: { default: '' },
    variant: { default: 'default' },
  },
  parseDOM: [{
    tag: 'figure',
    getAttrs(dom) {
      const img = dom.querySelector('img');
      const cls = dom.getAttribute('class') || '';
      const variants = ['full', 'bordered', 'float-start', 'float-end', 'centered'];
      const variant = variants.find(v => cls.includes(v)) || 'default';
      return {
        src: img ? img.getAttribute('src') || '' : '',
        alt: img ? img.getAttribute('alt') || '' : '',
        variant,
      };
    },
    // Content is an optional figcaption node, so hand the parser only the
    // <figcaption> element (skipping the <img>, which lives in attrs)
    contentElement(dom) {
      const wrapper = document.createElement('div');
      const caption = dom.querySelector('figcaption');
      if (caption) wrapper.appendChild(caption.cloneNode(true));
      return wrapper;
    },
  }],
  toDOM(node) {
    const attrs = {};
    if (node.attrs.variant && node.attrs.variant !== 'default') {
      attrs.class = node.attrs.variant;
    }
    // A content hole must be its parent's only child, so the caption
    // node renders inside a wrapper next to the <img>
    return ['figure', attrs,
      ['img', { src: node.attrs.src, alt: node.attrs.alt }],
      ['div', { 'data-figure-caption': '' }, 0],
    ];
  },
};

const figcaption = {
  content: 'inline*',
  parseDOM: [{ tag: 'figcaption' }],
  toDOM() { return ['figcaption', 0]; },
};

const embed = {
  group: 'block',
  atom: true,
  attrs: {
    url: { default: '' },
    type: { default: 'video' },
  },
  parseDOM: [{
    tag: 'div[data-embed]',
    getAttrs(dom) {
      return {
        url: dom.getAttribute('data-url') || '',
        type: dom.getAttribute('data-type') || 'video',
      };
    },
  }],
  toDOM(node) {
    return ['div', {
      'data-embed': '',
      'data-url': node.attrs.url,
      'data-type': node.attrs.type,
      class: 'pm-embed-placeholder',
      contenteditable: 'false',
    }, `[${node.attrs.type}: ${node.attrs.url}]`];
  },
};

const table = {
  content: 'table_row+',
  group: 'block',
  isolating: true,
  tableRole: 'table',
  attrs: {
    striped: { default: false },
    bordered: { default: false },
    compact: { default: false },
    caption: { default: '' },
  },
  parseDOM: [{
    tag: 'table',
    getAttrs(dom) {
      return {
        striped: dom.classList.contains('striped'),
        bordered: dom.classList.contains('bordered'),
        compact: dom.classList.contains('compact'),
        caption: dom.querySelector('caption')?.textContent || '',
      };
    },
    // The caption is an attr, not content: parse the rows without it
    contentElement(dom) {
      const clone = dom.cloneNode(true);
      clone.querySelector(':scope > caption')?.remove();
      return clone;
    },
  }],
  toDOM(node) {
    const classes = [];
    if (node.attrs.striped) classes.push('striped');
    if (node.attrs.bordered) classes.push('bordered');
    if (node.attrs.compact) classes.push('compact');
    const attrs = classes.length ? { class: classes.join(' ') } : {};
    if (node.attrs.caption) {
      // A content hole must be its parent's only child: rows go in <tbody>
      return ['table', attrs, ['caption', node.attrs.caption], ['tbody', 0]];
    }
    return ['table', attrs, ['tbody', 0]];
  },
};

const table_row = {
  content: '(table_cell | table_header)+',
  tableRole: 'row',
  parseDOM: [{ tag: 'tr' }],
  toDOM() { return ['tr', 0]; },
};

const table_header = {
  content: 'inline*',
  tableRole: 'header_cell',
  isolating: true,
  attrs: {
    align: { default: null },
  },
  parseDOM: [{
    tag: 'th',
    getAttrs(dom) {
      return { align: dom.getAttribute('data-align') || dom.style.textAlign || null };
    },
  }],
  toDOM(node) {
    const attrs = {};
    if (node.attrs.align) attrs['data-align'] = node.attrs.align;
    return ['th', attrs, 0];
  },
};

const table_cell = {
  content: 'inline*',
  tableRole: 'cell',
  isolating: true,
  attrs: {
    align: { default: null },
    numeric: { default: false },
  },
  parseDOM: [{
    tag: 'td',
    getAttrs(dom) {
      return {
        align: dom.getAttribute('data-align') || dom.style.textAlign || null,
        numeric: dom.hasAttribute('data-numeric'),
      };
    },
  }],
  toDOM(node) {
    const attrs = {};
    if (node.attrs.align) attrs['data-align'] = node.attrs.align;
    if (node.attrs.numeric) attrs['data-numeric'] = '';
    return ['td', attrs, 0];
  },
};

const definition_list = {
  content: '(definition_term | definition_desc)+',
  group: 'block',
  defining: true,
  parseDOM: [{ tag: 'dl' }],
  toDOM() { return ['dl', 0]; },
};

const definition_term = {
  content: 'inline*',
  defining: true,
  parseDOM: [{ tag: 'dt' }],
  toDOM() { return ['dt', 0]; },
};

const definition_desc = {
  content: 'block+',
  defining: true,
  parseDOM: [{ tag: 'dd' }],
  toDOM() { return ['dd', 0]; },
};

const text = {
  group: 'inline',
};

const footnote_ref = {
  group: 'inline',
  inline: true,
  atom: true,
  attrs: {
    id: { default: '1' },
  },
  parseDOM: [{
    tag: 'sup.footnote-ref',
    getAttrs(dom) {
      return { id: dom.getAttribute('data-id') || '1' };
    },
  }],
  toDOM(node) {
    return ['sup', {
      class: 'footnote-ref',
      'data-id': node.attrs.id,
    }, `[${node.attrs.id}]`];
  },
};

// --- Marks ---

const strong = {
  parseDOM: [
    { tag: 'strong' },
    { tag: 'b', getAttrs: node => node.style.fontWeight !== 'normal' && null },
    { style: 'font-weight=bold' },
    { style: 'font-weight', getAttrs: v => /^(bold(er)?|[5-9]\d{2,})$/.test(v) && null },
  ],
  toDOM() { return ['strong', 0]; },
};

const em = {
  parseDOM: [
    { tag: 'i' },
    { tag: 'em' },
    { style: 'font-style=italic' },
  ],
  toDOM() { return ['em', 0]; },
};

const code = {
  parseDOM: [{ tag: 'code' }],
  toDOM() { return ['code', 0]; },
};

const strikethrough = {
  parseDOM: [
    { tag: 's' },
    { tag: 'del' },
    { tag: 'strike' },
    { style: 'text-decoration', getAttrs: v => v === 'line-through' && null },
  ],
  toDOM() { return ['s', 0]; },
};

const highlight = {
  parseDOM: [{ tag: 'mark' }],
  toDOM() { return ['mark', 0]; },
};

const kbd = {
  parseDOM: [{ tag: 'kbd' }],
  toDOM() { return ['kbd', 0]; },
};

const subscript = {
  parseDOM: [{ tag: 'sub' }],
  toDOM() { return ['sub', 0]; },
};

const superscript = {
  parseDOM: [{
    tag: 'sup',
    getAttrs(dom) {
      // Don't match footnote refs
      if (dom.classList.contains('footnote-ref')) return false;
      return null;
    },
  }],
  toDOM() { return ['sup', 0]; },
};

const link = {
  attrs: {
    href: { default: '' },
    title: { default: null },
  },
  inclusive: false,
  parseDOM: [{
    tag: 'a[href]',
    getAttrs(dom) {
      return {
        href: dom.getAttribute('href'),
        title: dom.getAttribute('title'),
      };
    },
  }],
  toDOM(node) {
    const { href, title } = node.attrs;
    const attrs = { href };
    if (title) attrs.title = title;
    return ['a', attrs, 0];
  },
};

// --- Build schema ---

export const schema = new Schema({
  nodes: {
    doc,
    paragraph,
    heading,
    blockquote,
    bullet_list,
    ordered_list,
    list_item,
    hr,
    code_block,
    callout,
    collapsible,
    card,
    tabs,
    tab,
    steps,
    step,
    table,
    table_row,
    table_header,
    table_cell,
    definition_list,
    definition_term,
    definition_desc,
    figure,
    figcaption,
    embed,
    footnote_ref,
    text,
  },
  marks: {
    strong,
    em,
    code,
    strikethrough,
    highlight,
    kbd,
    subscript,
    superscript,
    link,
  },
});
