/**
 * Page templates for the static publisher.
 *
 * These produce richer page-scope HTML than the generic html.js renderPage,
 * including canonical URLs, alternate format links, Open Graph, and CSS/JS refs.
 *
 * @module build/templates
 */

import { escapeHtml, escapeAttr, formatDate } from '../renderers/shared.js';
import { render as renderHtml } from '../renderers/html.js';

/**
 * @typedef {Object} SiteConfig
 * @property {string} title
 * @property {string} url
 * @property {string} [description]
 * @property {string[]} [collections]
 */

/**
 * Render a full document page (page scope).
 * @param {Object} doc
 * @param {SiteConfig} site
 * @returns {string}
 */
export function renderDocumentPage(doc, site) {
  const m = doc.meta;
  const pageTitle = `${escapeHtml(m.title)} — ${escapeHtml(site.title)}`;
  const canonical = `${site.url}/${m.collection}/${m.slug}/`;
  const content = renderHtml(doc, { scope: 'content' });

  return `<!doctype html>
<html${htmlAttrs(site)}>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${pageTitle}</title>
<link rel="canonical" href="${escapeAttr(canonical)}"/>
<link rel="alternate" type="text/markdown" href="${escapeAttr(site.url)}/md/${m.collection}/${m.slug}/"/>
<link rel="alternate" type="application/json" href="${escapeAttr(site.url)}/api/${m.collection}/${m.slug}.json"/>
${m.description ? `<meta name="description" content="${escapeAttr(m.description)}"/>` : ''}
<meta property="og:title" content="${escapeAttr(m.title)}"/>
<meta property="og:url" content="${escapeAttr(canonical)}"/>
<meta property="og:type" content="article"/>
${m.description ? `<meta property="og:description" content="${escapeAttr(m.description)}"/>` : ''}
<link rel="stylesheet" href="/assets/css/main.css"/>${themeLink(site)}
</head>
<body>
${siteHeader(site)}
<main>
<header class="doc-header">
<h1>${escapeHtml(m.title)}</h1>
${m.published ? `<time datetime="${escapeAttr(m.published)}">${formatDate(m.published)}</time>` : ''}
${m.tags && m.tags.length ? `<div class="tag-list">${m.tags.map(t => `<a href="/${m.collection}/tag-${escapeAttr(t)}/" class="tag">${escapeHtml(t)}</a>`).join(' ')}</div>` : ''}
</header>
${content}
</main>
${siteFooter(site)}
<script src="/assets/js/main.js" type="module"></script>
</body>
</html>`;
}

/**
 * Render a collection index page.
 * @param {string} collection - Collection name
 * @param {Object[]} docs - Documents in the collection
 * @param {SiteConfig} site
 * @returns {string}
 */
export function renderCollectionPage(collection, docs, site) {
  const pageTitle = `${capitalize(collection)} — ${escapeHtml(site.title)}`;
  const cards = renderHtml(docs, { scope: 'collection' });

  return `<!doctype html>
<html${htmlAttrs(site)}>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${pageTitle}</title>
<link rel="canonical" href="${escapeAttr(site.url)}/${escapeAttr(collection)}/"/>
<link rel="stylesheet" href="/assets/css/main.css"/>${themeLink(site)}
</head>
<body>
${siteHeader(site)}
<main>
<h1>${capitalize(collection)}</h1>
${cards}
</main>
${siteFooter(site)}
<script src="/assets/js/main.js" type="module"></script>
</body>
</html>`;
}

/**
 * Render the home page.
 * @param {Object[]} recentDocs - Recent published documents
 * @param {SiteConfig} site
 * @returns {string}
 */
export function renderHomePage(recentDocs, site) {
  const cards = renderHtml(recentDocs, { scope: 'collection' });

  return `<!doctype html>
<html${htmlAttrs(site)}>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(site.title)}</title>
${site.description ? `<meta name="description" content="${escapeAttr(site.description)}"/>` : ''}
<link rel="canonical" href="${escapeAttr(site.url)}/"/>
<link rel="alternate" type="application/atom+xml" title="${escapeAttr(site.title)}" href="${escapeAttr(site.url)}/feed.xml"/>
<link rel="stylesheet" href="/assets/css/main.css"/>${themeLink(site)}
</head>
<body>
${siteHeader(site)}
<main>
<h1>${escapeHtml(site.title)}</h1>
${site.description ? `<p class="site-description">${escapeHtml(site.description)}</p>` : ''}
<h2>Recent</h2>
${cards}
</main>
${siteFooter(site)}
<script src="/assets/js/main.js" type="module"></script>
</body>
</html>`;
}

// --- Helpers ---

function themeLink(site) {
  if (!site.themeFile) return '';
  return `\n<link rel="stylesheet" href="/assets/css/themes/${escapeAttr(site.themeFile)}"/>\n<link rel="stylesheet" href="/assets/css/themes/_bridge.css"/>`;
}

function htmlAttrs(site) {
  if (site.themeId) return ` lang="en" data-theme="${escapeAttr(site.themeId)}"`;
  return ' lang="en"';
}

// --- Shared chrome ---

function siteHeader(site) {
  const collections = site.collections || [];
  const nav = collections.map(c =>
    `<a href="/${escapeAttr(c)}/">${capitalize(c)}</a>`
  ).join('\n');

  return `<header class="site-header">
<nav>
<a href="/" class="site-title">${escapeHtml(site.title)}</a>
${nav}
</nav>
</header>`;
}

function siteFooter(site) {
  return `<footer class="site-footer">
<p>&copy; ${new Date().getFullYear()} ${escapeHtml(site.title)}</p>
</footer>`;
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
