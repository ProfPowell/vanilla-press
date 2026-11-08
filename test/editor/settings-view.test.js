import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { statusBox, collectionOptions, urlPrefix, publishedDay, featuredModel, appearanceModel, pageThemeChoices } from '../../editor/assets/js/settings-view.js';

const NOT_LIVE = "Your saved edits aren't on the live site yet. Update builds the site and pushes them.";

describe('statusBox', () => {
  // Noon on Nov 3 local time: Nov 3 in any time zone the tests run in
  const published = { status: 'published', published: new Date(2026, 10, 3, 12).toISOString() };

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

describe('publishedDay', () => {
  it('a date-only value keeps its written day in any time zone', () => {
    // Run under TZ=America/Los_Angeles too (see npm test note in the report); the check is the same either way
    assert.equal(publishedDay({ published: '2026-11-03' }, 'en-US'), 'Nov 3, 2026');
    assert.equal(statusBox({ status: 'published', published: '2026-11-03' }, { liveOutOfDate: false, locale: 'en-US' }).title,
      'Published Nov 3, 2026');
  });

  it('a full timestamp is shown in local time, as before', () => {
    const value = '2026-11-03T12:00:00.000Z';
    const expected = new Date(value).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    assert.equal(publishedDay({ published: value }, 'en-US'), expected);
  });

  it('no date, or not a date: empty', () => {
    assert.equal(publishedDay({}, 'en-US'), '');
    assert.equal(publishedDay({ published: 'soon' }, 'en-US'), '');
  });
});

describe('featuredModel', () => {
  it('set: the src and its file name', () => {
    assert.deepEqual(featuredModel({ image: '/media/garden-3f9a2c.jpg' }), { set: true, src: '/media/garden-3f9a2c.jpg', name: 'garden-3f9a2c.jpg' });
  });

  it('set to a URL outside /media/: named by the URL', () => {
    assert.deepEqual(featuredModel({ image: 'https://x.test/a.png' }), { set: true, src: 'https://x.test/a.png', name: 'https://x.test/a.png' });
  });

  it('unset (absent, null or empty)', () => {
    const none = { set: false, src: null, name: null };
    assert.deepEqual(featuredModel({}), none);
    assert.deepEqual(featuredModel({ image: null }), none);
    assert.deepEqual(featuredModel({ image: '' }), none);
    assert.deepEqual(featuredModel(null), none);
  });
});

describe('appearanceModel', () => {
  const T = [
    { id: 'default', name: 'Default', href: null },
    { id: 'swiss', name: 'Swiss', href: '/s/swiss.css' },
    { id: '8bit', name: '8bit', href: '/s/8bit.css' },
    { id: 'night', name: 'Night Owl', href: '/s/night.css', custom: true, only: 'dark' },
    { id: 'vp-site', name: 'vp-site', href: '/s/vp-site.css' },
  ];

  it('site theme: radio on site, no cards', () => {
    const m = appearanceModel({}, { setting: { name: 'swiss' }, themes: T });
    assert.equal(m.own, false); assert.equal(m.siteName, 'Swiss'); assert.equal(m.note, null);
    assert.deepEqual(m.cards, []);
  });

  it('own theme with article scope: the note names both keys', () => {
    const m = appearanceModel({ theme: '8bit', themeScope: 'article' }, { setting: { name: 'swiss' }, themes: T });
    assert.equal(m.note, 'Saved with this post as theme: "8bit", themeScope: "article". The site theme and other pages are unchanged.');
    assert.equal(m.cards.find(c => c.id === '8bit').pressed, true);
    assert.equal(m.scope, 'article');
  });

  it('own theme, page scope: the note names the theme only; cards: current, custom, list, without the adjustments', () => {
    const m = appearanceModel({ theme: '8bit', themeScope: 'page' }, { setting: { name: 'swiss', adjust: 'vp-site' }, themes: T, siteId: 's 1' });
    assert.equal(m.own, true); assert.equal(m.scope, 'page');
    assert.equal(m.note, 'Saved with this post as theme: "8bit". The site theme and other pages are unchanged.');
    assert.equal(m.noteKeys, 'theme: "8bit"');
    assert.deepEqual(m.cards.map((c) => c.id), ['8bit', 'night', 'default', 'swiss']);
    assert.equal(m.toggleText, null);
    assert.deepEqual(m.cards.find((c) => c.id === 'night'), { id: 'night', name: 'Night Owl', pressed: false, only: 'dark' });
    assert.equal(m.adjustHref, '/app/site.html?site=s%201&section=theme');
  });

  it('an empty themeScope counts as page; an unsafe theme counts as none', () => {
    assert.equal(appearanceModel({ theme: '8bit', themeScope: '' }, { setting: null, themes: T }).scope, 'page');
    assert.equal(appearanceModel({ theme: 'Retro!' }, { setting: null, themes: T }).own, false);
  });

  it('no theme setting: the site theme is Default', () => {
    assert.equal(appearanceModel({}, { setting: null, themes: T }).siteName, 'Default');
    assert.equal(appearanceModel({}, { setting: null, themes: [] }).siteName, 'Default');
  });

  it('the first 8 cards, then "All N themes" expands in place', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, name: `T${i}` }));
    const own = { theme: 't10' };
    const m = appearanceModel(own, { setting: null, themes: many });
    assert.equal(m.cards.length, 8); assert.equal(m.cards[0].id, 't10'); assert.equal(m.total, 12);
    assert.equal(m.toggleText, 'All 12 themes');
    const all = appearanceModel(own, { setting: null, themes: many, expanded: true });
    assert.equal(all.cards.length, 12); assert.equal(all.toggleText, 'Fewer themes');
    assert.equal(appearanceModel({}, { setting: null, themes: many }).toggleText, null);
  });
});

describe('pageThemeChoices', () => {
  it('current first, then custom themes, then the list; never the adjustments', () => {
    const T = [{ id: 'a' }, { id: 'b', custom: true }, { id: 'vp-site' }, { id: 'c' }, { id: 'adj' }];
    assert.deepEqual(pageThemeChoices({ setting: { adjust: 'adj' }, themes: T }, 'c').map((t) => t.id), ['c', 'b', 'a']);
    assert.deepEqual(pageThemeChoices({ setting: null, themes: T }).map((t) => t.id), ['b', 'a', 'c', 'adj']);
  });
});
