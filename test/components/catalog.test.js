import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATALOG, CONTENT_KINDS } from '../../src/components/catalog.js';
import { readManifest } from '../../src/components/manifest.js';
import { packageDir } from '../../src/components/describe.js';

const vpRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// The published marquee-wc 1.7.0 and border-wc 0.2.0 tarballs omit
// custom-elements.json (not in their "files"). Until they are republished
// their attributes cannot be checked here, and the settings form is empty.
const NO_PUBLISHED_MANIFEST = new Set(['@profpowell/marquee-wc', '@profpowell/border-wc']);

const elements = CATALOG.flatMap((e) => e.elements.map((el) => ({ pkg: e.package, el })));

function manifestFor(pkg) {
  const found = packageDir(pkg, { siteDir: null, vpRoot });
  assert.ok(found, `${pkg} is installed in VP`);
  return readManifest(found.dir);
}

describe('component catalog', () => {
  it('holds the ten @profpowell packages and the bundled VB entry', () => {
    const pkgs = CATALOG.map((e) => e.package);
    assert.equal(pkgs.filter((p) => p.startsWith('@profpowell/')).length, 10);
    const vb = CATALOG.find((e) => e.package === 'vanilla-breeze');
    assert.equal(vb.bundled, true);
    assert.equal(vb.elements.length, 11);
  });

  it('every catalog tag exists in its package manifest', () => {
    for (const entry of CATALOG) {
      const manifest = manifestFor(entry.package);
      if (NO_PUBLISHED_MANIFEST.has(entry.package)) {
        assert.equal(manifest.size, 0, `${entry.package} now ships a manifest: remove it from NO_PUBLISHED_MANIFEST`);
        continue;
      }
      for (const el of entry.elements) {
        assert.ok(manifest.has(el.tag), `${el.tag} missing from ${entry.package} manifest`);
      }
    }
  });

  it('defaults and advanced name only declared attributes', () => {
    for (const entry of CATALOG) {
      if (NO_PUBLISHED_MANIFEST.has(entry.package)) continue;
      const manifest = manifestFor(entry.package);
      for (const el of entry.elements) {
        const names = new Set(manifest.get(el.tag).attributes.map((a) => a.name));
        for (const k of Object.keys(el.defaults)) assert.ok(names.has(k), `${el.tag} default ${k} not declared`);
        for (const k of el.advanced) assert.ok(names.has(k), `${el.tag} advanced ${k} not declared`);
      }
    }
  });

  it('kinds are valid and code kinds have codeWrap', () => {
    for (const { el } of elements) {
      assert.ok(CONTENT_KINDS.includes(el.kind), `${el.tag} kind`);
      for (const f of ['label', 'icon', 'description', 'group']) {
        assert.equal(typeof el[f], 'string', `${el.tag} ${f}`);
        assert.ok(el[f], `${el.tag} ${f} non-empty`);
      }
      assert.ok(Array.isArray(el.advanced));
      if (el.kind === 'code') assert.ok(['text', 'template', 'script'].includes(el.codeWrap), `${el.tag} codeWrap`);
      else assert.equal(el.codeWrap, undefined, `${el.tag} has codeWrap without code kind`);
    }
    assert.deepEqual(CONTENT_KINDS, ['none', 'text', 'code', 'blocks', 'inline']);
    const byTag = Object.fromEntries(elements.map(({ el }) => [el.tag, el]));
    assert.equal(byTag['code-block'].kind, 'code');
    assert.equal(byTag['code-block'].codeWrap, 'text');
    assert.equal(byTag['blink-wc'].kind, 'inline');
    assert.equal(byTag['marquee-wc'].kind, 'text');
  });

  it('tags are unique across the catalog', () => {
    const tags = elements.map(({ el }) => el.tag);
    assert.equal(new Set(tags).size, tags.length);
  });
});
