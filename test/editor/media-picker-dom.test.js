import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

// The media picker's library tab in a real DOM (linkedom), with fetch stubbed.
const win = parseHTML('<!doctype html><html><body></body></html>');
const GLOBALS = ['document', 'HTMLElement', 'customElements', 'CustomEvent', 'Event', 'Node'];
const saved = {};
let openMediaPicker, list;

before(async () => {
  for (const k of GLOBALS) { saved[k] = globalThis[k]; globalThis[k] = win[k]; }
  saved.fetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json(list);
  // linkedom has no modal dialogs
  const proto = win.document.createElement('dialog').constructor.prototype;
  proto.showModal ??= function showModal() { this.setAttribute('open', ''); };
  proto.close ??= function close() { this.removeAttribute('open'); };
  ({ openMediaPicker } = await import('../../editor/assets/js/components/media-picker.js'));
});
after(() => {
  for (const k of GLOBALS) globalThis[k] = saved[k];
  globalThis.fetch = saved.fetch;
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const U = 'https://images.unsplash.com/photo-1?w=2400&fit=max&q=80&auto=format';

describe('media picker library tab', () => {
  it('a linked item shows its remote thumbnail and a "Linked" marker in words, and can be chosen', async () => {
    list = [
      { id: 'u', filename: 'unsplash-u1', kind: 'image', mime_type: 'image/jpeg', alt: 'A hill', linked: true, src: U, missing: false, created: '2026-11-02' },
      { id: 'a', filename: 'a.jpg', kind: 'image', mime_type: 'image/jpeg', alt: 'A', linked: false, src: '/media/a.jpg', missing: false, created: '2026-11-01' },
    ];
    const chosen = openMediaPicker({ kind: 'image' });
    await tick(); await tick();
    const tiles = [...win.document.querySelectorAll('.media-picker-tile')];
    assert.equal(tiles.length, 2);
    assert.equal(tiles[0].querySelector('img').getAttribute('src'), U);
    const marker = tiles[0].querySelector('[data-badge="linked"]');
    assert.equal(marker?.textContent, 'Linked');
    assert.equal(tiles[1].querySelector('[data-badge="linked"]'), null);
    assert.equal(tiles[0].textContent.includes('Linked from Unsplash'), false);
    tiles[0].dispatchEvent(new win.Event('click'));
    assert.equal((await chosen).id, 'u');
  });
});
