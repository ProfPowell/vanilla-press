import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';

// The "/" block menu in a real DOM (linkedom): which option Enter would pick
// must be visible and announced as the writer types or uses the arrow keys.
const win = parseHTML('<!doctype html><html><body></body></html>');
const GLOBALS = ['document', 'HTMLElement', 'customElements', 'CustomEvent', 'Event', 'Node'];
const saved = {};
let palette;

before(async () => {
  for (const k of GLOBALS) { saved[k] = globalThis[k]; globalThis[k] = win[k]; }
  win.HTMLElement.prototype.scrollIntoView ??= function scrollIntoView() {}; // linkedom has no layout
  const { BlockPalette } = await import('../../editor/assets/js/components/block-palette.js');
  palette = new BlockPalette();
  palette.render();
});
after(() => { for (const k of GLOBALS) globalThis[k] = saved[k]; });

const options = () => [...palette.el.querySelectorAll('.palette-item')];
const selectedIndex = () => options().findIndex((o) => o.getAttribute('aria-selected') === 'true');

describe('block menu: the option Enter would pick', () => {
  it('is a listbox of options, the first one selected', () => {
    assert.equal(palette.el.getAttribute('role'), 'listbox');
    assert.ok(options().length > 2);
    assert.ok(options().every((o) => o.getAttribute('role') === 'option' && o.id));
    assert.equal(selectedIndex(), 0);
    assert.equal(options().filter((o) => o.getAttribute('aria-selected') === 'true').length, 1);
  });

  it('moves with the arrow keys, and only one option is selected', () => {
    palette.moveDown();
    palette.moveDown();
    assert.equal(selectedIndex(), 2);
    assert.ok(options()[2].classList.contains('selected'));
    assert.equal(options().filter((o) => o.classList.contains('selected')).length, 1);
    palette.moveUp();
    assert.equal(selectedIndex(), 1);
  });

  it('starts again at the first match when the filter changes', () => {
    palette.filter = 'list';
    palette.selected = 0;
    palette.render();
    assert.equal(selectedIndex(), 0);
    assert.match(options()[0].textContent, /list/i);
  });
});

describe('block menu: a resting mouse pointer', () => {
  it('does not take the selection when the menu opens or scrolls under it', () => {
    palette.filter = '';
    palette.selected = 0;
    palette.render();
    // A still pointer that options pass under fires mouseenter/mouseover, not mousemove
    options()[2].dispatchEvent(new win.Event('mouseenter'));
    options()[2].dispatchEvent(new win.Event('mouseover', { bubbles: true }));
    assert.equal(selectedIndex(), 0);
    palette.moveDown();
    assert.equal(selectedIndex(), 1);
  });

  it('a moving pointer does select the option under it', () => {
    options()[3].dispatchEvent(new win.Event('mousemove', { bubbles: true }));
    assert.equal(selectedIndex(), 3);
  });
});

describe('block menu css', () => {
  const css = readFileSync(new URL('../../editor/assets/css/_palette.css', import.meta.url), 'utf8');
  it('the selected option stands out from the menu, not the page background', () => {
    const rule = css.match(/\.block-palette \.palette-item\.selected\s*\{([^}]*)\}/);
    assert.ok(rule, 'a rule of its own for .selected');
    assert.match(rule[1], /--color-interactive/);
    assert.doesNotMatch(rule[1], /var\(--color-background\)/);
  });
  it('a resting pointer leaves no second highlight (no :hover tint)', () => {
    assert.doesNotMatch(css, /\.palette-item:hover/);
  });
  it('forced-colors mode still shows it', () => {
    assert.match(css, /@media \(forced-colors: active\)[\s\S]*\.palette-item\.selected/);
  });
});
