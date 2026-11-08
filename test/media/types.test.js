import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACCEPTED, typeOf, kindOf, typeLabel, EDITABLE, canEditImage, exportFormat } from '../../src/media/types.js';

test('ACCEPTED lists the 14 types with canonical first extensions', () => {
  assert.equal(ACCEPTED.length, 14);
  assert.deepEqual(typeOf('image/jpeg').exts, ['jpg', 'jpeg']);
  assert.deepEqual(typeOf('audio/ogg').exts, ['ogg', 'oga', 'opus']);
});

test('typeOf, kindOf and typeLabel', () => {
  assert.equal(kindOf('video/webm'), 'video');
  assert.equal(kindOf('application/pdf'), 'pdf');
  assert.equal(kindOf('image/heic'), null);
  assert.equal(typeOf('image/heic'), null);
  assert.equal(typeLabel('image/svg+xml'), 'SVG image');
  assert.equal(typeLabel('application/pdf'), 'PDF document');
  assert.equal(typeLabel('nope/x'), 'File');
});

test('canEditImage is true only for JPEG, PNG and WebP', () => {
  assert.deepEqual(EDITABLE, ['image/jpeg', 'image/png', 'image/webp']);
  for (const t of ACCEPTED) assert.equal(canEditImage(t.mime), EDITABLE.includes(t.mime), t.mime);
  assert.equal(exportFormat('image/webp'), 'webp');
  assert.equal(exportFormat('image/jpeg'), 'jpeg');
  assert.equal(exportFormat('image/png'), 'png');
  assert.equal(exportFormat('image/gif'), null);
});
