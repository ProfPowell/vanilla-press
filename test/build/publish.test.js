/**
 * Publisher integration tests.
 *
 * Seeds a temp in-memory DB, publishes to a temp directory,
 * and verifies the output file tree.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { migrate } from '../../src/store/migrate.js';
import { saveDocument } from '../../src/store/content.js';
import { publish } from '../../src/build/publish.js';

// --- Test data ---

const fixtures = [
  {
    id: 'pub_post01',
    meta: {
      title: 'First Post',
      slug: 'first-post',
      collection: 'posts',
      status: 'published',
      description: 'The first post.',
      created: '2026-02-10',
      updated: '2026-02-12',
      published: '2026-02-12',
      tags: ['intro', 'test'],
    },
    blocks: [
      { type: 'paragraph', children: [{ type: 'text', value: 'Hello from the first post.' }] },
    ],
  },
  {
    id: 'pub_post02',
    meta: {
      title: 'Second Post',
      slug: 'second-post',
      collection: 'posts',
      status: 'published',
      created: '2026-02-08',
      updated: '2026-02-08',
      published: '2026-02-08',
      tags: ['test'],
    },
    blocks: [
      { type: 'paragraph', children: [{ type: 'text', value: 'Hello from the second post.' }] },
    ],
  },
  {
    id: 'pub_doc01',
    meta: {
      title: 'Getting Started',
      slug: 'getting-started',
      collection: 'docs',
      status: 'published',
      description: 'Quick start guide.',
      created: '2026-02-01',
      updated: '2026-02-01',
      published: '2026-02-01',
      tags: ['guide'],
    },
    blocks: [
      { type: 'paragraph', children: [{ type: 'text', value: 'Welcome to the docs.' }] },
    ],
  },
  {
    id: 'pub_page01',
    meta: {
      title: 'About',
      slug: 'about',
      collection: 'pages',
      status: 'published',
      description: 'About this site.',
      created: '2026-02-01',
      updated: '2026-02-01',
      published: '2026-02-01',
    },
    blocks: [
      { type: 'paragraph', children: [{ type: 'text', value: 'About us.' }] },
    ],
  },
];

const site = {
  title: 'Test Site',
  url: 'https://test.example.com',
  description: 'A test site.',
};

let db;
let outDir;
let result;

describe('publish', () => {
  before(() => {
    db = new Database(':memory:');
    migrate(db);
    for (const doc of fixtures) {
      saveDocument(db, doc);
    }

    outDir = mkdtempSync(join(tmpdir(), 'vp-publish-'));
    result = publish({ db, outDir, site });
  });

  after(() => {
    db.close();
    rmSync(outDir, { recursive: true, force: true });
  });

  // --- Result ---

  it('returns document count', () => {
    assert.equal(result.documentCount, 4);
  });

  it('returns collections', () => {
    assert.deepEqual(result.collections, ['docs', 'pages', 'posts']);
  });

  // --- Home page ---

  it('creates index.html', () => {
    assert.ok(existsSync(join(outDir, 'index.html')));
  });

  it('home page contains site title', () => {
    const html = readFileSync(join(outDir, 'index.html'), 'utf-8');
    assert.ok(html.includes('Test Site'));
  });

  // --- Feeds ---

  it('creates feed.xml', () => {
    assert.ok(existsSync(join(outDir, 'feed.xml')));
    const xml = readFileSync(join(outDir, 'feed.xml'), 'utf-8');
    assert.ok(xml.includes('<feed'));
    assert.ok(xml.includes('First Post'));
  });

  it('creates sitemap.xml', () => {
    assert.ok(existsSync(join(outDir, 'sitemap.xml')));
    const xml = readFileSync(join(outDir, 'sitemap.xml'), 'utf-8');
    assert.ok(xml.includes('<urlset'));
    assert.ok(xml.includes('posts/first-post'));
  });

  it('creates llms.txt', () => {
    assert.ok(existsSync(join(outDir, 'llms.txt')));
    const txt = readFileSync(join(outDir, 'llms.txt'), 'utf-8');
    assert.ok(txt.includes('# Test Site'));
    assert.ok(txt.includes('First Post'));
  });

  // --- Document pages ---

  it('creates page scope HTML for each document', () => {
    assert.ok(existsSync(join(outDir, 'posts', 'first-post', 'index.html')));
    assert.ok(existsSync(join(outDir, 'posts', 'second-post', 'index.html')));
    assert.ok(existsSync(join(outDir, 'docs', 'getting-started', 'index.html')));
    assert.ok(existsSync(join(outDir, 'pages', 'about', 'index.html')));
  });

  it('document page includes canonical URL', () => {
    const html = readFileSync(join(outDir, 'posts', 'first-post', 'index.html'), 'utf-8');
    assert.ok(html.includes('rel="canonical"'));
    assert.ok(html.includes('posts/first-post'));
  });

  it('document page includes alternate format links', () => {
    const html = readFileSync(join(outDir, 'posts', 'first-post', 'index.html'), 'utf-8');
    assert.ok(html.includes('type="text/markdown"'));
    assert.ok(html.includes('type="application/json"'));
  });

  it('document page includes Open Graph tags', () => {
    const html = readFileSync(join(outDir, 'posts', 'first-post', 'index.html'), 'utf-8');
    assert.ok(html.includes('og:title'));
    assert.ok(html.includes('og:url'));
  });

  it('document page includes tag links', () => {
    const html = readFileSync(join(outDir, 'posts', 'first-post', 'index.html'), 'utf-8');
    assert.ok(html.includes('tag-intro'));
    assert.ok(html.includes('tag-test'));
  });

  // --- Content fragments ---

  it('creates content-scope fragment for each document', () => {
    assert.ok(existsSync(join(outDir, 'posts', 'first-post', '_fragment.html')));
    const html = readFileSync(join(outDir, 'posts', 'first-post', '_fragment.html'), 'utf-8');
    assert.ok(html.includes('<article'));
    assert.ok(html.includes('Hello from the first post.'));
    // Fragment should NOT have <!doctype>
    assert.ok(!html.includes('<!doctype'));
  });

  // --- Markdown ---

  it('creates markdown for each document', () => {
    assert.ok(existsSync(join(outDir, 'md', 'posts', 'first-post', 'index.md')));
    const md = readFileSync(join(outDir, 'md', 'posts', 'first-post', 'index.md'), 'utf-8');
    assert.ok(md.includes('---'));
    assert.ok(md.includes('title: "First Post"'));
    assert.ok(md.includes('Hello from the first post.'));
  });

  // --- JSON API ---

  it('creates JSON for each document', () => {
    const jsonPath = join(outDir, 'api', 'posts', 'first-post.json');
    assert.ok(existsSync(jsonPath));
    const data = JSON.parse(readFileSync(jsonPath, 'utf-8'));
    assert.equal(data.id, 'pub_post01');
    assert.equal(data.meta.title, 'First Post');
    assert.ok(Array.isArray(data.blocks));
  });

  // --- Collection pages ---

  it('creates collection index pages', () => {
    assert.ok(existsSync(join(outDir, 'posts', 'index.html')));
    assert.ok(existsSync(join(outDir, 'docs', 'index.html')));
    assert.ok(existsSync(join(outDir, 'pages', 'index.html')));
  });

  it('collection page includes document titles', () => {
    const html = readFileSync(join(outDir, 'posts', 'index.html'), 'utf-8');
    assert.ok(html.includes('First Post'));
    assert.ok(html.includes('Second Post'));
  });

  // --- Collection card fragments ---

  it('creates bare collection card fragments', () => {
    assert.ok(existsSync(join(outDir, '_collections', 'posts.html')));
    const html = readFileSync(join(outDir, '_collections', 'posts.html'), 'utf-8');
    assert.ok(html.includes('data-layout="grid"'));
    assert.ok(html.includes('<article data-layout="stack"'));
    assert.ok(!html.includes('<!doctype'));
  });

  // --- Tag-filtered collections ---

  it('creates tag-filtered collection fragments', () => {
    assert.ok(existsSync(join(outDir, '_collections', 'posts', 'tag-intro.html')));
    assert.ok(existsSync(join(outDir, '_collections', 'posts', 'tag-test.html')));
  });

  it('tag-filtered fragment only contains matching docs', () => {
    const html = readFileSync(join(outDir, '_collections', 'posts', 'tag-intro.html'), 'utf-8');
    assert.ok(html.includes('First Post'));
    assert.ok(!html.includes('Second Post'));
  });

  // --- Assets ---

  it('vendors Vanilla Breeze CSS and JS into /assets/vb/', () => {
    assert.ok(existsSync(join(outDir, 'assets', 'vb', 'vanilla-breeze.css')));
    assert.ok(existsSync(join(outDir, 'assets', 'vb', 'vanilla-breeze.js')));
  });

  it('vendors @profpowell/code-block JS into /assets/code-block/', () => {
    assert.ok(existsSync(join(outDir, 'assets', 'code-block', 'code-block.js')));
  });
});
