import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { statusBox, collectionOptions, urlPrefix } from '../../editor/assets/js/settings-view.js';

const NOT_LIVE = "Your saved edits aren't on the live site yet. Update builds the site and pushes them.";

describe('statusBox', () => {
  const published = { status: 'published', published: '2026-11-03T12:00:00.000Z' };

  it('a published post with its edits live: the date, no note', () => {
    assert.deepEqual(statusBox(published, { liveOutOfDate: false, locale: 'en-US' }),
      { title: 'Published Nov 3, 2026', note: null });
  });

  it('a published post with saved edits not live: the date and the Update note', () => {
    assert.deepEqual(statusBox(published, { liveOutOfDate: true, locale: 'en-US' }),
      { title: 'Published Nov 3, 2026', note: NOT_LIVE });
  });

  it('a published post without a date: just "Published"', () => {
    assert.equal(statusBox({ status: 'published' }, { liveOutOfDate: false }).title, 'Published');
  });

  it('a draft: what Publish does', () => {
    assert.deepEqual(statusBox({ status: 'draft' }, { liveOutOfDate: false }),
      { title: 'Draft', note: 'Publish builds the site and puts this post live.' });
  });

  it('a draft never shows the not-live note', () => {
    assert.equal(statusBox({ status: 'draft' }, { liveOutOfDate: true }).note, 'Publish builds the site and puts this post live.');
  });
});

describe('collectionOptions', () => {
  const config = { posts: {}, notes: { path: 'n' }, pages: {} };

  it("the config's names in order, when the current one is among them", () => {
    assert.deepEqual(collectionOptions(config, 'notes'), ['posts', 'notes', 'pages']);
  });

  it('keeps the current collection when the config does not list it', () => {
    assert.deepEqual(collectionOptions(config, 'recipes'), ['posts', 'notes', 'pages', 'recipes']);
  });

  it('no config: just the current collection', () => {
    assert.deepEqual(collectionOptions({}, 'posts'), ['posts']);
    assert.deepEqual(collectionOptions(null, 'posts'), ['posts']);
  });

  it('no current collection: just the config', () => {
    assert.deepEqual(collectionOptions(config, ''), ['posts', 'notes', 'pages']);
  });
});

describe('urlPrefix', () => {
  it('/<collection>/ by default', () => {
    assert.equal(urlPrefix('posts', {}), '/posts/');
    assert.equal(urlPrefix('notes', undefined), '/notes/');
  });

  it("the config's path when it sets one", () => {
    assert.equal(urlPrefix('notes', { notes: { path: '/journal/' } }), '/journal/');
    assert.equal(urlPrefix('notes', { notes: { path: 'blog/notes' } }), '/blog/notes/');
  });

  it('pages (or an empty path) sit at the root', () => {
    assert.equal(urlPrefix('pages', {}), '/');
    assert.equal(urlPrefix('posts', { posts: { path: '' } }), '/');
  });

  it("matches postUrlPath's rule", async () => {
    const { postUrlPath } = await import('../../src/sync/paths.js');
    const config = { notes: { path: 'journal' } };
    for (const collection of ['posts', 'notes', 'pages']) {
      assert.equal(urlPrefix(collection, config) + 'hello/', postUrlPath({ meta: { slug: 'hello', collection } }, config));
    }
  });
});
