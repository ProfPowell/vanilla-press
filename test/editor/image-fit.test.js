import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fitWithin } from '../../editor/assets/js/image-fit.js';

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
