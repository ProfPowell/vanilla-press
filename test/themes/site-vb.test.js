import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findSiteVb, builtInThemeIds, themeCatalog } from '../../src/themes/site-vb.js';

describe('site-vb', () => {
  let root;
  before(() => { root = mkdtempSync(join(tmpdir(), 'vp-sitevb-')); });
  after(() => rmSync(root, { recursive: true, force: true }));
  const put = (p, c = '') => { mkdirSync(join(root, p, '..'), { recursive: true }); writeFileSync(join(root, p), c); };

  it('findSiteVb takes the shallowest vanilla-breeze.css', () => {
    put('a/src/x/y/z/vanilla-breeze.css');
    put('a/src/assets/vendor/vanilla-breeze/vanilla-breeze.css');
    put('a/src/node_modules/q/vanilla-breeze.css');
    const vb = findSiteVb(join(root, 'a'));
    assert.equal(vb.url, '/assets/vendor/vanilla-breeze/vanilla-breeze.css');
    assert.equal(vb.dir, join(root, 'a/src/assets/vendor/vanilla-breeze'));
  });
  it('findSiteVb skips node_modules and returns null when absent', () => {
    put('b/src/node_modules/q/vanilla-breeze.css');
    assert.equal(findSiteVb(join(root, 'b')), null);
    assert.equal(findSiteVb(join(root, 'nope')), null);
  });
  it('builtInThemeIds reads selectors, not a list', () => {
    assert.deepEqual(builtInThemeIds('[data-theme~=modern]{} :root[data-theme~="classic"]{} [data-theme~=a11y-dyslexia]{}').sort(), ['classic', 'default', 'modern']);
  });
  it('themeCatalog uses the site VB with site hrefs', () => {
    put('c/src/assets/vendor/vanilla-breeze/vanilla-breeze.css', '[data-theme~=modern]{}');
    put('c/src/assets/vendor/vanilla-breeze/themes/swiss.css');
    put('c/src/assets/vendor/vanilla-breeze/themes/modern.css');
    const c = themeCatalog({ siteDir: join(root, 'c'), siteId: 's1', vpCdnDir: join(root, 'none') });
    assert.equal(c.source, 'site');
    assert.equal(c.vbUrl, '/assets/vendor/vanilla-breeze/vanilla-breeze.css');
    assert.deepEqual(c.builtIns.sort(), ['default', 'modern']);
    const by = Object.fromEntries(c.themes.map(t => [t.id, t]));
    assert.equal(by.swiss.href, '/sites/s1/site/assets/vendor/vanilla-breeze/themes/swiss.css');
    assert.equal(by.swiss.file, 'swiss.css');
    assert.equal(by.modern.file, null);
    assert.equal(by.modern.href, '/sites/s1/site/assets/vendor/vanilla-breeze/themes/modern.css');
    assert.equal(by.classic, undefined);
  });
  it('themeCatalog falls back to VP with source "vp"', () => {
    put('d/src/index.html');
    put('vp/themes/amber.css');
    const c = themeCatalog({ siteDir: join(root, 'd'), siteId: 's2', vpCdnDir: join(root, 'vp') });
    assert.equal(c.source, 'vp');
    assert.equal(c.vbUrl, null);
    assert.equal(c.themes.find(t => t.id === 'amber').href, '/assets/vb/themes/amber.css');
  });
});
