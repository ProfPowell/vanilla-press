import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

// The save bar in a real DOM (linkedom).
const win = parseHTML('<!doctype html><html><body></body></html>');
const GLOBALS = ['document', 'HTMLElement', 'customElements', 'CustomEvent', 'Event', 'Node'];
const saved = {};
let bar;

before(async () => {
  for (const k of GLOBALS) { saved[k] = globalThis[k]; globalThis[k] = win[k]; }
  await import('../../editor/assets/js/components/save-bar.js');
});
after(() => { for (const k of GLOBALS) globalThis[k] = saved[k]; });

function fresh() {
  win.document.body.innerHTML = '<save-bar hidden></save-bar>';
  bar = win.document.querySelector('save-bar');
  return bar;
}
const buttons = () => [...bar.querySelectorAll('button')];
const labels = () => buttons().map((b) => b.textContent);
const click = (label) => buttons().find((b) => b.textContent === label).dispatchEvent(new win.Event('click'));
const AT = new Date(Date.now() - 2 * 60000).toISOString();

describe('save bar', () => {
  it('an error is role=alert and stays until clear()', () => {
    fresh().show({ tone: 'error', text: 'Save failed', actions: [{ label: 'Try again', run() {} }] });
    assert.equal(bar.hidden, false);
    assert.equal(bar.getAttribute('role'), 'alert');
    assert.ok(bar.textContent.includes('Save failed'));
    click('Try again');
    assert.equal(bar.hidden, false);
    bar.clear();
    assert.equal(bar.hidden, true);
    assert.equal(bar.textContent, '');
  });

  it('warn and info are role=status; the text is shown verbatim', () => {
    fresh().show({ tone: 'warn', text: "Unsaved work isn't protected in this browser", actions: [] });
    assert.equal(bar.getAttribute('role'), 'status');
    assert.ok(bar.textContent.includes("Unsaved work isn't protected in this browser"));
    bar.show({ tone: 'info', text: 'x', actions: [] });
    assert.equal(bar.getAttribute('role'), 'status');
  });

  it('text is never parsed as HTML', () => {
    fresh().show({ tone: 'error', text: '<b>hi</b>', actions: [] });
    assert.equal(bar.querySelector('b'), null);
  });

  it('a restore offer has three buttons; Restore runs once and hides the bar', () => {
    let n = 0;
    fresh().showRestore({ kind: 'restore', at: AT }, { differences: ['Title changed'], onRestore: () => n++, onRestoreAsNew() {}, onDiscard() {} });
    assert.deepEqual(labels(), ['Restore', 'Show differences', 'Discard']);
    assert.ok(bar.textContent.includes('Unsaved changes from 2 minutes ago'));
    click('Restore');
    assert.equal(n, 1);
    assert.equal(bar.hidden, true);
  });

  it('a stale offer has exactly Restore as a new draft and Discard', () => {
    let a = 0, d = 0;
    fresh().showRestore({ kind: 'stale', at: AT }, { differences: [], onRestore() {}, onRestoreAsNew: () => a++, onDiscard: () => d++ });
    assert.deepEqual(labels(), ['Restore as a new draft', 'Discard']);
    assert.ok(bar.textContent.includes('Unsaved changes from 2 minutes ago, made before this post was changed elsewhere'));
    click('Restore as a new draft');
    assert.equal(a, 1);
    assert.equal(bar.hidden, true);
    fresh().showRestore({ kind: 'stale', at: AT }, { differences: [], onRestore() {}, onRestoreAsNew() {}, onDiscard: () => d++ });
    click('Discard');
    assert.equal(d, 1);
    assert.equal(bar.hidden, true);
  });

  it('Show differences toggles a list of the lines', () => {
    fresh().showRestore({ kind: 'restore', at: AT }, { differences: ['Title changed', 'Body is longer'], onRestore() {}, onRestoreAsNew() {}, onDiscard() {} });
    const btn = buttons().find((b) => b.textContent === 'Show differences');
    assert.equal(btn.getAttribute('aria-expanded'), 'false');
    assert.equal(bar.querySelector('ul').hidden, true);
    btn.dispatchEvent(new win.Event('click'));
    assert.equal(btn.getAttribute('aria-expanded'), 'true');
    const ul = bar.querySelector('ul');
    assert.equal(ul.hidden, false);
    assert.deepEqual([...ul.querySelectorAll('li')].map((l) => l.textContent), ['Title changed', 'Body is longer']);
    btn.dispatchEvent(new win.Event('click'));
    assert.equal(ul.hidden, true);
  });

  it('show() replaces a restore offer', () => {
    fresh().showRestore({ kind: 'restore', at: AT }, { differences: ['a'], onRestore() {}, onRestoreAsNew() {}, onDiscard() {} });
    bar.show({ tone: 'error', text: 'Save failed', actions: [] });
    assert.deepEqual(labels(), []);
    assert.equal(bar.querySelector('ul'), null);
  });
});
