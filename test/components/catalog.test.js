import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATALOG, CONTENT_KINDS } from '../../src/components/catalog.js';
import { readManifest } from '../../src/components/manifest.js';
import { packageDir, describeComponents, componentIndex } from '../../src/components/describe.js';
import { validate } from '../../src/schema/validate.js';
import { initialAttrs } from '../../editor/assets/js/component-model.js';

const vpRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// The published border-wc 0.2.0 tarball omits custom-elements.json (not in
// its "files"). Until it is republished its element carries an `attributes`
// hint from the README (R13). marquee-wc 1.7.1 ships a manifest whose
// attributes are untyped, so its hint now only refines them (R17).
const NO_PUBLISHED_MANIFEST = new Set(['@profpowell/border-wc']);

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
    assert.deepEqual(vb.elements.map((e) => e.tag).sort(), [
      'accordion-wc', 'audio-player', 'carousel-wc', 'diagram-wc', 'foot-notes', 'geo-map',
      'image-gallery', 'qr-code', 'social-embed', 'video-player', 'youtube-player',
    ]);
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

  it('packages without a published manifest carry an attributes hint covering defaults and advanced (R13)', () => {
    for (const entry of CATALOG.filter((e) => NO_PUBLISHED_MANIFEST.has(e.package))) {
      for (const el of entry.elements) assert.ok(Array.isArray(el.attributes) && el.attributes.length, `${el.tag} has no attributes hint`);
    }
  });

  it('every attributes hint is well formed and covers its defaults and advanced (R13, R17)', () => {
    for (const entry of CATALOG) {
      for (const el of entry.elements.filter((e) => e.attributes)) {
        assert.ok(Array.isArray(el.attributes) && el.attributes.length, `${el.tag} has no attributes hint`);
        const byName = new Map(el.attributes.map((a) => [a.name, a]));
        assert.equal(byName.size, el.attributes.length, `${el.tag} hint repeats a name`);
        for (const a of el.attributes) {
          assert.ok(['string', 'number', 'boolean'].includes(a.type), `${el.tag} ${a.name} type ${a.type}`);
          if (a.enum) assert.ok(Array.isArray(a.enum) && a.enum.length && a.type === 'string', `${el.tag} ${a.name} enum`);
        }
        for (const k of [...Object.keys(el.defaults), ...el.advanced]) assert.ok(byName.has(k), `${el.tag} ${k} not in its hint`);
        for (const [k, v] of Object.entries(el.defaults)) {
          const def = byName.get(k);
          if (def.enum) assert.ok(def.enum.includes(v), `${el.tag} default ${k}=${v} not in its enum`);
          if (def.type === 'number') assert.equal(typeof v, 'number', `${el.tag} default ${k}`);
          if (def.type === 'boolean') assert.equal(typeof v, 'boolean', `${el.tag} default ${k}`);
        }
      }
    }
  });

  it('a hint on a package with a manifest names only attributes the manifest declares (R17)', () => {
    for (const entry of CATALOG.filter((e) => !NO_PUBLISHED_MANIFEST.has(e.package))) {
      const manifest = manifestFor(entry.package);
      for (const el of entry.elements.filter((e) => e.attributes)) {
        const names = new Set(manifest.get(el.tag).attributes.map((a) => a.name));
        for (const a of el.attributes) assert.ok(names.has(a.name), `${el.tag} hint ${a.name} not in its manifest`);
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

  it('every element\'s defaults match its descriptor\'s attribute types and enums, and validate once inserted', () => {
    const index = componentIndex(describeComponents({ siteDir: null, vpRoot }), { enabledOnly: false });
    for (const { el } of elements) {
      const desc = index.get(el.tag);
      assert.ok(desc, `${el.tag} described`);
      const byName = new Map(desc.attributes.map((a) => [a.name, a]));
      for (const [k, v] of Object.entries(el.defaults)) {
        const def = byName.get(k);
        assert.ok(def, `${el.tag} default ${k} not declared`);
        assert.equal(typeof v, def.type, `${el.tag} default ${k}=${JSON.stringify(v)} must be a ${def.type}`);
        if (def.enum) assert.ok(def.enum.includes(v), `${el.tag} default ${k}=${v} not in its enum`);
      }
      // What the editor inserts (initialAttrs) must save: validate it as a stored post would be.
      const node = { type: 'component', ...initialAttrs(desc) };
      if (desc.kind === 'blocks') node.children = [{ type: 'paragraph', children: [{ type: 'text', value: 'a' }] }];
      if (desc.kind === 'inline') node.children = [{ type: 'text', value: 'a' }];
      const block = desc.kind === 'inline' ? { type: 'paragraph', children: [node] } : node;
      const doc = { id: 'doc_cat', meta: { title: 'T', slug: 't', collection: 'posts', status: 'draft' }, blocks: [block] };
      const r = validate(doc, { components: index });
      assert.equal(r.valid, true, `${el.tag}: ${r.errors.join('; ')}`);
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
    // R16: <foot-notes> collects the <foot-note> elements above it and wraps no authored content
    assert.equal(byTag['foot-notes'].kind, 'none');
  });

  it('tags are unique across the catalog', () => {
    const tags = elements.map(({ el }) => el.tag);
    assert.equal(new Set(tags).size, tags.length);
  });
});
