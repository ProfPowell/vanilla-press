import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SOCIALSPEC_TOO_OLD, EMAIL_HELPER, PREVIEW_UNAVAILABLE, aboutForm, toAboutPut, contactForm, toContactPut,
  followingRows, blankRow, toFollowingPut, moveRow, importSummary, previewDocument,
} from '../../app/assets/js/socialspec-view.js';

test('exact copy', () => {
  assert.equal(SOCIALSPEC_TOO_OLD, "This site's Cook is too old for this; update cook-ssg to 2.11.0 or later");
  assert.equal(EMAIL_HELPER, 'This address is public. Use one you are happy to see scraped.');
  assert.match(PREVIEW_UNAVAILABLE, /^Preview isn't available until the site's packages are installed/);
  assert.doesNotMatch(PREVIEW_UNAVAILABLE, /too old/);
});

test('aboutForm: from config, tolerant of null and missing keys', () => {
  assert.deepEqual(aboutForm(null), { summary: '', body: '' });
  assert.deepEqual(aboutForm({ summary: 'Hi', body: '# Me' }), { summary: 'Hi', body: '# Me' });
  assert.deepEqual(aboutForm({ file: 'about.md' }), { summary: '', body: '' });
});

test('toAboutPut: blank removes, file and unknown keys are kept, body not trimmed away', () => {
  assert.equal(toAboutPut({ summary: '  ', body: '\n ' }, null), null);
  assert.deepEqual(toAboutPut({ summary: ' Hi ', body: '# Me\n' }, null), { summary: 'Hi', body: '# Me\n' });
  assert.deepEqual(toAboutPut({ summary: '', body: 'x' }, { file: 'a.md', body: 'old' }), { body: 'x', file: 'a.md' });
  assert.equal(toAboutPut({ summary: '', body: '' }, { file: 'a.md' })?.file, 'a.md');
});

test('contactForm and toContactPut: five fields, trimmed, all empty is null', () => {
  assert.deepEqual(contactForm(null), { name: '', email: '', url: '', org: '', title: '' });
  assert.deepEqual(contactForm({ name: 'T', email: 'a@b.c', extra: 1 }), { name: 'T', email: 'a@b.c', url: '', org: '', title: '' });
  assert.equal(toContactPut({ name: ' ', email: '', url: '', org: '', title: ' ' }), null);
  assert.deepEqual(toContactPut({ name: ' T ', email: '', url: 'https://x.y', org: '', title: '' }), { name: 'T', url: 'https://x.y' });
});

test('followingRows: row model with defaults and stable keys', () => {
  const rows = followingRows([
    { title: 'A', feedUrl: 'https://a.test/feed', siteUrl: 'https://a.test', category: 'News' },
    { feedUrl: 'https://b.test/feed', public: false },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].public, true);
  assert.equal(rows[1].public, false);
  assert.equal(rows[1].title, '');
  assert.equal(rows[0].category, 'News');
  assert.notEqual(rows[0].key, rows[1].key);
  assert.deepEqual(followingRows(undefined), []);
  assert.equal(blankRow().public, true);
  assert.notEqual(blankRow().key, blankRow().key);
});

test('toFollowingPut: drops blank rows, trims, omits empty optional fields, keeps category', () => {
  const rows = [
    { key: 1, title: ' A ', feedUrl: ' https://a.test/feed ', siteUrl: '', category: 'News', public: true },
    blankRow(),
    { key: 3, title: '', feedUrl: 'https://b.test/feed', siteUrl: 'https://b.test', category: '', public: false },
  ];
  assert.deepEqual(toFollowingPut(rows), [
    { title: 'A', feedUrl: 'https://a.test/feed', category: 'News', public: true },
    { feedUrl: 'https://b.test/feed', siteUrl: 'https://b.test', public: false },
  ]);
  assert.deepEqual(toFollowingPut([blankRow()]), []);
});

test('moveRow: swaps, clamps, never mutates', () => {
  const l = [{ key: 1 }, { key: 2 }, { key: 3 }];
  assert.deepEqual(moveRow(l, 1, -1).map((r) => r.key), [2, 1, 3]);
  assert.deepEqual(moveRow(l, 1, 1).map((r) => r.key), [1, 3, 2]);
  assert.deepEqual(moveRow(l, 0, -1).map((r) => r.key), [1, 2, 3]);
  assert.deepEqual(moveRow(l, 2, 1).map((r) => r.key), [1, 2, 3]);
  assert.deepEqual(l.map((r) => r.key), [1, 2, 3]);
});

test('importSummary: counts, plurals, nothing new', () => {
  assert.equal(importSummary({ added: 3, skipped: 1, unchanged: 2 }), 'Added 3 feeds, skipped 1 without a feed address, 2 already in your list.');
  assert.equal(importSummary({ added: 1, skipped: 0, unchanged: 0 }), 'Added 1 feed.');
  assert.equal(importSummary({ added: 0, skipped: 0, unchanged: 4 }), 'Nothing new to add: 4 already in your list.');
  assert.equal(importSummary({ added: 0, skipped: 2, unchanged: 0 }), 'Nothing new to add: skipped 2 without a feed address.');
});

test('previewDocument: no scripts possible, html passes through for the sandbox', () => {
  const doc = previewDocument('<p>Hi</p><script>parent.x=1</script>');
  assert.match(doc, /<p>Hi<\/p>/);
  assert.match(doc, /Content-Security-Policy/);
  assert.match(doc, /default-src 'none'/);
  assert.doesNotMatch(doc, /script-src/);
  assert.match(previewDocument(''), /<body>/);
});
