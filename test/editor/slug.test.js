import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { slugify, slugIsHandEdited, slugAfterTitleEdit, isPlaceholderSlug } from '../../editor/assets/js/slug.js';

describe('slugify', () => {
  it('gives the same slugs as the meta panel did', () => {
    assert.equal(slugify('Hello, World!'), 'hello-world');
    assert.equal(slugify('  CSS Layers: 101  '), 'css-layers-101');
    assert.equal(slugify('Café au lait'), 'caf-au-lait');
    assert.equal(slugify(''), '');
    assert.equal(slugify('---'), '');
  });
});

describe('slugIsHandEdited', () => {
  it('is true when the slug is not what the title gives', () => {
    assert.equal(slugIsHandEdited({ title: 'Hello World', slug: 'my-own' }), true);
  });
  it('is false when the slug is what the title gives, or there is none', () => {
    assert.equal(slugIsHandEdited({ title: 'Hello World', slug: 'hello-world' }), false);
    assert.equal(slugIsHandEdited({ title: 'Hello', slug: '' }), false);
    assert.equal(slugIsHandEdited({ slug: '' }), false);
  });
});

describe('isPlaceholderSlug', () => {
  it('recognizes the slug a new post gets', () => {
    assert.equal(isPlaceholderSlug('untitled'), true);
    assert.equal(isPlaceholderSlug('untitled-m3x9k2'), true);
    assert.equal(isPlaceholderSlug('untitled-thoughts-on-css'), false);
    assert.equal(isPlaceholderSlug('hello'), false);
    assert.equal(isPlaceholderSlug(undefined), false);
  });
});

describe('slugAfterTitleEdit keeps a published slug', () => {
  it('published + new title: the old slug', () => {
    const meta = { title: 'Old', slug: 'old', status: 'published' };
    assert.equal(slugAfterTitleEdit(meta, 'Brand New', { handEdited: false }), 'old');
  });
  it('draft, not hand-edited: the slugified new title', () => {
    const meta = { title: 'Old', slug: 'old', status: 'draft' };
    assert.equal(slugAfterTitleEdit(meta, 'Brand New', { handEdited: false }), 'brand-new');
  });
  it('draft, hand-edited: the old slug', () => {
    const meta = { title: 'Old', slug: 'mine', status: 'draft' };
    assert.equal(slugAfterTitleEdit(meta, 'Brand New', { handEdited: true }), 'mine');
  });
  it('a title with no slug characters keeps the current slug', () => {
    const meta = { title: 'Old', slug: 'old', status: 'draft' };
    assert.equal(slugAfterTitleEdit(meta, '', { handEdited: false }), 'old');
    assert.equal(slugAfterTitleEdit(meta, '!!!', { handEdited: false }), 'old');
  });
});
