import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUploadQueue } from '../../editor/assets/js/media-upload.js';
import { tooLargeMessage, LARGE_NOTE, MAX_BYTES } from '../../src/media/limits.js';

const file = (name, size = 10) => ({ name, size });
const settle = () => new Promise((r) => setTimeout(r, 0));
const done = async (q) => { for (let i = 0; i < 50 && q.entries().some((e) => e.state === 'waiting' || e.state === 'uploading'); i++) await settle(); };

test('one failed file never stops the others', async () => {
  const upload = async (f) => {
    if (f.name === 'b.jpg') throw new Error('b.jpg is not really a JPEG.');
    return { id: f.name, filename: f.name };
  };
  const q = createUploadQueue({ upload });
  q.add([file('a.jpg'), file('b.jpg'), file('c.jpg')]);
  await done(q);
  const [a, b, c] = q.entries();
  assert.equal(a.state, 'done');
  assert.equal(c.state, 'done');
  assert.equal(b.state, 'error');
  assert.equal(b.error, 'b.jpg is not really a JPEG.');
  assert.equal(a.item.filename, 'a.jpg');
});

test('too-large file errors without uploading', async () => {
  const calls = [];
  const q = createUploadQueue({ upload: async (f) => { calls.push(f.name); return { id: f.name }; } });
  q.add([file('huge.mp4', MAX_BYTES + 1), file('ok.jpg')]);
  await done(q);
  assert.deepEqual(calls, ['ok.jpg']);
  const huge = q.entries()[0];
  assert.equal(huge.state, 'error');
  assert.equal(huge.error, tooLargeMessage('huge.mp4', MAX_BYTES + 1));
});

test('unsupported name errors without uploading', async () => {
  const calls = [];
  const q = createUploadQueue({ upload: async (f) => { calls.push(f.name); return {}; } });
  q.add([file('x.heic')]);
  assert.equal(q.entries()[0].state, 'error');
  assert.match(q.entries()[0].error, /x\.heic isn't a file type/);
  assert.deepEqual(calls, []);
});

test('large file gets the note', async () => {
  const q = createUploadQueue({ upload: async (f) => ({ id: f.name, large: f.name === 'big.jpg' }) });
  q.add([file('big.jpg'), file('small.jpg')]);
  await done(q);
  assert.equal(q.entries()[0].note, LARGE_NOTE);
  assert.equal(q.entries()[1].note, null);
});

test('runs at most two at a time', async () => {
  let running = 0, peak = 0;
  const upload = async (f) => {
    running++; peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 5));
    running--;
    return { id: f.name };
  };
  const q = createUploadQueue({ upload });
  q.add([1, 2, 3, 4, 5].map((n) => file(`f${n}.jpg`)));
  assert.equal(q.entries().filter((e) => e.state === 'uploading').length, 2);
  await done(q);
  assert.equal(peak, 2);
  assert.ok(q.entries().every((e) => e.state === 'done'));
});

test('progress reaches the entry', async () => {
  let report;
  const gate = new Promise((r) => { report = r; });
  const seen = [];
  const q = createUploadQueue({
    upload: async (f, { onProgress }) => { onProgress(0.5); seen.push(q.entries()[0].progress); await gate; return { id: f.name }; },
  });
  q.add([file('a.jpg')]);
  await settle();
  assert.deepEqual(seen, [0.5]);
  report();
  await done(q);
  assert.equal(q.entries()[0].progress, 1);
});

test('onChange fires on changes; dismiss removes finished entries only', async () => {
  let n = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const q = createUploadQueue({ upload: async (f) => { if (f.name === 'slow.jpg') await gate; return { id: f.name }; }, onChange: () => { n++; } });
  q.add([file('slow.jpg'), file('x.heic')]);
  assert.ok(n > 0);
  const [slow, bad] = q.entries();
  q.dismiss(slow.key);
  assert.equal(q.entries().length, 2, 'uploading entry stays');
  q.dismiss(bad.key);
  assert.equal(q.entries().length, 1);
  release();
  await done(q);
  q.dismiss(slow.key);
  assert.equal(q.entries().length, 0);
});

test('uploadMedia options are passed through', async () => {
  let opts;
  const q = createUploadQueue({ upload: async (f, o) => { opts = o; return {}; } });
  q.add([file('a.jpg')]);
  await done(q);
  assert.equal(typeof opts.onProgress, 'function');
});
