/**
 * Markdown renderer for Vanilla Press documents.
 *
 * Pure function: AST → markdown string with YAML frontmatter.
 * Always renders at content scope.
 *
 * @module renderers/markdown
 */

import { renderComponentBlock, renderComponentInline } from './html.js';

/**
 * Render a document to markdown with YAML frontmatter.
 * @param {Object} doc
 * @returns {string}
 */
export function render(doc) {
  const frontmatter = renderFrontmatter(doc.meta || {});
  const body = (doc.blocks || []).map(b => renderBlock(b, 0)).join('\n\n');
  return `${frontmatter}\n${body}\n`;
}

// --- Frontmatter ---

/**
 * Render YAML frontmatter from document metadata.
 * @param {Object} meta
 * @returns {string}
 */
function renderFrontmatter(meta) {
  const lines = ['---'];

  if (meta.title) lines.push(`title: "${escapeFmString(meta.title)}"`);
  if (meta.slug) lines.push(`slug: ${meta.slug}`);
  if (meta.collection) lines.push(`collection: ${meta.collection}`);
  if (meta.status) lines.push(`status: ${meta.status}`);
  if (meta.description) lines.push(`description: "${escapeFmString(meta.description)}"`);
  if (meta.author_id) lines.push(`author: ${meta.author_id}`);
  if (meta.published) lines.push(`date: ${meta.published}`);
  else if (meta.created) lines.push(`date: ${meta.created}`);
  if (meta.tags && meta.tags.length) {
    lines.push(`tags:`);
    for (const tag of meta.tags) {
      lines.push(`  - ${tag}`);
    }
  }

  lines.push('---');
  return lines.join('\n');
}

/**
 * Escape a string for YAML double-quoted value.
 * @param {string} str
 * @returns {string}
 */
function escapeFmString(str) {
  return (str || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// --- Block renderers ---

/**
 * Render a block to markdown.
 * @param {Object} block
 * @param {number} depth - nesting depth (for blockquote prefixing)
 * @returns {string}
 */
function renderBlock(block, depth = 0) {
  if (!block || !block.type) return '';

  switch (block.type) {
    case 'paragraph':    return renderParagraph(block);
    case 'heading':      return renderHeading(block);
    case 'blockquote':   return renderBlockquote(block, depth);
    case 'list':         return renderList(block, depth);
    case 'hr':           return block.attrs?.variant === 'decorative' ? '* * *' : '---';
    case 'figure':       return renderFigure(block);
    case 'code_block':   return renderCodeBlock(block);
    case 'callout':      return renderCallout(block, depth);
    case 'collapsible':  return renderCollapsible(block);
    case 'card':         return renderCard(block);
    case 'tabs':         return renderTabsBlock(block);
    case 'steps':        return renderStepsBlock(block);
    case 'table':        return renderTableBlock(block);
    case 'definition_list': return renderDefinitionListBlock(block);
    case 'embed':        return renderEmbed(block);
    case 'component':    return renderComponentBlock(block); // raw HTML is valid Markdown
    default:
      if (block.children) {
        return block.children.map(b => renderBlock(b, depth)).join('\n\n');
      }
      return '';
  }
}

function renderParagraph(block) {
  return renderInline(block.children);
}

function renderHeading(block) {
  const level = block.attrs?.level || 2;
  const hashes = '#'.repeat(level);
  return `${hashes} ${renderInline(block.children)}`;
}

function renderBlockquote(block, depth) {
  const inner = (block.children || []).map(b => renderBlock(b, depth + 1)).join('\n\n');
  return prefixLines(inner, '> ');
}

function renderList(block, depth) {
  const ordered = block.attrs?.ordered;
  return (block.children || []).map((item, i) => {
    const prefix = ordered ? `${i + 1}. ` : '- ';
    const inner = (item.children || []).map(b => renderBlock(b, depth)).join('\n\n');
    const lines = inner.split('\n');
    const indented = lines.map((line, li) => li === 0 ? `${prefix}${line}` : `${' '.repeat(prefix.length)}${line}`).join('\n');
    return indented;
  }).join('\n');
}

function renderFigure(block) {
  const { src, alt } = block.attrs || {};
  let out = `![${alt || ''}](${src || ''})`;
  const captions = (block.children || []).filter(c => c.type === 'figcaption');
  if (captions.length) {
    const captionText = renderInline(captions[0].children);
    out += `\n\n*${captionText}*`;
  }
  return out;
}

function renderCodeBlock(block) {
  const { language, filename } = block.attrs || {};
  const lang = language || '';
  const filenameComment = filename ? ` ${filename}` : '';
  return '```' + lang + filenameComment + '\n' + (block.value || '') + '\n```';
}

function renderCallout(block, depth) {
  const variant = block.attrs?.variant || 'note';
  const label = variant.charAt(0).toUpperCase() + variant.slice(1);
  const inner = (block.children || []).map(b => renderBlock(b, depth + 1)).join('\n\n');
  return prefixLines(`**${label}:** ${inner}`, '> ');
}

function renderCollapsible(block) {
  const summary = block.attrs?.summary || '';
  const inner = (block.children || []).map(b => renderBlock(b, 0)).join('\n\n');
  return `**${summary}**\n\n${inner}`;
}

function renderCard(block) {
  const href = block.attrs?.href || '';
  // Extract title from first heading child
  const headingChild = (block.children || []).find(c => c.type === 'heading');
  const title = headingChild ? renderInline(headingChild.children) : '';
  const rest = (block.children || []).filter(c => c !== headingChild).map(b => renderBlock(b, 0)).join('\n\n');
  let out = `### [${title}](${href})`;
  if (rest) out += `\n\n${rest}`;
  return out;
}

function renderTabsBlock(block) {
  return (block.children || []).map(tab => {
    const label = tab.attrs?.label || 'Tab';
    const inner = (tab.children || []).map(b => renderBlock(b, 0)).join('\n\n');
    return `### ${label}\n\n${inner}`;
  }).join('\n\n');
}

function renderStepsBlock(block) {
  return (block.children || []).map((step, i) => {
    const title = step.attrs?.title || '';
    const inner = (step.children || []).map(b => renderBlock(b, 0)).join('\n\n');
    return `${i + 1}. **${title}**\n\n${indent(inner, '   ')}`;
  }).join('\n\n');
}

function renderTableBlock(block) {
  const rows = block.children || [];
  if (rows.length === 0) return '';

  const processedRows = rows.map(row => {
    return (row.children || []).map(cell => {
      const text = renderInline(cell.children).replace(/\|/g, '\\|');
      return text;
    });
  });

  // Determine column count and alignments from the first row
  const firstRow = rows[0];
  const colCount = (firstRow.children || []).length;
  const isHeaderRow = (firstRow.children || []).every(c => c.type === 'table_header');

  const lines = [];

  if (isHeaderRow) {
    lines.push('| ' + processedRows[0].join(' | ') + ' |');
    // Alignment row
    const aligns = (firstRow.children || []).map(cell => {
      const align = cell.attrs?.align;
      if (align === 'center') return ':---:';
      if (align === 'right') return '---:';
      return '---';
    });
    lines.push('| ' + aligns.join(' | ') + ' |');
    // Data rows
    for (let i = 1; i < processedRows.length; i++) {
      const padded = processedRows[i];
      while (padded.length < colCount) padded.push('');
      lines.push('| ' + padded.join(' | ') + ' |');
    }
  } else {
    // No header row: add empty header + separator
    const emptyHeader = new Array(colCount).fill('').join(' | ');
    lines.push('| ' + emptyHeader + ' |');
    lines.push('| ' + new Array(colCount).fill('---').join(' | ') + ' |');
    for (const row of processedRows) {
      const padded = row;
      while (padded.length < colCount) padded.push('');
      lines.push('| ' + padded.join(' | ') + ' |');
    }
  }

  return lines.join('\n');
}

function renderDefinitionListBlock(block) {
  const children = block.children || [];
  const parts = [];
  for (const child of children) {
    if (child.type === 'definition_term') {
      parts.push(`**${renderInline(child.children)}**`);
    } else if (child.type === 'definition_desc') {
      const inner = (child.children || []).map(b => renderBlock(b, 0)).join('\n\n');
      parts.push(`: ${inner}`);
    }
  }
  return parts.join('\n');
}

function renderEmbed(block) {
  const { url, type } = block.attrs || {};
  return `[${type || 'embed'}: ${url}](${url})`;
}

// --- Inline rendering ---

/**
 * Render inline nodes to markdown.
 * @param {Object[]} children
 * @returns {string}
 */
function renderInline(children) {
  if (!children || !children.length) return '';
  return children.map(renderInlineNode).join('');
}

function renderInlineNode(node) {
  if (!node) return '';

  switch (node.type) {
    case 'text':
      return renderTextNode(node);
    case 'link':
      return renderLinkNode(node);
    case 'footnote_ref':
      return `[^${node.attrs?.id || ''}]`;
    case 'component':
      return renderComponentInline(node);
    default:
      return '';
  }
}

function renderTextNode(node) {
  let text = node.value || '';
  if (node.marks && node.marks.length) {
    for (const mark of node.marks) {
      switch (mark) {
        case 'strong':        text = `**${text}**`; break;
        case 'em':            text = `*${text}*`; break;
        case 'code':          text = `\`${text}\``; break;
        case 'strikethrough': text = `~~${text}~~`; break;
        case 'mark':          text = `==${text}==`; break;
        case 'kbd':           text = `<kbd>${text}</kbd>`; break;
        case 'sub':           text = `<sub>${text}</sub>`; break;
        case 'sup':           text = `<sup>${text}</sup>`; break;
      }
    }
  }
  return text;
}

function renderLinkNode(node) {
  const { href, title } = node.attrs || {};
  const inner = renderInline(node.children);
  const titlePart = title ? ` "${title}"` : '';
  return `[${inner}](${href}${titlePart})`;
}

// --- Helpers ---

/**
 * Prefix every line of a string with a given prefix.
 * @param {string} str
 * @param {string} prefix
 * @returns {string}
 */
function prefixLines(str, prefix) {
  return str.split('\n').map(line => `${prefix}${line}`).join('\n');
}

/**
 * Indent every line of a string (except empty lines).
 * @param {string} str
 * @param {string} spaces
 * @returns {string}
 */
function indent(str, spaces) {
  return str.split('\n').map(line => line ? `${spaces}${line}` : line).join('\n');
}
