import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeComponents, componentIndex, packageDir } from '../../src/components/describe.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/components');
const REAL_VP = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const hint = (tag, extra = {}) => ({
  tag, label: tag, icon: 'x', description: tag, group: 'Test',
  kind: 'none', defaults: {}, advanced: [], ...extra,
});
const catalog = [
  { package: 'x-widgets', elements: [hint('x-one'), hint('x-two')] },
  { package: 'x-other', elements: [hint('x-three')] },
  { package: 'x-bundled', bundled: true, elements: [hint('x-four')] },
];

let root, siteDir, vpRoot;

function install(dir, name, fixture) {
  const dest = join(dir, 'node_modules', name);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(join(FIX, fixture), dest, { recursive: true });
}
function sitePkg(deps) {
  writeFileSync(join(siteDir, 'package.json'), JSON.stringify({ name: 'site', dependencies: deps }));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'vp-describe-'));
  siteDir = join(root, 'site');
  vpRoot = join(root, 'vp');
  mkdirSync(siteDir);
  mkdirSync(vpRoot);
  install(vpRoot, 'x-widgets', 'x-widgets');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const state = (states, pkg) => states.find((s) => s.package === pkg);

describe('describeComponents', () => {
  it('a package in site dependencies is enabled, others are not', () => {
    sitePkg({ 'x-widgets': '^1.0.0' });
    const states = describeComponents({ siteDir, vpRoot, catalog });
    assert.equal(state(states, 'x-widgets').enabled, true);
    assert.equal(state(states, 'x-other').enabled, false);
  });

  it('VB elements are always enabled and bundled', () => {
    sitePkg({});
    const s = state(describeComponents({ siteDir, vpRoot, catalog }), 'x-bundled');
    assert.equal(s.enabled, true);
    assert.equal(s.bundled, true);
    assert.equal(s.elements[0].bundled, true);
    assert.equal(s.elements[0].scriptPath, null);
    const real = describeComponents({ siteDir: null, vpRoot: REAL_VP });
    const vb = state(real, 'vanilla-breeze');
    assert.equal(vb.bundled, true);
    assert.equal(vb.enabled, true);
    assert.ok(vb.elements.find((e) => e.tag === 'audio-player').attributes.length > 0);
  });

  it('fills attributes, versions, source and scriptPath from the VP copy', () => {
    sitePkg({ 'x-widgets': '^1.0.0' });
    const s = state(describeComponents({ siteDir, vpRoot, catalog }), 'x-widgets');
    assert.equal(s.source, 'vp');
    assert.equal(s.vpVersion, '1.2.0');
    assert.equal(s.siteVersion, null);
    const one = s.elements[0];
    assert.equal(one.package, 'x-widgets');
    assert.equal(one.scriptPath, 'dist/x-widgets.js');
    assert.deepEqual(one.attributes.map((a) => a.name), ['mode', 'count', 'open']);
    const missing = state(describeComponents({ siteDir, vpRoot, catalog }), 'x-other');
    assert.equal(missing.source, null);
    assert.deepEqual(missing.elements[0].attributes, []);
    assert.equal(missing.elements[0].scriptPath, null);
  });

  it('site copy wins over VP copy', () => {
    sitePkg({ 'x-widgets': '^1.0.0' });
    install(siteDir, 'x-widgets', 'x-widgets-site');
    const s = state(describeComponents({ siteDir, vpRoot, catalog }), 'x-widgets');
    assert.equal(s.source, 'site');
    assert.equal(s.siteVersion, '1.1.0');
    assert.equal(s.vpVersion, '1.2.0');
    assert.deepEqual(s.elements[0].attributes.map((a) => a.name), ['mode', 'open']);
    // entry falls back to "module" when there are no exports
    assert.equal(s.elements[0].scriptPath, 'dist/x-widgets.js');
    assert.equal(packageDir('x-widgets', { siteDir, vpRoot }).source, 'site');
  });

  it('siteDir null treats every package as enabled', () => {
    const states = describeComponents({ siteDir: null, vpRoot, catalog });
    assert.ok(states.every((s) => s.enabled));
  });

  it('packageDir returns null when nothing is installed', () => {
    assert.equal(packageDir('x-other', { siteDir, vpRoot }), null);
    assert.equal(packageDir('x-widgets', { siteDir: null, vpRoot }).source, 'vp');
  });
});

describe('componentIndex', () => {
  it('skips disabled packages unless enabledOnly is false', () => {
    sitePkg({ 'x-widgets': '^1.0.0' });
    const states = describeComponents({ siteDir, vpRoot, catalog });
    assert.deepEqual([...componentIndex(states).keys()].sort(), ['x-four', 'x-one', 'x-two']);
    assert.deepEqual(
      [...componentIndex(states, { enabledOnly: false }).keys()].sort(),
      ['x-four', 'x-one', 'x-three', 'x-two'],
    );
    assert.equal(componentIndex(states).get('x-one').package, 'x-widgets');
  });
});
