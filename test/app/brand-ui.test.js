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
import { applyPaneTheme, paneTheme } from '../../editor/assets/js/pane-theme.js';

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
  // Inputs, palettes and menus: text on surface
  ['--color-text', '--color-surface'],
  ['--color-text-muted', '--color-surface'],
  ['--color-text-subtle', '--color-surface'],
  ['--color-primary', '--color-surface'],
  ['--color-text-on-primary', '--color-primary'],
  ['--color-primary', '--color-background'],
  // Selected nav item and hover: text on surface-alt
  ['--color-text', '--color-surface-alt'],
  ['--color-text-muted', '--color-surface-alt'],
];

const OVERRIDDEN = [
  '--color-background', '--color-surface', '--color-surface-raised', '--color-surface-alt', '--color-border',
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

    it(`${label}: inputs and menus (surface) stand apart from raised panels`, () => {
      assert.notEqual(hex(scheme, '--color-surface'), hex(scheme, '--color-surface-raised'));
    });

    it(`${label}: interactive is the primary color`, () => {
      assert.equal(hex(scheme, '--color-interactive'), hex(scheme, '--color-primary'));
    });
  }

  it('dark: subtle and primary stay readable on surface-alt too', () => {
    for (const fg of ['--color-text-subtle', '--color-primary']) {
      const ratio = contrast(hex(dark, fg), hex(dark, '--color-surface-alt'));
      assert.ok(ratio >= 4.5, `${fg}: ${ratio.toFixed(2)}:1`);
    }
  });

  // Delete and Unpublish rows in menus, hovered (surface-alt) or not; the danger button (text-on-primary on error-text).
  for (const bg of ['--color-background', '--color-surface', '--color-surface-raised', '--color-surface-alt']) {
    it(`dark: --color-error-text on ${bg} is at least 4.5:1`, () => {
      const ratio = contrast(hex(dark, '--color-error-text'), hex(dark, bg));
      assert.ok(ratio >= 4.5, `${hex(dark, '--color-error-text')} on ${hex(dark, bg)} is ${ratio.toFixed(2)}:1`);
    });
  }
  it('dark: the danger button (text-on-primary on error-text) is at least 4.5:1', () => {
    const ratio = contrast(hex(dark, '--color-text-on-primary'), hex(dark, '--color-error-text'));
    assert.ok(ratio >= 4.5, `${ratio.toFixed(2)}:1`);
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

/** A fake document holding the pane and the content element. */
function fakeDoc() {
  const pane = fakeEl();
  const content = fakeEl();
  const doc = {
    pane, content,
    querySelector: (sel) => ({ '.editor-pane': pane, '.editor-content': content }[sel] || null),
    querySelectorAll: () => [],
    getElementById: () => null,
    createElement: () => ({ ...fakeEl(), remove() {} }),
    head: { append() {}, appendChild() {} },
  };
  return doc;
}

const THEMES = [{ id: 'default', name: 'Default', href: null }, { id: 'swiss', name: 'Swiss', href: '/s/swiss.css' }];

describe('applyPaneTheme keeps the writing area unbranded', () => {
  const cases = [
    ['a site with no theme', null, {}, ''],
    ['the site theme', { name: 'swiss', mode: 'auto' }, {}, 'swiss'],
    ['a page theme, page scope', { name: 'default', mode: 'light' }, { theme: 'swiss' }, 'swiss'],
    ['a page theme, article scope', { name: 'default', mode: 'auto' }, { theme: 'swiss', themeScope: 'article' }, 'default'],
    ['a page theme on a site with no theme.json', null, { theme: 'swiss' }, 'swiss'],
  ];
  for (const [label, setting, meta, ids] of cases) {
    it(`${label}: the pane keeps a data-theme (${JSON.stringify(ids)})`, () => {
      const doc = fakeDoc();
      doc.pane.setAttribute('data-theme', 'old');
      applyPaneTheme(paneTheme(setting, meta, THEMES), doc);
      assert.equal(doc.pane.getAttribute('data-theme'), ids);
    });
  }

  it('going from a theme back to none leaves data-theme="" on the pane, and none on the content', () => {
    const doc = fakeDoc();
    applyPaneTheme(paneTheme({ name: 'default' }, { theme: 'swiss', themeScope: 'article' }, THEMES), doc);
    assert.equal(doc.content.getAttribute('data-theme'), 'swiss');
    applyPaneTheme(paneTheme(null, {}, THEMES), doc);
    assert.equal(doc.pane.getAttribute('data-theme'), '');
    assert.equal(doc.content.hasAttribute('data-theme'), false);
  });
});

describe('<theme-picker> (vp serve) keeps the writing area unbranded', () => {
  it('the default theme sets data-theme="" on the pane, not no attribute', async () => {
    const saved = Object.fromEntries(['HTMLElement', 'customElements', 'document'].map((k) => [k, globalThis[k]]));
    const doc = fakeDoc();
    globalThis.HTMLElement = class {};
    globalThis.customElements = { define() {} };
    globalThis.document = doc;
    try {
      const { ThemePicker } = await import('../../editor/assets/js/components/theme-picker.js');
      const picker = new ThemePicker();
      picker._themes = [{ id: 'default' }, { id: 'swiss', file: 'swiss.css' }];
      picker.setTheme('swiss');
      assert.equal(doc.pane.getAttribute('data-theme'), 'swiss');
      picker.setTheme('default');
      assert.equal(doc.pane.getAttribute('data-theme'), '');
      picker.setTheme('unknown');
      assert.equal(doc.pane.getAttribute('data-theme'), '');
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete globalThis[k];
        else globalThis[k] = v;
      }
    }
  });
});

/*
 * The served Vanilla Breeze (/assets/vb/) must re-declare every token the
 * brand overrides on any [data-theme] element: that is what keeps the brand
 * (set on :root) out of the writing area, which always carries data-theme.
 */
describe('the served Vanilla Breeze re-declares the brand tokens on [data-theme]', () => {
  const vbCss = read('node_modules', 'vanilla-breeze', 'dist', 'cdn', 'vanilla-breeze.css');
  const rules = [...vbCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: m[1].split(',').map((x) => x.trim()),
    names: new Set([...m[2].matchAll(/(--[\w-]+)\s*:/g)].map((d) => d[1])),
  }));
  const brandNames = [...new Set([...light.keys(), ...decls(darkCss).keys()])].filter((n) => n.startsWith('--color-'));

  it('the check covers every token the brand overrides', () => {
    for (const n of OVERRIDDEN) assert.ok(brandNames.includes(n), n);
  });

  it('a :where([data-theme]) rule declares every --color-* token the brand sets', () => {
    const covered = new Set();
    for (const r of rules) {
      if (r.selectors.includes(':where([data-theme])')) for (const n of r.names) covered.add(n);
    }
    const missing = brandNames.filter((n) => !covered.has(n));
    assert.deepEqual(missing, [], `not re-declared on [data-theme]: ${missing.join(', ')}`);
  });

  it('the dark rules (data-mode=dark and system dark) also reach [data-theme] elements', () => {
    const dark = rules.filter((r) => r.names.has('--color-background') && r.selectors.some((x) => /data-mode=dark/.test(x)));
    assert.ok(dark.some((r) => r.selectors.some((x) => /^:where\(\[data-mode=dark\] \[data-theme\]/.test(x))), 'data-mode=dark rule');
    assert.ok(rules.some((r) => r.names.has('--color-background') && r.selectors.some((x) => /^:where\(\[data-theme\]:not\(\[data-mode=light\]/.test(x))), 'system dark rule');
  });
});
