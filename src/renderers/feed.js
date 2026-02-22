/**
 * Feed renderers for Vanilla Press.
 *
 * Pure functions: documents → Atom XML, Sitemap XML, llms.txt
 *
 * @module renderers/feed
 */

import { escapeHtml } from './shared.js';
import { render as renderMarkdown } from './markdown.js';

/**
 * Render an Atom feed from a list of documents.
 * @param {Object[]} docs - Array of documents (should be published, sorted by date)
 * @param {Object} site - Site metadata
 * @param {string} site.title - Site title
 * @param {string} site.url - Site base URL (e.g., https://example.com)
 * @param {string} [site.description] - Site description
 * @returns {string} Atom XML
 */
export function renderAtom(docs, site) {
  const updated = docs.length > 0
    ? (docs[0].meta.published || docs[0].meta.updated || docs[0].meta.created)
    : new Date().toISOString();

  const entries = docs.map(doc => {
    const m = doc.meta;
    const url = `${site.url}/${m.collection}/${m.slug}/`;
    const entryDate = m.published || m.updated || m.created;

    return `  <entry>
    <title>${escapeHtml(m.title)}</title>
    <link href="${escapeHtml(url)}" rel="alternate"/>
    <id>${escapeHtml(url)}</id>
    <updated>${escapeHtml(entryDate)}</updated>${m.description ? `\n    <summary>${escapeHtml(m.description)}</summary>` : ''}
  </entry>`;
  });

  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${escapeHtml(site.title)}</title>
  <link href="${escapeHtml(site.url)}/" rel="alternate"/>
  <link href="${escapeHtml(site.url)}/feed.xml" rel="self"/>
  <id>${escapeHtml(site.url)}/</id>
  <updated>${escapeHtml(updated)}</updated>${site.description ? `\n  <subtitle>${escapeHtml(site.description)}</subtitle>` : ''}
${entries.join('\n')}
</feed>
`;
}

/**
 * Render a sitemap from a list of documents.
 * @param {Object[]} docs - Array of published documents
 * @param {Object} site
 * @param {string} site.url - Site base URL
 * @param {string[]} [collections] - Collection names for collection index pages
 * @returns {string} Sitemap XML
 */
export function renderSitemap(docs, site, collections = []) {
  const urls = [];

  // Home page
  urls.push(sitemapUrl(`${site.url}/`, undefined, '1.0'));

  // Collection index pages
  for (const col of collections) {
    urls.push(sitemapUrl(`${site.url}/${col}/`, undefined, '0.7'));
  }

  // Individual documents
  for (const doc of docs) {
    const m = doc.meta;
    const lastmod = m.updated || m.published || m.created;
    urls.push(sitemapUrl(`${site.url}/${m.collection}/${m.slug}/`, lastmod, '0.8'));
  }

  return `<?xml version="1.0" encoding="utf-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>
`;
}

/**
 * @param {string} loc
 * @param {string} [lastmod]
 * @param {string} [priority]
 * @returns {string}
 */
function sitemapUrl(loc, lastmod, priority) {
  let xml = `  <url>\n    <loc>${escapeHtml(loc)}</loc>`;
  if (lastmod) xml += `\n    <lastmod>${escapeHtml(lastmod)}</lastmod>`;
  if (priority) xml += `\n    <priority>${priority}</priority>`;
  xml += '\n  </url>';
  return xml;
}

/**
 * Render llms.txt — a plaintext manifest for LLM agents.
 * Lists all published content with title, URL, and description.
 * @param {Object[]} docs - Array of published documents
 * @param {Object} site
 * @param {string} site.title - Site title
 * @param {string} site.url - Site base URL
 * @param {string} [site.description]
 * @returns {string}
 */
export function renderLlmsTxt(docs, site) {
  const lines = [];
  lines.push(`# ${site.title}`);
  if (site.description) {
    lines.push(`> ${site.description}`);
  }
  lines.push('');

  // Group by collection
  const grouped = {};
  for (const doc of docs) {
    const col = doc.meta.collection;
    if (!grouped[col]) grouped[col] = [];
    grouped[col].push(doc);
  }

  for (const [collection, collectionDocs] of Object.entries(grouped)) {
    lines.push(`## ${collection}`);
    lines.push('');
    for (const doc of collectionDocs) {
      const m = doc.meta;
      const url = `${site.url}/md/${m.collection}/${m.slug}/`;
      lines.push(`- [${m.title}](${url})${m.description ? ': ' + m.description : ''}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
