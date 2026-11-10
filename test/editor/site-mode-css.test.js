import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'editor', 'assets', 'css', '_site-mode.css'), 'utf8');

/** The declarations of the rule whose selector list includes `selector`, or null. */
function ruleFor(selector) {
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const selectors = m[1].replace(/\/\*[\s\S]*?\*\//g, '').split(',').map((s) => s.trim());
    if (selectors.includes(selector)) return m[2];
  }
  return null;
}

describe('editor site-mode css', () => {
  // VB styles `header` (and other elements) with a display, which beats the UA
  // [hidden] rule: without this the app header shows in `vp serve`.
  for (const selector of ['.site-header[hidden]', '.site-header .action-report[hidden]', '.site-header button[hidden]', '.more-menu [role=menu][hidden]']) {
    it(`${selector} is display: none !important`, () => {
      const decls = ruleFor(selector);
      assert.ok(decls, `no rule for ${selector}`);
      assert.match(decls, /display:\s*none\s*!important/);
    });
  }
});

describe('editor prosemirror css', () => {
  const pm = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'editor', 'assets', 'css', '_prosemirror.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  it('hiding the selection for a selected block spares the fields inside it (figure Src/Alt, embed URL)', () => {
    const rules = [...pm.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((m) => /ProseMirror-hideselection/.test(m[1]) && /::selection/.test(m[1]));
    assert.ok(rules.length > 0, 'no hide-selection ::selection rule');
    for (const [, selector] of rules) assert.match(selector, /:not\(input,\s*textarea\)::selection/, selector.trim());
  });
});
