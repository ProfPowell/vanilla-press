/**
 * AST serialization: ProseMirror doc <-> VP Block AST.
 *
 * Key conversions:
 * - PM link marks → VP link nodes with children (and back)
 * - PM bullet_list/ordered_list → VP list with ordered boolean (and back)
 * - PM code_block (text content) → VP code_block (leaf with value)
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
 * Convert a ProseMirror document to a VP block AST.
 * @param {import('prosemirror-model').Node} pmDoc
 * @returns {Object[]} Array of VP blocks
 */
export function toBlockAst(pmDoc) {
  const blocks = [];
  pmDoc.forEach(child => {
    const block = nodeToBlock(child);
    if (block) blocks.push(block);
  });
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

  // Walk through text nodes, splitting on link marks
  node.forEach(child => {
    if (child.type.name === 'footnote_ref') {
      result.push({
        type: 'footnote_ref',
        attrs: { id: child.attrs.id },
      });
      return;
    }

    if (child.type.name !== 'text') return;

    const text = child.text;
    const marks = child.marks;

    // Check for link mark
    const linkMark = marks.find(m => m.type.name === 'link');

    if (linkMark) {
      // This text is part of a link. We need to group consecutive texts
      // with the same link into one VP link node.
      const otherMarks = marks.filter(m => m.type.name !== 'link')
        .map(m => PM_TO_VP_MARK[m.type.name] || m.type.name);

      // Check if previous result item is a link with same href
      const prevLink = result[result.length - 1];
      if (prevLink && prevLink.type === 'link' &&
          prevLink.attrs.href === linkMark.attrs.href &&
          prevLink.attrs.title === linkMark.attrs.title) {
        // Append to existing link
        const textNode = { type: 'text', value: text };
        if (otherMarks.length) textNode.marks = otherMarks;
        prevLink.children.push(textNode);
      } else {
        // Create new link node
        const textNode = { type: 'text', value: text };
        if (otherMarks.length) textNode.marks = otherMarks;
        const linkNode = {
          type: 'link',
          attrs: cleanAttrs({
            href: linkMark.attrs.href,
            title: linkMark.attrs.title || undefined,
          }),
          children: [textNode],
        };
        result.push(linkNode);
      }
    } else {
      const vpMarks = marks.map(m => PM_TO_VP_MARK[m.type.name] || m.type.name);
      const textNode = { type: 'text', value: text };
      if (vpMarks.length) textNode.marks = vpMarks;
      result.push(textNode);
    }
  });

  return result;
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
 * Convert VP block AST to a ProseMirror document.
 * @param {Object[]} blocks - Array of VP blocks
 * @param {import('prosemirror-model').Schema} pmSchema
 * @returns {import('prosemirror-model').Node}
 */
export function fromBlockAst(blocks, pmSchema) {
  const s = pmSchema || schema;
  const children = blocks.map(b => blockToNode(b, s)).filter(Boolean);
  if (children.length === 0) {
    children.push(s.node('paragraph'));
  }
  return s.node('doc', null, children);
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

    default:
      return null;
  }
}

/**
 * Convert VP inline nodes to PM inline content.
 * Handles link node → link mark conversion.
 */
function vpInlineToPm(children, s) {
  const result = [];

  for (const child of children) {
    if (!child) continue;

    if (child.type === 'text') {
      if (!child.value && child.value !== '') continue;
      if (child.value === '') continue; // Skip empty text nodes
      const marks = (child.marks || []).map(m => {
        const pmName = VP_TO_PM_MARK[m] || m;
        return s.mark(pmName);
      }).filter(Boolean);
      result.push(s.text(child.value, marks));
    } else if (child.type === 'link') {
      // Convert VP link node to PM text nodes with link mark
      const linkMark = s.mark('link', {
        href: child.attrs?.href || '',
        title: child.attrs?.title || null,
      });
      const linkChildren = child.children || [];
      for (const linkChild of linkChildren) {
        if (linkChild.type === 'text') {
          if (!linkChild.value) continue;
          const otherMarks = (linkChild.marks || []).map(m => s.mark(VP_TO_PM_MARK[m] || m));
          result.push(s.text(linkChild.value, [...otherMarks, linkMark]));
        }
      }
    } else if (child.type === 'footnote_ref') {
      result.push(s.node('footnote_ref', { id: child.attrs?.id || '1' }));
    }
  }

  return result;
}
