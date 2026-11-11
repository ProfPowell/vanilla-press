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
    credit: { name: 'Jane Doe', site: 'Pexels', siteUrl: 'https://www.pexels.com', adapted: true }, errors: {}, skip: false,
  });
});

test('clearing every field gives credit: null', () => {
  assert.deepEqual(creditFromForm(empty), { credit: null, errors: {}, skip: false });
  assert.deepEqual(creditFromForm({ ...empty, name: '   ' }), { credit: null, errors: {}, skip: false });
  // Adapted alone says nothing about who made it: still no credit
  assert.deepEqual(creditFromForm({ ...empty, adapted: true }), { credit: null, errors: {}, skip: false });
});

test('a javascript: link is refused beside its field; the other fields still save', () => {
  const answer = creditFromForm({ ...empty, name: 'Jane', site: 'Pexels', url: 'javascript:alert(1)' });
  assert.equal(LINK_ERROR, 'Links must start with http:// or https://');
  assert.deepEqual(answer, { credit: { name: 'Jane', site: 'Pexels' }, errors: { url: 'Links must start with http:// or https://' }, skip: false });
});

test('a refused link keeps the link already stored', () => {
  const stored = { name: 'Jane', url: 'https://www.pexels.com/@jane' };
  const answer = creditFromForm({ ...empty, name: 'Jane Doe', url: 'javascript:x' }, stored);
  assert.deepEqual(answer.credit, { name: 'Jane Doe', url: 'https://www.pexels.com/@jane' });
  assert.deepEqual(Object.keys(answer.errors), ['url']);
});

test('a link must be a whole http(s) URL with a host and no spaces', () => {
  const refused = (link) => creditFromForm({ ...empty, name: 'Jane', url: link }).errors.url;
  for (const bad of [' JaVaScRiPt:x', 'www.pexels.com', 'https://', 'http://', 'https://exa mple.com', 'ftp://example.com', 'mailto:a@b.c', '//example.com']) {
    assert.equal(refused(bad), LINK_ERROR, bad);
  }
  for (const good of ['HTTP://example.com', 'https://www.pexels.com/@jane', ' https://example.com/a?b=c ']) {
    assert.equal(refused(good), undefined, good);
  }
  const answer = creditFromForm({ ...empty, name: 'Jane', url: 'nope', siteUrl: 'also nope', licenseUrl: 'https://ok.example' });
  assert.deepEqual(Object.keys(answer.errors), ['url', 'siteUrl']);
  assert.deepEqual(answer.credit, { name: 'Jane', licenseUrl: 'https://ok.example' });
});

test('links with nothing to show them on are refused, and nothing is saved', () => {
  const answer = creditFromForm({ ...empty, url: 'https://www.pexels.com/@jane' });
  assert.deepEqual(answer, { credit: null, errors: { name: 'Add a creator, site or license for the links to go with.' }, skip: true });
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
