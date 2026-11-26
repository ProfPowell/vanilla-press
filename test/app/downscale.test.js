import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { planDownscale, downscaleImage } from '../../app/assets/js/downscale.js';

describe('planDownscale', () => {
  it('shrinks the long edge to the limit and keeps the proportions', () => {
    assert.deepEqual(planDownscale(4032, 3024, 2400), { width: 2400, height: 1800 });
    assert.deepEqual(planDownscale(3024, 4032, 2400), { width: 1800, height: 2400 });
  });
  it('leaves an image alone when it already fits', () => {
    assert.equal(planDownscale(1200, 800, 2400), null);
    assert.equal(planDownscale(2400, 2400, 2400), null);
  });
  it('refuses nonsense sizes', () => {
    assert.equal(planDownscale(0, 100, 2400), null);
    assert.equal(planDownscale(NaN, 100, 2400), null);
  });
});

describe('downscaleImage', () => {
  const blob = (type) => new Blob(['x'], { type });
  it('returns the original for a type it does not shrink', async () => {
    const gif = blob('image/gif');
    assert.equal(await downscaleImage(gif), gif);
    const svg = blob('image/svg+xml');
    assert.equal(await downscaleImage(svg), svg);
  });
  it('returns the original when the browser cannot decode it', async () => {
    const jpg = blob('image/jpeg');
    const saved = globalThis.createImageBitmap;
    globalThis.createImageBitmap = async () => { throw new Error('cannot decode'); };
    try { assert.equal(await downscaleImage(jpg), jpg); } finally { globalThis.createImageBitmap = saved; }
  });
  it('returns the original when it already fits, and closes the bitmap', async () => {
    const jpg = blob('image/jpeg');
    let closed = false;
    const saved = globalThis.createImageBitmap;
    globalThis.createImageBitmap = async () => ({ width: 1000, height: 500, close() { closed = true; } });
    try { assert.equal(await downscaleImage(jpg), jpg); } finally { globalThis.createImageBitmap = saved; }
    assert.equal(closed, true);
  });
  it('draws a JPEG at the planned size, named after the original with .jpg', async () => {
    const png = new File(['x'], 'Big Photo.PNG', { type: 'image/png' });
    const saved = { cib: globalThis.createImageBitmap, oc: globalThis.OffscreenCanvas };
    const drawn = {};
    globalThis.createImageBitmap = async () => ({ width: 4800, height: 2400, close() {} });
    globalThis.OffscreenCanvas = class {
      constructor(w, h) { drawn.size = [w, h]; }
      getContext() { return { fillRect() {}, drawImage(_b, x, y, w, h) { drawn.draw = [x, y, w, h]; } }; }
      async convertToBlob(opts) { drawn.opts = opts; return new Blob(['jpeg'], { type: 'image/jpeg' }); }
    };
    try {
      const out = await downscaleImage(png, { maxEdge: 2400, quality: 0.8 });
      assert.deepEqual(drawn.size, [2400, 1200]);
      assert.deepEqual(drawn.draw, [0, 0, 2400, 1200]);
      assert.deepEqual(drawn.opts, { type: 'image/jpeg', quality: 0.8 });
      assert.equal(out.name, 'Big Photo.jpg');
      assert.equal(out.type, 'image/jpeg');
    } finally { globalThis.createImageBitmap = saved.cib; globalThis.OffscreenCanvas = saved.oc; }
  });
});
