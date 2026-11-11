import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fitWithin, importPath } from '../../editor/assets/js/image-fit.js';

describe('fitWithin', () => {
  it('scales a landscape image down to 2400 on the long edge', () => {
    assert.deepEqual(fitWithin(6000, 4000), { width: 2400, height: 1600, scaled: true });
  });

  it('leaves an image that already fits alone', () => {
    assert.deepEqual(fitWithin(1280, 853), { width: 1280, height: 853, scaled: false });
    assert.deepEqual(fitWithin(2400, 2400), { width: 2400, height: 2400, scaled: false });
  });

  it('scales a portrait image by its height', () => {
    assert.deepEqual(fitWithin(3000, 6000), { width: 1200, height: 2400, scaled: true });
  });

  it('takes another limit', () => {
    assert.deepEqual(fitWithin(1000, 500, 100), { width: 100, height: 50, scaled: true });
  });

  it('never rounds an edge to zero', () => {
    assert.deepEqual(fitWithin(10000, 1), { width: 2400, height: 1, scaled: true });
  });

  it('unknown sizes are not scaled', () => {
    assert.deepEqual(fitWithin(0, 0), { width: 0, height: 0, scaled: false });
    assert.deepEqual(fitWithin(undefined, 300), { width: 0, height: 300, scaled: false });
  });
});

describe('importPath', () => {
  const copy = (over) => ({ source: 'openverse', id: '1', mode: 'copy', width: 1280, height: 853, ...over });

  it('an Unsplash result is used by link, even when asked to edit', () => {
    assert.equal(importPath(copy({ source: 'unsplash', mode: 'link' }), { edit: false }), 'link');
    assert.equal(importPath(copy({ source: 'unsplash', mode: 'link' }), { edit: true }), 'link');
  });

  it('Edit first edits, whatever the size', () => {
    assert.equal(importPath(copy(), { edit: true }), 'edit');
    assert.equal(importPath(copy({ width: 0, height: 0 }), { edit: true }), 'edit');
  });

  it('a known size over 2400px is downsized in the browser', () => {
    assert.equal(importPath(copy({ width: 6000, height: 4000 }), { edit: false }), 'downsize');
  });

  it('an unknown size is probed: loaded and measured, never imported blind', () => {
    for (const size of [{ width: 0, height: 0 }, { width: 0, height: 900 }, { width: 900, height: null }, { width: undefined, height: undefined }]) {
      assert.equal(importPath(copy(size), { edit: false }), 'probe', JSON.stringify(size));
    }
  });

  it('a known size that fits is imported by the server', () => {
    assert.equal(importPath(copy(), { edit: false }), 'import');
    assert.equal(importPath(copy({ width: 2400, height: 1600 })), 'import');
  });
});
