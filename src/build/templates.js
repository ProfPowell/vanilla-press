/**
 * Page templates for the static publisher.
 *
 * Idiomatic Vanilla Breeze. Chrome uses VB's canonical patterns:
 *   <header class="site"> with brand + nav inside (flex row, space-between)
 *   <footer class="site"> for muted, padded site footer
 *   <nav class="horizontal pills"> with aria-current on the active section
 *   <main data-layout="center" data-layout-max="prose"> for article reading width
 *
 * VB ships its own reset/tokens/typography/components/themes — VanillaPress
 * loads only vanilla-breeze.css and the @profpowell/code-block module. No
 * project-local stylesheet competes with VB's cascade.
 *
 * Themes apply via data-theme on <html>; mode override via data-mode.
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
 * @property {string|null} [themeId] - VB data-theme value, or null for default
 */

const VB_CSS = '/assets/vb/vanilla-breeze.css';
const VB_JS = '/assets/vb/vanilla-breeze.js';
const CODE_BLOCK_JS = '/assets/code-block/code-block.js';

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
  const blocks = renderHtml(doc, { scope: 'content', bare: true });

  return `<!doctype html>
<html${htmlAttrs(site)}>
<head>
${headCommon()}
<title>${pageTitle}</title>
<link rel="canonical" href="${escapeAttr(canonical)}"/>
<link rel="alternate" type="text/markdown" href="${escapeAttr(site.url)}/md/${m.collection}/${m.slug}/"/>
<link rel="alternate" type="application/json" href="${escapeAttr(site.url)}/api/${m.collection}/${m.slug}.json"/>
${m.description ? `<meta name="description" content="${escapeAttr(m.description)}"/>\n` : ''}<meta property="og:title" content="${escapeAttr(m.title)}"/>
<meta property="og:url" content="${escapeAttr(canonical)}"/>
<meta property="og:type" content="article"/>
${m.description ? `<meta property="og:description" content="${escapeAttr(m.description)}"/>\n` : ''}</head>
<body data-page-layout="article">
${siteHeader(site, m.collection)}
<main data-layout="center" data-layout-max="prose" data-layout-gap="m">
<article data-layout="stack" data-layout-gap="m" data-doc="${escapeAttr(doc.id)}">
<header data-layout="stack" data-layout-gap="xs">
<h1>${escapeHtml(m.title)}</h1>
${m.published ? `<p><small>By ${escapeHtml(site.author?.name || site.title)} · <time datetime="${escapeAttr(m.published)}">${formatDate(m.published)}</time></small></p>\n` : ''}${tagsNav(m)}</header>
${blocks}
</article>
</main>
${siteFooter(site)}
${scriptTags()}
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
${headCommon()}
<title>${pageTitle}</title>
<link rel="canonical" href="${escapeAttr(site.url)}/${escapeAttr(collection)}/"/>
</head>
<body data-page-layout="stack">
${siteHeader(site, collection)}
<main data-layout="center" data-layout-max="wide" data-layout-gap="l">
<header class="page">
<h1>${capitalize(collection)}</h1>
</header>
${cards}
</main>
${siteFooter(site)}
${scriptTags()}
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
${headCommon()}
<title>${escapeHtml(site.title)}</title>
${site.description ? `<meta name="description" content="${escapeAttr(site.description)}"/>\n` : ''}<link rel="canonical" href="${escapeAttr(site.url)}/"/>
<link rel="alternate" type="application/atom+xml" title="${escapeAttr(site.title)}" href="${escapeAttr(site.url)}/feed.xml"/>
</head>
<body data-page-layout="stack">
${siteHeader(site, null)}
<main data-layout="center" data-layout-max="wide" data-layout-gap="l">
<header class="page centered">
<h1>${escapeHtml(site.title)}</h1>
${site.description ? `<p class="lead">${escapeHtml(site.description)}</p>\n` : ''}</header>
<h2>Recent</h2>
${cards}
</main>
${siteFooter(site)}
${scriptTags()}
</body>
</html>`;
}

// --- Helpers ---

function headCommon() {
  return `<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<link rel="stylesheet" href="${VB_CSS}"/>`;
}

function htmlAttrs(site) {
  if (site.themeId) return ` lang="en" data-theme="${escapeAttr(site.themeId)}"`;
  return ' lang="en"';
}

function scriptTags() {
  return `<script type="module" src="${VB_JS}"></script>
<script type="module" src="${CODE_BLOCK_JS}"></script>`;
}

function siteHeader(site, currentCollection) {
  return `<header class="site">
<strong><a href="/">${escapeHtml(site.title)}</a></strong>
${siteNav(site, currentCollection)}
</header>`;
}

function siteNav(site, currentCollection) {
  const collections = site.collections || [];
  const items = collections.map(c => {
    const current = c === currentCollection ? ' aria-current="page"' : '';
    return `<li><a href="/${escapeAttr(c)}/"${current}>${capitalize(c)}</a></li>`;
  }).join('\n');

  return `<nav class="horizontal pills" aria-label="Primary">
<ul>
${items}
</ul>
</nav>`;
}

function siteFooter(site) {
  return `<footer class="site">
<p><small>&copy; ${new Date().getFullYear()} ${escapeHtml(site.title)} · <a href="/feed.xml">Feed</a> · <a href="/sitemap.xml">Sitemap</a></small></p>
</footer>`;
}

function tagsNav(m) {
  if (!m.tags || !m.tags.length) return '';
  const links = m.tags.map(t =>
    `<a href="/${escapeAttr(m.collection)}/tag-${escapeAttr(t)}/"><layout-badge data-variant="info">${escapeHtml(t)}</layout-badge></a>`
  ).join('\n');
  return `<nav data-layout="cluster" data-layout-gap="xs" aria-label="Tags">
${links}
</nav>\n`;
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
