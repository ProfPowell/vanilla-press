import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ownedPaths, createBackup, commitTitle } from '../../src/app/site-git.js';
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

test('ownedPaths lists content and collection dirs', () => {
  fx = makeGitSite();
  write(fx.site, 'content/posts/a.json', draft('a', 'A'));
  write(fx.site, 'content/media.json', '[]');
  assert.deepEqual(ownedPaths(wsOf(fx.site), {}).sort(), ['config/vp.json', 'content', 'src/media', 'src/posts']);
  // A configured output dir replaces the default one.
  assert.deepEqual(ownedPaths(wsOf(fx.site), { posts: { path: 'blog' } }).sort(),
    ['config/vp.json', 'content', 'src/blog', 'src/media']);
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

test('draft backup of a published post is an Update without the skip marker', async () => {
  fx = makeGitSite();
  const clock = fakeClock();
  const backup = backupFor(clock);
  write(fx.site, 'content/posts/hello.json', draft('hello', 'Hello'));
  write(fx.site, 'src/posts/hello.html', '---\nvp_id: "doc_hello"\n---\n<p>Hi</p>\n');
  backup.noteSaved({ title: 'Hello', status: 'published' });
  await backup.flush();
  assert.equal(lastRemote(), 'Update: Hello');
  // A draft-only edit afterwards is a Draft again.
  write(fx.site, 'content/posts/other.json', draft('other', 'Other'));
  backup.noteSaved({ title: 'Other', status: 'draft' });
  await backup.flush();
  assert.equal(lastRemote(), 'Draft: Other [CI Skip]');
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
