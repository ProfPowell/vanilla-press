/**
 * AST serialization: ProseMirror doc <-> VP Block AST.
 *
 * Key conversions:
 * - PM link marks → VP link nodes with children (and back)
 * - PM bullet_list/ordered_list → VP list with ordered boolean (and back)
 * - PM code_block (text content) → VP code_block (leaf with value)
 * - PM component_leaf / component_blocks / component_inline → VP component
 *   (`value`/`wrap` on leaves only when set, `children` for blocks and inline)
 *
 * @module editor/ast
 */

import { schema } from './schema.js';

// Mark name mapping: PM schema name → VP AST name
const PM_TO_VP_MARK = {
  highlight: 'mark',
  subscript: 'sub',
  superscript: 'sup',
};
const VP_TO_PM_MARK = {
  mark: 'highlight',
  sub: 'subscript',
  sup: 'superscript',
};

// --- PM Doc → VP Block AST ---

/**
 * Convert a ProseMirror document to a VP block AST. The title node (the
 * document's first line, which holds `meta.title`) is not a block: skipped.
 * @param {import('prosemirror-model').Node} pmDoc
 * @returns {Object[]} Array of VP blocks
 */
export function toBlockAst(pmDoc) {
  const blocks = [];
  pmDoc.forEach(child => {
    if (child.type.name === 'title') return;
    const block = nodeToBlock(child);
    if (block) blocks.push(block);
  });
  // The editor's trailing paragraph (block-nav.js): an empty last paragraph
  // after anything but a paragraph is not part of the post
  const last = blocks[blocks.length - 1];
  const before = blocks[blocks.length - 2];
  if (before && before.type !== 'paragraph' && last.type === 'paragraph' && !(last.children || []).length) {
    blocks.pop();
  }
  return blocks;
}

/**
 * Convert a single PM node to a VP block.
 * @param {import('prosemirror-model').Node} node
 * @returns {Object|null}
 */
function nodeToBlock(node) {
  switch (node.type.name) {
    case 'paragraph':
      return {
        type: 'paragraph',
        children: inlineToVp(node),
      };

    case 'heading':
      return {
        type: 'heading',
        attrs: { level: node.attrs.level },
        children: inlineToVp(node),
      };

    case 'blockquote':
      return {
        type: 'blockquote',
        children: childBlocks(node),
      };

    case 'bullet_list':
      return {
        type: 'list',
        attrs: { ordered: false },
        children: childBlocks(node),
      };

    case 'ordered_list':
      return {
        type: 'list',
        attrs: { ordered: true },
        children: childBlocks(node),
      };

    case 'list_item':
      return {
        type: 'list_item',
        children: childBlocks(node),
      };

    case 'hr': {
      const variant = node.attrs.variant;
      const hrBlock = { type: 'hr' };
      if (variant && variant !== 'default') hrBlock.attrs = { variant };
      return hrBlock;
    }

    case 'code_block':
      return {
        type: 'code_block',
        attrs: cleanAttrs({
          language: node.attrs.language,
          filename: node.attrs.filename || undefined,
        }),
        value: node.textContent,
      };

    case 'callout':
      return {
        type: 'callout',
        attrs: { variant: node.attrs.variant },
        children: childBlocks(node),
      };

    case 'collapsible':
      return {
        type: 'collapsible',
        attrs: { summary: node.attrs.summary },
        children: childBlocks(node),
      };

    case 'card':
      return {
        type: 'card',
        attrs: cleanAttrs({ href: node.attrs.href || undefined }),
        children: childBlocks(node),
      };

    case 'tabs':
      return {
        type: 'tabs',
        children: childBlocks(node),
      };

    case 'tab':
      return {
        type: 'tab',
        attrs: { label: node.attrs.label },
        children: childBlocks(node),
      };

    case 'steps':
      return {
        type: 'steps',
        children: childBlocks(node),
      };

    case 'step':
      return {
        type: 'step',
        attrs: { title: node.attrs.title },
        children: childBlocks(node),
      };

    case 'table': {
      const tableAttrs = cleanAttrs({
        striped: node.attrs.striped || undefined,
        bordered: node.attrs.bordered || undefined,
        compact: node.attrs.compact || undefined,
        caption: node.attrs.caption || undefined,
      });
      const result = { type: 'table', children: childBlocks(node) };
      if (Object.keys(tableAttrs).length) result.attrs = tableAttrs;
      return result;
    }

    case 'table_row':
      return { type: 'table_row', children: childBlocks(node) };

    case 'table_header': {
      const thResult = {
        type: 'table_header',
        children: inlineToVp(node),
      };
      if (node.attrs.align) thResult.attrs = { align: node.attrs.align };
      return thResult;
    }

    case 'table_cell': {
      const tdAttrs = cleanAttrs({
        align: node.attrs.align || undefined,
        numeric: node.attrs.numeric || undefined,
      });
      const tdResult = {
        type: 'table_cell',
        children: inlineToVp(node),
      };
      if (Object.keys(tdAttrs).length) tdResult.attrs = tdAttrs;
      return tdResult;
    }

    case 'definition_list':
      return { type: 'definition_list', children: childBlocks(node) };

    case 'definition_term':
      return { type: 'definition_term', children: inlineToVp(node) };

    case 'definition_desc':
      return { type: 'definition_desc', children: childBlocks(node) };

    case 'figure': {
      const figAttrs = cleanAttrs({
        src: node.attrs.src,
        alt: node.attrs.alt,
        variant: node.attrs.variant && node.attrs.variant !== 'default' ? node.attrs.variant : undefined,
      });
      const result = {
        type: 'figure',
        attrs: figAttrs,
      };
      const captions = childBlocks(node);
      if (captions.length > 0) {
        result.children = captions;
      }
      return result;
    }

    case 'figcaption':
      return {
        type: 'figcaption',
        children: inlineToVp(node),
      };

    case 'embed':
      return {
        type: 'embed',
        attrs: { url: node.attrs.url, type: node.attrs.type },
      };

    case 'component_leaf': {
      const comp = { type: 'component', tag: node.attrs.tag, attrs: { ...(node.attrs.attrs || {}) } };
      if (node.attrs.value != null) comp.value = node.attrs.value;
      if (node.attrs.wrap != null) comp.wrap = node.attrs.wrap;
      return comp;
    }

    case 'component_blocks':
      return {
        type: 'component',
        tag: node.attrs.tag,
        attrs: { ...(node.attrs.attrs || {}) },
        children: childBlocks(node),
      };

    default:
      return null;
  }
}

/**
 * Collect child blocks from a PM node.
 */
function childBlocks(node) {
  const blocks = [];
  node.forEach(child => {
    const b = nodeToBlock(child);
    if (b) blocks.push(b);
  });
  return blocks;
}

/**
 * Convert PM inline content to VP inline nodes.
 * Handles link mark → link node conversion.
 * @param {import('prosemirror-model').Node} node - A node with inline content
 * @returns {Object[]}
 */
function inlineToVp(node) {
  const result = [];

  // Consecutive inline nodes carrying the same link mark form one VP link
  // node; the link mark may sit on text, footnote refs and inline components.
  node.forEach(child => {
    const vp = inlineNodeToVp(child);
    if (!vp) return;

    const linkMark = child.marks.find(m => m.type.name === 'link');
    if (!linkMark) {
      result.push(vp);
      return;
    }

    const prevLink = result[result.length - 1];
    if (prevLink && prevLink.type === 'link' && prevLink._mark &&
        prevLink._mark.eq(linkMark)) {
      prevLink.children.push(vp);
    } else {
      const linkNode = {
        type: 'link',
        attrs: cleanAttrs({
          href: linkMark.attrs.href,
          title: linkMark.attrs.title || undefined,
        }),
        children: [vp],
      };
      Object.defineProperty(linkNode, '_mark', { value: linkMark, enumerable: false });
      result.push(linkNode);
    }
  });

  return result;
}

/**
 * One PM inline node as a VP inline node, ignoring its link mark (the
 * caller groups by link). Null for node types the AST doesn't know.
 */
function inlineNodeToVp(child) {
  switch (child.type.name) {
    case 'text': {
      const vpMarks = child.marks.filter(m => m.type.name !== 'link')
        .map(m => PM_TO_VP_MARK[m.type.name] || m.type.name);
      const textNode = { type: 'text', value: child.text };
      if (vpMarks.length) textNode.marks = vpMarks;
      return textNode;
    }
    case 'footnote_ref':
      return { type: 'footnote_ref', attrs: { id: child.attrs.id } };
    case 'component_inline':
      return {
        type: 'component',
        tag: child.attrs.tag,
        attrs: { ...(child.attrs.attrs || {}) },
        children: inlineToVp(child),
      };
    default:
      return null;
  }
}

/**
 * Remove undefined/null attrs.
 */
function cleanAttrs(attrs) {
  const clean = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined && v !== null) clean[k] = v;
  }
  return clean;
}


// --- VP Block AST → PM Doc ---

/**
 * Convert VP block AST to a ProseMirror document, with the post title as its
 * first node.
 * @param {Object[]} blocks - Array of VP blocks
 * @param {import('prosemirror-model').Schema} pmSchema
 * @param {{ title?: string }} [options] - title: `meta.title`
 * @returns {import('prosemirror-model').Node}
 */
export function fromBlockAst(blocks, pmSchema, { title = '' } = {}) {
  const s = pmSchema || schema;
  const children = blocks.map(b => blockToNode(b, s)).filter(Boolean);
  if (children.length === 0) {
    children.push(s.node('paragraph'));
  }
  const titleNode = s.node('title', null, title ? [s.text(title)] : []);
  return s.node('doc', null, [titleNode, ...children]);
}

/**
 * Convert a single VP block to a PM node.
 */
function blockToNode(block, s) {
  switch (block.type) {
    case 'paragraph':
      return s.node('paragraph', null, vpInlineToPm(block.children || [], s));

    case 'heading':
      return s.node('heading', { level: block.attrs?.level || 2 },
        vpInlineToPm(block.children || [], s));

    case 'blockquote':
      return s.node('blockquote', null,
        (block.children || []).map(b => blockToNode(b, s)).filter(Boolean));

    case 'list': {
      const nodeType = block.attrs?.ordered ? 'ordered_list' : 'bullet_list';
      const children = (block.children || []).map(b => blockToNode(b, s)).filter(Boolean);
      return s.node(nodeType, null, children);
    }

    case 'list_item':
      return s.node('list_item', null,
        (block.children || []).map(b => blockToNode(b, s)).filter(Boolean));

    case 'hr':
      return s.node('hr', { variant: block.attrs?.variant || 'default' });

    case 'code_block':
      return s.node('code_block', {
        language: block.attrs?.language || 'text',
        filename: block.attrs?.filename || '',
      }, block.value ? [s.text(block.value)] : []);

    case 'callout':
      return s.node('callout', { variant: block.attrs?.variant || 'note' },
        (block.children || []).map(b => blockToNode(b, s)).filter(Boolean));

    case 'collapsible':
      return s.node('collapsible', { summary: block.attrs?.summary || '' },
        (block.children || []).map(b => blockToNode(b, s)).filter(Boolean));

    case 'card':
      return s.node('card', { href: block.attrs?.href || '' },
        (block.children || []).map(b => blockToNode(b, s)).filter(Boolean));

    case 'tabs':
      return s.node('tabs', null,
        (block.children || []).map(b => blockToNode(b, s)).filter(Boolean));

    case 'tab':
      return s.node('tab', { label: block.attrs?.label || 'Tab' },
        (block.children || []).map(b => blockToNode(b, s)).filter(Boolean));

    case 'steps':
      return s.node('steps', null,
        (block.children || []).map(b => blockToNode(b, s)).filter(Boolean));

    case 'step':
      return s.node('step', { title: block.attrs?.title || '' },
        (block.children || []).map(b => blockToNode(b, s)).filter(Boolean));

    case 'table':
      return s.node('table', {
        striped: block.attrs?.striped || false,
        bordered: block.attrs?.bordered || false,
        compact: block.attrs?.compact || false,
        caption: block.attrs?.caption || '',
      }, (block.children || []).map(b => blockToNode(b, s)).filter(Boolean));

    case 'table_row':
      return s.node('table_row', null,
        (block.children || []).map(b => blockToNode(b, s)).filter(Boolean));

    case 'table_header':
      return s.node('table_header', { align: block.attrs?.align || null },
        vpInlineToPm(block.children || [], s));

    case 'table_cell':
      return s.node('table_cell', {
        align: block.attrs?.align || null,
        numeric: block.attrs?.numeric || false,
      }, vpInlineToPm(block.children || [], s));

    case 'definition_list':
      return s.node('definition_list', null,
        (block.children || []).map(b => blockToNode(b, s)).filter(Boolean));

    case 'definition_term':
      return s.node('definition_term', null, vpInlineToPm(block.children || [], s));

    case 'definition_desc':
      return s.node('definition_desc', null,
        (block.children || []).map(b => blockToNode(b, s)).filter(Boolean));

    case 'figure': {
      const captionNodes = (block.children || []).map(b => blockToNode(b, s)).filter(Boolean);
      return s.node('figure', {
        src: block.attrs?.src || '',
        alt: block.attrs?.alt || '',
        variant: block.attrs?.variant || 'default',
      }, captionNodes);
    }

    case 'figcaption':
      return s.node('figcaption', null, vpInlineToPm(block.children || [], s));

    case 'embed':
      return s.node('embed', {
        url: block.attrs?.url || '',
        type: block.attrs?.type || 'video',
      });

    case 'component': {
      const attrs = { ...(block.attrs || {}) };
      if (Array.isArray(block.children)) {
        const children = block.children.map(b => blockToNode(b, s)).filter(Boolean);
        // block+ needs one child; an empty list comes back as one empty paragraph
        if (children.length === 0) children.push(s.node('paragraph'));
        return s.node('component_blocks', { tag: block.tag, attrs }, children);
      }
      return s.node('component_leaf', {
        tag: block.tag,
        attrs,
        value: typeof block.value === 'string' ? block.value : null,
        wrap: block.wrap ?? null,
      });
    }

    default:
      return null;
  }
}

/**
 * Convert VP inline nodes to PM inline content.
 * Handles link node → link mark conversion.
 */
function vpInlineToPm(children, s, linkMark = null) {
  const result = [];
  const withLink = (marks) => (linkMark ? linkMark.addToSet(marks) : marks);

  for (const child of children) {
    if (!child) continue;

    if (child.type === 'text') {
      if (typeof child.value !== 'string' || child.value === '') continue; // Skip empty text nodes
      const marks = (child.marks || []).map(m => s.mark(VP_TO_PM_MARK[m] || m));
      result.push(s.text(child.value, withLink(marks)));
    } else if (child.type === 'link') {
      // VP link node → its content carrying a PM link mark
      const mark = s.mark('link', {
        href: child.attrs?.href || '',
        title: child.attrs?.title || null,
      });
      result.push(...vpInlineToPm(child.children || [], s, mark));
    } else if (child.type === 'footnote_ref') {
      result.push(s.node('footnote_ref', { id: child.attrs?.id || '1' }, null, withLink([])));
    } else if (child.type === 'component') {
      result.push(s.node('component_inline', { tag: child.tag, attrs: { ...(child.attrs || {}) } },
        vpInlineToPm(child.children || [], s), withLink([])));
    }
  }

  return result;
}
