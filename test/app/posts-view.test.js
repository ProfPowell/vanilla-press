import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterPosts, filterCounts, rowModel, emptyText } from '../../app/assets/js/posts-view.js';
import { formatDate } from '../../app/assets/js/app-api.js';

const doc = (id, meta) => ({ id, meta: { collection: 'posts', status: 'draft', ...meta } });
const docs = [
  doc('a', { title: 'Alpha', description: 'First one', status: 'published', published: '2026-01-01T00:00:00Z', updated: '2026-06-01T00:00:00Z' }),
  doc('b', { title: 'Beta', status: 'published', published: '2026-03-01T00:00:00Z' }),
  doc('c', { title: 'Gamma draft', description: 'About ALPHA things', updated: '2026-02-01T00:00:00Z' }),
  doc('d', { title: 'A page', collection: 'pages', status: 'published' }),
];
const ids = (list) => list.map((d) => d.id);

test('filterPosts: posts only, newest first by published else updated', () => {
  assert.deepEqual(ids(filterPosts(docs, { filter: 'all', query: '' })), ['b', 'c', 'a']);
});

test('filterPosts: status filters', () => {
  assert.deepEqual(ids(filterPosts(docs, { filter: 'published', query: '' })), ['b', 'a']);
  assert.deepEqual(ids(filterPosts(docs, { filter: 'drafts', query: '' })), ['c']);
});

test('filterPosts: query matches title or description, case-insensitive, trimmed', () => {
  assert.deepEqual(ids(filterPosts(docs, { filter: 'all', query: '  alpha ' })), ['c', 'a']);
  assert.deepEqual(ids(filterPosts(docs, { filter: 'drafts', query: 'alpha' })), ['c']);
  assert.deepEqual(ids(filterPosts(docs, { filter: 'all', query: 'zzz' })), []);
});

test('filterCounts counts posts only', () => {
  assert.deepEqual(filterCounts(docs), { all: 3, published: 2, drafts: 1 });
  assert.deepEqual(filterCounts([]), { all: 0, published: 0, drafts: 0 });
});

test('rowModel: full post', () => {
  const m = rowModel(docs[0].meta ? { ...docs[0], meta: { ...docs[0].meta, slug: 'alpha' } } : docs[0]);
  assert.deepEqual(m, {
    title: 'Alpha', description: 'First one', descriptionMissing: false, path: '/posts/alpha',
    statusText: 'Published', date: formatDate('2026-01-01T00:00:00Z'),
  });
});

test('rowModel: fallbacks', () => {
  const m = rowModel(doc('x', { slug: 'x-1', title: '', description: '  ', created: '2026-02-01T00:00:00Z' }));
  assert.equal(m.title, 'Untitled');
  assert.equal(m.description, 'No description');
  assert.equal(m.descriptionMissing, true);
  assert.equal(m.statusText, 'Draft');
  assert.equal(m.path, '/posts/x-1');
  assert.equal(m.date, formatDate('2026-02-01T00:00:00Z'));
});

test('emptyText', () => {
  assert.equal(emptyText('all', 'cats'), 'No posts match "cats".');
  assert.equal(emptyText('drafts', ' cats '), 'No posts match "cats".');
  assert.equal(emptyText('all', ''), 'No posts yet. Start a new post.');
  assert.equal(emptyText('published', ''), 'Nothing published yet.');
  assert.equal(emptyText('drafts', '  '), 'No drafts. Start a new post.');
});
