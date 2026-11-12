import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, cpSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  listLayoutFiles, readLayoutFile, saveLayoutFile, createLayoutFile, deleteLayoutFile, layoutContext, serializeLayoutTree, LayoutError,
  OLD_COOK_EDIT_MESSAGE, CHANGED_ON_DISK,
} from '../../src/app/layout-store.js';

const COOK = '/Users/tpowell/src/cook';
const STARTER = join(COOK, 'starters', 'vanilla-breeze');
const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });

function makeSite({ repo = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'vp-layout-store-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'site', type: 'module', devDependencies: { 'cook-ssg': '^2.9.0' } }));
  mkdirSync(join(dir, 'node_modules'));
  symlinkSync(COOK, join(dir, 'node_modules', 'cook-ssg'));
  cpSync(join(STARTER, 'src', 'layouts'), join(dir, 'src', 'layouts'), { recursive: true });
  cpSync(join(STARTER, 'src', 'includes'), join(dir, 'src', 'includes'), { recursive: true });
  cpSync(join(STARTER, 'config'), join(dir, 'config'), { recursive: true });
  mkdirSync(join(dir, 'src', 'posts'), { recursive: true });
  writeFileSync(join(dir, 'src', 'posts', 'a.html'), '---\ntitle: A\nlayout: post\n---\n<p>hi</p>\n');
  if (repo) {
    git(dir, 'init', '-q');
    git(dir, 'config', 'user.name', 'T'); git(dir, 'config', 'user.email', 't@example.com');
    writeFileSync(join(dir, '.gitignore'), 'node_modules\n');
    git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'init');
  }
  return dir;
}

const rejects = (promise, status, message) => assert.rejects(promise, (err) => {
  assert.ok(err instanceof LayoutError, String(err));
  assert.equal(err.status, status, err.message);
  if (message) assert.equal(err.message, message);
  return true;
});

describe('layout-store', () => {
  const dirs = [];
  const mk = (opts) => { const d = makeSite(opts); dirs.push(d); return d; };
  after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

  it('lists layouts and includes with status, usedBy, baseFor and unpublished', async () => {
    const dir = mk({ repo: true });
    writeFileSync(join(dir, 'src/layouts/plain.html'), '<html><body>${content}</body></html>');
    writeFileSync(join(dir, 'src/layouts/bad.html'), readFileSync(join(dir, 'src/layouts/page.html'), 'utf8').replace('${title}', '${nope}'));
    let r = await listLayoutFiles(dir);
    assert.equal(r.supported, true);
    const by = Object.fromEntries(r.layouts.map((e) => [e.name, e]));
    assert.equal(by.base.status, 'editable');
    assert.deepEqual(by.base.baseFor.sort(), ['bad', 'docs', 'landing', 'page', 'post']);
    assert.equal(by.post.parent, 'base');
    assert.deepEqual(by.post.usedBy, ['src/posts/a.html']);
    assert.equal(by.plain.status, 'plain');
    assert.equal(by.bad.status, 'problems');
    assert.ok(by.bad.problems.length > 0);
    assert.equal(by.post.kind, 'layout');
    assert.equal(by.base.abstract, true);
    assert.equal(by.post.abstract, false);
    assert.equal(r.includes.find((e) => e.name === 'header').status, 'editable');
    assert.equal(r.includes.find((e) => e.name === 'header').kind, 'include');
    // plain and bad were added after the commit: untracked, so unpublished
    assert.equal(by.plain.unpublished, true);
    assert.equal(by.post.unpublished, false);
    const read = await readLayoutFile(dir, 'layout', 'post');
    await saveLayoutFile(dir, 'layout', 'post', { tree: { ...read.tree, info: { ...read.tree.info, label: 'Post 2' } }, hash: read.hash });
    r = await listLayoutFiles(dir);
    assert.equal(r.layouts.find((e) => e.name === 'post').unpublished, true);
    assert.equal(r.layouts.find((e) => e.name === 'post').label, 'Post 2');
  });

  it('marks unpublished files VP wrote (vpWrote), not files changed by hand on top (I1)', async () => {
    const dir = mk({ repo: true });
    const cfg = mkdtempSync(join(tmpdir(), 'vp-layout-writes-'));
    dirs.push(cfg);
    const writesLog = join(cfg, 'layout-writes', 'site.json');
    const read = await readLayoutFile(dir, 'layout', 'post');
    await saveLayoutFile(dir, 'layout', 'post', { tree: { ...read.tree, info: { ...read.tree.info, label: 'Post 2' } }, hash: read.hash }, { writesLog });
    await createLayoutFile(dir, { kind: 'layout', name: 'fresh', label: 'Fresh', start: { type: 'blank' } }, { writesLog });
    await deleteLayoutFile(dir, 'layout', 'docs', { writesLog });
    writeFileSync(join(dir, 'src/layouts/page.html'), `${readFileSync(join(dir, 'src/layouts/page.html'), 'utf8')}\n`);
    rmSync(join(dir, 'src/layouts/landing.html'));
    assert.ok(existsSync(writesLog), 'the record lives under the config dir');
    assert.equal(existsSync(join(dir, '.vp', 'layout-writes')), false);
    let r = await listLayoutFiles(dir, { writesLog });
    const by = () => Object.fromEntries(r.layouts.map((e) => [e.name, e]));
    assert.equal(by().post.vpWrote, true);
    assert.equal(by().fresh.vpWrote, true);
    assert.equal(by().page.unpublished, true);
    assert.equal(by().page.vpWrote, false);
    assert.equal(r.deleted.find((d) => d.name === 'docs').vpWrote, true);
    assert.equal(r.deleted.find((d) => d.name === 'landing').vpWrote, false);
    // A hand edit on top of VP's save: no longer VP's
    writeFileSync(join(dir, 'src/layouts/post.html'), `${readFileSync(join(dir, 'src/layouts/post.html'), 'utf8')}\n`);
    r = await listLayoutFiles(dir, { writesLog });
    assert.equal(by().post.vpWrote, false);
    assert.equal(by().fresh.vpWrote, true);
  });

  it('layoutContext: fields, lists with collections and program areas; an old Cook is a 409', async () => {
    const dir = mk();
    writeFileSync(join(dir, 'config', 'programs.json'), JSON.stringify({ areas: [{ path: 'courses' }, { path: 'media' }] }));
    const ctx = await layoutContext(dir, { collections: ['posts', 'posts'] });
    assert.deepEqual(ctx.lists.filter((l) => l.startsWith('collections.') || l.startsWith('programAreas')), ['collections.posts', 'programAreas.courses']);
    assert.ok(ctx.lists.includes('navItems'));
    assert.ok(ctx.siteFields.includes('siteTitle'));
    assert.deepEqual(ctx.declaredFields, []);
    assert.ok(ctx.documentFields.includes('url'));
    await rejects(layoutContext(dir, { importCook: async () => null }), 409, OLD_COOK_EDIT_MESSAGE);
  });

  it('unpublished is false outside a git repository', async () => {
    const dir = mk();
    const r = await listLayoutFiles(dir);
    assert.ok(r.layouts.every((e) => e.unpublished === false));
  });

  it('reading a plain or broken layout is a 409 with the problems', async () => {
    const dir = mk();
    writeFileSync(join(dir, 'src/layouts/plain.html'), '<html><body>${content}</body></html>');
    await assert.rejects(readLayoutFile(dir, 'layout', 'plain'), (err) => {
      assert.equal(err.status, 409);
      assert.equal(err.message, 'not editable');
      assert.ok(Array.isArray(err.body.problems));
      return true;
    });
    await rejects(readLayoutFile(dir, 'layout', 'nothere'), 404);
  });

  it('save round trip', async () => {
    const dir = mk();
    const a = await readLayoutFile(dir, 'layout', 'page');
    assert.equal(a.tree.kind, 'child');
    const saved = await saveLayoutFile(dir, 'layout', 'page', { tree: a.tree, hash: a.hash });
    const b = await readLayoutFile(dir, 'layout', 'page');
    assert.equal(b.hash, saved.hash);
    assert.deepEqual(b.tree, a.tree);
    const inc = await readLayoutFile(dir, 'include', 'footer');
    await saveLayoutFile(dir, 'include', 'footer', { tree: inc.tree, hash: inc.hash });
  });

  it('a hand edit between read and save is a 409 and nothing is written', async () => {
    const dir = mk();
    const a = await readLayoutFile(dir, 'layout', 'page');
    const file = join(dir, 'src/layouts/page.html');
    const edited = readFileSync(file, 'utf8') + '\n<!-- hand edit -->\n';
    writeFileSync(file, edited);
    await rejects(saveLayoutFile(dir, 'layout', 'page', { tree: a.tree, hash: a.hash }), 409, CHANGED_ON_DISK);
    assert.equal(readFileSync(file, 'utf8'), edited);
    assert.equal(CHANGED_ON_DISK, 'This layout changed on disk since you opened it');
  });

  it('a tree that fails the check is a 422 and nothing is written', async () => {
    const dir = mk();
    const a = await readLayoutFile(dir, 'layout', 'page');
    const before = readFileSync(join(dir, 'src/layouts/page.html'), 'utf8');
    const tree = structuredClone(a.tree);
    tree.body[0].body.push({ type: 'text', tag: 'p', attrs: [], inline: [{ field: 'noSuchField' }] });
    await assert.rejects(saveLayoutFile(dir, 'layout', 'page', { tree, hash: a.hash }), (err) => {
      assert.equal(err.status, 422);
      assert.ok(err.body.problems.length > 0);
      return true;
    });
    assert.equal(readFileSync(join(dir, 'src/layouts/page.html'), 'utf8'), before);
    await rejects(saveLayoutFile(dir, 'layout', 'page', { tree: { nonsense: true }, hash: a.hash }), 422);
  });

  it('save with a null hash needs the file not to exist', async () => {
    const dir = mk();
    const a = await readLayoutFile(dir, 'layout', 'page');
    await rejects(saveLayoutFile(dir, 'layout', 'page', { tree: a.tree, hash: null }), 409, CHANGED_ON_DISK);
    const out = await saveLayoutFile(dir, 'layout', 'fresh', { tree: a.tree, hash: null });
    assert.ok(out.hash);
    assert.ok(existsSync(join(dir, 'src/layouts/fresh.html')));
  });

  it('creates a child, a copy and a blank base; a duplicate name is a 409', async () => {
    const dir = mk();
    const child = await createLayoutFile(dir, { kind: 'layout', name: 'kid', label: 'Kid', start: { type: 'child', from: 'base' } });
    assert.equal(child.name, 'kid');
    const kid = await readLayoutFile(dir, 'layout', 'kid');
    assert.equal(kid.hash, child.hash);
    assert.equal(kid.tree.parent, 'base');
    assert.equal(kid.tree.info.label, 'Kid');
    assert.deepEqual(kid.tree.body, [{ type: 'content', attrs: [] }]);
    assert.equal(kid.tree.pageLayout, 'stack');

    await createLayoutFile(dir, { kind: 'layout', name: 'page2', label: 'Page two', start: { type: 'copy', from: 'page' } });
    const copy = await readLayoutFile(dir, 'layout', 'page2');
    const orig = await readLayoutFile(dir, 'layout', 'page');
    assert.equal(copy.tree.info.label, 'Page two');
    assert.deepEqual(copy.tree.body, orig.tree.body);

    await createLayoutFile(dir, { kind: 'layout', name: 'shell', label: 'Shell', start: { type: 'blank' } });
    const shell = await readLayoutFile(dir, 'layout', 'shell');
    assert.equal(shell.tree.kind, 'base');
    assert.equal(shell.tree.pageLayout, 'stack');
    assert.deepEqual(shell.tree.body.map((b) => b.tag ?? b.type), ['header', 'main', 'footer']);
    assert.deepEqual(shell.tree.head.map((h) => h.tag), ['meta', 'meta', 'title']);

    await createLayoutFile(dir, { kind: 'include', name: 'banner', label: 'Banner', start: { type: 'blank' } });
    assert.equal((await readLayoutFile(dir, 'include', 'banner')).tree.kind, 'fragment');
    assert.match(readFileSync(join(dir, 'src/includes/banner.html'), 'utf8'), /^<!-- layout-fragment -->/);

    await rejects(createLayoutFile(dir, { kind: 'layout', name: 'kid', label: 'Again', start: { type: 'blank' } }), 409);
    await rejects(createLayoutFile(dir, { kind: 'layout', name: 'x', label: 'X', start: { type: 'child', from: 'missing' } }), 404);
    await rejects(createLayoutFile(dir, { kind: 'layout', name: 'x', label: '  ', start: { type: 'blank' } }), 400);
  });

  it('delete refuses a used layout naming the users, and removes an unused one', async () => {
    const dir = mk();
    await assert.rejects(deleteLayoutFile(dir, 'layout', 'post'), (err) => {
      assert.equal(err.status, 409);
      assert.equal(err.message, 'in use');
      assert.deepEqual(err.body.usedBy, ['src/posts/a.html']);
      assert.deepEqual(err.body.baseFor, []);
      return true;
    });
    await assert.rejects(deleteLayoutFile(dir, 'layout', 'base'), (err) => err.status === 409 && err.body.baseFor.includes('page'));
    assert.ok(existsSync(join(dir, 'src/layouts/post.html')));
    await deleteLayoutFile(dir, 'layout', 'docs');
    assert.equal(existsSync(join(dir, 'src/layouts/docs.html')), false);
  });

  it('lists include users and refuses to delete a used include', async () => {
    const dir = mk();
    const r = await listLayoutFiles(dir);
    const header = r.includes.find((e) => e.name === 'header');
    assert.ok(header.usedBy.includes('src/layouts/base.html'), JSON.stringify(header.usedBy));
    await assert.rejects(deleteLayoutFile(dir, 'include', 'header'), (err) => {
      assert.equal(err.status, 409);
      assert.equal(err.message, 'in use');
      assert.ok(err.body.usedBy.includes('src/layouts/base.html'));
      assert.deepEqual(err.body.baseFor, []);
      return true;
    });
    assert.ok(existsSync(join(dir, 'src/includes/header.html')));
    await createLayoutFile(dir, { kind: 'include', name: 'spare', label: 'Spare', start: { type: 'blank' } });
    await deleteLayoutFile(dir, 'include', 'spare');
    assert.equal(existsSync(join(dir, 'src/includes/spare.html')), false);
  });

  it('include usage: files directly in a program area count, program folders do not', async () => {
    const tag = '<div data-include="/includes/footer.html"></div>';
    const usedWith = async (areas, mainJs) => {
      const dir = mk();
      writeFileSync(join(dir, 'config', 'programs.json'), JSON.stringify({ areas, programs: [] }));
      if (mainJs) writeFileSync(join(dir, 'config', 'main.js'), mainJs);
      mkdirSync(join(dir, 'src/demos/plasma'), { recursive: true });
      writeFileSync(join(dir, 'src/demos/list.html'), tag);
      writeFileSync(join(dir, 'src/demos/plasma/index.html'), tag);
      return { dir, used: (await listLayoutFiles(dir)).includes.find((e) => e.name === 'footer').usedBy };
    };
    let { dir, used } = await usedWith([{ path: 'demos' }]);
    assert.ok(used.includes('src/demos/list.html'));
    assert.ok(!used.includes('src/demos/plasma/index.html'));
    writeFileSync(join(dir, 'src/demos/plasma/index.html'), '<div data-include="/includes/spare.html"></div>');
    await createLayoutFile(dir, { kind: 'include', name: 'spare', label: 'Spare', start: { type: 'blank' } });
    await deleteLayoutFile(dir, 'include', 'spare');
    assert.equal(existsSync(join(dir, 'src/includes/spare.html')), false);

    // Not slugs, reserved names and buildOnlyPaths entries are not areas (Cook ignores them)
    for (const path of ['/demos/', 'src/demos', 'Demos']) {
      ({ used } = await usedWith([{ path }]));
      assert.ok(used.includes('src/demos/plasma/index.html'), path);
    }
    ({ used } = await usedWith([{ path: 'demos' }], "export default { buildOnlyPaths: ['demos'] };\n"));
    assert.ok(used.includes('src/demos/plasma/index.html'), 'buildOnlyPaths');
    // a reserved name is no area: src/media/x/y.html is a page there
    const r = mk();
    writeFileSync(join(r, 'config', 'programs.json'), JSON.stringify({ areas: [{ path: 'media' }], programs: [] }));
    mkdirSync(join(r, 'src/media/x'), { recursive: true });
    writeFileSync(join(r, 'src/media/x/index.html'), tag);
    assert.ok((await listLayoutFiles(r)).includes.find((e) => e.name === 'footer').usedBy.includes('src/media/x/index.html'));
  });

  it('refuses a save that makes a parent cycle', async () => {
    const dir = mk();
    await createLayoutFile(dir, { kind: 'layout', name: 'a', label: 'A', start: { type: 'child', from: 'base' } });
    await createLayoutFile(dir, { kind: 'layout', name: 'b', label: 'B', start: { type: 'child', from: 'a' } });
    const a = await readLayoutFile(dir, 'layout', 'a');
    const before = readFileSync(join(dir, 'src/layouts/a.html'), 'utf8');
    const cyc = async (parent, msg) => {
      await assert.rejects(saveLayoutFile(dir, 'layout', 'a', { tree: { ...a.tree, parent }, hash: a.hash }), (err) => {
        assert.equal(err.status, 422);
        assert.ok(err.body.problems.some((p) => p.message === msg), JSON.stringify(err.body));
        return true;
      });
    };
    await cyc('a', 'Layout cycle: a → a');
    await cyc('b', 'Layout cycle: a → b → a');
    assert.equal(readFileSync(join(dir, 'src/layouts/a.html'), 'utf8'), before);
  });

  it('refuses bad names and kinds with a 400', async () => {
    const dir = mk();
    for (const name of ['../x', 'a/b', '.x', '']) {
      await rejects(readLayoutFile(dir, 'layout', name), 400);
      await rejects(saveLayoutFile(dir, 'layout', name, { tree: {}, hash: null }), 400);
      await rejects(deleteLayoutFile(dir, 'include', name), 400);
      await rejects(createLayoutFile(dir, { kind: 'layout', name, label: 'X', start: { type: 'blank' } }), 400);
    }
    await rejects(readLayoutFile(dir, 'file', 'page'), 400);
  });

  it('serializes an unsaved tree with the site\'s Cook (for the preview); writes nothing', async () => {
    const dir = mk();
    const file = join(dir, 'src', 'layouts', 'post.html');
    const before = readFileSync(file, 'utf8');
    const { tree } = await readLayoutFile(dir, 'layout', 'post');
    tree.body[0].body[0].tag = 'h2';
    const { html } = await serializeLayoutTree(dir, 'layout', tree);
    assert.match(html, /<h2>\$\{title\}<\/h2>/);
    assert.equal(readFileSync(file, 'utf8'), before);
    const inc = await readLayoutFile(dir, 'include', 'header');
    assert.match((await serializeLayoutTree(dir, 'include', inc.tree)).html, /^<!-- layout-fragment -->/);
    await rejects(serializeLayoutTree(dir, 'file', tree), 400);
    await rejects(serializeLayoutTree(dir, 'layout', null), 400);
    await rejects(serializeLayoutTree(dir, 'include', tree), 400);
    await rejects(serializeLayoutTree(dir, 'layout', inc.tree), 400);
    await rejects(serializeLayoutTree(dir, 'layout', { ...tree, body: 'nope' }), 422);
    await rejects(serializeLayoutTree(dir, 'layout', tree, { importCook: async () => ({}) }), 409, OLD_COOK_EDIT_MESSAGE);
  });

  it('an old Cook is unsupported with the message', async () => {
    const dir = mk();
    const old = async () => ({ listLayouts: async () => ({ layouts: [], includes: [] }) });
    const r = await listLayoutFiles(dir, { importCook: old });
    assert.equal(r.supported, false);
    assert.equal(r.message, OLD_COOK_EDIT_MESSAGE);
    assert.deepEqual(r.deleted, []);
    assert.ok(r.layouts.length > 0 && r.includes.length > 0);
    for (const e of [...r.layouts, ...r.includes]) {
      assert.equal(e.status, 'plain');
      assert.deepEqual([e.usedBy, e.baseFor, e.unpublished], [[], [], false]);
    }
    assert.ok(r.layouts.some((e) => e.name === 'post' && e.kind === 'layout'));
    assert.ok(r.includes.every((e) => e.kind === 'include'));
    assert.equal(OLD_COOK_EDIT_MESSAGE, "This site's Cook is too old to edit layouts; update cook-ssg");
    await rejects(readLayoutFile(dir, 'layout', 'page', { importCook: old }), 409, OLD_COOK_EDIT_MESSAGE);
  });
});
