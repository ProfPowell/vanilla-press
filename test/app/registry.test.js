import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  listSites, getSite, addSite, removeSite, isCookSite, listFolders, configDir,
} from '../../src/app/registry.js';

let root;
let env;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'vp-registry-'));
  env = { VP_CONFIG_DIR: join(root, 'config') };
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function makeSite(...parts) {
  const dir = join(root, ...parts);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ devDependencies: { 'cook-ssg': '^2.0.0' } }));
  return dir;
}

test('configDir honours VP_CONFIG_DIR', () => {
  assert.equal(configDir(env), env.VP_CONFIG_DIR);
});

test('addSite registers a Cook site and lists it', () => {
  const dir = makeSite('My Site');
  const site = addSite({ path: dir }, { env });
  assert.deepEqual(listSites({ env }), [site]);
  assert.equal(site.id, 'my-site');
  assert.equal(site.name, 'My Site');
  assert.equal(site.path, dir);
  assert.equal(new Date(site.addedAt).toISOString(), site.addedAt);
  assert.deepEqual(getSite('my-site', { env }), site);
  assert.equal(getSite('nope', { env }), null);
});

test('addSite rejects a folder without cook-ssg', () => {
  const dir = join(root, 'plain');
  mkdirSync(dir);
  writeFileSync(join(dir, 'package.json'), '{}');
  assert.throws(() => addSite({ path: dir }, { env }), /Not a Cook site/);
});

test('addSite rejects a duplicate path', () => {
  const dir = makeSite('a');
  addSite({ path: dir }, { env });
  assert.throws(() => addSite({ path: dir }, { env }), /Already added/);
});

test('ids are unique', () => {
  const a = addSite({ path: makeSite('one', 'blog') }, { env });
  const b = addSite({ path: makeSite('two', 'blog') }, { env });
  assert.equal(a.id, 'blog');
  assert.equal(b.id, 'blog-2');
});

test('addSite creates .vp and git-ignores it once', () => {
  const dir = makeSite('s1');
  addSite({ path: dir }, { env });
  assert.ok(existsSync(join(dir, '.vp')));
  const lines = readFileSync(join(dir, '.gitignore'), 'utf8').split('\n').filter((l) => l === '.vp/');
  assert.equal(lines.length, 1);

  const dir2 = makeSite('s2');
  const original = 'node_modules/\n.vp/\n';
  writeFileSync(join(dir2, '.gitignore'), original);
  addSite({ path: dir2 }, { env });
  assert.equal(readFileSync(join(dir2, '.gitignore'), 'utf8'), original);
});

test('removeSite forgets the site but leaves its folder', () => {
  const dir = makeSite('gone');
  const site = addSite({ path: dir }, { env });
  assert.equal(removeSite(site.id, { env }), true);
  assert.deepEqual(listSites({ env }), []);
  assert.ok(existsSync(dir));
  assert.equal(removeSite(site.id, { env }), false);
});

test('isCookSite checks dependencies and devDependencies', () => {
  const dir = join(root, 'dep');
  mkdirSync(dir);
  assert.equal(isCookSite(dir), false);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { 'cook-ssg': '1' } }));
  assert.equal(isCookSite(dir), true);
});

test('listFolders lists subfolders and marks sites', () => {
  const site = makeSite('parent', 'zeta');
  mkdirSync(join(root, 'parent', 'alpha'));
  mkdirSync(join(root, 'parent', '.hidden'));
  writeFileSync(join(root, 'parent', 'file.txt'), 'x');
  const res = listFolders(join(root, 'parent'));
  assert.equal(res.path, join(root, 'parent'));
  assert.equal(res.parent, root);
  assert.deepEqual(res.folders, [
    { name: 'alpha', path: join(root, 'parent', 'alpha'), isSite: false },
    { name: 'zeta', path: site, isSite: true },
  ]);
});

test('registry survives a missing or corrupt sites.json', () => {
  assert.deepEqual(listSites({ env }), []);
  mkdirSync(env.VP_CONFIG_DIR, { recursive: true });
  const file = join(env.VP_CONFIG_DIR, 'sites.json');
  writeFileSync(file, '{not json');
  assert.throws(() => listSites({ env }), /sites\.json/);
  assert.throws(() => addSite({ path: makeSite('x') }, { env }), /sites\.json/);
  assert.equal(readFileSync(file, 'utf8'), '{not json');
});
