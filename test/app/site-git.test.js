import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ownedPaths, createBackup, commitTitle, postPages, BACKUP_PATHS } from '../../src/app/site-git.js';
import * as realGit from '../../src/git/git.js';
import { resolveWorkspace } from '../../src/workspace/workspace.js';
import { makeGitSite, fakeClock, git, write } from './git-site-fixture.js';

const repoRoot = join(import.meta.dirname, '..', '..');
let fx;
afterEach(() => { if (fx) rmSync(fx.root, { recursive: true, force: true }); fx = null; });

const wsOf = (dir) => resolveWorkspace({ site: dir, env: {}, repoRoot });
const lastRemote = () => git(fx.remote, 'log', '-1', '--format=%s', 'main');
const remoteCount = () => Number(git(fx.remote, 'rev-list', '--count', 'main'));
const draft = (slug, title) => JSON.stringify({ id: `doc_${slug}`, meta: { title, slug, collection: 'posts', status: 'draft' }, blocks: [] });

function backupFor(clock, extra = {}) {
  return createBackup({
    site: { id: 's1', path: fx.site }, ws: wsOf(fx.site), git: realGit,
    now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer, ...extra,
  });
}

test('ownedPaths lists content and the VP-owned files in each collection dir', () => {
  fx = makeGitSite();
  write(fx.site, 'content/posts/a.json', draft('a', 'A'));
  write(fx.site, 'content/media.json', '[]');
  write(fx.site, 'src/posts/a.html', '---\ntitle: "A"\nvp_id: "doc_a"\n---\n<p>A</p>\n');
  write(fx.site, 'src/posts/mine.html', '---\ntitle: "Mine"\n---\n<p>Hand-written</p>\n');
  write(fx.site, 'src/posts/notes.txt', 'mine');
  write(fx.site, '.vp/manifest.json', JSON.stringify({
    version: 1, documents: { doc_gone: { json: 'content/posts/gone.json', html: 'src/posts/gone.html', jsonHash: 'x' } },
  }));
  assert.deepEqual(ownedPaths(wsOf(fx.site), {}).sort(),
    ['config/vp.json', 'content', 'src/media', 'src/posts/a.html', 'src/posts/gone.html']);
  // A configured output dir replaces the default one.
  write(fx.site, 'src/blog/b.html', '---\nvp_id: "doc_b"\n---\n<p>B</p>\n');
  assert.deepEqual(ownedPaths(wsOf(fx.site), { posts: { path: 'blog' } }).sort(),
    ['config/vp.json', 'content', 'src/blog/b.html', 'src/media', 'src/posts/gone.html']);
});

test('ownedPaths lists only VP-owned page files for a pages collection', () => {
  fx = makeGitSite();
  mkdirSync(join(fx.site, 'content', 'pages'), { recursive: true });
  write(fx.site, 'src/about.html', '---\ntitle: "About"\nvp_id: "doc_about"\n---\n<p>About</p>\n');
  write(fx.site, 'src/hand.html', '---\ntitle: "Hand"\n---\n<p>Mine</p>\n');
  write(fx.site, '.vp/manifest.json', JSON.stringify({
    version: 1, documents: { doc_old: { json: 'content/pages/old.json', html: 'src/old.html', jsonHash: 'x' } },
  }));
  const paths = ownedPaths(wsOf(fx.site), {});
  assert.deepEqual(paths.sort(), ['config/vp.json', 'content', 'src/about.html', 'src/media', 'src/old.html']);
  assert.ok(!paths.includes('src') && !paths.includes('src/hand.html') && !paths.includes('src/index.html'));
});

test('commitTitle joins up to three titles', () => {
  assert.equal(commitTitle(['A']), 'A');
  assert.equal(commitTitle(['A', 'B', 'C']), 'A, B, C');
  assert.equal(commitTitle(['A', 'B', 'C', 'D', 'E']), 'A, B, C and 2 more');
});

test('draft backup commits with CI Skip after the pause', async () => {
  fx = makeGitSite();
  const clock = fakeClock();
  const backup = backupFor(clock);
  write(fx.site, 'content/posts/hello.json', draft('hello', 'Hello'));
  backup.noteSaved({ title: 'Hello', status: 'draft' });
  assert.equal(backup.state().pending, 1);
  await clock.advance(29_000);
  assert.equal(lastRemote(), 'init');
  await clock.advance(1_000);
  assert.equal(lastRemote(), 'Draft: Hello [CI Skip]');
  const s = backup.state();
  assert.equal(s.pending, 0);
  assert.equal(s.error, null);
  assert.equal(s.connected, true);
  assert.equal(s.lastPushAt, new Date(clock.now()).toISOString());
});

test('draft backup batches titles', async () => {
  fx = makeGitSite();
  const clock = fakeClock();
  const backup = backupFor(clock);
  for (const [slug, title] of [['a', 'A'], ['b', 'B'], ['a', 'A'], ['c', 'C']]) {
    write(fx.site, `content/posts/${slug}.json`, draft(slug, title) + slug.repeat(3));
    backup.noteSaved({ title, status: 'draft' });
    await clock.advance(10_000);
  }
  await clock.advance(30_000);
  assert.equal(remoteCount(), 2);
  assert.equal(lastRemote(), 'Draft: A, B, C [CI Skip]');
});

test('draft backup pushes at most 120 s after the first save', async () => {
  fx = makeGitSite();
  const clock = fakeClock();
  const backup = backupFor(clock);
  for (let i = 0; i < 6; i++) {
    write(fx.site, 'content/posts/a.json', draft('a', 'A') + i);
    backup.noteSaved({ title: 'A', status: 'draft' });
    await clock.advance(20_000); // never a 30 s pause
  }
  // Saves at 0..100 s; the deadline is 120 s.
  assert.equal(lastRemote(), 'Draft: A [CI Skip]');
});

test('backup of an edited published post commits the JSON only, as Edit with CI Skip', async () => {
  fx = makeGitSite();
  const backup = backupFor(fakeClock());
  write(fx.site, 'content/posts/hello.json', draft('hello', 'Hello'));
  write(fx.site, 'src/posts/hello.html', '---\nvp_id: "doc_hello"\n---\n<p>Old</p>\n');
  git(fx.site, 'add', '-A');
  git(fx.site, 'commit', '-m', 'Publish: Hello');
  git(fx.site, 'push');
  write(fx.site, 'content/posts/hello.json', draft('hello', 'Hello') + ' ');
  write(fx.site, 'src/posts/hello.html', '---\nvp_id: "doc_hello"\n---\n<p>New</p>\n'); // the save's sync
  assert.equal(backup.state().lastPushKind, null);
  backup.noteSaved({ title: 'Hello', status: 'published' });
  await backup.flush();
  assert.equal(lastRemote(), 'Edit: Hello [CI Skip]');
  assert.equal(git(fx.remote, 'show', '--name-only', '--format=', 'main'), 'content/posts/hello.json');
  assert.match(git(fx.remote, 'show', 'main:src/posts/hello.html'), /<p>Old<\/p>/);
  assert.match(git(fx.site, 'status', '--porcelain'), /M src\/posts\/hello\.html/); // still the working tree's, for Preview
  assert.equal(backup.state().lastPushKind, 'draft');
  await backup.exclusive(async () => ({ status: 'pushed' }));
  assert.equal(backup.state().lastPushKind, 'publish');
});

test('backup stages only content, src/media and config/vp.json', async () => {
  fx = makeGitSite();
  assert.deepEqual([...BACKUP_PATHS].sort(), ['config/vp.json', 'content', 'src/media']);
  const backup = backupFor(fakeClock());
  write(fx.site, 'content/posts/hello.json', draft('hello', 'Hello'));
  write(fx.site, 'src/media/pic.png', 'png');
  write(fx.site, 'config/vp.json', '{}\n');
  write(fx.site, 'src/posts/hello.html', '---\nvp_id: "doc_hello"\n---\n<p>Hi</p>\n');
  write(fx.site, 'src/about.html', '---\nvp_id: "doc_about"\n---\n<p>About</p>\n');
  mkdirSync(join(fx.site, 'content', 'pages'), { recursive: true });
  backup.noteSaved({ title: 'Hello', status: 'draft' });
  await backup.flush();
  assert.deepEqual(git(fx.remote, 'show', '--name-only', '--format=', 'main').split('\n').sort(),
    ['config/vp.json', 'content/posts/hello.json', 'src/media/pic.png']);
  assert.equal(lastRemote(), 'Draft: Hello [CI Skip]');
});

test('draft backup leaves files outside VP paths alone', async () => {
  fx = makeGitSite();
  const clock = fakeClock();
  const backup = backupFor(clock);
  write(fx.site, 'content/posts/hello.json', draft('hello', 'Hello'));
  write(fx.site, 'src/programs/p/index.html', '<p>agent</p>');
  write(fx.site, 'config/main.js', 'export default { changed: 1 };\n');
  backup.noteSaved({ title: 'Hello', status: 'draft' });
  await backup.flush();
  assert.equal(git(fx.remote, 'show', '--name-only', '--format=', 'main'), 'content/posts/hello.json');
  const status = git(fx.site, 'status', '--porcelain');
  assert.match(status, /M config\/main\.js/);
  assert.match(status, /\?\? src\/programs\//);
});

test('backup never commits a page, VP-written or hand-written', async () => {
  fx = makeGitSite();
  const backup = backupFor(fakeClock());
  write(fx.site, 'content/posts/hello.json', draft('hello', 'Hello'));
  write(fx.site, 'src/posts/hello.html', '---\nvp_id: "doc_hello"\n---\n<p>Hi</p>\n');
  write(fx.site, 'src/posts/mine.html', '---\ntitle: "Mine"\n---\n<p>Hand-written</p>\n');
  backup.noteSaved({ title: 'Hello', status: 'published' });
  await backup.flush();
  const pushed = git(fx.remote, 'show', '--name-only', '--format=', 'main').split('\n').sort();
  assert.deepEqual(pushed, ['content/posts/hello.json']);
  const untracked = git(fx.site, 'status', '--porcelain', '-uall');
  assert.match(untracked, /\?\? src\/posts\/mine\.html/);
  assert.match(untracked, /\?\? src\/posts\/hello\.html/);
});

test('draft backup without a remote keeps working', async () => {
  fx = makeGitSite({ remote: false });
  const clock = fakeClock();
  const backup = backupFor(clock);
  write(fx.site, 'content/posts/hello.json', draft('hello', 'Hello'));
  backup.noteSaved({ title: 'Hello', status: 'draft' });
  await clock.advance(30_000);
  assert.equal(backup.state().connected, false);
  assert.equal(backup.state().error, null);
  const res = await backup.flush();
  assert.equal(res.connected, false);
  backup.noteSaved({ title: 'Hello', status: 'draft' });
  assert.equal(backup.state().pending, 2);
});

test('draft backup records other git errors and retries on the next flush', async () => {
  fx = makeGitSite();
  const clock = fakeClock();
  let fail = true;
  const flaky = {
    ...realGit,
    push: async (dir) => {
      if (fail) throw new realGit.GitError('git push failed: network down', 'network down');
      return realGit.push(dir);
    },
  };
  const backup = backupFor(clock, { git: flaky });
  write(fx.site, 'content/posts/hello.json', draft('hello', 'Hello'));
  backup.noteSaved({ title: 'Hello', status: 'draft' });
  const failed = await backup.flush();
  assert.match(failed.error, /network down/);
  assert.equal(failed.pending, 1);
  assert.equal(lastRemote(), 'init');
  fail = false;
  const ok = await backup.flush(); // nothing new to commit: pushes the earlier commit
  assert.equal(ok.error, null);
  assert.equal(ok.pending, 0);
  assert.equal(lastRemote(), 'Draft: Hello [CI Skip]');
});

test('dispose cancels the pending timer', () => {
  fx = makeGitSite();
  const clock = fakeClock();
  const backup = backupFor(clock);
  backup.noteSaved({ title: 'Hello', status: 'draft' });
  assert.equal(clock.pending(), 1);
  backup.dispose();
  assert.equal(clock.pending(), 0);
});

test('a mixed batch with a published edit is an Edit, still with the skip marker', async () => {
  fx = makeGitSite();
  const backup = backupFor(fakeClock());
  write(fx.site, 'content/posts/other.json', draft('other', 'Other'));
  backup.noteSaved({ title: 'Other', status: 'draft' });
  write(fx.site, 'content/posts/hello.json', draft('hello', 'Hello'));
  write(fx.site, 'src/posts/hello.html', '---\nvp_id: "doc_hello"\n---\n<p>Hi</p>\n');
  backup.noteSaved({ title: 'Hello', status: 'published' });
  await backup.flush();
  assert.equal(lastRemote(), 'Edit: Other, Hello [CI Skip]');
  assert.deepEqual(git(fx.remote, 'show', '--name-only', '--format=', 'main').split('\n').sort(),
    ['content/posts/hello.json', 'content/posts/other.json']);
});

const localCount = () => Number(git(fx.site, 'rev-list', '--count', 'HEAD'));

for (const kind of ['disconnected', 'failing']) {
  test(`after a ${kind} push, later saves still wait for the pause`, async () => {
    fx = makeGitSite({ remote: kind === 'failing' });
    const clock = fakeClock();
    const failing = { ...realGit, push: async () => { throw new realGit.GitError('git push failed: down', 'down'); } };
    const backup = backupFor(clock, kind === 'failing' ? { git: failing } : {});
    write(fx.site, 'content/posts/a.json', draft('a', 'A'));
    backup.noteSaved({ title: 'A', status: 'draft' });
    await clock.advance(30_000); // first backup: a local commit, push fails
    await clock.advance(200_000); // idle, well past the first save's 120 s window
    const base = localCount();
    for (let i = 0; i < 5; i++) {
      write(fx.site, 'content/posts/a.json', draft('a', 'A') + i);
      backup.noteSaved({ title: 'A', status: 'draft' });
      await clock.advance(1_000);
    }
    await clock.advance(28_000); // 29 s after the last save
    assert.equal(localCount(), base);
    await clock.advance(1_000);
    assert.equal(localCount(), base + 1);
  });
}

test('a save during a slow push stays pending and is backed up next', async () => {
  fx = makeGitSite();
  let entered, release;
  const inPush = new Promise((r) => { entered = r; });
  const gate = new Promise((r) => { release = r; });
  const slow = { ...realGit, push: async (dir) => { entered(); await gate; return realGit.push(dir); } };
  const backup = backupFor(fakeClock(), { git: slow });
  write(fx.site, 'content/posts/a.json', draft('a', 'A'));
  backup.noteSaved({ title: 'A', status: 'draft' });
  const first = backup.flush();
  await inPush;
  write(fx.site, 'content/posts/b.json', draft('b', 'B'));
  backup.noteSaved({ title: 'B', status: 'draft' });
  release();
  await first;
  assert.equal(lastRemote(), 'Draft: A [CI Skip]');
  assert.equal(backup.state().pending, 1);
  const second = await backup.flush();
  assert.equal(second.pending, 0);
  assert.equal(lastRemote(), 'Draft: B [CI Skip]');
});

test('a save during a publish stays pending', async () => {
  fx = makeGitSite();
  const clock = fakeClock();
  const backup = backupFor(clock);
  let release;
  const gate = new Promise((r) => { release = r; });
  const publishing = backup.exclusive(async () => { await gate; return { status: 'pushed' }; });
  await new Promise((r) => setImmediate(r));
  write(fx.site, 'content/posts/b.json', draft('b', 'B'));
  backup.noteSaved({ title: 'B', status: 'draft' });
  release();
  await publishing;
  assert.equal(backup.state().pending, 1);
  await clock.advance(30_000);
  assert.equal(lastRemote(), 'Draft: B [CI Skip]');
  assert.equal(backup.state().pending, 0);
});

test('init: connected comes from git status before any push', async () => {
  fx = makeGitSite();
  const mk = (status) => createBackup({ ws: wsOf(fx.site), git: { gitStatus: async () => status } });
  assert.equal(mk({ isRepo: false }).state().connected, false);
  assert.equal((await mk({ isRepo: false }).init()).connected, false);
  assert.equal((await mk({ isRepo: true, hasRemote: true, hasUpstream: false }).init()).connected, false);
  assert.equal((await mk({ isRepo: true, hasRemote: true, hasUpstream: true }).init()).connected, true);
});

const page = (id, body) => `---\ntitle: "T"\nvp_id: "${id}"\n---\n<p>${body}</p>\n`;
const pageSet = (id, current) => postPages(wsOf(fx.site), id, current, { git: realGit, collectionsConfig: {} });

test('postPages: the current page plus every changed or deleted page of this post in HEAD, never another post', async () => {
  fx = makeGitSite();
  write(fx.site, 'content/posts/a.json', draft('a', 'A'));
  write(fx.site, 'src/posts/a.html', page('doc_a', 'A'));
  write(fx.site, 'src/posts/b.html', page('doc_b', 'B'));
  write(fx.site, 'src/posts/mine.html', '---\ntitle: "Mine"\n---\n<p>Hand-written</p>\n');
  git(fx.site, 'add', '-A');
  git(fx.site, 'commit', '-m', 'published');
  // A renamed (old page removed, new one written); B edited, not updated; the user's page edited.
  rmSync(join(fx.site, 'src/posts/a.html'));
  write(fx.site, 'src/posts/a-2.html', page('doc_a', 'A2'));
  write(fx.site, 'src/posts/b.html', page('doc_b', 'B2'));
  write(fx.site, 'src/posts/mine.html', '<p>Edited by hand</p>\n');
  assert.deepEqual((await pageSet('doc_a', 'src/posts/a-2.html')).sort(), ['src/posts/a-2.html', 'src/posts/a.html']);
  assert.deepEqual(await pageSet('doc_a', null), ['src/posts/a.html']); // unpublish after the rename
  assert.deepEqual(await pageSet('doc_b', 'src/posts/b.html'), ['src/posts/b.html']);
  // A current path that is not this post's page (hand-written, or another post's) is left out.
  assert.deepEqual(await pageSet('doc_x', 'src/posts/mine.html'), []);
  assert.deepEqual(await pageSet('doc_x', 'src/posts/b.html'), []);
});

test('postPages: pages collection pages live directly in src/', async () => {
  fx = makeGitSite();
  mkdirSync(join(fx.site, 'content', 'pages'), { recursive: true });
  write(fx.site, 'src/about.html', page('doc_about', 'About'));
  write(fx.site, 'src/media/x.html', page('doc_about', 'Media'));
  git(fx.site, 'add', '-A');
  git(fx.site, 'commit', '-m', 'about');
  rmSync(join(fx.site, 'src/about.html'));
  rmSync(join(fx.site, 'src/media/x.html'));
  write(fx.site, 'src/index.html', '<h1>Home 2</h1>\n');
  assert.deepEqual(await pageSet('doc_about', null), ['src/about.html']);
});
