import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { placePopover } from '../../editor/assets/js/popover-place.js';

describe('placePopover', () => {
  const viewport = { width: 1280, height: 800 };

  it('goes below when it fits', () => {
    const p = placePopover({ top: 100, bottom: 120, left: 50, right: 60 }, { width: 300, height: 200 }, viewport);
    assert.equal(p.side, 'below');
    assert.equal(p.top, 124);
    assert.equal(p.maxHeight, null);
  });

  it('flips above when below is too short but above fits', () => {
    const p = placePopover({ top: 770, bottom: 790, left: 50, right: 60 }, { width: 300, height: 360 }, viewport);
    assert.equal(p.side, 'above');
    assert.equal(p.top, 770 - 4 - 360);
    assert.equal(p.maxHeight, null);
  });

  it('with neither side fitting, takes the side with more room above and caps the height', () => {
    const p = placePopover({ top: 260, bottom: 280, left: 20, right: 30 }, { width: 300, height: 400 }, { width: 390, height: 500 });
    assert.equal(p.side, 'above');
    assert.equal(p.maxHeight, 248);
    assert.equal(p.top, 8);
  });

  it('with neither side fitting, takes the side with more room below', () => {
    const p = placePopover({ top: 200, bottom: 220, left: 20, right: 30 }, { width: 300, height: 400 }, { width: 390, height: 500 });
    assert.equal(p.side, 'below');
    assert.equal(p.top, 224);
    assert.equal(p.maxHeight, 268);
  });

  it('clamps left inside the viewport', () => {
    const p = placePopover({ top: 100, bottom: 120, left: 1200, right: 1210 }, { width: 300, height: 200 }, viewport);
    assert.equal(p.left, 1280 - 300 - 8);
    assert.equal(placePopover({ top: 100, bottom: 120, left: -50, right: -40 }, { width: 300, height: 200 }, viewport).left, 8);
  });

  it('prefer above with no room above goes below', () => {
    const p = placePopover({ top: 30, bottom: 50, left: 50, right: 60 }, { width: 200, height: 44 }, viewport, { prefer: 'above', gap: 8 });
    assert.equal(p.side, 'below');
    assert.equal(p.top, 58);
  });

  it('prefer above goes above when it fits', () => {
    const p = placePopover({ top: 300, bottom: 320, left: 50, right: 60 }, { width: 200, height: 44 }, viewport, { prefer: 'above', gap: 8 });
    assert.equal(p.side, 'above');
    assert.equal(p.top, 248);
  });
});
