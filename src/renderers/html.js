/**
 * HTML renderer for Vanilla Press documents.
 *
 * Pure function: AST → HTML string. Supports five rendering scopes:
 * page, content, block, collection, meta.
 *
 * @module renderers/html
 */

import { escapeHtml, escapeAttr, formatDate } from './shared.js';

/**
 * Render a document (or array of docs) to HTML.
 * @param {Object|Object[]} doc - Document or array of documents (for collection scope)
 * @param {Object} [options]
 * @param {string} [options.scope='content'] - Rendering scope: page, content, block, collection, meta
 * @param {Object} [options.site] - Site metadata for page scope (title, css, js)
 * @returns {string}
 */
export function render(doc, options = {}) {
  const { scope = 'content', site = {} } = options;

  switch (scope) {
    case 'block':
      return renderBlock(doc);
    case 'content':
      return renderContent(doc);
    case 'meta':
      return renderMeta(doc);
    case 'collection':
      return renderCollection(doc);
    case 'page':
      return renderPage(doc, site);
    default:
      return renderContent(doc);
  }
}

// --- Scope renderers ---

/**
 * Render content scope: article wrapping rendered blocks.
 * @param {Object} doc
 * @returns {string}
 */
function renderContent(doc) {
  const blocks = (doc.blocks || []).map(renderBlock).join('\n');
  return `<article data-doc="${escapeAttr(doc.id)}">\n${blocks}\n</article>`;
}

/**
 * Render meta scope: metadata header.
 * @param {Object} doc
 * @returns {string}
 */
function renderMeta(doc) {
  const m = doc.meta || {};
  const parts = [];
  parts.push(`<header data-doc-meta>`);
  parts.push(`<h1>${escapeHtml(m.title)}</h1>`);
  if (m.description) {
    parts.push(`<p>${escapeHtml(m.description)}</p>`);
  }
  if (m.tags && m.tags.length) {
    const tags = m.tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join(' ');
    parts.push(`<div class="tags">${tags}</div>`);
  }
  if (m.published || m.created) {
    parts.push(`<time datetime="${escapeAttr(m.published || m.created)}">${formatDate(m.published || m.created)}</time>`);
  }
  parts.push(`</header>`);
  return parts.join('\n');
}

/**
 * Render collection scope: array of docs as card list.
 * @param {Object|Object[]} docs
 * @returns {string}
 */
function renderCollection(docs) {
  const list = Array.isArray(docs) ? docs : [docs];
  const cards = list.map(doc => {
    const m = doc.meta || {};
    const href = `/${m.collection}/${m.slug}`;
    const parts = [];
    parts.push(`<content-card href="${escapeAttr(href)}">`);
    parts.push(`<h3>${escapeHtml(m.title)}</h3>`);
    if (m.description) {
      parts.push(`<p>${escapeHtml(m.description)}</p>`);
    }
    if (m.published || m.created) {
      parts.push(`<time datetime="${escapeAttr(m.published || m.created)}">${formatDate(m.published || m.created)}</time>`);
    }
    parts.push(`</content-card>`);
    return parts.join('\n');
  });
  return `<div data-collection>\n${cards.join('\n')}\n</div>`;
}

/**
 * Render page scope: full HTML document.
 * @param {Object} doc
 * @param {Object} site
 * @returns {string}
 */
function renderPage(doc, site) {
  const m = doc.meta || {};
  const title = m.title ? `${escapeHtml(m.title)} — ${escapeHtml(site.title || 'Vanilla Press')}` : escapeHtml(site.title || 'Vanilla Press');
  const cssLink = site.css ? `<link rel="stylesheet" href="${escapeAttr(site.css)}"/>` : '';
  const jsTag = site.js ? `<script src="${escapeAttr(site.js)}" type="module"></script>` : '';
  const description = m.description ? `<meta name="description" content="${escapeAttr(m.description)}"/>` : '';

  const content = renderContent(doc);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title}</title>
${description}
${cssLink}
</head>
<body>
<header class="site-header">
<nav><a href="/">${escapeHtml(site.title || 'Vanilla Press')}</a></nav>
</header>
<main>
${content}
</main>
<footer class="site-footer">
<p>&copy; ${new Date().getFullYear()} ${escapeHtml(site.title || 'Vanilla Press')}</p>
</footer>
${jsTag}
</body>
</html>`;
}

// --- Block renderers ---

/**
 * Render a single block to HTML.
 * @param {Object} block
 * @returns {string}
 */
function renderBlock(block) {
  if (!block || !block.type) return '';

  switch (block.type) {
    case 'paragraph':    return renderParagraph(block);
    case 'heading':      return renderHeading(block);
    case 'blockquote':   return renderBlockquote(block);
    case 'list':         return renderList(block);
    case 'list_item':    return renderListItem(block);
    case 'hr':           return renderHr(block);
    case 'figure':       return renderFigure(block);
    case 'figcaption':   return renderFigcaption(block);
    case 'embed':        return renderEmbed(block);
    case 'code_block':   return renderCodeBlock(block);
    case 'callout':      return renderCallout(block);
    case 'collapsible':  return renderCollapsible(block);
    case 'card':         return renderCard(block);
    case 'tabs':         return renderTabs(block);
    case 'steps':        return renderSteps(block);
    case 'step':         return renderStep(block);
    case 'table':        return renderTable(block);
    case 'table_row':    return renderTableRow(block);
    case 'table_header': return renderTableHeader(block);
    case 'table_cell':   return renderTableCell(block);
    case 'definition_list': return renderDefinitionList(block);
    case 'definition_term': return renderDefinitionTerm(block);
    case 'definition_desc': return renderDefinitionDesc(block);
    default:
      // Unknown block: render children if present
      if (block.children) {
        return block.children.map(renderBlock).join('\n');
      }
      return '';
  }
}

function renderParagraph(block) {
  return `<p>${renderInline(block.children)}</p>`;
}

function renderHeading(block) {
  const level = block.attrs?.level || 2;
  return `<h${level}>${renderInline(block.children)}</h${level}>`;
}

function renderBlockquote(block) {
  const inner = (block.children || []).map(renderBlock).join('\n');
  return `<blockquote>\n${inner}\n</blockquote>`;
}

function renderList(block) {
  const tag = block.attrs?.ordered ? 'ol' : 'ul';
  const items = (block.children || []).map(renderBlock).join('\n');
  return `<${tag}>\n${items}\n</${tag}>`;
}

function renderListItem(block) {
  const inner = (block.children || []).map(renderBlock).join('\n');
  return `<li>${inner}</li>`;
}

function renderHr(block) {
  const variant = block.attrs?.variant;
  if (variant === 'decorative') return '<hr class="decorative"/>';
  return '<hr/>';
}

function renderFigure(block) {
  const { src, alt, variant } = block.attrs || {};
  const caption = (block.children || []).map(renderBlock).join('');
  const cls = variant && variant !== 'default' ? ` class="${escapeAttr(variant)}"` : '';
  return `<figure${cls}>\n<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}"/>\n${caption}\n</figure>`;
}

function renderFigcaption(block) {
  return `<figcaption>${renderInline(block.children)}</figcaption>`;
}

function renderEmbed(block) {
  const { url, type } = block.attrs || {};
  return `<div data-embed data-url="${escapeAttr(url)}" data-type="${escapeAttr(type)}"></div>`;
}

function renderCodeBlock(block) {
  const { language, filename } = block.attrs || {};
  const langAttr = language ? ` data-language="${escapeAttr(language)}"` : '';
  const fileAttr = filename ? ` data-filename="${escapeAttr(filename)}"` : '';
  return `<code-block${langAttr}${fileAttr}><pre><code>${escapeHtml(block.value || '')}</code></pre></code-block>`;
}

function renderCallout(block) {
  const variant = block.attrs?.variant || 'note';
  const inner = (block.children || []).map(renderBlock).join('\n');
  return `<ui-callout data-variant="${escapeAttr(variant)}">\n${inner}\n</ui-callout>`;
}

function renderCollapsible(block) {
  const summary = block.attrs?.summary || '';
  const inner = (block.children || []).map(renderBlock).join('\n');
  return `<details>\n<summary>${escapeHtml(summary)}</summary>\n${inner}\n</details>`;
}

function renderCard(block) {
  const href = block.attrs?.href || '';
  const inner = (block.children || []).map(renderBlock).join('\n');
  const hrefAttr = href ? ` href="${escapeAttr(href)}"` : '';
  return `<content-card${hrefAttr}>\n${inner}\n</content-card>`;
}

function renderTabs(block) {
  const tabs = block.children || [];
  const groupId = `tabs-${Math.random().toString(36).slice(2, 8)}`;
  const parts = [];
  parts.push(`<ui-tabs>`);

  tabs.forEach((tab, i) => {
    const label = tab.attrs?.label || `Tab ${i + 1}`;
    const tabId = `${groupId}-${i}`;
    const checked = i === 0 ? ' checked' : '';
    parts.push(`<input type="radio" name="${groupId}" id="${tabId}"${checked}/>`);
    parts.push(`<label for="${tabId}">${escapeHtml(label)}</label>`);
    const inner = (tab.children || []).map(renderBlock).join('\n');
    parts.push(`<div class="tab-panel">\n${inner}\n</div>`);
  });

  parts.push(`</ui-tabs>`);
  return parts.join('\n');
}

function renderSteps(block) {
  const steps = (block.children || []).map(renderBlock).join('\n');
  return `<ol data-steps>\n${steps}\n</ol>`;
}

function renderStep(block) {
  const title = block.attrs?.title || '';
  const inner = (block.children || []).map(renderBlock).join('\n');
  return `<li data-step-title="${escapeAttr(title)}">\n${inner}\n</li>`;
}

function renderTable(block) {
  const { striped, bordered, compact, caption } = block.attrs || {};
  const classes = [];
  if (striped) classes.push('striped');
  if (bordered) classes.push('bordered');
  if (compact) classes.push('compact');
  const cls = classes.length ? ` class="${classes.join(' ')}"` : '';
  const rows = (block.children || []).map(renderBlock).join('\n');
  const captionTag = caption ? `<caption>${escapeHtml(caption)}</caption>\n` : '';
  return `<table${cls}>\n${captionTag}${rows}\n</table>`;
}

function renderTableRow(block) {
  const cells = (block.children || []).map(renderBlock).join('\n');
  return `<tr>\n${cells}\n</tr>`;
}

function renderTableHeader(block) {
  const align = block.attrs?.align;
  const alignAttr = align ? ` data-align="${escapeAttr(align)}"` : '';
  return `<th${alignAttr}>${renderInline(block.children)}</th>`;
}

function renderTableCell(block) {
  const { align, numeric } = block.attrs || {};
  const attrs = [];
  if (align) attrs.push(`data-align="${escapeAttr(align)}"`);
  if (numeric) attrs.push('data-numeric');
  const attrStr = attrs.length ? ' ' + attrs.join(' ') : '';
  return `<td${attrStr}>${renderInline(block.children)}</td>`;
}

function renderDefinitionList(block) {
  const items = (block.children || []).map(renderBlock).join('\n');
  return `<dl>\n${items}\n</dl>`;
}

function renderDefinitionTerm(block) {
  return `<dt>${renderInline(block.children)}</dt>`;
}

function renderDefinitionDesc(block) {
  const inner = (block.children || []).map(renderBlock).join('\n');
  return `<dd>${inner}</dd>`;
}

// --- Inline rendering ---

/**
 * Render an array of inline nodes to HTML.
 * @param {Object[]} children
 * @returns {string}
 */
function renderInline(children) {
  if (!children || !children.length) return '';
  return children.map(renderInlineNode).join('');
}

/**
 * Render a single inline node.
 * @param {Object} node
 * @returns {string}
 */
function renderInlineNode(node) {
  if (!node) return '';

  switch (node.type) {
    case 'text':
      return renderTextNode(node);
    case 'link':
      return renderLinkNode(node);
    case 'footnote_ref':
      return renderFootnoteRef(node);
    default:
      return '';
  }
}

function renderTextNode(node) {
  let text = escapeHtml(node.value || '');
  if (node.marks && node.marks.length) {
    for (const mark of node.marks) {
      switch (mark) {
        case 'strong':        text = `<strong>${text}</strong>`; break;
        case 'em':            text = `<em>${text}</em>`; break;
        case 'code':          text = `<code>${text}</code>`; break;
        case 'strikethrough': text = `<s>${text}</s>`; break;
        case 'mark':          text = `<mark>${text}</mark>`; break;
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
  const titleAttr = title ? ` title="${escapeAttr(title)}"` : '';
  const inner = renderInline(node.children);
  return `<a href="${escapeAttr(href)}"${titleAttr}>${inner}</a>`;
}

function renderFootnoteRef(node) {
  const id = node.attrs?.id || '';
  return `<sup><a href="#fn-${escapeAttr(id)}" id="fnref-${escapeAttr(id)}">[${escapeHtml(id)}]</a></sup>`;
}
