import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';

// The Services screen in a real DOM (linkedom), with fetch stubbed and each PUT held
// until the test answers it. Never hand a linkedom node to assert (it inspects forever).
const page = readFileSync(new URL('../../app/services.html', import.meta.url), 'utf8');
const win = parseHTML(page.replace(/<script[^>]*><\/script>/g, ''));
const GLOBALS = ['window', 'document', 'HTMLElement'];
const saved = {};

const svc = (id, label, over = {}) => ({ id, label, needsKey: true, hasKey: false, enabled: true, ready: false, signupUrl: `https://${id}.test/`, ...over });
let state;
let pending; // [{ id, body, resolve(ok) }]

function stateOf(id) {
  return state.groups[0].services.find((s) => s.id === id);
}

before(async () => {
  for (const k of GLOBALS) { saved[k] = globalThis[k]; globalThis[k] = k === 'window' ? win : win[k]; }
  saved.fetch = globalThis.fetch;
  state = {
    groups: [
      { id: 'image-search', label: 'Image search', services: [
        svc('openverse', 'Openverse', { needsKey: false, ready: true, signupUrl: null }),
        svc('pexels', 'Pexels'),
      ] },
      { id: 'ai', label: 'AI generation', services: [] },
    ],
  };
  globalThis.fetch = (url, init = {}) => {
    if (init.method !== 'PUT') return Promise.resolve(Response.json(state));
    const id = decodeURIComponent(String(url).split('/').pop());
    const body = JSON.parse(init.body);
    return new Promise((resolve) => {
      pending.push({
        id, body,
        resolve(ok = true) {
          if (!ok) return resolve(Response.json({ error: 'Disk full' }, { status: 500 }));
          const s = stateOf(id);
          if (body.key !== undefined) s.hasKey = Boolean(body.key);
          if (body.enabled !== undefined) s.enabled = body.enabled;
          s.ready = s.enabled && (!s.needsKey || s.hasKey);
          resolve(Response.json({ ...s }));
        },
      });
    });
  };
  pending = [];
  await import('../../app/assets/js/services-page.js');
  await tick();
});
after(() => {
  for (const k of GLOBALS) globalThis[k] = saved[k];
  globalThis.fetch = saved.fetch;
});
beforeEach(() => { pending = []; });

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
const $ = (sel) => win.document.querySelector(sel);
const card = (id) => $(`.service-card[data-id="${id}"]`);
const keyInput = () => $('#service-pexels-key');
const sw = (id) => card(id).querySelector('input[data-action="toggle"]');

function submitKey(value) {
  keyInput().value = value;
  card('pexels').querySelector('form').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
}
// linkedom's `checked` property starts undefined: it does not read the attribute
const isOn = (id) => sw(id).checked ?? sw(id).hasAttribute('checked');
function flip(id) {
  const box = sw(id);
  box.checked = !isOn(id);
  box.dispatchEvent(new win.Event('change', { bubbles: true }));
}
const busyControls = (id) => [...card(id).querySelectorAll('input, button')].filter((c) => c.disabled).length;
const allControls = (id) => card(id).querySelectorAll('input, button').length;

describe('Services screen: the live region', () => {
  it('is never display:none, so its updates are announced', () => {
    const css = readFileSync(new URL('../../app/assets/app.css', import.meta.url), 'utf8');
    const rules = [...css.matchAll(/([^{}]*\.services-status[^{}]*)\{([^}]*)\}/g)];
    assert.ok(rules.length > 0, 'a .services-status rule');
    for (const [, sel, body] of rules) assert.doesNotMatch(body, /display:\s*none/, sel.trim());
    assert.equal($('#status').getAttribute('role'), 'status');
    assert.equal($('#status').hasAttribute('hidden'), false);
  });
});

describe('Services screen: saving a key', () => {
  it('keeps the pasted key in the field while saving and after a failed save, and says why', async () => {
    submitKey('  my-key  ');
    assert.equal(pending.length, 1);
    assert.deepEqual(pending[0].body, { key: 'my-key' });
    assert.equal(keyInput().value, '  my-key  ', 'still there while the save is in flight');
    pending[0].resolve(false);
    await tick();
    assert.equal(keyInput().value, '  my-key  ', 'still there after the failure');
    assert.equal($('#error').hidden, false);
    assert.equal($('#error').textContent, 'Disk full');
    assert.equal(busyControls('pexels'), 0, 'the card is usable again');
  });

  it('empties the field once the save succeeds', async () => {
    submitKey('my-key');
    pending[0].resolve();
    await tick();
    assert.equal(keyInput().value, '');
    assert.equal($('#error').hidden, true);
    assert.equal(card('pexels').querySelector('.service-status').textContent.replace('Status: ', '').trim(), 'Ready');
    assert.equal($('#status').textContent.trim(), 'Pexels key saved. Ready.');
  });

  it('a second identical result is still new text, so it is read again', async () => {
    const first = $('#status').textContent;
    submitKey('my-other-key');
    pending[0].resolve();
    await tick();
    assert.equal($('#status').textContent.trim(), 'Pexels key saved. Ready.');
    assert.notEqual($('#status').textContent, first);
  });
});

describe('Services screen: the switch and an unsaved key', () => {
  it('flipping the switch keeps a key that was pasted but not saved', async () => {
    keyInput().value = 'pasted-not-saved';
    flip('pexels');
    pending[0].resolve();
    await tick();
    assert.equal(isOn('pexels'), false);
    assert.equal(keyInput().value, 'pasted-not-saved');
    flip('pexels');
    pending[1].resolve();
    await tick();
    assert.equal(keyInput().value, 'pasted-not-saved');
    keyInput().value = '';
  });
});

describe('Services screen: one save at a time per card', () => {
  it('a card is busy, its controls disabled, until its save finishes', async () => {
    flip('openverse');
    assert.equal(card('openverse').getAttribute('aria-busy'), 'true');
    assert.equal(busyControls('openverse'), allControls('openverse'));
    assert.equal(busyControls('pexels'), 0, 'other cards stay usable');
    pending[0].resolve();
    await tick();
    assert.equal(card('openverse').hasAttribute('aria-busy'), false);
    assert.equal(busyControls('openverse'), 0);
    assert.equal(isOn('openverse'), false);
    flip('openverse');
    pending[1].resolve();
    await tick();
  });

  it('a failed toggle flips back and frees the card', async () => {
    flip('openverse');
    pending[0].resolve(false);
    await tick();
    assert.equal(isOn('openverse'), true);
    assert.equal(card('openverse').hasAttribute('aria-busy'), false);
    assert.equal(busyControls('openverse'), 0);
    assert.equal($('#error').textContent, 'Disk full');
  });

  it('a second change while busy sends nothing', async () => {
    flip('openverse');
    flip('openverse'); // a disabled switch in a browser fires no change; even if one arrives, it is ignored
    assert.equal(pending.length, 1);
    pending[0].resolve();
    await tick();
    assert.equal(isOn('openverse'), false);
    flip('openverse');
    pending[1].resolve();
    await tick();
  });
});
