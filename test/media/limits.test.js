import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_BYTES, LARGE_BYTES, formatBytes, ACCEPT_ATTR, tooLargeMessage, unsupportedMessage, LARGE_NOTE, checkBeforeUpload } from '../../src/media/limits.js';

test('limits and formatBytes', () => {
  assert.equal(MAX_BYTES, 26214400);
  assert.equal(LARGE_BYTES, 5242880);
  assert.equal(formatBytes(512), '512 bytes');
  assert.equal(formatBytes(812 * 1024), '812 KB');
  assert.equal(formatBytes(Math.round(4.2 * 1048576)), '4.2 MB');
});

test('ACCEPT_ATTR lists every extension', () => {
  const parts = ACCEPT_ATTR.split(',');
  for (const e of ['.jpg', '.jpeg', '.m4v', '.opus', '.pdf', '.svg']) assert.ok(parts.includes(e), e);
  assert.ok(parts.every((p) => /^\.[a-z0-9]+$/.test(p)));
});

test('messages', () => {
  assert.equal(unsupportedMessage('a.heic'), "a.heic isn't a file type Vanilla Press accepts. Use JPEG, PNG, WebP, AVIF, GIF, SVG, MP4, WebM, MP3, M4A, AAC, Ogg, WAV or PDF.");
  assert.equal(LARGE_NOTE, 'Large file: everything is committed to git, so the repository grows by its size.');
});

test('checkBeforeUpload', () => {
  const big = checkBeforeUpload({ name: 'a.mp4', size: MAX_BYTES + 1 });
  assert.equal(big.ok, false);
  assert.equal(big.error, tooLargeMessage('a.mp4', MAX_BYTES + 1));
  assert.ok(big.error.includes('25.0 MB') && big.error.includes('Files over 25 MB'));
  assert.deepEqual(checkBeforeUpload({ name: 'a.mp4', size: MAX_BYTES }), { ok: true, large: true });
  assert.deepEqual(checkBeforeUpload({ name: 'a.jpg', size: LARGE_BYTES + 1 }), { ok: true, large: true });
  assert.deepEqual(checkBeforeUpload({ name: 'a.JPG', size: LARGE_BYTES }), { ok: true, large: false });
  assert.deepEqual(checkBeforeUpload({ name: 'a.heic', size: 10 }), { ok: false, error: unsupportedMessage('a.heic') });
  assert.equal(checkBeforeUpload({ name: 'noext', size: 10 }).ok, false);
});
