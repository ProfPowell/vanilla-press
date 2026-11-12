/**
 * HTML renderer for Vanilla Press documents.
 *
 * Pure function: AST → HTML string. Supports five rendering scopes:
 * page, content, block, collection, meta.
 *
 * @module renderers/html
 */

import { createHash } from 'node:crypto';
import { isSafeComponentTag, isSafeAttrName } from '../schema/component-names.js';
import { escapeHtml, escapeAttr, formatDate } from './shared.js';
import { creditParts } from '../media/credit.js';

/**
 * Render a document (or array of docs) to HTML.
 * @param {Object|Object[]} doc - Document or array of documents (for collection scope)
 * @param {Object} [options]
 * @param {string} [options.scope='content'] - Rendering scope: page, content, block, collection, meta
 * @param {Object} [options.site] - Site metadata for page scope (title, css, js)
 * @returns {string}
 */
export function render(doc, options = {}) {
  const { scope = 'content', site = {}, bare = false } = options;

  switch (scope) {
    case 'block':
      return renderBlock(doc);
    case 'content':
      return renderContent(doc, { bare });
    case 'meta':
      return renderMeta(doc);
    case 'collection':
      return renderCollection(doc);
    case 'page':
      return renderPage(doc, site);
    default:
      return renderContent(doc, { bare });
  }
}

/**
 * A paragraph with no text: no children, or only empty text nodes.
 * @param {Object} block
 * @returns {boolean}
 */
const isEmptyParagraph = (block) => !!block && block.type === 'paragraph'
  && (block.children || []).every((c) => c && c.type === 'text' && !c.value);

/**
 * The document's regions as slot templates for Cook's layouts: one
 * `<template slot="name">` per non-empty region (sorted by name; a region of
 * only empty paragraphs counts as empty), holding the
 * bare content render of its blocks, joined by newlines. '' without regions.
 * @param {Object} doc
 * @returns {string}
 */
export function renderRegions(doc) {
  const regions = doc && doc.regions && typeof doc.regions === 'object' && !Array.isArray(doc.regions) ? doc.regions : {};
  return Object.keys(regions).sort()
    .filter((name) => Array.isArray(regions[name]) && !regions[name].every(isEmptyParagraph))
    .map((name) => `<template slot="${escapeAttr(name)}">${renderContent({ ...doc, blocks: regions[name] }, { bare: true })}</template>`)
    .join('\n');
}

// --- Scope renderers ---

/**
 * Render content scope: article wrapping rendered blocks. With { bare: true },
 * returns just the joined blocks so the caller can supply its own article wrapper.
 * @param {Object} doc
 * @param {Object} [options]
 * @param {boolean} [options.bare]
 * @returns {string}
 */
function renderContent(doc, options = {}) {
  const blocks = (doc.blocks || []).map(renderBlock).join('\n');
  if (options.bare) return blocks;
  return `<article data-layout="stack" data-layout-gap="m" data-doc="${escapeAttr(doc.id)}">\n${blocks}\n</article>`;
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
    const href = `/${m.collection}/${m.slug}/`;
    const parts = [`<article data-layout="stack" data-layout-gap="xs">`];
    parts.push(`<h3><a href="${escapeAttr(href)}">${escapeHtml(m.title)}</a></h3>`);
    if (m.published || m.created) {
      parts.push(`<p><small><time datetime="${escapeAttr(m.published || m.created)}">${formatDate(m.published || m.created)}</time></small></p>`);
    }
    if (m.description) {
      parts.push(`<p>${escapeHtml(m.description)}</p>`);
    }
    parts.push(`</article>`);
    return parts.join('\n');
  });
  return `<div data-layout="grid" data-layout-min="20rem" data-layout-gap="l">\n${cards.join('\n')}\n</div>`;
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
    case 'component':    return renderComponentBlock(block);
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
  const { src, alt, variant, credit } = block.attrs || {};
  const creditHtml = renderCredit(credit);
  let caption = (block.children || []).map(renderBlock).join('');
  if (creditHtml) {
    // The credit follows the writer's caption, inside the same figcaption
    const text = (block.children || []).map((c) => renderInline(c.children)).join('');
    caption = `<figcaption>${text ? `${text} ` : ''}${creditHtml}</figcaption>`;
  }
  const captionLine = caption ? `${caption}\n` : '';
  const cls = variant && variant !== 'default' ? ` class="${escapeAttr(variant)}"` : '';
  return `<figure${cls}>\n<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}"/>\n${captionLine}</figure>`;
}

/**
 * A figure's credit line: `<small class="credit">` with its text and links,
 * or '' when there's no credit to show.
 * @param {unknown} credit
 * @returns {string}
 */
export function renderCredit(credit) {
  const parts = creditParts(credit);
  if (!parts.length) return '';
  const inner = parts.map((part) => (part.href
    ? `<a href="${escapeAttr(part.href)}" rel="noopener">${escapeHtml(part.text)}</a>`
    : escapeHtml(part.text))).join('');
  return `<small class="credit">${inner}</small>`;
}

function renderFigcaption(block) {
  return `<figcaption>${renderInline(block.children)}</figcaption>`;
}

function renderEmbed(block) {
  const { url, type } = block.attrs || {};
  if (type === 'video') {
    const ytId = extractYouTubeId(url);
    if (ytId) {
      return `<youtube-player video-id="${escapeAttr(ytId)}"></youtube-player>`;
    }
    // Self-hosted video: wrap native <video> per VB's video-player static fallback.
    return `<video-player>\n<video controls>\n<source src="${escapeAttr(url)}"/>\n<p>Your browser does not support video. <a href="${escapeAttr(url)}">Download</a>.</p>\n</video>\n</video-player>`;
  }
  if (type === 'audio') {
    const u = escapeAttr(url);
    return `<audio-player>\n<audio controls src="${u}">\n<p>Your browser does not support audio. <a href="${u}">Download</a>.</p>\n</audio>\n</audio-player>`;
  }
  // codepen, observable, twitter, etc — VB's social-embed auto-detects provider.
  return `<social-embed url="${escapeAttr(url)}"></social-embed>`;
}

function extractYouTubeId(url) {
  if (!url) return null;
  // youtu.be/<id>, youtube.com/watch?v=<id>, youtube.com/embed/<id>, youtube.com/shorts/<id>
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
  return m ? m[1] : null;
}

function renderCodeBlock(block) {
  const { language, filename } = block.attrs || {};
  const langAttr = language ? ` language="${escapeAttr(language)}"` : '';
  const labelAttr = filename ? ` label="${escapeAttr(filename)}"` : '';
  return `<code-block${langAttr}${labelAttr}>${escapeHtml(block.value || '')}</code-block>`;
}

const CALLOUT_VARIANT_MAP = {
  note:    'info',
  tip:     'success',
  warning: 'warning',
  danger:  'error',
};

function renderCallout(block) {
  const variant = block.attrs?.variant || 'note';
  const vbVariant = CALLOUT_VARIANT_MAP[variant] || 'info';
  const inner = (block.children || []).map(renderBlock).join('\n');
  return `<status-message data-variant="${escapeAttr(vbVariant)}">\n<div data-content>\n${inner}\n</div>\n</status-message>`;
}

function renderCollapsible(block) {
  const summary = block.attrs?.summary || '';
  const inner = (block.children || []).map(renderBlock).join('\n');
  return `<details>\n<summary>${escapeHtml(summary)}</summary>\n${inner}\n</details>`;
}

function renderCard(block) {
  const href = block.attrs?.href || '';
  const inner = (block.children || []).map(renderBlock).join('\n');
  const card = `<layout-card data-variant="elevated">\n<section>\n${inner}\n</section>\n</layout-card>`;
  if (href) {
    return `<a href="${escapeAttr(href)}" class="card-link">\n${card}\n</a>`;
  }
  return card;
}

function renderTabs(block) {
  const tabs = block.children || [];
  // Deterministic group name: hash of the labels plus the tab count.
  const labels = tabs.map((tab, i) => tab.attrs?.label || `Tab ${i + 1}`);
  const hash = createHash('sha1').update(`${labels.join('\u0000')}\u0000${tabs.length}`).digest('hex').slice(0, 6);
  const groupName = `ts-${hash}`;
  const parts = ['<tab-set>'];

  tabs.forEach((tab, i) => {
    const label = tab.attrs?.label || `Tab ${i + 1}`;
    const open = i === 0 ? ' open' : '';
    const inner = (tab.children || []).map(renderBlock).join('\n');
    parts.push(`<details name="${groupName}"${open}>`);
    parts.push(`<summary>${escapeHtml(label)}</summary>`);
    parts.push(`<div>\n${inner}\n</div>`);
    parts.push(`</details>`);
  });

  parts.push('</tab-set>');
  return parts.join('\n');
}

function renderSteps(block) {
  const steps = (block.children || []).map(renderBlock).join('\n');
  return `<ol class="steps">\n${steps}\n</ol>`;
}

function renderStep(block) {
  const title = block.attrs?.title || '';
  const inner = (block.children || []).map(renderBlock).join('\n');
  const titleHtml = title ? `<strong class="step-title">${escapeHtml(title)}</strong>\n` : '';
  return `<li>\n${titleHtml}${inner}\n</li>`;
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

// --- Component rendering ---

/**
 * Serialize component attrs in name order: true -> bare, false -> omitted.
 * @param {Object} [attrs]
 * @returns {string}
 */
function renderComponentAttrs(attrs) {
  return Object.keys(attrs || {}).filter(isSafeAttrName).sort().map(name => {
    const v = attrs[name];
    if (v === true) return ` ${name}`;
    if (v === false) return '';
    return ` ${name}="${escapeAttr(String(v))}"`;
  }).join('');
}

/**
 * Render a block-position component node. Exported so the markdown renderer
 * can emit the same raw HTML.
 * @param {Object} block - { tag, attrs, value?, wrap?, children? }
 * @returns {string}
 */
export function renderComponentBlock(block) {
  const { tag } = block;
  if (!isSafeComponentTag(tag)) return '';
  let inner = '';
  if (Array.isArray(block.children) && block.children.length) {
    inner = block.children.map(renderBlock).join('\n');
  } else if (typeof block.value === 'string') {
    const v = block.value;
    switch (block.wrap || 'text') {
      case 'template': inner = `<template>${escapeHtml(v)}</template>`; break;
      case 'script':   inner = `<script type="text/plain">${v.replace(/<\/script/gi, '<\\/script')}</script>`; break;
      default:         inner = escapeHtml(v);
    }
  }
  return `<${tag}${renderComponentAttrs(block.attrs)}>${inner}</${tag}>`;
}

/**
 * Render an inline-position component node.
 * @param {Object} node - { tag, attrs, children }
 * @returns {string}
 */
export function renderComponentInline(node) {
  if (!isSafeComponentTag(node.tag)) return renderInline(node.children);
  return `<${node.tag}${renderComponentAttrs(node.attrs)}>${renderInline(node.children)}</${node.tag}>`;
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
    case 'component':
      return renderComponentInline(node);
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
