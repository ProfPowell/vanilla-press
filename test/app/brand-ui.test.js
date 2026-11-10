/**
 * The branded chrome (app/assets/brand-ui.css): VB semantic tokens mapped to
 * the Bloom Seal brand, light and dark, every text pair at least 4.5:1 and the
 * focus ring at least 3:1. The writing area keeps the site theme: the pane
 * always carries `data-theme`, so VB re-declares its tokens there.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyPaneTheme } from '../../editor/assets/js/pane-theme.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const brandCss = stripComments(read('app', 'assets', 'brand-ui.css'));
const tokensCss = stripComments(read('docs', 'design', 'brand', 'tokens.css'));

/** `--name: value` declarations in a chunk of CSS, as a Map. */
function decls(css) {
  const map = new Map();
  for (const m of css.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)) map.set(m[1], m[2].trim());
  return map;
}

const brand = decls(tokensCss);
const DARK = /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)/;
const [lightCss, darkCss = ''] = brandCss.split(DARK);
const light = decls(lightCss);
const dark = new Map([...light, ...decls(darkCss)]);

/** A token's value as hex, following var() through the scheme's own tokens and the brand tokens. */
function hex(scheme, name, seen = new Set()) {
  assert.ok(!seen.has(name), `var() loop at ${name}`);
  seen.add(name);
  const value = scheme.get(name) ?? brand.get(name);
  assert.ok(value, `${name} is not declared`);
  const ref = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value);
  if (ref) return hex(scheme, ref[1], seen);
  assert.match(value, /^#[0-9a-f]{6}$/i, `${name} resolves to ${value}, not a hex color`);
  return value.toUpperCase();
}

/** WCAG 2 relative luminance of a #RRGGBB color. */
function luminance(color) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT_PAIRS = [
  ['--color-text', '--color-background'],
  ['--color-text-muted', '--color-background'],
  ['--color-text-subtle', '--color-background'],
  ['--color-text', '--color-surface-raised'],
  ['--color-text-muted', '--color-surface-raised'],
  ['--color-text-subtle', '--color-surface-raised'],
  ['--color-text-on-primary', '--color-primary'],
  ['--color-primary', '--color-background'],
  // Selected nav item and hover: text on surface-alt
  ['--color-text', '--color-surface-alt'],
  ['--color-text-muted', '--color-surface-alt'],
];

const OVERRIDDEN = [
  '--color-background', '--color-surface-raised', '--color-surface-alt', '--color-border',
  '--color-border-subtle', '--color-text', '--color-text-muted', '--color-text-subtle',
  '--color-primary', '--color-interactive', '--color-text-on-primary',
];

describe('brand-ui.css tokens', () => {
  for (const [label, scheme] of [['light', light], ['dark', dark]]) {
    it(`${label}: declares every chrome token`, () => {
      for (const name of OVERRIDDEN) assert.ok(hex(scheme, name), name);
    });

    for (const [fg, bg] of TEXT_PAIRS) {
      it(`${label}: ${fg} on ${bg} is at least 4.5:1`, () => {
        const ratio = contrast(hex(scheme, fg), hex(scheme, bg));
        assert.ok(ratio >= 4.5, `${hex(scheme, fg)} on ${hex(scheme, bg)} is ${ratio.toFixed(2)}:1`);
      });
    }

    it(`${label}: the focus ring (primary on background) is at least 3:1`, () => {
      const ratio = contrast(hex(scheme, '--color-primary'), hex(scheme, '--color-background'));
      assert.ok(ratio >= 3, `${ratio.toFixed(2)}:1`);
    });

    it(`${label}: interactive is the primary color`, () => {
      assert.equal(hex(scheme, '--color-interactive'), hex(scheme, '--color-primary'));
    });
  }

  it('dark: muted and subtle stay readable on surface-alt too', () => {
    for (const fg of ['--color-text-subtle', '--color-primary']) {
      const ratio = contrast(hex(dark, fg), hex(dark, '--color-surface-alt'));
      assert.ok(ratio >= 4.5, `${fg}: ${ratio.toFixed(2)}:1`);
    }
  });

  it('light: the fixed in-between values and brand colors', () => {
    assert.equal(hex(light, '--color-background'), '#FFFAF0');
    assert.equal(hex(light, '--color-surface-raised'), '#F4EDE0');
    assert.equal(hex(light, '--color-surface-alt'), '#EAE0CC');
    assert.equal(hex(light, '--color-border'), '#DCD1BD');
    assert.equal(hex(light, '--color-border-subtle'), '#ECE3D2');
    assert.equal(hex(light, '--color-text'), '#1A2133');
    assert.equal(hex(light, '--color-text-muted'), '#4A5164');
    assert.equal(hex(light, '--color-text-subtle'), '#5F6577');
    assert.equal(hex(light, '--color-primary'), '#23314F');
    assert.equal(hex(light, '--color-text-on-primary'), '#F7EEDB');
  });

  it('dark: ink-rim, ink, petal and vanilla with ink on it', () => {
    assert.equal(hex(dark, '--color-background'), '#141C30');
    assert.equal(hex(dark, '--color-surface-raised'), '#23314F');
    assert.equal(hex(dark, '--color-text'), '#F7EEDB');
    assert.equal(hex(dark, '--color-primary'), '#ECD89A');
    assert.equal(hex(dark, '--color-text-on-primary'), '#23314F');
  });

  it('dark: borders are a lighter ink than the background', () => {
    const bg = luminance(hex(dark, '--color-background'));
    assert.ok(luminance(hex(dark, '--color-border')) > luminance(hex(dark, '--color-surface-raised')));
    assert.ok(luminance(hex(dark, '--color-border-subtle')) > bg);
  });

  it('brand colors come from tokens.css, not repeated as hex', () => {
    const brandHex = new Set([...brand.values()].filter((v) => /^#[0-9a-f]{6}$/i.test(v)).map((v) => v.toUpperCase()));
    for (const m of brandCss.matchAll(/#[0-9a-f]{6}\b/gi)) {
      assert.ok(!brandHex.has(m[0].toUpperCase()), `${m[0]} is a brand token: use var(--vp-brand-…)`);
    }
  });
});

describe('brand-ui.css structure', () => {
  it('declares Fraunces from /brand/fonts/', () => {
    const face = /@font-face\s*\{([^}]*)\}/.exec(brandCss);
    assert.ok(face, 'no @font-face');
    assert.match(face[1], /font-family:\s*Fraunces\s*;/);
    assert.match(face[1], /src:\s*url\(\/brand\/fonts\/fraunces-latin-wght-normal\.woff2\)\s*format\(['"]woff2['"]\)/);
    assert.match(face[1], /font-weight:\s*100 900/);
    assert.match(face[1], /font-display:\s*swap/);
  });

  it('has a prefers-color-scheme: dark block', () => {
    assert.match(brandCss, DARK);
  });

  it('sits in its own layer', () => {
    assert.match(brandCss, /@layer\s+[\w-]+\s*\{/);
  });

  it('gives Task 6 the title font', () => {
    assert.equal(light.get('--vp-title-font'), 'var(--vp-brand-font-display)');
  });

  for (const page of [['app', 'index.html'], ['app', 'site.html'], ['editor', 'index.html']]) {
    it(`${page.join('/')} links tokens.css and brand-ui.css right after vanilla-breeze.css`, () => {
      const links = [...read(...page).matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
      const vb = links.indexOf('/assets/vb/vanilla-breeze.css');
      assert.ok(vb >= 0, 'no vanilla-breeze.css');
      assert.deepEqual(links.slice(vb + 1, vb + 3), ['/brand/tokens.css', '/app/assets/brand-ui.css']);
    });
  }

  it('the editor pane starts with a data-theme, so VB re-declares the site tokens there', () => {
    assert.match(read('editor', 'index.html'), /<main class="editor-pane" data-theme="">/);
  });
});

/** A tiny element: attributes only. */
function fakeEl() {
  const attrs = new Map();
  return {
    attrs,
    setAttribute: (k, v) => attrs.set(k, String(v)),
    removeAttribute: (k) => attrs.delete(k),
    hasAttribute: (k) => attrs.has(k),
    getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
  };
}

describe('applyPaneTheme keeps the writing area unbranded', () => {
  it('a site with no theme leaves data-theme="" on the pane, not no attribute', () => {
    const pane = fakeEl();
    const content = fakeEl();
    const doc = {
      querySelector: (s) => ({ '.editor-pane': pane, '.editor-content': content }[s] || null),
      querySelectorAll: () => [],
      head: { append() {} },
    };
    pane.setAttribute('data-theme', 'swiss');
    applyPaneTheme({ pane: { ids: '', mode: null }, content: null, strip: null, chip: null, hrefs: [] }, doc);
    assert.equal(pane.getAttribute('data-theme'), '');
    assert.equal(content.hasAttribute('data-theme'), false);
  });
});
