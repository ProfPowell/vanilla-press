/**
 * Feed renderer tests.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderAtom, renderSitemap, renderLlmsTxt } from '../../src/renderers/feed.js';

const site = {
  title: 'Test Site',
  url: 'https://example.com',
  description: 'A test site for feed rendering.',
};

const docs = [
  {
    id: 'doc1',
    meta: {
      title: 'First Post',
      slug: 'first-post',
      collection: 'posts',
      status: 'published',
      description: 'The very first post.',
      created: '2026-02-10',
      updated: '2026-02-12',
      published: '2026-02-12',
      tags: ['intro'],
    },
    blocks: [
      { type: 'paragraph', children: [{ type: 'text', value: 'Hello world.' }] },
    ],
  },
  {
    id: 'doc2',
    meta: {
      title: 'Second Post',
      slug: 'second-post',
      collection: 'posts',
      status: 'published',
      created: '2026-02-08',
      updated: '2026-02-08',
      published: '2026-02-08',
    },
    blocks: [
      { type: 'paragraph', children: [{ type: 'text', value: 'Second content.' }] },
    ],
  },
  {
    id: 'doc3',
    meta: {
      title: 'About Page',
      slug: 'about',
      collection: 'pages',
      status: 'published',
      description: 'About us.',
      created: '2026-02-01',
      updated: '2026-02-01',
      published: '2026-02-01',
    },
    blocks: [
      { type: 'paragraph', children: [{ type: 'text', value: 'About text.' }] },
    ],
  },
];

// --- Atom ---

describe('renderAtom', () => {
  it('produces valid Atom XML', () => {
    const xml = renderAtom(docs, site);
    assert.ok(xml.startsWith('<?xml version="1.0"'));
    assert.ok(xml.includes('<feed xmlns="http://www.w3.org/2005/Atom">'));
    assert.ok(xml.includes('</feed>'));
  });

  it('includes site title and links', () => {
    const xml = renderAtom(docs, site);
    assert.ok(xml.includes('<title>Test Site</title>'));
    assert.ok(xml.includes('href="https://example.com/"'));
    assert.ok(xml.includes('href="https://example.com/feed.xml"'));
  });

  it('includes site description as subtitle', () => {
    const xml = renderAtom(docs, site);
    assert.ok(xml.includes('<subtitle>A test site for feed rendering.</subtitle>'));
  });

  it('includes entries for each document', () => {
    const xml = renderAtom(docs, site);
    assert.ok(xml.includes('<title>First Post</title>'));
    assert.ok(xml.includes('<title>Second Post</title>'));
    assert.ok(xml.includes('<title>About Page</title>'));
  });

  it('builds correct entry URLs', () => {
    const xml = renderAtom(docs, site);
    assert.ok(xml.includes('href="https://example.com/posts/first-post/"'));
    assert.ok(xml.includes('href="https://example.com/pages/about/"'));
  });

  it('includes entry summaries when present', () => {
    const xml = renderAtom(docs, site);
    assert.ok(xml.includes('<summary>The very first post.</summary>'));
    // Second post has no description
    assert.ok(!xml.includes('<summary>undefined</summary>'));
  });

  it('uses first doc published date as feed updated', () => {
    const xml = renderAtom(docs, site);
    assert.ok(xml.includes('<updated>2026-02-12</updated>'));
  });

  it('handles empty document list', () => {
    const xml = renderAtom([], site);
    assert.ok(xml.includes('<feed'));
    assert.ok(!xml.includes('<entry>'));
  });

  it('omits subtitle when no description', () => {
    const xml = renderAtom(docs, { title: 'No Desc', url: 'https://x.com' });
    assert.ok(!xml.includes('<subtitle>'));
  });
});

// --- Sitemap ---

describe('renderSitemap', () => {
  it('produces valid sitemap XML', () => {
    const xml = renderSitemap(docs, site, ['posts', 'pages']);
    assert.ok(xml.startsWith('<?xml version="1.0"'));
    assert.ok(xml.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'));
    assert.ok(xml.includes('</urlset>'));
  });

  it('includes home page', () => {
    const xml = renderSitemap(docs, site);
    assert.ok(xml.includes('<loc>https://example.com/</loc>'));
    assert.ok(xml.includes('<priority>1.0</priority>'));
  });

  it('includes collection index pages', () => {
    const xml = renderSitemap(docs, site, ['posts', 'pages']);
    assert.ok(xml.includes('<loc>https://example.com/posts/</loc>'));
    assert.ok(xml.includes('<loc>https://example.com/pages/</loc>'));
  });

  it('includes document URLs', () => {
    const xml = renderSitemap(docs, site);
    assert.ok(xml.includes('<loc>https://example.com/posts/first-post/</loc>'));
    assert.ok(xml.includes('<loc>https://example.com/pages/about/</loc>'));
  });

  it('includes lastmod from updated date', () => {
    const xml = renderSitemap(docs, site);
    assert.ok(xml.includes('<lastmod>2026-02-12</lastmod>'));
  });

  it('works with empty docs', () => {
    const xml = renderSitemap([], site);
    assert.ok(xml.includes('<loc>https://example.com/</loc>'));
  });
});

// --- llms.txt ---

describe('renderLlmsTxt', () => {
  it('includes site title as heading', () => {
    const txt = renderLlmsTxt(docs, site);
    assert.ok(txt.startsWith('# Test Site'));
  });

  it('includes site description', () => {
    const txt = renderLlmsTxt(docs, site);
    assert.ok(txt.includes('> A test site for feed rendering.'));
  });

  it('groups documents by collection', () => {
    const txt = renderLlmsTxt(docs, site);
    assert.ok(txt.includes('## posts'));
    assert.ok(txt.includes('## pages'));
  });

  it('includes markdown-format links to each document', () => {
    const txt = renderLlmsTxt(docs, site);
    assert.ok(txt.includes('[First Post](https://example.com/md/posts/first-post/)'));
    assert.ok(txt.includes('[About Page](https://example.com/md/pages/about/)'));
  });

  it('appends description when present', () => {
    const txt = renderLlmsTxt(docs, site);
    assert.ok(txt.includes(': The very first post.'));
    assert.ok(txt.includes(': About us.'));
  });

  it('handles empty docs', () => {
    const txt = renderLlmsTxt([], site);
    assert.ok(txt.includes('# Test Site'));
  });

  it('omits description line when not provided', () => {
    const txt = renderLlmsTxt(docs, { title: 'No Desc', url: 'https://x.com' });
    assert.ok(!txt.includes('> '));
  });
});
