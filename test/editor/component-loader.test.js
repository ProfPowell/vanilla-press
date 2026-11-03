import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { componentScriptUrl, createLoader, attributeEntries } from '../../editor/assets/js/component-loader.js';

const bw = { tag: 'browser-window', package: '@profpowell/browser-window', bundled: false, scriptPath: 'dist/browser-window.js' };

describe('componentScriptUrl', () => {
  it('is null for bundled Vanilla Breeze elements', () => {
    const vb = { tag: 'accordion-wc', package: 'vanilla-breeze', bundled: true, scriptPath: null };
    assert.equal(componentScriptUrl(vb, 'site'), null);
    assert.equal(componentScriptUrl(vb, null), null);
  });

  it('is null when the package has no entry script (not installed)', () => {
    assert.equal(componentScriptUrl({ ...bw, scriptPath: null }, 'site'), null);
    assert.equal(componentScriptUrl(null, 'site'), null);
  });

  it('with a site, is the site route, encoded per segment with a readable scope', () => {
    assert.equal(componentScriptUrl(bw, 'site'),
      '/sites/site/components/@profpowell/browser-window/dist/browser-window.js');
    assert.equal(componentScriptUrl({ ...bw, scriptPath: 'dist/a b#.js' }, 'my blog'),
      '/sites/my%20blog/components/@profpowell/browser-window/dist/a%20b%23.js');
    assert.equal(componentScriptUrl(bw, 'a/b'),
      '/sites/a%2Fb/components/@profpowell/browser-window/dist/browser-window.js');
  });

  it('with no site (vp serve), is the /components/ mount', () => {
    assert.equal(componentScriptUrl(bw, null), '/components/@profpowell/browser-window/dist/browser-window.js');
    assert.equal(componentScriptUrl({ ...bw, package: 'plain-pkg', scriptPath: './index.js' }, null),
      '/components/plain-pkg/index.js');
  });
});

describe('createLoader', () => {
  it('imports once per package and caches the promise', async () => {
    const urls = [];
    const load = createLoader({ siteId: 's', importer: async (u) => { urls.push(u); } });
    const a = load(bw);
    const b = load({ ...bw, tag: 'other-tag' });
    assert.equal(a, b);
    assert.equal(await a, 'ready');
    assert.deepEqual(urls, ['/sites/s/components/@profpowell/browser-window/dist/browser-window.js']);
  });

  it("resolves 'failed' (never rejects) when the import fails or there is no script", async () => {
    const load = createLoader({ siteId: null, importer: async () => { throw new Error('404'); } });
    assert.equal(await load(bw), 'failed');
    assert.equal(await load({ ...bw, package: 'x', scriptPath: null }), 'failed');
  });

  it("resolves 'ready' for bundled elements without importing", async () => {
    let called = false;
    const load = createLoader({ siteId: 's', importer: async () => { called = true; } });
    assert.equal(await load({ tag: 'qr-code', package: 'vanilla-breeze', bundled: true, scriptPath: null }), 'ready');
    assert.equal(called, false);
  });
});

describe('attributeEntries', () => {
  it('matches the renderer: true is bare, false and unsafe names are left out', () => {
    assert.deepEqual(attributeEntries({ url: 'https://x', speed: 50, shadow: true, off: false, onclick: 'x', 'Bad Name': 1 }),
      [['shadow', ''], ['speed', '50'], ['url', 'https://x']]);
    assert.deepEqual(attributeEntries(null), []);
  });
});
