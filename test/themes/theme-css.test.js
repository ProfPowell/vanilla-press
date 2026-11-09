import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  IMPORT_LIMIT, ThemeCssError, rewriteComposerCss, customThemeCss, adjustmentsCss,
  isDefaultAdjustments, FONT_STACKS, CORNER_RADII, themeTokenNames, hueColorExpr,
  safeTokenName, safeTokenValue, singleSchemeOf, skippedTokens,
} from '../../src/themes/theme-css.js';

/** Every selector the output uses, with declarations removed. */
function selectorsOf(css) {
  return css.replace(/\{[^{}]*\}/g, '{}').match(/[^{}]+(?=\{)/g).map((s) => s.trim());
}

/** The output only ever styles the theme id, inside one layer. */
function assertScoped(css, id) {
  assert.match(css, /^@layer bundle-theme \{/);
  for (const sel of selectorsOf(css)) {
    if (sel === '@layer bundle-theme' || sel === '@media (prefers-color-scheme: dark)') continue;
    assert.ok([
      `[data-theme~="${id}"]`,
      `[data-theme~="${id}"][data-mode="dark"]`,
      `[data-theme~="${id}"]:not([data-mode="light"])`,
    ].includes(sel), `unexpected selector ${sel}`);
  }
  let depth = 0;
  for (const ch of css) {
    if (ch === '{') depth++;
    if (ch === '}') { depth--; assert.ok(depth >= 0, 'unbalanced braces'); }
  }
  assert.equal(depth, 0);
  assert.doesNotMatch(css, /url\(|@import|@font-face|\\/i);
}

describe('rewriteComposerCss', () => {
  it('rewrites :root and html to the theme id inside @layer bundle-theme', () => {
    const { css, schemes, dropped } = rewriteComposerCss(':root, html { --color-primary: oklch(0.6 0.2 30); --hue-primary: 30; }', 'retro-mine');
    assert.match(css, /^@layer bundle-theme \{/);
    assert.match(css, /\[data-theme~="retro-mine"\] \{[^}]*--color-primary: oklch\(0\.6 0\.2 30\)/);
    assert.doesNotMatch(css, /:root|html/);
    assert.equal(schemes, 'light');
    assert.deepEqual(dropped, []);
  });
  it('keeps a dark block as both schemes', () => {
    const r = rewriteComposerCss(':root{--color-background:white} @media (prefers-color-scheme: dark){:root{--color-background:black}}', 'x');
    assert.equal(r.schemes, 'both');
    assert.match(r.css, /\[data-theme~="x"\]\[data-mode="dark"\]/);
    assert.match(r.css, /@media \(prefers-color-scheme: dark\) \{ \[data-theme~="x"\]:not\(\[data-mode="light"\]\)/);
    assertScoped(r.css, 'x');
  });
  it('drops everything that is not a custom property, and listed values', () => {
    const r = rewriteComposerCss('@import url(x.css); @font-face{font-family:A} body{color:red} :root{--a:1;--b:url(http://e/x.png);--c:2} /* } */', 'x');
    assert.deepEqual(r.dropped, ['@import url(x.css)', '@font-face', 'body', '--b']);
    assert.match(r.css, /--a: 1;/); assert.match(r.css, /--c: 2;/);
  });
  it('a single dark-background block is Dark only (R11)', () => {
    assert.equal(rewriteComposerCss(':root{--color-background: oklch(0.2 0.02 250)}', 'x').schemes, 'dark');
  });
  it('refuses over 256 KB (413) and nothing usable (422)', () => {
    assert.throws(() => rewriteComposerCss(':root{--a:1}' + ' '.repeat(256 * 1024), 'x'), { status: 413 });
    assert.throws(() => rewriteComposerCss('body{color:red}', 'x'), { status: 422 });
  });

  it('exports the limit and an error class with a status', () => {
    assert.equal(IMPORT_LIMIT, 256 * 1024);
    const e = new ThemeCssError('nope', 422);
    assert.ok(e instanceof Error);
    assert.equal(e.status, 422);
  });
  it('counts the limit in bytes, and refuses a 300 KB file', () => {
    const big = ':root{--a:"' + 'é'.repeat(IMPORT_LIMIT / 2) + '"}';
    assert.throws(() => rewriteComposerCss(big, 'x'), { status: 413 });
    assert.throws(() => rewriteComposerCss(':root{--a:1}' + ' '.repeat(300 * 1024), 'x'), { status: 413 });
  });
  it('the 422 lists what it dropped; non-text and empty input are 422', () => {
    assert.throws(() => rewriteComposerCss('body{color:red}', 'x'), (e) => e.status === 422 && e.dropped[0] === 'body');
    assert.throws(() => rewriteComposerCss('', 'x'), { status: 422 });
    assert.throws(() => rewriteComposerCss(null, 'x'), { status: 422 });
    assert.throws(() => rewriteComposerCss(':root { /* No theme overrides detected yet. */ }', 'x'), { status: 422 });
  });
  it('refuses an unsafe id (400)', () => {
    for (const id of ['X', 'a"]{', '', null, 'a b']) {
      assert.throws(() => rewriteComposerCss(':root{--a:1}', id), { status: 400 });
    }
  });

  it('a brace inside a comment does not end the block', () => {
    const r = rewriteComposerCss(':root { --a: 1; /* } body { color: red } */ --b: 2; }', 'x');
    assert.match(r.css, /--a: 1;[^}]*--b: 2;/);
    assert.deepEqual(r.dropped, []);
    assertScoped(r.css, 'x');
  });
  it('a brace inside a string does not end the block, and the value is kept whole or dropped', () => {
    const r = rewriteComposerCss(':root { --font-x: "a}b"; --c: 3 } body { color: red }', 'x');
    assert.deepEqual(r.dropped, ['--font-x', 'body']);
    assert.match(r.css, /--c: 3;/);
    assertScoped(r.css, 'x');
    const ok = rewriteComposerCss(':root { --font-body: "Segoe UI", sans-serif }', 'x');
    assert.match(ok.css, /--font-body: "Segoe UI", sans-serif;/);
  });
  it('escaped braces cannot close a block and escaped values are dropped', () => {
    const r = rewriteComposerCss(':root { --a: x\\7d body\\{color:red; --b: 1; --c: u\\72l(http://e/x.png) }', 'x');
    assert.deepEqual(r.dropped, ['--a', '--c']);
    assert.match(r.css, /--b: 1;/);
    assertScoped(r.css, 'x');
    const r2 = rewriteComposerCss(':root { --a: 1 \\} body { color: red } --b: 2 } :root { --ok: 1 }', 'x');
    assertScoped(r2.css, 'x');
    assert.doesNotMatch(r2.css, /color: red/);
  });
  it('an escaped token name is dropped', () => {
    const r = rewriteComposerCss(':root { --a\\7d: 1; --B: 2; --ok: 3 }', 'x');
    assert.deepEqual(r.dropped, ['--a\\7d', '--B']);
    assert.match(r.css, /--ok: 3;/);
  });
  it('drops @layer, @supports, @charset, @namespace and other @media blocks by their prelude', () => {
    const r = rewriteComposerCss([
      '@charset "utf-8";',
      '@layer theme { :root { --x: 1 } }',
      '@supports (color: oklch(0 0 0)) { :root { --y: 1 } }',
      '@media (min-width: 40em) { :root { --z: 1 } }',
      '@namespace svg url(http://www.w3.org/2000/svg);',
      ':root { --a: 1 }',
    ].join('\n'), 'x');
    assert.deepEqual(r.dropped, [
      '@charset "utf-8"', '@layer theme', '@supports (color: oklch(0 0 0))',
      '@media (min-width: 40em)', '@namespace svg url(http://www.w3.org/2000/svg)',
    ]);
    assert.doesNotMatch(r.css, /--[xyz]:/);
    assertScoped(r.css, 'x');
  });
  it('nested @media inside the dark block and nested rules inside a theme block are dropped', () => {
    const r = rewriteComposerCss([
      '@media (prefers-color-scheme: dark) {',
      '  :root { --bg: black; & body { color: red } }',
      '  @media print { :root { --p: 1 } }',
      '  body { color: white }',
      '}',
      ':root { --bg: white }',
    ].join('\n'), 'x');
    assert.deepEqual(r.dropped, ['& body', '@media print', 'body']);
    assert.equal(r.schemes, 'both');
    assert.doesNotMatch(r.css, /--p:/);
    assertScoped(r.css, 'x');
  });
  it('selector lists with anything but the theme selectors are dropped whole', () => {
    const r = rewriteComposerCss(':root, body { --a: 1 } :root:has(a), html { --b: 1 } html body { --c: 1 } :root { --d: 1 }', 'x');
    assert.deepEqual(r.dropped, [':root, body', ':root:has(a), html', 'html body']);
    assert.doesNotMatch(r.css, /--[abc]:/);
    assertScoped(r.css, 'x');
  });
  it('[data-mode=dark] in any quoting is the dark block', () => {
    for (const sel of [':root[data-mode=dark]', '[data-mode="dark"]', ":root[data-mode='dark']", 'html[data-mode="dark"]']) {
      const r = rewriteComposerCss(`:root { --a: 1 } ${sel} { --a: 2 }`, 'x');
      assert.equal(r.schemes, 'both', sel);
      assert.match(r.css, /\[data-theme~="x"\]\[data-mode="dark"\] \{[^}]*--a: 2;/);
    }
  });
  it('the VB dark form :root:not([data-mode=light]) inside the dark @media is the dark block', () => {
    for (const sel of [':root:not([data-mode=light])', ':root:not([data-mode="light"])', 'html:not( [data-mode=\'light\'] )', ':root:not([data-mode=light]), html:not([data-mode=light])']) {
      const r = rewriteComposerCss(`:root { --a: 1 } @media (prefers-color-scheme: dark) { ${sel} { --a: 2 } }`, 'x');
      assert.equal(r.schemes, 'both', sel);
      assert.deepEqual(r.dropped, [], sel);
      assert.match(r.css, /\[data-theme~="x"\]\[data-mode="dark"\] \{[^}]*--a: 2;/);
      assertScoped(r.css, 'x');
    }
    // Outside a dark @media it says nothing about the scheme: dropped.
    const top = rewriteComposerCss(':root { --a: 1 } :root:not([data-mode=light]) { --a: 2 }', 'x');
    assert.deepEqual(top.dropped, [':root:not([data-mode=light])']);
    assert.equal(top.schemes, 'light');
    // Inside a light @media it is not dark either.
    const light = rewriteComposerCss(':root { --a: 1 } @media (prefers-color-scheme: light) { :root:not([data-mode=light]) { --a: 2 } }', 'x');
    assert.deepEqual(light.dropped, [':root:not([data-mode=light])']);
  });
  it('a lone dark block is Dark only, written as the theme block', () => {
    const r = rewriteComposerCss('@media (prefers-color-scheme: dark) { :root { --a: 2 } }', 'x');
    assert.equal(r.schemes, 'dark');
    assert.match(r.css, /\[data-theme~="x"\] \{[^}]*--a: 2;/);
    assert.doesNotMatch(r.css, /data-mode/);
  });
  it('drops values with R11 characters, !important, resource functions and unbalanced brackets', () => {
    const r = rewriteComposerCss([
      ':root {',
      '  --a: <b>; --b: a @x; --c: 1 !important; --d: image-set("http://e/x.png" 1x);',
      '  --e: -webkit-image-set("x.png" 1x); --f: cross-fade(a, b); --g: src("x"); --h: (1;',
      '  --i: [a; --j: "unclosed',
      '}',
      ':root { --ok: calc(1px + (2px * 3)) }',
    ].join('\n'), 'x');
    assert.deepEqual(r.dropped, ['--a', '--b', '--c', '--d', '--e', '--f', '--g', '--h', '--i', '--j']);
    assert.match(r.css, /--ok: calc\(1px \+ \(2px \* 3\)\);/);
    assertScoped(r.css, 'x');
  });
  it('an unclosed block at the end is not kept past what was parsed', () => {
    const r = rewriteComposerCss(':root { --a: 1; } body { color: red', 'x');
    assert.deepEqual(r.dropped, ['body']);
    assertScoped(r.css, 'x');
  });
  it('stray closing braces do not break out', () => {
    const r = rewriteComposerCss('} } :root { --a: 1 } } body { color: red }', 'x');
    assert.match(r.css, /--a: 1;/);
    assert.ok(r.dropped.includes('body'));
    assertScoped(r.css, 'x');
  });
  it('a later declaration of the same token wins', () => {
    const r = rewriteComposerCss(':root { --a: 1 } html { --a: 2 }', 'x');
    assert.match(r.css, /--a: 2;/);
    assert.doesNotMatch(r.css, /--a: 1;/);
  });
  it('collapses whitespace in values', () => {
    const r = rewriteComposerCss(':root { --a:\n  oklch(0.5\n 0.1   30) }', 'x');
    assert.match(r.css, /--a: oklch\(0\.5 0\.1 30\);/);
  });
  it('caps the dropped list at 50 labels plus a count, quickly', () => {
    let junk = '';
    for (let n = 0; junk.length < 250 * 1024; n++) junk += `.c${n}{a:b}`;
    const t = Date.now();
    assert.throws(() => rewriteComposerCss(junk, 'x'), (e) => {
      assert.equal(e.status, 422);
      assert.equal(e.dropped.length, 51);
      assert.equal(e.dropped[0], '.c0');
      assert.match(e.dropped[50], /^…and \d+ more$/);
      return true;
    });
    assert.ok(Date.now() - t < 500, `took ${Date.now() - t} ms`);
    const r = rewriteComposerCss(`${junk.slice(0, 2000)} :root { --a: 1 }`, 'x');
    assert.ok(r.dropped.length <= 51);
  });
  it('keeps dropped labels short', () => {
    const r = rewriteComposerCss(`${'a'.repeat(500)} { color: red } :root { --a: 1 }`, 'x');
    assert.ok(r.dropped[0].length <= 81);
  });
});

describe('rewriteComposerCss fuzz', () => {
  it('random CSS-ish input only ever yields scoped output or a ThemeCssError', () => {
    let seed = 42;
    const rand = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    const parts = [':root', 'html', 'body', ',', '{', '}', ';', ':', '--a', '--b-c', 'red', '1', '"', "'", '\\', '\\7d',
      '/*', '*/', '@media (prefers-color-scheme: dark)', '@import', '@layer x', 'url(', ')', '(', '[data-mode=dark]', '!important', '<', '@', ' ', '\n',
      ':root{--z:2}', '--a:1;', ':root{--y:oklch(0.5 0.1 30);', '@media (prefers-color-scheme: dark){html{--w:3}}'];
    let ok = 0;
    for (let n = 0; n < 2000; n++) {
      let text = '';
      for (let k = rand(40); k >= 0; k--) text += parts[rand(parts.length)];
      try {
        const r = rewriteComposerCss(text, 'x');
        assertScoped(r.css, 'x');
        assert.ok(['both', 'light', 'dark'].includes(r.schemes));
        ok++;
      } catch (e) {
        if (!(e instanceof ThemeCssError)) throw new Error(`${e.message} for ${JSON.stringify(text)}`);
      }
    }
    assert.ok(ok > 200, `only ${ok} inputs were usable`);
  });
});

describe('singleSchemeOf (R11)', () => {
  it('reads OKLCH, OKLab, Lab/LCH, hex, rgb, hsl and named backgrounds', () => {
    const s = (v) => singleSchemeOf({ '--color-background': v });
    assert.equal(s('oklch(0.2 0.02 250)'), 'dark');
    assert.equal(s('oklch(20% 0.02 250)'), 'dark');
    assert.equal(s('oklch(0.97 0.01 250)'), 'light');
    assert.equal(s('oklab(0.3 0 0)'), 'dark');
    assert.equal(s('lch(15 10 200)'), 'dark');
    assert.equal(s('#111'), 'dark');
    assert.equal(s('#1a1a2e'), 'dark');
    assert.equal(s('#ffffff'), 'light');
    assert.equal(s('#fafafaff'), 'light');
    assert.equal(s('rgb(10 10 10)'), 'dark');
    assert.equal(s('rgba(250, 250, 250, 1)'), 'light');
    assert.equal(s('hsl(220 20% 10%)'), 'dark');
    assert.equal(s('black'), 'dark');
    assert.equal(s('white'), 'light');
  });
  it('is light when unknown or missing', () => {
    assert.equal(singleSchemeOf({}), 'light');
    assert.equal(singleSchemeOf({ '--color-background': 'var(--x)' }), 'light');
  });
});

describe('customThemeCss', () => {
  it('customThemeCss writes light, dark and the auto media rule', () => {
    const css = customThemeCss('retro-mine', { light: { '--color-primary': 'oklch(0.5 0.2 30)' }, dark: { '--color-primary': 'oklch(0.7 0.2 30)' } });
    assert.match(css, /@layer bundle-theme/);
    assert.match(css, /\[data-theme~="retro-mine"\]\[data-mode="dark"\] \{[^}]*0\.7/);
    assert.match(css, /prefers-color-scheme: dark/);
    assertScoped(css, 'retro-mine');
  });
  it('writes one block without a dark set, and skips unsafe names and values', () => {
    const css = customThemeCss('x', { light: { '--a': '1', '--b': 'url(x)', 'color': 'red', '--c': 'a } body { color: red', '--d': 'x /* y' } });
    assert.match(css, /--a: 1;/);
    assert.doesNotMatch(css, /--b|color|--c|--d|data-mode|prefers/);
    assertScoped(css, 'x');
  });
  it('refuses missing or unusable tokens with 422', () => {
    for (const sets of [null, undefined, {}, { light: null }, { light: [] }, { light: {} }, { light: { '--a': 'url(x)' } }, { dark: { '--a': '1' } }]) {
      assert.throws(() => customThemeCss('x', sets), (e) => e instanceof ThemeCssError && e.status === 422, JSON.stringify(sets));
    }
    assert.throws(() => customThemeCss('x', { light: { '--a': 'url(x)', 'color': 'red' } }), (e) => e.dropped.join() === '--a,color');
  });
  it('skippedTokens lists the names customThemeCss skips, per scheme', () => {
    assert.deepEqual(skippedTokens({ light: { '--a': '1', '--b': 'url(x)', 'color': 'red' }, dark: { '--a': '1', '--c': 'a;b', '--b': 'image(x)' } }),
      ['--b', 'color', '--c']);
    assert.deepEqual(skippedTokens({ light: { '--a': '1' } }), []);
    assert.deepEqual(skippedTokens(null), []);
  });
  it('refuses an unsafe id', () => {
    assert.throws(() => customThemeCss('x"] body { color: red } [a="', { light: { '--a': '1' } }), { status: 400 });
  });
});

describe('adjustmentsCss', () => {
  it('adjustmentsCss is unlayered, scoped to vp-site, and empty when nothing is adjusted', () => {
    const adj = { hue: 25, headingFont: 'serif', bodyFont: null, corners: 'square',
      colors: { light: { '--color-primary': 'oklch(0.5 0.2 25)', '--color-interactive': 'oklch(0.5 0.2 25)' }, dark: { '--color-primary': 'oklch(0.7 0.18 25)', '--color-interactive': 'oklch(0.7 0.18 25)' } } };
    const css = adjustmentsCss(adj);
    assert.doesNotMatch(css, /@layer/);
    assert.match(css, /\[data-theme~="vp-site"\] \{[^}]*--hue-primary: 25;[^}]*--font-heading: Charter/);
    assert.match(css, /--radius-m: 0;/);
    assert.match(css, /\[data-theme~="vp-site"\]\[data-mode="dark"\] \{[^}]*0\.7 0\.18 25/);
    assert.equal(adjustmentsCss({ hue: null, headingFont: null, bodyFont: null, corners: 'theme', colors: null }), '');
  });
  it('round corners, body font and the auto dark rule', () => {
    const css = adjustmentsCss({ hue: null, headingFont: null, bodyFont: 'mono', corners: 'round',
      colors: { light: { '--color-primary': 'oklch(0.5 0.2 25)' }, dark: { '--color-primary': 'oklch(0.7 0.18 25)' } } });
    assert.match(css, /--font-body: ui-monospace/);
    assert.match(css, /--radius-xs: 0\.375rem;[^}]*--radius-2xl: 1\.5rem;/);
    assert.match(css, /@media \(prefers-color-scheme: dark\) \{ \[data-theme~="vp-site"\]:not\(\[data-mode="light"\]\) \{[^}]*0\.7 0\.18 25/);
    assert.doesNotMatch(css, /--hue-primary/);
  });
  it('ignores unknown and unsafe values', () => {
    const css = adjustmentsCss({ hue: 'x', headingFont: 'comic', bodyFont: 'sans', corners: 'wobbly',
      colors: { light: { '--a': 'url(x)', 'color': 'red', '--ok': '1' }, dark: null } });
    assert.match(css, /--font-body: system-ui/);
    assert.match(css, /--ok: 1;/);
    assert.doesNotMatch(css, /hue|--font-heading|radius|url|color:|data-mode/);
    assert.equal(adjustmentsCss(null), '');
  });
  it('the hue setting wins over colors; colors cannot set fonts, radii or the hue', () => {
    const css = adjustmentsCss({ hue: 25, headingFont: null, bodyFont: null, corners: 'theme',
      colors: { light: { '--hue-primary': '200', '--radius-m': '9rem', '--color-primary': 'red' }, dark: { '--hue-primary': '200', '--font-body': 'x', '--color-primary': 'blue' } } });
    assert.match(css, /--hue-primary: 25;/);
    assert.doesNotMatch(css, /200|9rem|--font-body/);
    assert.match(css, /--color-primary: blue;/);
    const noHue = adjustmentsCss({ hue: null, headingFont: null, bodyFont: null, corners: 'theme',
      colors: { light: { '--hue-primary': '200', '--color-primary': 'red' }, dark: null } });
    assert.doesNotMatch(noHue, /--hue-primary/);
  });
  it('isDefaultAdjustments', () => {
    assert.equal(isDefaultAdjustments({ hue: null, headingFont: null, bodyFont: null, corners: 'theme', colors: null }), true);
    assert.equal(isDefaultAdjustments(null), true);
    assert.equal(isDefaultAdjustments({ hue: 0, headingFont: null, bodyFont: null, corners: 'theme', colors: null }), false);
    assert.equal(isDefaultAdjustments({ hue: null, headingFont: null, bodyFont: null, corners: 'round', colors: null }), false);
    assert.equal(isDefaultAdjustments({ hue: null, headingFont: null, bodyFont: 'serif', corners: 'theme', colors: null }), false);
  });
  it('FONT_STACKS and CORNER_RADII hold the R8 values', () => {
    assert.equal(FONT_STACKS.sans, 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif');
    assert.equal(FONT_STACKS.serif, 'Charter, "Bitstream Charter", "Sitka Text", Cambria, serif');
    assert.equal(FONT_STACKS.mono, 'ui-monospace, "Cascadia Code", "Source Code Pro", Menlo, monospace');
    assert.deepEqual(Object.keys(CORNER_RADII.square), ['--radius-xs', '--radius-s', '--radius-sm', '--radius-m', '--radius-l', '--radius-xl', '--radius-2xl']);
    assert.ok(Object.values(CORNER_RADII.square).every((v) => v === '0'));
    assert.deepEqual(Object.values(CORNER_RADII.round), ['0.375rem', '0.5rem', '0.625rem', '0.75rem', '1rem', '1.25rem', '1.5rem']);
  });
});

describe('hueColorExpr', () => {
  it('hueColorExpr keeps a minimum chroma', () => {
    assert.equal(hueColorExpr('--color-primary', 140), 'oklch(from var(--color-primary) l max(c, 0.1) 140)');
  });
  it('refuses an unsafe token or hue', () => {
    assert.throws(() => hueColorExpr('--x) red', 1));
    assert.throws(() => hueColorExpr('--x', NaN));
  });
});

describe('themeTokenNames', () => {
  it('themeTokenNames reads a theme block of vanilla-breeze.css', () => {
    assert.deepEqual(themeTokenNames(':root{--z:0} [data-theme~=classic]{--a:1;--b:2} [data-theme~=modern]{--c:3}', 'classic'), ['--a', '--b']);
  });
  it('finds blocks in layers and media, any quoting, not ids that only start the same', () => {
    const css = '@layer bundle-theme { [data-theme~="classic"] { --a: 1 } [data-theme~="classic"][data-mode="dark"] { --b: 2; --a: 3 }'
      + ' @media (prefers-color-scheme: dark) { [data-theme~=\'classic\']:not([data-mode="light"]) { --c: 4 } }'
      + ' [data-theme~="classic-dark"] { --d: 5 } } /* [data-theme~=classic] { --e: 1 } */';
    assert.deepEqual(themeTokenNames(css, 'classic'), ['--a', '--b', '--c']);
  });
  it('survives deep nesting', () => {
    const deep = '{'.repeat(100000) + '[data-theme~=a]{--a:1}';
    assert.deepEqual(themeTokenNames(deep, 'a'), []);
    assert.deepEqual(themeTokenNames('@layer x { @media y { [data-theme~=a] { --a: 1 } } }', 'a'), ['--a']);
  });
  it('id null reads every rule', () => {
    assert.deepEqual(themeTokenNames(':root{--z:0} [data-theme~=classic]{--a:1; color: red}', null), ['--z', '--a']);
  });
});

describe('safeTokenName / safeTokenValue', () => {
  it('names', () => {
    assert.equal(safeTokenName('--color-primary'), true);
    for (const n of ['color', '--A', '--a b', '--a\\7d', '--a;', '', null]) assert.equal(safeTokenName(n), false, String(n));
  });
  it('values', () => {
    for (const v of ['1', 'oklch(0.5 0.2 30)', '"Segoe UI", sans-serif', 'calc(1px + 2px)', 'light-dark(#fff, #000)']) {
      assert.equal(safeTokenValue(v), true, v);
    }
    for (const v of ['', ' ', 'url(x)', 'URL(x)', 'a{', 'a}', 'a;', '<x>', '@x', 'a\\7d', '1 !important', '/* x', 'x */',
      'image-set("x" 1x)', 'attr(href url)', '(', 'a)', '[', '"x', 'a\nb', null, 1, 'x'.repeat(5000)]) {
      assert.equal(safeTokenValue(v), false, String(v));
    }
  });
});
