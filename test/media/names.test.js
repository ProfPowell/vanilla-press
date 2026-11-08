import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugBase, shortId, storedExt, mediaFilename, editedFilename, uniqueFilename } from '../../src/media/names.js';
import { typeOf } from '../../src/media/types.js';

test('slugBase handles odd names', () => {
  assert.equal(slugBase('Garden Path.JPG'), 'garden-path');
  assert.equal(slugBase('Résumé final (2).PDF'), 'resume-final-2');
  assert.equal(slugBase('😀.png'), 'file');
  assert.equal(slugBase('.png'), 'file');
  const long = slugBase(('abcd efgh ').repeat(30) + '.jpg');
  assert.ok(long.length <= 60 && !long.endsWith('-'), long);
});

test('slugBase drops only a real extension', () => {
  assert.equal(slugBase('Notes v1.2'), 'notes-v1-2');
  assert.equal(slugBase('Notes v1.2.png'), 'notes-v1-2');
  assert.equal(slugBase('report.final'), 'report-final');
  assert.equal(slugBase('clip.MP4'), 'clip');
});

test('shortId is 6 lowercase hex characters', () => {
  for (let i = 0; i < 20; i++) assert.match(shortId(), /^[0-9a-f]{6}$/);
});

test('mediaFilename', () => {
  assert.equal(mediaFilename('Garden Path.JPG', 'jpg', '3f9a2c'), 'garden-path-3f9a2c.jpg');
});

test('editedFilename does not stack suffixes', () => {
  assert.equal(editedFilename('garden-path-3f9a2c.jpg', 'jpg', 'a1b2c3'), 'garden-path-edited-a1b2c3.jpg');
  assert.equal(editedFilename('garden-path-edited-a1b2c3.jpg', 'jpg', 'd4e5f6'), 'garden-path-edited-d4e5f6.jpg');
  assert.equal(editedFilename('3f9a2c1b.png', 'png', 'a1b2c3'), '3f9a2c1b-edited-a1b2c3.png');
});

test('storedExt keeps the original extension when it fits the type', () => {
  assert.equal(storedExt('photo.JPEG', typeOf('image/jpeg')), 'jpeg');
  assert.equal(storedExt('photo.jpg', typeOf('image/png')), 'png');
  assert.equal(storedExt('noext', typeOf('application/pdf')), 'pdf');
});

test('uniqueFilename retries on a taken name and throws after tries', () => {
  const ids = ['a', 'b', 'c'];
  let n = 0;
  assert.equal(uniqueFilename(() => `f-${ids[n++]}.jpg`, (name) => name !== 'f-c.jpg'), 'f-c.jpg');
  assert.throws(() => uniqueFilename(() => 'x.jpg', () => true, 3), /Could not find a free file name/);
  let calls = 0;
  assert.throws(() => uniqueFilename(() => { calls++; return 'x'; }, () => true), /Could not find/);
  assert.equal(calls, 20);
});
