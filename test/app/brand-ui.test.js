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
const darkAt = brandCss.search(DARK);

/** The innermost rules of a stylesheet: selectors, declarations, and whether they sit in the dark block. */
function cssRules(css, darkFrom = Infinity) {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: m[1].split(',').map((x) => x.trim()),
    body: m[2],
    dark: darkAt >= 0 && m.index > darkFrom,
  }));
}
const brandRules = cssRules(brandCss, darkAt);
/** Declarations of the brand rules a selector is listed on, light or dark. */
function declsFor(selector, isDark) {
  return new Map(brandRules.filter((r) => r.dark === isDark && r.selectors.includes(selector)).flatMap((r) => [...decls(r.body)]));
}
const darkRoot = declsFor(':root', true);
const light = declsFor(':root', false);
const dark = new Map([...light, ...darkRoot]);
// The ink bars (.on-ink): they inherit the chrome tokens and set their own.
const onInkLight = new Map([...light, ...declsFor('.on-ink', false)]);
const onInkDark = new Map([...dark, ...declsFor('.on-ink', false), ...declsFor('.on-ink', true)]);

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
  const brandNames = [...new Set([...light.keys(), ...darkRoot.keys()])].filter((n) => n.startsWith('--color-'));

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

/*
 * Task 6, the brand surfaces: ink top bars with the vanilla seal, the seal in
 * the rail, Fraunces screen titles, and the faint seal over empty states.
 * The bars carry .on-ink, which brand-ui.css gives on-ink tokens; menus that
 * open from a bar get the page's tokens back.
 */
const SEAL = (name) => new RegExp(`<img\\b[^>]*\\bsrc="/brand/svg/${name}\\.svg"[^>]*>`);
const DARK_SOURCE = /<source\b[^>]*\bsrcset="\/brand\/svg\/seal-vanilla-medium\.svg"[^>]*\bmedia="\(prefers-color-scheme: dark\)"[^>]*>/;
/** The markup of the first element with this opening-tag pattern, up to its closing tag. */
function element(html, open, tag) {
  const start = html.search(open);
  assert.ok(start >= 0, `no ${open}`);
  const end = html.indexOf(`</${tag}>`, start);
  return html.slice(start, end);
}

/** fg drawn at `alpha` opacity over bg, as hex. */
function over(fg, bg, alpha) {
  const ch = (c, i) => parseInt(c.slice(i, i + 2), 16);
  return '#' + [1, 3, 5].map((i) => Math.round(ch(fg, i) * alpha + ch(bg, i) * (1 - alpha)).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** The dark half of a VB `light-dark(…, oklch(L% C H))` token in the served build, as hex. */
function vbDark(name) {
  const vb = read('node_modules', 'vanilla-breeze', 'dist', 'cdn', 'vanilla-breeze.css');
  const m = new RegExp(`${name}:\\s*light-dark\\([^,]+,\\s*oklch\\(([\\d.]+)%\\s+([\\d.]+)\\s+([\\d.]+)\\)\\s*\\)`).exec(vb);
  assert.ok(m, `no light-dark() ${name} in the served VB`);
  const [L, C, H] = [m[1] / 100, Number(m[2]), (m[3] * Math.PI) / 180];
  const [a, b] = [C * Math.cos(H), C * Math.sin(H)];
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s];
  const srgb = lin.map((c) => Math.min(1, Math.max(0, c))).map((c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));
  return '#' + srgb.map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}

const appCss = stripComments(read('app', 'assets', 'app.css'));
const appRules = cssRules(appCss);

describe('brand surfaces: the ink bars', () => {
  it('app/index.html: the top bar is an ink bar with the vanilla medium seal', () => {
    const bar = element(read('app', 'index.html'), /<header class="topbar[^"]*"/, 'header');
    assert.match(bar, /^<header class="[^"]*\bon-ink\b/);
    assert.match(bar, SEAL('seal-vanilla-medium'));
    assert.doesNotMatch(bar, SEAL('seal-ink-medium'));
  });

  it('editor/index.html: the top bar is an ink bar with the vanilla medium seal; the pane is not', () => {
    const html = read('editor', 'index.html');
    const bar = element(html, /<header class="site-header[^"]*"/, 'header');
    assert.match(bar, /^<header class="[^"]*\bon-ink\b/);
    assert.match(bar, SEAL('seal-vanilla-medium'));
    assert.doesNotMatch(element(html, /<main class="editor-pane"/, 'main'), /on-ink/);
  });

  for (const [label, scheme] of [['light', onInkLight], ['dark', onInkDark]]) {
    it(`${label}: the bar is petal text on ink`, () => {
      assert.equal(hex(scheme, '--color-text'), '#F7EEDB');
      assert.equal(hex(scheme, '--color-background'), label === 'light' ? '#23314F' : '#141C30');
      const ratio = contrast(hex(scheme, '--color-text'), hex(scheme, '--color-background'));
      assert.ok(ratio >= 4.5, `${ratio.toFixed(2)}:1`);
    });

    it(`${label}: Publish on the bar is vanilla with ink text`, () => {
      assert.equal(hex(scheme, '--color-primary'), '#ECD89A');
      assert.equal(hex(scheme, '--color-text-on-primary'), '#23314F');
    });

    const BAR_TEXT = [
      ['--color-text', '--color-background'],
      ['--color-text-muted', '--color-background'], // "← Posts", the site name, the save pill
      ['--color-text', '--color-surface-alt'], // hovered and pressed buttons
      ['--color-text-muted', '--color-surface-alt'],
      ['--color-text-on-primary', '--color-primary'],
    ];
    for (const [fg, bg] of BAR_TEXT) {
      it(`${label}: on the bar, ${fg} on ${bg} is at least 4.5:1`, () => {
        const ratio = contrast(hex(scheme, fg), hex(scheme, bg));
        assert.ok(ratio >= 4.5, `${hex(scheme, fg)} on ${hex(scheme, bg)} is ${ratio.toFixed(2)}:1`);
      });
    }

    it(`${label}: the focus ring and Publish (primary) on the bar are at least 3:1`, () => {
      for (const bg of ['--color-background', '--color-surface-alt']) {
        const ratio = contrast(hex(scheme, '--color-primary'), hex(scheme, bg));
        assert.ok(ratio >= 3, `${bg}: ${ratio.toFixed(2)}:1`);
      }
    });

    it(`${label}: the Sites address (petal at 80%) on the bar is at least 4.5:1`, () => {
      const bg = hex(scheme, '--color-background');
      const ratio = contrast(over(hex(scheme, '--color-text'), bg, 0.8), bg);
      assert.ok(ratio >= 4.5, `${ratio.toFixed(2)}:1`);
    });
  }

  it('light: save and publish errors on the bar (VB\'s dark error text, by color-scheme) are at least 4.5:1', () => {
    assert.equal(declsFor('.on-ink', false).has('--color-error-text'), false, 'menus would inherit it');
    const ratio = contrast(vbDark('--color-error-text'), hex(onInkLight, '--color-background'));
    assert.ok(ratio >= 4.5, `${ratio.toFixed(2)}:1`);
  });

  it('dark: save and publish errors on the bar are at least 4.5:1', () => {
    const ratio = contrast(hex(onInkDark, '--color-error-text'), hex(onInkDark, '--color-background'));
    assert.ok(ratio >= 4.5, `${ratio.toFixed(2)}:1`);
  });

  it('the bars use the dark color scheme, so status colors (light-dark()) read on ink', () => {
    assert.equal(declsFor('.on-ink', false).size > 0, true);
    const rule = brandRules.find((r) => !r.dark && r.selectors.includes('.on-ink'));
    assert.match(rule.body, /color-scheme:\s*dark\s*;/);
  });

  it('a menu opening from a bar gets the page tokens back, light and dark', () => {
    for (const isDark of [false, true]) {
      const rule = brandRules.find((r) => r.dark === isDark && r.selectors.includes(':root'));
      assert.ok(rule.selectors.includes('.on-ink [role="menu"]'), `${isDark ? 'dark' : 'light'} :root rule`);
    }
    // color inherits as a computed value (petal), so the menu sets it again
    const own = brandRules.find((r) => r.selectors.length === 1 && r.selectors[0] === '.on-ink [role="menu"]');
    assert.ok(own, 'no .on-ink [role="menu"] rule');
    assert.match(own.body, /color:\s*var\(--color-text\)/);
  });

  it('app.css: the address is petal at 80%', () => {
    const rule = appRules.find((r) => r.selectors.includes('.topbar-address'));
    assert.match(rule.body, /color:\s*var\(--color-text\)/);
    assert.match(rule.body, /opacity:\s*0?\.8\b/);
  });
});

describe('brand surfaces: the rail and the titles', () => {
  it('app/site.html: the rail has the ink medium seal at 28px above the site name, vanilla in dark', () => {
    const rail = element(read('app', 'site.html'), /<nav aria-label="Site" class="site-rail"/, 'nav');
    const seal = SEAL('seal-ink-medium').exec(rail);
    assert.ok(seal, 'no ink seal in the rail');
    assert.match(seal[0], /\balt=""/);
    assert.match(seal[0], /\bwidth="28"/);
    assert.match(seal[0], /\bheight="28"/);
    assert.ok(seal.index < rail.indexOf('class="rail-name"'), 'the seal comes before the site name');
    assert.match(rail, DARK_SOURCE);
  });

  for (const selector of ['h1', '.rail-name']) {
    it(`app.css: ${selector} uses the title font, and nothing later sets another`, () => {
      const own = appRules.filter((r) => r.selectors.includes(selector) && /font-family:/.test(r.body));
      assert.ok(own.length, `no font-family for ${selector}`);
      assert.match(own.at(-1).body, /font-family:\s*var\(--vp-title-font\)/);
    });
  }

  it('app.css: h2 stays Charter', () => {
    const own = appRules.filter((r) => r.selectors.includes('h2') && /font-family:/.test(r.body));
    assert.match(own.at(-1).body, /font-family:\s*var\(--font-serif\)/);
  });
});

describe('brand surfaces: empty states', () => {
  const pages = [
    ['app/index.html', read('app', 'index.html'), 'sites-empty'],
    ['app/site.html (posts)', read('app', 'site.html'), 'empty'],
    ['app/site.html (media)', read('app', 'site.html'), 'media-empty'],
    ['app/site.html (programs)', read('app', 'site.html'), 'program-empty'],
  ];
  for (const [label, html, id] of pages) {
    it(`${label}: #${id} shows the ink medium seal at 64px above its text, vanilla in dark`, () => {
      const box = element(html, new RegExp(`<p id="${id}" class="empty"`), 'p');
      const seal = SEAL('seal-ink-medium').exec(box);
      assert.ok(seal, 'no seal');
      assert.match(seal[0], /\balt=""/);
      assert.match(seal[0], /\bwidth="64"/);
      assert.match(seal[0], /\bheight="64"/);
      assert.match(box, DARK_SOURCE);
      assert.match(box, new RegExp(`<span id="${id}-text"></span>`));
      assert.ok(seal.index < box.indexOf(`id="${id}-text"`), 'the seal comes before the text');
    });
  }

  it('app.css: the empty-state seal is a 64px block at 35% opacity', () => {
    const rule = appRules.find((r) => r.selectors.includes('.empty img'));
    assert.ok(rule, 'no .empty img rule');
    assert.match(rule.body, /opacity:\s*0?\.35\b/);
    assert.match(rule.body, /display:\s*block/);
  });
});
