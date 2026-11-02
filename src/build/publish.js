/**
 * Static site publisher for Vanilla Press.
 *
 * Reads content from SQLite, renders all output formats, and writes to _site/.
 *
 * Usage: node src/build/publish.js
 *
 * @module build/publish
 */

import { mkdirSync, writeFileSync, cpSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { migrate } from '../store/migrate.js';
import { getAllPublished, listCollection, getCollections, getAllTags } from '../store/content.js';
import { getConfig } from '../store/config.js';
import { render as renderHtml } from '../renderers/html.js';
import { render as renderMarkdown } from '../renderers/markdown.js';
import { renderAtom, renderSitemap, renderLlmsTxt } from '../renderers/feed.js';
import { renderDocumentPage, renderCollectionPage, renderHomePage } from './templates.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Default site configuration.
 * @type {import('./templates.js').SiteConfig}
 */
const DEFAULT_SITE = {
  title: 'Vanilla Press',
  url: 'https://example.com',
  description: 'A platform-first content system built on web standards.',
};

/**
 * Publish the site to the output directory.
 * @param {Object} [options]
 * @param {string} [options.dbPath] - Path to SQLite database
 * @param {string} [options.outDir] - Output directory
 * @param {import('./templates.js').SiteConfig} [options.site] - Site config
 * @param {import('better-sqlite3').Database} [options.db] - Pre-opened database (for testing)
 */
export function publish(options = {}) {
  const rootDir = options.rootDir || join(__dirname, '..', '..');
  const dbPath = options.dbPath || join(rootDir, 'content.db');
  const outDir = options.outDir || join(rootDir, '_site');
  const site = { ...DEFAULT_SITE, ...options.site };

  // Open DB (or use provided one)
  const db = options.db || new Database(dbPath);
  if (!options.db) migrate(db);

  const collections = getCollections(db);
  site.collections = collections;

  // Theme is applied via data-theme on <html>; VB ships the styles.
  const themeId = getConfig(db, 'theme');
  site.themeId = themeId && themeId !== 'default' ? themeId : null;

  const allDocs = getAllPublished(db);

  // Clean and create output directory
  if (existsSync(outDir)) {
    rmSync(outDir, { recursive: true });
  }
  mkdirSync(outDir, { recursive: true });

  // --- Home page ---
  write(join(outDir, 'index.html'), renderHomePage(allDocs, site));

  // --- Feeds ---
  write(join(outDir, 'feed.xml'), renderAtom(allDocs, site));
  write(join(outDir, 'sitemap.xml'), renderSitemap(allDocs, site, collections));
  write(join(outDir, 'llms.txt'), renderLlmsTxt(allDocs, site));

  // --- Per-document outputs ---
  for (const doc of allDocs) {
    const m = doc.meta;

    // Page scope: {collection}/{slug}/index.html
    const pageDir = join(outDir, m.collection, m.slug);
    write(join(pageDir, 'index.html'), renderDocumentPage(doc, site));

    // Content scope (fragment): {collection}/{slug}/_fragment.html
    write(join(pageDir, '_fragment.html'), renderHtml(doc, { scope: 'content' }));

    // Markdown: md/{collection}/{slug}/index.md
    const mdDir = join(outDir, 'md', m.collection, m.slug);
    write(join(mdDir, 'index.md'), renderMarkdown(doc));

    // JSON API: api/{collection}/{slug}.json
    const apiDir = join(outDir, 'api', m.collection);
    write(join(apiDir, `${m.slug}.json`), JSON.stringify(doc, null, 2));
  }

  // --- Collection pages ---
  for (const collection of collections) {
    const docs = listCollection(db, collection);

    // Collection index: {collection}/index.html
    write(
      join(outDir, collection, 'index.html'),
      renderCollectionPage(collection, docs, site),
    );

    // Collection cards (no chrome): _collections/{collection}.html
    write(
      join(outDir, '_collections', `${collection}.html`),
      renderHtml(docs, { scope: 'collection' }),
    );

    // Tag-filtered collection pages
    const allTagsForCollection = new Set();
    for (const doc of docs) {
      if (doc.meta.tags) {
        for (const tag of doc.meta.tags) {
          allTagsForCollection.add(tag);
        }
      }
    }
    for (const tag of allTagsForCollection) {
      const filtered = listCollection(db, collection, { tag });
      write(
        join(outDir, '_collections', collection, `tag-${tag}.html`),
        renderHtml(filtered, { scope: 'collection' }),
      );
    }
  }

  // --- Kitchen Sink static pages ---
  const kitchenSinkSource = join(rootDir, 'kitchen-sink');
  const kitchenSinkDest = join(outDir, 'kitchen-sink');
  if (existsSync(kitchenSinkSource)) {
    cpSync(kitchenSinkSource, kitchenSinkDest, { recursive: true });
  }

  // --- Assets ---
  const assetsSource = join(__dirname, 'assets');
  const assetsDest = join(outDir, 'assets');
  if (existsSync(assetsSource)) {
    cpSync(assetsSource, assetsDest, { recursive: true });
  }

  // --- Vanilla Breeze (vendored from node_modules) ---
  const vbSource = join(rootDir, 'node_modules', 'vanilla-breeze', 'dist', 'cdn');
  const vbDest = join(outDir, 'assets', 'vb');
  if (existsSync(vbSource)) {
    cpSync(vbSource, vbDest, { recursive: true });
  }

  // --- @profpowell/code-block (vendored from node_modules) ---
  const cbSource = join(rootDir, 'node_modules', '@profpowell', 'code-block', 'dist');
  const cbDest = join(outDir, 'assets', 'code-block');
  if (existsSync(cbSource)) {
    cpSync(cbSource, cbDest, { recursive: true });
  }

  // --- Media ---
  const mediaSource = join(rootDir, 'media');
  const mediaDest = join(outDir, 'media');
  if (existsSync(mediaSource)) {
    cpSync(mediaSource, mediaDest, { recursive: true });
  }

  // Close DB if we opened it
  if (!options.db) db.close();

  return { outDir, documentCount: allDocs.length, collections };
}

/**
 * Write a file, creating parent directories as needed.
 * @param {string} filePath
 * @param {string} content
 */
function write(filePath, content) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf-8');
}

// --- CLI entry point ---
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = publish();
  console.log(`Published ${result.documentCount} documents to ${result.outDir}`);
  console.log(`Collections: ${result.collections.join(', ')}`);
}
