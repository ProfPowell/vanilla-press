import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { siteLayouts } from '../../src/app/site-layouts.js';

const OLD_COOK = "This site's Cook is too old for layouts built on other layouts; update cook-ssg";
const COOK = '/Users/tpowell/src/cook';

function tmpSite() {
  const dir = mkdtempSync(join(tmpdir(), 'vp-layouts-'));
  mkdirSync(join(dir, 'src', 'layouts'), { recursive: true });
  return dir;
}

describe('siteLayouts', () => {
  const dirs = [];
  const mk = () => { const d = tmpSite(); dirs.push(d); return d; };
  after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

  it('maps the site Cook listing: usable, head dropped, abstract kept', async () => {
    const importCook = async () => ({
      listLayouts: async () => ({
        layouts: [
          { name: 'base', label: 'Base', abstract: true, editable: false, ok: false,
            slots: [{ name: 'head', label: 'head' }, { name: 'aside', label: 'Aside' }] },
          { name: 'post', label: 'Post', abstract: false, editable: true, ok: true, slots: [] },
        ],
        includes: [], problems: [],
      }),
    });
    const r = await siteLayouts('/nowhere', { importCook });
    assert.equal(r.supported, true);
    assert.equal(r.message, null);
    assert.deepEqual(r.layouts, [
      { name: 'base', label: 'Base', abstract: true, usable: true, editable: false, missing: false,
        slots: [{ name: 'aside', label: 'Aside' }] },
      { name: 'post', label: 'Post', abstract: false, usable: true, editable: true, missing: false, slots: [] },
    ]);
  });

  it('falls back to a scan when the site has no Cook layouts export', async () => {
    const dir = mk();
    writeFileSync(join(dir, 'src/layouts/post.html'), '<html><body><main>${content}</main>${slot:aside}${slot:head}</body></html>');
    writeFileSync(join(dir, 'src/layouts/child.html'), '<html data-template="post"><body></body></html>');
    mkdirSync(join(dir, 'src/layouts/docs'));
    writeFileSync(join(dir, 'src/layouts/docs/index.html'), '<html><body>${content}</body></html>');
    const r = await siteLayouts(dir, { importCook: async () => null });
    assert.equal(r.supported, false);
    assert.equal(r.message, OLD_COOK);
    const by = Object.fromEntries(r.layouts.map((l) => [l.name, l]));
    assert.deepEqual(Object.keys(by).sort(), ['child', 'docs', 'post']);
    assert.equal(by.post.usable, true);
    assert.deepEqual(by.post.slots, [{ name: 'aside', label: 'aside' }]);
    assert.equal(by.post.label, 'post');
    assert.equal(by.child.usable, false);
    assert.equal(by.docs.usable, true);
    assert.equal(by.post.missing, false);
  });

  for (const [label, listLayouts, text] of [
    ['throws', async () => { throw new Error('boom'); }, 'boom'],
    ['returns no layouts', async () => ({}), null],
  ]) {
    it(`falls back with a read-failure message when listLayouts ${label}`, async () => {
      const dir = mk();
      writeFileSync(join(dir, 'src/layouts/post.html'), '<html><body>${content}</body></html>');
      const r = await siteLayouts(dir, { importCook: async () => ({ listLayouts }) });
      assert.equal(r.supported, false);
      assert.match(r.message, /^This site's Cook couldn't read its layouts: /);
      if (text) assert.ok(r.message.endsWith(text));
      assert.notEqual(r.message, OLD_COOK);
      assert.deepEqual(r.layouts.map((l) => l.name), ['post']);
    });
  }

  it('data-template on body also marks a layout unusable', async () => {
    const dir = mk();
    writeFileSync(join(dir, 'src/layouts/b.html'), '<html><body data-template="x"></body></html>');
    const r = await siteLayouts(dir, { importCook: async () => null });
    assert.equal(r.layouts[0].usable, false);
  });

  it('default importCook returns the fallback for a site with no node_modules', async () => {
    const dir = mk();
    writeFileSync(join(dir, 'src/layouts/post.html'), '<html></html>');
    const r = await siteLayouts(dir);
    assert.equal(r.supported, false);
    assert.equal(r.layouts.length, 1);
  });

  it('no layouts directory gives an empty list', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vp-layouts-'));
    dirs.push(dir);
    const r = await siteLayouts(dir, { importCook: async () => null });
    assert.deepEqual(r.layouts, []);
  });

  it('no site gives unsupported with no message', async () => {
    assert.deepEqual(await siteLayouts(null), { supported: false, message: null, layouts: [] });
  });

  it('uses the real Cook through node_modules', { skip: !existsSync(join(COOK, 'scripts/layouts.js')) }, async () => {
    const dir = mk();
    mkdirSync(join(dir, 'node_modules'));
    symlinkSync(COOK, join(dir, 'node_modules', 'cook-ssg'));
    writeFileSync(join(dir, 'package.json'), '{}');
    writeFileSync(join(dir, 'src/layouts/post.html'), '<html><body>${content}${slot:aside}</body></html>');
    const r = await siteLayouts(dir);
    assert.equal(r.supported, true);
    assert.equal(r.message, null);
    const post = r.layouts.find((l) => l.name === 'post');
    assert.ok(post);
    assert.equal(post.usable, true);
    assert.deepEqual(post.slots.map((s) => s.name), ['aside']);
  });
});
