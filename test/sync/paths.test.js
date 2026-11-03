import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { collectionOutput, outputPaths, postUrlPath } from '../../src/sync/paths.js';

const doc = (collection, slug, status) => ({ id: '1', meta: { title: 'T', slug, collection, status }, blocks: [] });

describe('collectionOutput', () => {
  it('defaults for a collection', () => {
    assert.deepEqual(collectionOutput('posts'), { path: 'posts', layout: 'post' });
  });
  it('defaults for pages', () => {
    assert.deepEqual(collectionOutput('pages'), { path: '', layout: 'page' });
  });
  it('config override wins', () => {
    assert.deepEqual(collectionOutput('posts', { posts: { path: 'blog', layout: 'article' } }), { path: 'blog', layout: 'article' });
  });
});

describe('outputPaths', () => {
  it('published post', () => {
    assert.deepEqual(outputPaths(doc('posts', 'hello', 'published')), { json: 'content/posts/hello.json', html: 'src/posts/hello.html' });
  });
  it('published page', () => {
    assert.deepEqual(outputPaths(doc('pages', 'about', 'published')), { json: 'content/pages/about.json', html: 'src/about.html' });
  });
  it('draft and archived have no html', () => {
    assert.equal(outputPaths(doc('posts', 'h', 'draft')).html, null);
    assert.equal(outputPaths(doc('posts', 'h', 'archived')).html, null);
    assert.equal(outputPaths(doc('posts', 'h', 'draft')).json, 'content/posts/h.json');
  });
  it('config override changes html path', () => {
    assert.equal(outputPaths(doc('posts', 'h', 'published'), { posts: { path: 'blog', layout: 'post' } }).html, 'src/blog/h.html');
  });
});

describe('postUrlPath', () => {
  it('postUrlPath gives the page URL', () => {
    assert.equal(postUrlPath(doc('posts', 'hello', 'published')), '/posts/hello/');
    assert.equal(postUrlPath(doc('pages', 'hello', 'published')), '/hello/');
    assert.equal(postUrlPath(doc('posts', 'hello', 'published'), { posts: { path: '/blog/' } }), '/blog/hello/');
    assert.equal(postUrlPath(doc('notes', 'n1', 'draft'), { notes: { path: 'a/b' } }), '/a/b/n1/');
  });
});
