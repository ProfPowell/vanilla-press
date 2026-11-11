import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CREDIT_FIELDS, CREDIT_NOTE, LINK_ERROR, creditFormValues, creditFromForm, detailModel,
} from '../../src/media/library-view.js';

// The Media detail panel's Credit fieldset, as pure models (the DOM is media-detail.js).
const item = (o) => ({
  id: 'x', filename: 'pexels-1.jpg', original_name: 'pexels-1.jpg', mime_type: 'image/jpeg', kind: 'image',
  alt: 'A fox', created: '2026-11-01T00:00:00Z', missing: false, usedIn: [], source: null, credit: null, ...o,
});

const fullCredit = {
  name: 'Jane Doe', url: 'https://www.pexels.com/@jane',
  site: 'Pexels', siteUrl: 'https://www.pexels.com',
  license: 'Pexels License', licenseUrl: 'https://www.pexels.com/license/',
  adapted: true,
};

const empty = { name: '', url: '', site: '', siteUrl: '', license: '', licenseUrl: '', adapted: false };

test('the fieldset has creator, creator link, site, site link, license and license link', () => {
  assert.deepEqual(CREDIT_FIELDS.map((f) => [f.key, f.label]), [
    ['name', 'Creator'], ['url', 'Creator link'],
    ['site', 'Site'], ['siteUrl', 'Site link'],
    ['license', 'License'], ['licenseUrl', 'License link'],
  ]);
  assert.deepEqual(CREDIT_FIELDS.filter((f) => f.link).map((f) => f.key), ['url', 'siteUrl', 'licenseUrl']);
  assert.equal(CREDIT_NOTE, 'Changes apply to new uses of this image. Posts that already use it keep their credit.');
});

test('the form model, from a MediaItem with a credit, fills every field', () => {
  assert.deepEqual(creditFormValues(item({ source: 'pexels', credit: fullCredit })), fullCredit);
});

test('the form model of an item with no credit is empty', () => {
  assert.deepEqual(creditFormValues(item()), empty);
});

test('the form gives back the credit, trimmed', () => {
  const answer = creditFromForm({ ...empty, name: '  Jane Doe ', site: 'Pexels', siteUrl: ' https://www.pexels.com ', adapted: true });
  assert.deepEqual(answer, {
    credit: { name: 'Jane Doe', site: 'Pexels', siteUrl: 'https://www.pexels.com', adapted: true }, error: null, invalid: [],
  });
});

test('clearing every field gives credit: null', () => {
  assert.deepEqual(creditFromForm(empty), { credit: null, error: null, invalid: [] });
  assert.deepEqual(creditFromForm({ ...empty, name: '   ' }), { credit: null, error: null, invalid: [] });
  // Adapted alone says nothing about who made it: still no credit
  assert.deepEqual(creditFromForm({ ...empty, adapted: true }), { credit: null, error: null, invalid: [] });
});

test('a javascript: link is refused', () => {
  const answer = creditFromForm({ ...empty, name: 'Jane', url: 'javascript:alert(1)' });
  assert.equal(LINK_ERROR, 'Links must start with http:// or https://');
  assert.deepEqual(answer, { credit: null, error: 'Links must start with http:// or https://', invalid: ['url'] });
});

test('every link that is not http(s) is named, including one with no scheme', () => {
  const answer = creditFromForm({ ...empty, name: 'Jane', url: ' JaVaScRiPt:x', siteUrl: 'www.pexels.com', licenseUrl: 'https://ok.example' });
  assert.equal(answer.error, LINK_ERROR);
  assert.deepEqual(answer.invalid, ['url', 'siteUrl']);
  assert.equal(creditFromForm({ ...empty, name: 'Jane', url: 'HTTP://example.com' }).error, null);
});

test('links with nothing to show them on are refused, not dropped', () => {
  const answer = creditFromForm({ ...empty, url: 'https://www.pexels.com/@jane' });
  assert.equal(answer.credit, null);
  assert.equal(answer.error, 'Add a creator, site or license for the links to go with.');
  assert.deepEqual(answer.invalid, ['name']);
});

test('a web image shows where it came from; a credit written by hand does not', () => {
  assert.equal(detailModel(item({ source: 'pexels', credit: fullCredit }), { siteId: 's' }).source, 'From Pexels');
  assert.equal(detailModel(item({ source: 'openverse' }), { siteId: 's' }).source, 'From Openverse');
  assert.equal(detailModel(item({ source: 'pixabay' }), { siteId: 's' }).source, 'From Pixabay');
  assert.equal(detailModel(item({ source: 'manual', credit: { name: 'Me' } }), { siteId: 's' }).source, null);
  assert.equal(detailModel(item(), { siteId: 's' }).source, null);
});

test('only an image has a credit to edit', () => {
  assert.equal(detailModel(item(), { siteId: 's' }).showCredit, true);
  assert.equal(detailModel(item({ kind: 'video', mime_type: 'video/mp4' }), { siteId: 's' }).showCredit, false);
});
