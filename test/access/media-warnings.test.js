import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mediaAccessWarnings } from '../../src/access/media-warnings.js';

const doc = (access, blocks = [], image) => ({
  id: 'doc_x',
  meta: { title: 'T', ...(access ? { access } : {}), ...(image ? { image } : {}) },
  blocks,
});
const para = (text) => ({ type: 'paragraph', children: [{ type: 'text', value: text }] });
const fig = (src) => ({ type: 'figure', attrs: { src, alt: 'x' } });
const media = [
  { filename: 'a.jpg', access: 'friends' },
  { filename: 'b.jpg', access: 'private' },
  { filename: 'c.jpg' },
  { filename: 'd.jpg', access: 'public' },
];

describe('mediaAccessWarnings', () => {
  it('a public page using a friends image gets one warning', () => {
    assert.deepEqual(mediaAccessWarnings(doc(undefined, [fig('/media/a.jpg')]), media), [{ filename: 'a.jpg', access: 'friends' }]);
  });
  it('a friends page using a friends image gets none', () => {
    assert.deepEqual(mediaAccessWarnings(doc('friends', [fig('/media/a.jpg')]), media), []);
  });
  it('a private page using a friends image gets none', () => {
    assert.deepEqual(mediaAccessWarnings(doc('private', [fig('/media/a.jpg')]), media), []);
  });
  it('a friends page using a private image is warned', () => {
    assert.deepEqual(mediaAccessWarnings(doc('friends', [fig('/media/b.jpg')]), media), [{ filename: 'b.jpg', access: 'private' }]);
  });
  it('meta.image counts', () => {
    assert.deepEqual(mediaAccessWarnings(doc('public', [], '/media/b.jpg'), media), [{ filename: 'b.jpg', access: 'private' }]);
  });
  it('finds a reference in text and nested children, once each', () => {
    const blocks = [
      { type: 'blockquote', children: [para('see /media/a.jpg here')] },
      fig('/media/a.jpg?w=200'),
      fig('/media/b.jpg'),
    ];
    assert.deepEqual(
      mediaAccessWarnings(doc('public', blocks), media),
      [{ filename: 'a.jpg', access: 'friends' }, { filename: 'b.jpg', access: 'private' }],
    );
  });
  it('public or unset media, unknown files and other URLs never warn', () => {
    const blocks = [fig('/media/c.jpg'), fig('/media/d.jpg'), fig('/media/gone.jpg'), fig('https://x.example/media/a.jpg')];
    assert.deepEqual(mediaAccessWarnings(doc(undefined, blocks), media), []);
  });
  it('an unknown media level counts as private: a public page is warned', () => {
    assert.deepEqual(mediaAccessWarnings(doc('public', [fig('/media/x.jpg')]), [{ filename: 'x.jpg', access: 'Friends' }]), [{ filename: 'x.jpg', access: 'Friends' }]);
  });
  it('an unknown document level counts as private: a friends image does not warn', () => {
    assert.deepEqual(mediaAccessWarnings(doc('bogus', [fig('/media/a.jpg')]), media), []);
  });
  it('finds a percent-encoded name and region blocks', () => {
    const items = [{ filename: 'my pic.jpg', access: 'friends' }];
    const d = { ...doc('public', []), regions: { aside: [fig('/media/my%20pic.jpg')] } };
    assert.deepEqual(mediaAccessWarnings(d, items), [{ filename: 'my pic.jpg', access: 'friends' }]);
  });
});
