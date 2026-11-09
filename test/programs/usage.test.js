import { test } from 'node:test';
import assert from 'node:assert/strict';
import { programRefs, programUsage } from '../../src/programs/usage.js';

const keys = (html, opts) => [...programRefs(html, opts)].sort();

test('programRefs: /<area>/<slug>, with a trailing slash, and any file inside, in href or src', () => {
  const html = [
    '<a href="/programs/plasma">bare</a>',
    '<a href="/programs/plasma/">slash</a>',
    '<script src="/demos/div-vaders/js/game.js"></script>',
    '<a href="/programs/h3/?level=2#top">query and hash</a>',
    "<iframe src='/programs/agentic-chaos/index.html'></iframe>",
  ].join('\n');
  assert.deepEqual(keys(html), ['demos/div-vaders', 'programs/agentic-chaos', 'programs/h3', 'programs/plasma']);
});

test('programRefs: areas narrows the keys; a lookalike area is not a use', () => {
  const html = '<a href="/demosx/plasma/">x</a><a href="/demos/plasma/">y</a><a href="/demos/">list</a><a href="/about">a</a>';
  assert.deepEqual(keys(html, { areas: ['demos'] }), ['demos/plasma']);
  assert.ok(!programRefs(html, { areas: ['demos'] }).has('demosx/plasma'));
});

test('programRefs: same-site absolute URLs count; other hosts and text do not', () => {
  const html = [
    '<a href="https://example.com/programs/plasma/">same site</a>',
    '<a href="//example.com/programs/h3">protocol-relative</a>',
    '<a href="https://elsewhere.org/programs/rug-pull/">other host</a>',
    '<p>/programs/written-in-text/</p>',
    '<a data-x="/programs/not-an-href/">attr</a>',
  ].join('\n');
  assert.deepEqual(keys(html, { siteHost: 'example.com' }), ['programs/h3', 'programs/plasma']);
  assert.deepEqual(keys(html), []); // no site host: absolute URLs never count
});

test('programRefs: entity-encoded attribute values are decoded', () => {
  assert.deepEqual(keys('<a href="/programs/plasma/?a=1&amp;b=2">x</a>'), ['programs/plasma']);
});

test('programUsage: saved posts and committed pages, one entry each, not the program itself', () => {
  const docs = [
    { id: 'doc_1', title: 'Try plasma', path: 'src/posts/try.html', html: '<p><a href="/programs/plasma/">Plasma</a></p>' },
    { id: 'doc_2', title: 'Other', path: 'src/posts/other.html', html: '<p><a href="/programs/h3/">H3</a></p>' },
    { id: 'doc_3', title: 'Dropped it', path: 'src/posts/dropped.html', html: '<p>No link now.</p>' },
  ];
  const live = new Map([
    ['programs/plasma', [
      { path: 'src/posts/try.html', vpId: 'doc_1' }, // the same post: listed once
      { path: 'src/posts/dropped.html', vpId: 'doc_3' }, // its live page still links it
      { path: 'src/about.html', vpId: null }, // a hand-written page
      { path: 'src/programs/plasma/index.html', vpId: null }, // the program's own page
    ]],
  ]);
  assert.deepEqual(programUsage({ docs, live, area: 'programs', slug: 'plasma' }), [
    { title: 'Try plasma', path: 'src/posts/try.html' },
    { title: 'Dropped it', path: 'src/posts/dropped.html' },
    { title: 'src/about.html', path: 'src/about.html' },
  ]);
  assert.deepEqual(programUsage({ docs, live: new Map(), area: 'programs', slug: 'rug-pull' }), []);
});

test('programUsage: a same-site absolute link in a saved post counts', () => {
  const docs = [{ id: 'doc_1', title: 'Abs', path: 'src/posts/abs.html', html: '<a href="https://example.com/programs/plasma">x</a>' }];
  assert.deepEqual(programUsage({ docs, live: new Map(), area: 'programs', slug: 'plasma', siteHost: 'example.com' }),
    [{ title: 'Abs', path: 'src/posts/abs.html' }]);
});

test('programRefs: front matter values count (a committed page\'s featured image)', () => {
  const page = '---\ntitle: "Plasma"\nimage: /programs/plasma/shot.png\n---\n<p>No link.</p>';
  assert.deepEqual(keys(page), ['programs/plasma']);
});

test('programUsage: a saved post whose featured image is inside the program counts', () => {
  const docs = [{ id: 'doc_1', title: 'Shot', path: 'src/posts/shot.html', html: '<p>x</p>', image: '/programs/plasma/shot.png' }];
  assert.deepEqual(programUsage({ docs, live: new Map(), area: 'programs', slug: 'plasma' }), [{ title: 'Shot', path: 'src/posts/shot.html' }]);
});
