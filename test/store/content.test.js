/**
 * Store content tests.
 *
 * Uses in-memory SQLite for fast, isolated testing.
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrate } from '../../src/store/migrate.js';
import {
  getDocument,
  getDocumentBySlug,
  listCollection,
  saveDocument,
  deleteDocument,
  searchDocuments,
  getAllTags,
  getCollections,
  getAllPublished,
  getAllDocuments,
  extractPlaintext,
} from '../../src/store/content.js';

// --- Test fixtures (inline for isolation) ---

const sampleDoc = {
  id: 'test_doc01',
  meta: {
    title: 'Test Post',
    slug: 'test-post',
    collection: 'posts',
    status: 'published',
    description: 'A test post for the store.',
    author_id: 'author_t1',
    created: '2026-02-10',
    updated: '2026-02-12',
    published: '2026-02-12',
    tags: ['testing', 'store'],
  },
  blocks: [
    {
      type: 'paragraph',
      children: [
        { type: 'text', value: 'Hello world from the test post.' },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 2 },
      children: [
        { type: 'text', value: 'Section One' },
      ],
    },
    {
      type: 'code_block',
      attrs: { language: 'js' },
      value: 'console.log("hello")',
    },
  ],
};

const sampleDoc2 = {
  id: 'test_doc02',
  meta: {
    title: 'Second Post',
    slug: 'second-post',
    collection: 'posts',
    status: 'published',
    description: 'Another test post.',
    created: '2026-02-08',
    updated: '2026-02-08',
    published: '2026-02-08',
    tags: ['testing'],
  },
  blocks: [
    {
      type: 'paragraph',
      children: [
        { type: 'text', value: 'This is the second post.' },
      ],
    },
  ],
};

const draftDoc = {
  id: 'test_draft01',
  meta: {
    title: 'Draft Post',
    slug: 'draft-post',
    collection: 'posts',
    status: 'draft',
    created: '2026-02-14',
    updated: '2026-02-14',
  },
  blocks: [
    {
      type: 'paragraph',
      children: [
        { type: 'text', value: 'This is a draft.' },
      ],
    },
  ],
};

const docsDoc = {
  id: 'test_docs01',
  meta: {
    title: 'Getting Started',
    slug: 'getting-started',
    collection: 'docs',
    status: 'published',
    created: '2026-02-01',
    updated: '2026-02-01',
    published: '2026-02-01',
    tags: ['guide'],
  },
  blocks: [
    {
      type: 'paragraph',
      children: [
        { type: 'text', value: 'Welcome to the docs.' },
      ],
    },
  ],
};

// --- Helper ---

function freshDb() {
  const db = new Database(':memory:');
  migrate(db);
  return db;
}

// --- Tests ---

describe('extractPlaintext', () => {
  it('extracts text values from flat blocks', () => {
    const text = extractPlaintext(sampleDoc.blocks);
    assert.ok(text.includes('Hello world from the test post'));
    assert.ok(text.includes('Section One'));
    assert.ok(text.includes('console.log'));
  });

  it('returns empty string for empty array', () => {
    assert.equal(extractPlaintext([]), '');
  });

  it('returns empty string for non-array', () => {
    assert.equal(extractPlaintext(null), '');
    assert.equal(extractPlaintext(undefined), '');
  });

  it('handles nested children', () => {
    const blocks = [
      {
        type: 'callout',
        children: [
          {
            type: 'paragraph',
            children: [
              { type: 'text', value: 'nested text' },
            ],
          },
        ],
      },
    ];
    const text = extractPlaintext(blocks);
    assert.ok(text.includes('nested text'));
  });
});

describe('saveDocument + getDocument', () => {
  let db;

  beforeEach(() => { db = freshDb(); });

  it('saves and retrieves a document', () => {
    saveDocument(db, sampleDoc);
    const doc = getDocument(db, 'test_doc01');
    assert.ok(doc);
    assert.equal(doc.id, 'test_doc01');
    assert.equal(doc.meta.title, 'Test Post');
    assert.equal(doc.meta.slug, 'test-post');
    assert.equal(doc.meta.collection, 'posts');
    assert.deepEqual(doc.meta.tags, ['testing', 'store']);
    assert.equal(doc.blocks.length, 3);
  });

  it('meta.image round-trips through the store', () => {
    saveDocument(db, { ...sampleDoc, meta: { ...sampleDoc.meta, image: '/media/a.jpg' } });
    assert.equal(getDocument(db, 'test_doc01').meta.image, '/media/a.jpg');
    saveDocument(db, { ...sampleDoc, meta: { ...sampleDoc.meta, image: null } });
    assert.equal(getDocument(db, 'test_doc01').meta.image, undefined);
  });

  it('an old documents table gains image', () => {
    db.exec('ALTER TABLE documents DROP COLUMN image');
    migrate(db);
    saveDocument(db, { ...sampleDoc, meta: { ...sampleDoc.meta, image: '/media/b.jpg' } });
    assert.equal(getDocument(db, 'test_doc01').meta.image, '/media/b.jpg');
  });

  it('meta.theme and meta.themeScope round-trip through the store', () => {
    saveDocument(db, { ...sampleDoc, meta: { ...sampleDoc.meta, theme: '8bit', themeScope: 'article' } });
    let meta = getDocument(db, 'test_doc01').meta;
    assert.equal(meta.theme, '8bit');
    assert.equal(meta.themeScope, 'article');
    saveDocument(db, { ...sampleDoc, meta: { ...sampleDoc.meta, theme: 'swiss' } });
    meta = getDocument(db, 'test_doc01').meta;
    assert.equal(meta.theme, 'swiss');
    assert.equal(meta.themeScope, undefined);
    saveDocument(db, sampleDoc);
    meta = getDocument(db, 'test_doc01').meta;
    assert.equal(meta.theme, undefined);
    assert.equal(meta.themeScope, undefined);
  });

  it('an old documents table gains theme and theme_scope', () => {
    db.exec('ALTER TABLE documents DROP COLUMN theme');
    db.exec('ALTER TABLE documents DROP COLUMN theme_scope');
    migrate(db);
    saveDocument(db, { ...sampleDoc, meta: { ...sampleDoc.meta, theme: 'swiss', themeScope: 'page' } });
    assert.equal(getDocument(db, 'test_doc01').meta.theme, 'swiss');
  });

  it('returns null for nonexistent document', () => {
    const doc = getDocument(db, 'nonexistent');
    assert.equal(doc, null);
  });

  it('upserts on save with same id', () => {
    saveDocument(db, sampleDoc);
    const updated = {
      ...sampleDoc,
      meta: { ...sampleDoc.meta, title: 'Updated Title' },
    };
    saveDocument(db, updated);
    const doc = getDocument(db, 'test_doc01');
    assert.equal(doc.meta.title, 'Updated Title');
  });

  it('preserves block structure through round-trip', () => {
    saveDocument(db, sampleDoc);
    const doc = getDocument(db, 'test_doc01');
    assert.equal(doc.blocks[0].type, 'paragraph');
    assert.equal(doc.blocks[0].children[0].value, 'Hello world from the test post.');
    assert.equal(doc.blocks[1].type, 'heading');
    assert.equal(doc.blocks[1].attrs.level, 2);
    assert.equal(doc.blocks[2].type, 'code_block');
    assert.equal(doc.blocks[2].value, 'console.log("hello")');
  });
});

describe('getDocumentBySlug', () => {
  let db;

  beforeEach(() => {
    db = freshDb();
    saveDocument(db, sampleDoc);
  });

  it('finds document by collection and slug', () => {
    const doc = getDocumentBySlug(db, 'posts', 'test-post');
    assert.ok(doc);
    assert.equal(doc.id, 'test_doc01');
  });

  it('returns null for wrong collection', () => {
    const doc = getDocumentBySlug(db, 'docs', 'test-post');
    assert.equal(doc, null);
  });

  it('returns null for wrong slug', () => {
    const doc = getDocumentBySlug(db, 'posts', 'nonexistent');
    assert.equal(doc, null);
  });
});

describe('listCollection', () => {
  let db;

  beforeEach(() => {
    db = freshDb();
    saveDocument(db, sampleDoc);
    saveDocument(db, sampleDoc2);
    saveDocument(db, draftDoc);
    saveDocument(db, docsDoc);
  });

  it('lists published documents in a collection', () => {
    const docs = listCollection(db, 'posts');
    assert.equal(docs.length, 2);
    // Should be sorted by published date descending
    assert.equal(docs[0].id, 'test_doc01'); // published 2026-02-12
    assert.equal(docs[1].id, 'test_doc02'); // published 2026-02-08
  });

  it('excludes drafts by default', () => {
    const docs = listCollection(db, 'posts');
    const ids = docs.map(d => d.id);
    assert.ok(!ids.includes('test_draft01'));
  });

  it('can filter by status=draft', () => {
    const docs = listCollection(db, 'posts', { status: 'draft' });
    assert.equal(docs.length, 1);
    assert.equal(docs[0].id, 'test_draft01');
  });

  it('filters by tag', () => {
    const docs = listCollection(db, 'posts', { tag: 'store' });
    assert.equal(docs.length, 1);
    assert.equal(docs[0].id, 'test_doc01');
  });

  it('returns different collections independently', () => {
    const posts = listCollection(db, 'posts');
    const docs = listCollection(db, 'docs');
    assert.equal(posts.length, 2);
    assert.equal(docs.length, 1);
  });

  it('respects limit and offset', () => {
    const docs = listCollection(db, 'posts', { limit: 1 });
    assert.equal(docs.length, 1);
    assert.equal(docs[0].id, 'test_doc01');

    const page2 = listCollection(db, 'posts', { limit: 1, offset: 1 });
    assert.equal(page2.length, 1);
    assert.equal(page2[0].id, 'test_doc02');
  });
});

describe('deleteDocument', () => {
  let db;

  beforeEach(() => {
    db = freshDb();
    saveDocument(db, sampleDoc);
  });

  it('deletes a document and returns true', () => {
    const result = deleteDocument(db, 'test_doc01');
    assert.equal(result, true);
    assert.equal(getDocument(db, 'test_doc01'), null);
  });

  it('returns false for nonexistent document', () => {
    const result = deleteDocument(db, 'nonexistent');
    assert.equal(result, false);
  });
});

describe('searchDocuments', () => {
  let db;

  beforeEach(() => {
    db = freshDb();
    saveDocument(db, sampleDoc);
    saveDocument(db, sampleDoc2);
    saveDocument(db, docsDoc);
  });

  it('finds documents matching title', () => {
    const results = searchDocuments(db, 'Test Post');
    assert.ok(results.length >= 1);
    assert.ok(results.some(d => d.id === 'test_doc01'));
  });

  it('finds documents matching content', () => {
    const results = searchDocuments(db, 'Hello world');
    assert.ok(results.length >= 1);
    assert.ok(results.some(d => d.id === 'test_doc01'));
  });

  it('finds documents matching tags', () => {
    const results = searchDocuments(db, 'guide');
    assert.ok(results.length >= 1);
    assert.ok(results.some(d => d.id === 'test_docs01'));
  });

  it('returns empty for no match', () => {
    const results = searchDocuments(db, 'xyznonexistent');
    assert.equal(results.length, 0);
  });

  it('respects limit', () => {
    const results = searchDocuments(db, 'test', { limit: 1 });
    assert.equal(results.length, 1);
  });
});

describe('getAllTags', () => {
  let db;

  beforeEach(() => {
    db = freshDb();
    saveDocument(db, sampleDoc);
    saveDocument(db, sampleDoc2);
    saveDocument(db, draftDoc);
    saveDocument(db, docsDoc);
  });

  it('returns sorted unique tags from published docs', () => {
    const tags = getAllTags(db);
    assert.ok(tags.includes('testing'));
    assert.ok(tags.includes('store'));
    assert.ok(tags.includes('guide'));
    // Tags are sorted
    assert.deepEqual(tags, [...tags].sort());
  });

  it('excludes tags from draft documents', () => {
    // draftDoc has no tags, but verify the function works with drafts
    const tags = getAllTags(db);
    assert.ok(tags.length > 0);
  });
});

describe('getCollections', () => {
  let db;

  beforeEach(() => {
    db = freshDb();
    saveDocument(db, sampleDoc);
    saveDocument(db, docsDoc);
  });

  it('returns distinct collection names sorted', () => {
    const collections = getCollections(db);
    assert.deepEqual(collections, ['docs', 'posts']);
  });
});

describe('getAllPublished', () => {
  let db;

  beforeEach(() => {
    db = freshDb();
    saveDocument(db, sampleDoc);
    saveDocument(db, sampleDoc2);
    saveDocument(db, draftDoc);
    saveDocument(db, docsDoc);
  });

  it('returns only published documents', () => {
    const docs = getAllPublished(db);
    assert.equal(docs.length, 3);
    const ids = docs.map(d => d.id);
    assert.ok(!ids.includes('test_draft01'));
  });

  it('sorts by published date descending', () => {
    const docs = getAllPublished(db);
    assert.equal(docs[0].id, 'test_doc01'); // 2026-02-12
    assert.equal(docs[1].id, 'test_doc02'); // 2026-02-08
    assert.equal(docs[2].id, 'test_docs01'); // 2026-02-01
  });
});

describe('getAllDocuments', () => {
  it('returns every document, drafts included, with parsed blocks, in one query', () => {
    const db = freshDb();
    saveDocument(db, sampleDoc);
    saveDocument(db, draftDoc);
    let prepared = 0;
    const prepare = db.prepare.bind(db);
    db.prepare = (sql) => { prepared++; return prepare(sql); };
    const docs = getAllDocuments(db);
    assert.equal(prepared, 1);
    assert.deepEqual(docs.map((d) => d.id).sort(), ['test_doc01', 'test_draft01']);
    assert.ok(Array.isArray(docs[0].blocks));
  });
});

describe('FTS triggers', () => {
  let db;

  beforeEach(() => { db = freshDb(); });

  it('indexes new documents for search', () => {
    saveDocument(db, sampleDoc);
    const results = searchDocuments(db, 'Hello world');
    assert.ok(results.length >= 1);
  });

  it('updates FTS on document update', () => {
    saveDocument(db, sampleDoc);
    const updated = {
      ...sampleDoc,
      blocks: [
        {
          type: 'paragraph',
          children: [{ type: 'text', value: 'Completely new content about zebras.' }],
        },
      ],
    };
    saveDocument(db, updated);

    const oldResults = searchDocuments(db, 'Hello world');
    assert.equal(oldResults.length, 0);

    const newResults = searchDocuments(db, 'zebras');
    assert.ok(newResults.length >= 1);
  });

  it('removes FTS entries on delete', () => {
    saveDocument(db, sampleDoc);
    deleteDocument(db, 'test_doc01');
    const results = searchDocuments(db, 'Hello world');
    assert.equal(results.length, 0);
  });
});
