import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { readRawBody } from '../../src/server/router.js';

test('readRawBody returns the whole body under the limit', async () => {
  const req = new PassThrough();
  const done = readRawBody(req, { limit: 10 });
  req.write('hello');
  req.end('world');
  assert.equal((await done).toString(), 'helloworld');
});

test('readRawBody rejects with 413 past the limit and stops buffering', async () => {
  const req = new PassThrough();
  const done = readRawBody(req, { limit: 10 });
  req.write(Buffer.alloc(6));
  req.write(Buffer.alloc(6));
  await assert.rejects(done, (err) => err.status === 413 && err.received === 12);
  assert.equal(req.listenerCount('data'), 0);
  assert.equal(req.isPaused(), true);
});

test('readRawBody without a limit reads everything', async () => {
  const req = new PassThrough();
  const done = readRawBody(req);
  req.end(Buffer.alloc(100));
  assert.equal((await done).length, 100);
});
