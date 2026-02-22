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
  parseDOM: [{ tag: 'hr' }],
  toDOM() { return ['hr']; },
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

const callout = {
  content: 'block+',
  group: 'block',
  defining: true,
  isolating: true,
  attrs: {
    variant: { default: 'note' },
  },
  parseDOM: [{
    tag: 'ui-callout',
    getAttrs(dom) {
      return { variant: dom.getAttribute('data-variant') || 'note' };
    },
  }],
  toDOM(node) {
    return ['ui-callout', { 'data-variant': node.attrs.variant }, 0];
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
  parseDOM: [{
    tag: 'content-card',
    getAttrs(dom) {
      return { href: dom.getAttribute('href') || '' };
    },
  }],
  toDOM(node) {
    const attrs = {};
    if (node.attrs.href) attrs.href = node.attrs.href;
    return ['content-card', attrs, 0];
  },
};

const tabs = {
  content: 'tab+',
  group: 'block',
  isolating: true,
  parseDOM: [{ tag: 'ui-tabs' }],
  toDOM() { return ['ui-tabs', 0]; },
};

const tab = {
  content: 'block+',
  isolating: true,
  attrs: {
    label: { default: 'Tab' },
  },
  parseDOM: [{
    tag: 'div.tab-panel',
    getAttrs(dom) {
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
  parseDOM: [{ tag: 'ol[data-steps]' }],
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
  },
  parseDOM: [{
    tag: 'figure',
    getAttrs(dom) {
      const img = dom.querySelector('img');
      return {
        src: img ? img.getAttribute('src') || '' : '',
        alt: img ? img.getAttribute('alt') || '' : '',
      };
    },
    contentElement: 'figcaption',
  }],
  toDOM(node) {
    return ['figure', {},
      ['img', { src: node.attrs.src, alt: node.attrs.alt }],
      0,
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
    link,
  },
});
