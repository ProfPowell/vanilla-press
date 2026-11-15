import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

// <versions-list> in a real DOM (linkedom).
const win = parseHTML('<!doctype html><html><body></body></html>');
const GLOBALS = ['document', 'HTMLElement', 'customElements', 'CustomEvent', 'Event', 'Node'];
const saved = {};
let list;

before(async () => {
  for (const k of GLOBALS) { saved[k] = globalThis[k]; globalThis[k] = win[k]; }
  await import('../../editor/assets/js/components/versions-list.js');
});
after(() => { for (const k of GLOBALS) globalThis[k] = saved[k]; });

function fresh() {
  win.document.body.innerHTML = '<versions-list></versions-list>';
  list = win.document.querySelector('versions-list');
  return list;
}
const NOW = Date.parse('2026-11-14T12:00:00Z');
const ago = (min) => new Date(NOW - min * 60000).toISOString();
const rows = () => [...list.querySelectorAll('li')];
const click = (node) => node.dispatchEvent(new win.Event('click'));
const btn = (row, label) => [...row.querySelectorAll('button')].find((b) => b.textContent === label);

describe('versions list', () => {
  it('lists versions as given (newest first) with relative times', () => {
    fresh().render([{ at: ago(2) }, { at: ago(120) }], { now: NOW });
    assert.equal(rows().length, 2);
    assert.ok(rows()[0].textContent.includes('2 minutes ago'));
    assert.ok(rows()[1].textContent.includes('2 hours ago'));
  });

  it('labels offered copies "Unsaved copy" and discarded ones "Discarded copy"', () => {
    fresh().render([{ at: ago(1), discarded: true }, { at: ago(2), offered: true }, { at: ago(3) }], { now: NOW });
    assert.ok(rows()[0].textContent.includes('Discarded copy'));
    assert.ok(rows()[1].textContent.includes('Unsaved copy'));
    assert.equal(rows()[2].textContent.includes('copy'), false);
  });

  it('Restore calls onRestore with that version', () => {
    const v = [{ at: ago(1), meta: { title: 'A' } }, { at: ago(5), meta: { title: 'B' } }];
    const got = [];
    fresh().render(v, { now: NOW, onRestore: (x) => got.push(x) });
    click(btn(rows()[1], 'Restore'));
    assert.deepEqual(got, [v[1]]);
  });

  it('Look shows the differences inline, and again hides them', () => {
    const v = { at: ago(1) };
    fresh().render([v], { now: NOW, onLook: (x) => (x === v ? ['Title changed', 'Body: 2 blocks added'] : []) });
    click(btn(rows()[0], 'Look'));
    const lines = [...rows()[0].querySelectorAll('[data-differences] li')].map((n) => n.textContent);
    assert.deepEqual(lines, ['Title changed', 'Body: 2 blocks added']);
    click(btn(rows()[0], 'Look'));
    assert.equal(rows()[0].querySelector('[data-differences]'), null);
  });

  it('Look on a copy that matches the post says so', () => {
    fresh().render([{ at: ago(1) }], { now: NOW, onLook: () => [] });
    click(btn(rows()[0], 'Look'));
    assert.ok(rows()[0].textContent.includes('Same as the post now'));
  });

  it('Restore is disabled when restoring is not allowed (another tab edits)', () => {
    const got = [];
    fresh().render([{ at: ago(1) }], { now: NOW, canRestore: () => false, onRestore: (x) => got.push(x) });
    assert.equal(btn(rows()[0], 'Restore').disabled, true);
    click(btn(rows()[0], 'Restore'));
    assert.equal(got.length, 0);
  });

  it('an empty list says there are no earlier versions', () => {
    fresh().render([], { now: NOW });
    assert.equal(rows().length, 0);
    assert.ok(list.textContent.includes('No earlier versions in this browser yet'));
  });
});
