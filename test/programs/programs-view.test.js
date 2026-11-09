import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FILTERS, withEffectiveSandbox, filterPrograms, headerText, tileModel, emptyText,
  sandboxChoiceText, sandboxChoice, sandboxFromChoice, previewText, postFromProgram, postDocument, slugFromFolder,
} from '../../src/programs/programs-view.js';

const prog = (over = {}) => ({
  area: 'demos', slug: 'plasma', title: 'Plasma', description: '', date: '2026-11-09', tags: [], image: '',
  listed: true, url: '/demos/plasma/', hasCard: true, status: 'ok', sandboxed: false, ...over,
});

test('FILTERS: values and labels in order', () => {
  assert.deepEqual(FILTERS, [
    ['all', 'All'], ['listed', 'Listed'], ['unlisted', 'Unlisted'], ['no-card', 'No card'], ['sandboxed', 'Sandboxed'],
  ]);
});

test('withEffectiveSandbox: the card wins, else the area default', () => {
  const state = {
    areas: [{ path: 'demos', sandbox: false }, { path: 'labs', sandbox: true }],
    programs: [
      { area: 'demos', slug: 'a' },
      { area: 'demos', slug: 'b', sandbox: true },
      { area: 'labs', slug: 'c' },
      { area: 'labs', slug: 'd', sandbox: false },
    ],
  };
  assert.deepEqual(withEffectiveSandbox(state).map((p) => p.sandboxed), [false, true, true, false]);
  assert.equal(state.programs[0].sandboxed, undefined, 'input not changed');
});

test('filterPrograms: area, each filter, and search by title or slug', () => {
  const list = [
    prog({ slug: 'plasma', title: 'Plasma' }),
    prog({ slug: 'vaders', title: 'Div Vaders', listed: false, sandboxed: true }),
    prog({ area: 'labs', slug: 'stray', title: 'Stray', listed: false, hasCard: false }),
  ];
  const slugs = (opts) => filterPrograms(list, opts).map((p) => p.slug);
  assert.deepEqual(slugs({ area: 'all', filter: 'all', q: '' }), ['plasma', 'vaders', 'stray']);
  assert.deepEqual(slugs({ area: 'demos', filter: 'all', q: '' }), ['plasma', 'vaders']);
  assert.deepEqual(slugs({ area: 'all', filter: 'listed', q: '' }), ['plasma']);
  assert.deepEqual(slugs({ area: 'all', filter: 'unlisted', q: '' }), ['vaders', 'stray']);
  assert.deepEqual(slugs({ area: 'all', filter: 'no-card', q: '' }), ['stray']);
  assert.deepEqual(slugs({ area: 'all', filter: 'sandboxed', q: '' }), ['vaders']);
  assert.deepEqual(slugs({ area: 'all', filter: 'all', q: 'div' }), ['vaders'], 'title, any case');
  assert.deepEqual(slugs({ area: 'all', filter: 'all', q: ' STRAY ' }), ['stray'], 'slug, trimmed');
  assert.deepEqual(slugs({}), ['plasma', 'vaders', 'stray'], 'defaults show everything');
});

test('headerText: counts with singular forms', () => {
  const areas = (n) => Array.from({ length: n }, (_, i) => ({ path: `a${i}` }));
  assert.equal(headerText({ areas: areas(2), programs: [prog(), prog({ listed: false }), prog({ listed: false })] }),
    '3 programs in 2 areas · 2 unlisted');
  assert.equal(headerText({ areas: areas(1), programs: [prog()] }), '1 program in 1 area · 0 unlisted');
  assert.equal(headerText({ areas: [], programs: [] }), '0 programs in 0 areas · 0 unlisted');
});

test('tileModel: title, path and badges in order', () => {
  assert.deepEqual(tileModel(prog()), { title: 'Plasma', path: '/demos/plasma/', badges: [] });
  assert.deepEqual(tileModel(prog({ listed: false, sandboxed: true })).badges, ['Unlisted', 'Sandboxed']);
  assert.deepEqual(tileModel(prog({ listed: false, status: 'missing-folder' })).badges, ['Unlisted', 'Missing folder']);
  assert.deepEqual(tileModel(prog({ listed: false, status: 'no-index', hasCard: false })).badges,
    ['Unlisted', 'Not a program (no index.html)', 'No card']);
});

test('emptyText: no programs at all, or none matching', () => {
  assert.equal(emptyText(0), 'No programs yet. Add an area, then Add program.');
  assert.equal(emptyText(3), 'No programs match.');
});

test('sandboxChoiceText: labels follow the area default; exact On hint', () => {
  const off = sandboxChoiceText(false);
  assert.deepEqual(off.map((c) => c.value), ['default', 'on', 'off']);
  assert.deepEqual(off.map((c) => c.label), ['Area default (off)', 'On', 'Off']);
  assert.equal(off[1].hint, "The program can't use the site's storage or cookies, and its own saved data won't work.");
  assert.equal(off[0].hint, 'Follows its area: not sandboxed.');
  assert.equal(off[2].hint, 'The program runs like any page of the site: its saved data works.');
  const on = sandboxChoiceText(true);
  assert.equal(on[0].label, 'Area default (on)');
  assert.equal(on[0].hint, 'Follows its area: sandboxed.');
});

test('sandboxChoice and sandboxFromChoice map the card value', () => {
  assert.equal(sandboxChoice({}), 'default');
  assert.equal(sandboxChoice({ sandbox: true }), 'on');
  assert.equal(sandboxChoice({ sandbox: false }), 'off');
  assert.equal(sandboxFromChoice('default'), null);
  assert.equal(sandboxFromChoice('on'), true);
  assert.equal(sandboxFromChoice('off'), false);
});

test('previewText: what Update from source would change', () => {
  assert.equal(previewText({ added: ['a.js'], changed: ['index.html', 'b.css'], removed: [], total: 2048, skipped: [], large: false }),
    '2 changed, 1 added, 0 removed (2 KB in all).');
  assert.equal(previewText({ added: [], changed: [], removed: [], total: 10, skipped: [], large: false }),
    'No changes: the source folder matches the live copy.');
});

test('postFromProgram: title, description, image and the Try it paragraph, escaped', () => {
  assert.deepEqual(postFromProgram(prog({ title: 'Tom & <Jerry>', description: 'Chase', image: '/media/tj-1a2b3c.png' })), {
    title: 'Tom & <Jerry>',
    description: 'Chase',
    image: '/media/tj-1a2b3c.png',
    html: '<p>Try it: <a href="/demos/plasma/">Tom &amp; &lt;Jerry&gt;</a></p>',
  });
  assert.equal(postFromProgram(prog()).image, null, 'no image: none');
});

test('postDocument: a draft post with the link, and a free slug', () => {
  const doc = postDocument(prog({ description: 'Waves', image: '/media/p-1a2b3c.png' }), ['plasma', 'plasma-2']);
  assert.deepEqual(doc, {
    meta: { title: 'Plasma', slug: 'plasma-3', collection: 'posts', status: 'draft', description: 'Waves', image: '/media/p-1a2b3c.png' },
    blocks: [{ type: 'paragraph', children: [
      { type: 'text', value: 'Try it: ' },
      { type: 'link', attrs: { href: '/demos/plasma/' }, children: [{ type: 'text', value: 'Plasma' }] },
    ] }],
  });
  const bare = postDocument(prog(), []);
  assert.equal(bare.meta.slug, 'plasma');
  assert.ok(!('image' in bare.meta) && !('description' in bare.meta), 'empty fields left out');
});

test('slugFromFolder: a folder name made slug-shaped', () => {
  assert.equal(slugFromFolder('Div Vaders!'), 'div-vaders');
  assert.equal(slugFromFolder('my_game--2'), 'my-game-2');
  assert.equal(slugFromFolder('/Users/me/demos/Plasma/'), 'plasma');
  assert.equal(slugFromFolder('ééé'), '');
});
