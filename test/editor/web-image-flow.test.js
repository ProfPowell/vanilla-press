import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { chooseWebImage, DECODE_ERROR } from '../../editor/assets/js/web-image-flow.js';

// The flow in Node: fetch and createImageBitmap stubbed. A decode that fails
// stops before any canvas or upload, so each test shows which path ran.
describe('chooseWebImage', () => {
  let calls, realFetch, realDecode, importAnswer;
  beforeEach(() => {
    calls = [];
    realFetch = globalThis.fetch;
    realDecode = globalThis.createImageBitmap;
    importAnswer = () => Response.json({ id: 'm1', filename: 'openverse-1.jpg', kind: 'image' }, { status: 201 });
    globalThis.fetch = async (url, opts = {}) => {
      calls.push(`${opts.method || 'GET'} ${url}`);
      if (url.endsWith('/media/import')) return importAnswer();
      if (url.endsWith('/image')) return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/jpeg' } });
      return new Response(null, { status: 204 });
    };
    globalThis.createImageBitmap = async () => { throw new DOMException('The source image could not be decoded.', 'InvalidStateError'); };
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    globalThis.createImageBitmap = realDecode;
  });

  const result = (over) => ({ source: 'openverse', id: '1', mode: 'copy', width: 1280, height: 853, description: 'A fox', credit: { name: 'Jane', site: 'Openverse' }, ...over });

  it('a known size that fits is imported by the server', async () => {
    const item = await chooseWebImage(result());
    assert.equal(item.id, 'm1');
    assert.deepEqual(calls, ['POST /api/media/import']);
  });

  it('an unknown size is loaded through the proxy and measured, never imported blind', async () => {
    await assert.rejects(chooseWebImage(result({ width: 0, height: 0 })), { message: DECODE_ERROR });
    assert.deepEqual(calls, ['GET /api/web-images/openverse/1/image']);
  });

  it('an import refused as too large falls back to downsizing in the browser', async () => {
    importAnswer = () => Response.json({ error: 'Openverse sent an image larger than 25.0 MB' }, { status: 413 });
    await assert.rejects(chooseWebImage(result()), { message: DECODE_ERROR });
    assert.deepEqual(calls, ['POST /api/media/import', 'GET /api/web-images/openverse/1/image']);
  });

  it('another import error is shown as the server says it', async () => {
    importAnswer = () => Response.json({ error: 'Search again — this result has expired' }, { status: 404 });
    await assert.rejects(chooseWebImage(result()), { message: 'Search again — this result has expired' });
    assert.deepEqual(calls, ['POST /api/media/import']);
  });

  it('an image that cannot be decoded says so plainly, not the browser\'s words', async () => {
    assert.equal(DECODE_ERROR, "This image couldn't be opened. Try another one.");
    await assert.rejects(chooseWebImage(result({ width: 6000, height: 4000 })), { message: DECODE_ERROR });
  });

  it('a link result is added to the library as a linked item (the server pings Unsplash), and is that MediaItem', async () => {
    const linked = { id: 'm2', filename: 'unsplash-u1', kind: 'image', linked: true, src: 'https://images.unsplash.com/u1' };
    let body;
    importAnswer = () => Response.json(linked, { status: 201 });
    const real = globalThis.fetch;
    globalThis.fetch = async (url, opts = {}) => {
      if (String(url).endsWith('/media/import')) body = JSON.parse(opts.body);
      return real(url, opts);
    };
    const item = await chooseWebImage(result({ source: 'unsplash', id: 'u1', mode: 'link', url: 'https://images.unsplash.com/u1' }));
    assert.deepEqual(item, linked);
    assert.deepEqual(body, { source: 'unsplash', id: 'u1' });
    assert.deepEqual(calls, ['POST /api/media/import']); // no separate client ping
  });
});
