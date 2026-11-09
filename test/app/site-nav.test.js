import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SECTIONS, LATER, sectionFromSearch, sectionHref } from '../../app/assets/js/site-nav.js';

test('sections and later items', () => {
  assert.deepEqual(SECTIONS, ['posts', 'media', 'programs', 'components', 'theme']);
  assert.deepEqual(LATER, ['Analytics', 'Social']);
});

test('sectionFromSearch: a known section, else posts', () => {
  assert.equal(sectionFromSearch('?site=a&section=media'), 'media');
  assert.equal(sectionFromSearch('?site=a&section=theme'), 'theme');
  assert.equal(sectionFromSearch('?site=a&section=programs'), 'programs');
  assert.equal(sectionFromSearch('?site=a&section=nope'), 'posts');
  assert.equal(sectionFromSearch('?site=a'), 'posts');
  assert.equal(sectionFromSearch(''), 'posts');
});

test('sectionHref: encodes the site, omits section for posts', () => {
  assert.equal(sectionHref('my blog', 'theme'), 'site.html?site=my%20blog&section=theme');
  assert.equal(sectionHref('a', 'posts'), 'site.html?site=a');
});
