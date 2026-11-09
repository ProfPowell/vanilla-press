import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  gitStatus, aheadBehind, lastVpCommitAt, commitPaths, push, cloneRepo, pullFastForward, changedFiles, changedSinceHead, readHead, hasHead, headCommit, headTree, readBlob, readBlobs,
  GitConflictError, GitNotConnectedError, GitError, GitStashConflictError,
} from '../../src/git/git.js';

let root, remote, a, b;

const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();

function identify(dir) {
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'user.email', 'test@example.com');
}

function write(dir, rel, text) {
  mkdirSync(join(dir, rel, '..'), { recursive: true });
  writeFileSync(join(dir, rel), text);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'vp-git-'));
  remote = join(root, 'remote.git');
  a = join(root, 'a');
  b = join(root, 'b');
  execFileSync('git', ['init', '--bare', '-b', 'main', remote]);
  execFileSync('git', ['init', '-b', 'main', a]);
  identify(a);
  git(a, 'remote', 'add', 'origin', remote);
  write(a, 'README.md', 'hello\n');
  git(a, 'add', '-A');
  git(a, 'commit', '-m', 'init');
  git(a, 'push', '-u', 'origin', 'main');
  execFileSync('git', ['clone', '-b', 'main', remote, b], { stdio: 'ignore' });
  identify(b);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

test('gitStatus reports branch and upstream', async () => {
  assert.deepEqual(await gitStatus(a), { isRepo: true, branch: 'main', hasRemote: true, hasUpstream: true });
  const plain = join(root, 'plain');
  mkdirSync(plain);
  execFileSync('git', ['init', '-b', 'main', plain], { stdio: 'ignore' });
  const s = await gitStatus(plain);
  assert.equal(s.isRepo, true);
  assert.equal(s.hasRemote, false);
  assert.equal(s.hasUpstream, false);
  const none = join(root, 'none');
  mkdirSync(none);
  assert.equal((await gitStatus(none)).isRepo, false);
});

test('commitPaths commits only the given paths', async () => {
  write(a, 'content/x.json', '{}');
  write(a, 'src/programs/p/index.html', '<p>x</p>');
  const sha = await commitPaths(a, ['content'], 'Draft: X [CI Skip]');
  assert.equal(sha, git(a, 'rev-parse', 'HEAD'));
  assert.equal(git(a, 'show', '--name-only', '--format=', 'HEAD'), 'content/x.json');
  assert.match(git(a, 'status', '--porcelain'), /\?\? src\//);
});

test('commitPaths ignores files outside the given paths', async () => {
  write(a, 'config/main.js', 'export default {}');
  git(a, 'add', 'config/main.js');
  git(a, 'commit', '-m', 'cfg');
  write(a, 'config/main.js', 'export default { changed: 1 }');
  write(a, 'content/x.json', '{}');
  await commitPaths(a, ['content'], 'Draft: X');
  assert.equal(git(a, 'show', '--name-only', '--format=', 'HEAD'), 'content/x.json');
  assert.match(git(a, 'status', '--porcelain'), /M config\/main\.js/);
});

test('commitPaths skips paths that neither exist nor are tracked', async () => {
  write(a, 'content/x.json', '{}');
  const sha = await commitPaths(a, ['content', 'src/media', 'config/vp.json'], 'Draft: X');
  assert.ok(sha);
});

test('commitPaths stages deletions', async () => {
  write(a, 'content/x.json', '{}');
  await commitPaths(a, ['content'], 'add');
  rmSync(join(a, 'content/x.json'));
  const sha = await commitPaths(a, ['content'], 'del');
  assert.ok(sha);
  assert.equal(git(a, 'show', '--name-status', '--format=', 'HEAD'), 'D\tcontent/x.json');
});

test('commitPaths stages deletion of a tracked path that no longer exists', async () => {
  write(a, 'content/x.json', '{}');
  await commitPaths(a, ['content/x.json'], 'add');
  rmSync(join(a, 'content'), { recursive: true });
  const sha = await commitPaths(a, ['content/x.json'], 'del');
  assert.ok(sha);
});

test('commitPaths takes a message function given the staged files', async () => {
  write(a, 'content/x.json', '{}');
  write(a, 'src/posts/x.html', '<p>x</p>');
  write(a, 'other.txt', 'mine');
  git(a, 'add', 'other.txt'); // the user's own staged file stays out
  let seen;
  await commitPaths(a, ['content', 'src/posts'], (files) => { seen = files; return `n=${files.length}`; });
  assert.deepEqual(seen.sort(), ['content/x.json', 'src/posts/x.html']);
  assert.equal(git(a, 'log', '-1', '--format=%s'), 'n=2');
  assert.match(git(a, 'status', '--porcelain'), /^A {2}other\.txt$/m);
});

test('commitPaths commits a rename as delete plus add, leaving the index clean', async () => {
  write(a, 'content/posts/old.json', '{"slug":"old"}\n');
  await commitPaths(a, ['content'], 'add');
  rmSync(join(a, 'content/posts/old.json'));
  write(a, 'content/posts/new.json', '{"slug":"old"}\n'); // same content: git would call it a rename
  await commitPaths(a, ['content'], 'rename');
  assert.deepEqual(git(a, 'ls-tree', '-r', '--name-only', 'HEAD').split('\n').sort(), ['README.md', 'content/posts/new.json']);
  assert.equal(git(a, 'diff', '--cached', '--name-only'), '');
});

test('commitPaths treats paths literally: * and [ stage only that file', async () => {
  write(a, 'src/posts/a*.html', 'star');
  write(a, 'src/posts/ab.html', 'mine');
  write(a, 'src/posts/[x].html', 'bracket');
  write(a, 'src/posts/x.html', 'mine too');
  await commitPaths(a, ['src/posts/a*.html', 'src/posts/[x].html'], 'odd slugs');
  assert.deepEqual(git(a, 'show', '--name-only', '--format=', 'HEAD').split('\n').sort(),
    ['src/posts/[x].html', 'src/posts/a*.html']);
  assert.equal(git(a, 'ls-files', '--others', '--exclude-standard'), 'src/posts/ab.html\nsrc/posts/x.html');
});

test('commitPaths returns null when nothing changed', async () => {
  write(a, 'content/x.json', '{}');
  await commitPaths(a, ['content'], 'add');
  assert.equal(await commitPaths(a, ['content'], 'again'), null);
});

test('push pushes to the upstream', async () => {
  write(a, 'content/x.json', '{}');
  await commitPaths(a, ['content'], 'Draft: X');
  assert.deepEqual(await push(a), { pushed: true, rebased: false });
  assert.match(git(remote, 'log', '--format=%s'), /Draft: X/);
});

test('push rebases when the remote moved', async () => {
  write(b, 'README.md', 'changed\n');
  git(b, 'commit', '-am', 'readme');
  git(b, 'push');
  write(a, 'content/x.json', '{}');
  await commitPaths(a, ['content'], 'Draft: X');
  assert.deepEqual(await push(a), { pushed: true, rebased: true });
  const log = git(remote, 'log', '--format=%s');
  assert.match(log, /Draft: X/);
  assert.match(log, /readme/);
});

test('push aborts a conflicting rebase', async () => {
  write(b, 'content/x.json', '{"v":"b"}');
  git(b, 'add', '-A');
  git(b, 'commit', '-m', 'b');
  git(b, 'push');
  write(a, 'content/x.json', '{"v":"a"}');
  await commitPaths(a, ['content'], 'Draft: A');
  const before = git(a, 'rev-parse', 'HEAD');
  await assert.rejects(push(a), (err) => {
    assert.ok(err instanceof GitConflictError);
    assert.deepEqual(err.files, ['content/x.json']);
    assert.match(err.message, /Open the site folder in a terminal or Git app, resolve the conflict in content\/x\.json, then publish again\./);
    return true;
  });
  assert.equal(git(a, 'rev-parse', 'HEAD'), before);
  assert.equal(git(a, 'status', '--porcelain'), '');
  assert.equal(existsSync(join(a, '.git', 'rebase-merge')), false);
  assert.equal(existsSync(join(a, '.git', 'rebase-apply')), false);
});

test('push without upstream throws GitNotConnectedError', async () => {
  const plain = join(root, 'plain');
  mkdirSync(plain);
  execFileSync('git', ['init', '-b', 'main', plain], { stdio: 'ignore' });
  identify(plain);
  await assert.rejects(push(plain), GitNotConnectedError);
  git(a, 'branch', '--unset-upstream');
  await assert.rejects(push(a), GitNotConnectedError);
});

test('git never prompts', async () => {
  const started = Date.now();
  await assert.rejects(cloneRepo('https://127.0.0.1:9/none.git', join(root, 'c')), GitError);
  // A "URL" that looks like an option is a repository name to git, never an option.
  await assert.rejects(cloneRepo('--bogus-option', join(root, 'd')), (err) => {
    assert.ok(err instanceof GitError);
    assert.doesNotMatch(err.stderr, /unknown option/);
    assert.match(err.stderr, /does not exist|not found|bogus-option/);
    return true;
  });
  assert.ok(Date.now() - started < 10000);
});

function addHook(body) {
  const hook = join(remote, 'hooks', 'pre-receive');
  writeFileSync(hook, `#!/bin/sh\n${body}\n`);
  chmodSync(hook, 0o755);
}

test('git calls time out with a GitError', async () => {
  addHook('exec sleep 5');
  write(a, 'content/x.json', '{}');
  await commitPaths(a, ['content'], 'Draft: X');
  process.env.VP_GIT_TIMEOUT_MS = '300';
  try {
    const started = Date.now();
    await assert.rejects(push(a), (err) => err instanceof GitError && /timed out/.test(err.message));
    assert.ok(Date.now() - started < 4000);
  } finally {
    delete process.env.VP_GIT_TIMEOUT_MS;
  }
});

test('git children get non-interactive ssh and askpass settings', async () => {
  const out = join(root, 'env.txt');
  addHook(`printf '%s|%s|%s' "$GIT_SSH_COMMAND" "\${GIT_ASKPASS-unset}" "$GIT_TERMINAL_PROMPT" > '${out}'`);
  write(a, 'content/x.json', '{}');
  await commitPaths(a, ['content'], 'Draft: X');
  const saved = process.env.GIT_SSH_COMMAND;
  delete process.env.GIT_SSH_COMMAND;
  try {
    await push(a);
  } finally {
    if (saved !== undefined) process.env.GIT_SSH_COMMAND = saved;
  }
  assert.equal(readFileSync(out, 'utf8'), 'ssh -o BatchMode=yes||0');
});

test('push keeps a non-conflicting uncommitted change outside VP paths', async () => {
  write(b, 'other.txt', 'remote\n');
  git(b, 'add', '-A');
  git(b, 'commit', '-m', 'other');
  git(b, 'push');
  write(a, 'README.md', 'my local edit\n');
  write(a, 'content/x.json', '{}');
  await commitPaths(a, ['content'], 'Draft: X');
  assert.deepEqual(await push(a), { pushed: true, rebased: true });
  assert.equal(git(a, 'status', '--porcelain'), 'M README.md');
  assert.equal(git(a, 'stash', 'list'), '');
});

test('push refuses, changing nothing, when the remote touches a file the user is editing', async () => {
  write(b, 'README.md', 'remote edit\n');
  git(b, 'commit', '-am', 'readme');
  git(b, 'push');
  write(a, 'README.md', 'my local edit\n');
  write(a, 'content/x.json', '{}');
  await commitPaths(a, ['content'], 'Draft: X');
  const remoteBefore = git(remote, 'rev-parse', 'main');
  const headBefore = git(a, 'rev-parse', 'HEAD');
  const statusBefore = git(a, 'status', '--porcelain');
  await assert.rejects(push(a), (err) => {
    assert.ok(err instanceof GitStashConflictError);
    assert.ok(!(err instanceof GitConflictError));
    assert.deepEqual(err.files, ['README.md']);
    assert.match(err.message, /Commit or discard/);
    return true;
  });
  assert.equal(git(remote, 'rev-parse', 'main'), remoteBefore);
  assert.equal(git(a, 'rev-parse', 'HEAD'), headBefore);
  assert.equal(git(a, 'status', '--porcelain'), statusBefore);
  assert.equal(readFileSync(join(a, 'README.md'), 'utf8'), 'my local edit\n');
  assert.equal(git(a, 'stash', 'list'), '');
});

test('push refuses when the remote renamed a file the user is editing', async () => {
  git(b, 'mv', 'README.md', 'READ.md');
  git(b, 'commit', '-m', 'rename readme');
  git(b, 'push');
  write(a, 'README.md', 'my local edit\n');
  write(a, 'content/x.json', '{}');
  await commitPaths(a, ['content'], 'Draft: X');
  await assert.rejects(push(a), (err) => {
    assert.ok(err instanceof GitStashConflictError);
    assert.deepEqual(err.files, ['README.md']);
    assert.match(err.message, /Commit or discard/);
    return true;
  });
  assert.equal(readFileSync(join(a, 'README.md'), 'utf8'), 'my local edit\n');
  assert.equal(git(a, 'stash', 'list'), '');
});

test('changedFiles lists changed and untracked files under the given paths only', async () => {
  write(a, 'content/x.json', '{}');
  write(a, 'other.txt', 'x');
  write(a, 'README.md', 'edited\n');
  assert.deepEqual(await changedFiles(a, ['content', 'src/posts/a.html']), ['content/x.json']);
  assert.deepEqual(await changedFiles(a, ['src/posts/a.html']), []);
});

test('pullFastForward fast-forwards; it refuses to merge diverged history', async () => {
  write(b, 'content/b.json', '{}');
  git(b, 'add', '-A');
  git(b, 'commit', '-m', 'b');
  git(b, 'push');
  await pullFastForward(a);
  assert.equal(git(a, 'rev-parse', 'HEAD'), git(remote, 'rev-parse', 'main'));
  write(b, 'content/b2.json', '{}');
  git(b, 'add', '-A');
  git(b, 'commit', '-m', 'b2');
  git(b, 'push');
  write(a, 'content/a.json', '{}');
  git(a, 'add', '-A');
  git(a, 'commit', '-m', 'a');
  const before = git(a, 'rev-parse', 'HEAD');
  await assert.rejects(pullFastForward(a), GitError);
  assert.equal(git(a, 'rev-parse', 'HEAD'), before);
});

test('pullFastForward with yieldUntracked: the upstream copy wins; put back when the pull fails', async () => {
  write(b, 'config/theme.json', '{"name":"swiss"}\n');
  git(b, 'add', '-A');
  git(b, 'commit', '-m', 'theme');
  git(b, 'push');
  write(a, 'config/theme.json', '{"name":"mine"}\n'); // untracked in a
  write(a, 'config/other.json', 'keep\n'); // untracked, not incoming
  await assert.rejects(pullFastForward(a), /untracked working tree files would be overwritten/);
  assert.deepEqual(await pullFastForward(a, { yieldUntracked: ['config/theme.json'] }), { yielded: ['config/theme.json'] });
  assert.equal(readFileSync(join(a, 'config/theme.json'), 'utf8'), '{"name":"swiss"}\n');
  assert.equal(readFileSync(join(a, 'config/other.json'), 'utf8'), 'keep\n');
  // Diverged: the pull fails and the local file is put back.
  write(b, 'src/assets/themes/x.css', 'b\n');
  git(b, 'add', '-A');
  git(b, 'commit', '-m', 'x');
  git(b, 'push');
  write(a, 'README.md', 'a\n');
  git(a, 'commit', '-am', 'a');
  write(a, 'src/assets/themes/x.css', 'mine\n');
  await assert.rejects(pullFastForward(a, { yieldUntracked: ['src/assets/themes'] }), GitError);
  assert.equal(readFileSync(join(a, 'src/assets/themes/x.css'), 'utf8'), 'mine\n');
});

test('push resolveConflicts: settles theme conflicts; anything else is still a GitConflictError', async () => {
  for (const [dir, text] of [[b, 'from b\n'], [a, 'from a\n']]) {
    write(dir, 'config/theme.json', text);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-m', 'theme');
  }
  git(b, 'push');
  const calls = [];
  const res = await push(a, {
    resolveConflicts: async ({ files, readStage }) => {
      calls.push(files);
      writeFileSync(join(a, 'config/theme.json'), await readStage(2, 'config/theme.json'));
      return true;
    },
  });
  assert.deepEqual(calls, [['config/theme.json']]);
  assert.deepEqual(res.resolved, ['config/theme.json']);
  assert.equal(git(a, 'rev-parse', 'HEAD'), git(remote, 'rev-parse', 'main')); // the emptied commit was skipped
  assert.equal(readFileSync(join(a, 'config/theme.json'), 'utf8'), 'from b\n');
  for (const [dir, text] of [[b, 'b\n'], [a, 'a\n']]) {
    write(dir, 'README.md', text);
    git(dir, 'commit', '-am', 'readme');
  }
  git(b, 'push');
  const before = git(a, 'rev-parse', 'HEAD');
  await assert.rejects(push(a, { resolveConflicts: async () => false }), GitConflictError);
  assert.equal(git(a, 'rev-parse', 'HEAD'), before);
});

test('push: a resolver that throws leaves no rebase in progress, puts set-aside files back and surfaces the error', async () => {
  write(b, 'config/theme.json', 'from b\n');
  write(b, 'src/assets/themes/y.css', 'b\n');
  git(b, 'add', '-A');
  git(b, 'commit', '-m', 'theme b');
  git(b, 'push');
  write(a, 'config/theme.json', 'from a\n');
  git(a, 'add', '-A');
  git(a, 'commit', '-m', 'theme a');
  write(a, 'src/assets/themes/y.css', 'mine\n'); // untracked, set aside for the rebase
  const before = git(a, 'rev-parse', 'HEAD');
  await assert.rejects(push(a, {
    yieldUntracked: ['src/assets/themes'],
    resolveConflicts: async () => { throw new Error('resolver broke'); },
  }), /resolver broke/);
  assert.equal(existsSync(join(a, '.git', 'rebase-merge')) || existsSync(join(a, '.git', 'rebase-apply')), false);
  assert.equal(git(a, 'rev-parse', 'HEAD'), before);
  assert.equal(readFileSync(join(a, 'src/assets/themes/y.css'), 'utf8'), 'mine\n');
  assert.equal(readFileSync(join(a, 'config/theme.json'), 'utf8'), 'from a\n');
});

test('changedSinceHead lists tracked files modified or deleted since HEAD, under the paths', async () => {
  write(a, 'src/posts/a.html', 'a\n');
  write(a, 'src/posts/b.html', 'b\n');
  write(a, 'src/posts/c.html', 'c\n');
  write(a, 'src/other/d.html', 'd\n');
  git(a, 'add', '-A');
  git(a, 'commit', '-m', 'pages');
  write(a, 'src/posts/a.html', 'a2\n'); // modified
  rmSync(join(a, 'src/posts/b.html')); // deleted
  write(a, 'src/posts/c.html', 'c2\n');
  git(a, 'add', 'src/posts/c.html'); // staged counts too: compared with HEAD
  write(a, 'src/posts/new.html', 'n\n'); // untracked: not listed
  write(a, 'src/other/d.html', 'd2\n'); // outside the paths
  assert.deepEqual((await changedSinceHead(a, ['src/posts'])).sort(), ['src/posts/a.html', 'src/posts/b.html', 'src/posts/c.html']);
  assert.deepEqual(await changedSinceHead(a, []), []);
});

test('readHead returns a file as committed in HEAD, or null', async () => {
  write(a, 'src/posts/a.html', 'old text\n');
  git(a, 'add', '-A');
  git(a, 'commit', '-m', 'page');
  rmSync(join(a, 'src/posts/a.html'));
  assert.equal(await readHead(a, 'src/posts/a.html'), 'old text\n');
  assert.equal(await readHead(a, 'src/posts/missing.html'), null);
});

test('hasHead is false before the first commit, true after', async () => {
  const fresh = join(root, 'fresh');
  execFileSync('git', ['init', '-b', 'main', fresh], { stdio: 'ignore' });
  assert.equal(await hasHead(fresh), false);
  assert.equal(await hasHead(a), true);
});

test('headCommit, headTree and readBlob read the committed tree', async () => {
  const fresh = join(root, 'fresh-tree');
  execFileSync('git', ['init', '-b', 'main', fresh], { stdio: 'ignore' });
  assert.equal(await headCommit(fresh), null);
  write(a, 'src/tree/p q.html', '<img src="/media/x.jpg">\n');
  git(a, 'add', '-A');
  git(a, 'commit', '-m', 'tree');
  assert.equal(await headCommit(a), git(a, 'rev-parse', 'HEAD'));
  write(a, 'src/tree/uncommitted.html', 'u\n');
  const entries = await headTree(a, 'src/tree');
  assert.deepEqual(entries.map((e) => e.path), ['src/tree/p q.html']);
  assert.equal(await readBlob(a, entries[0].oid), '<img src="/media/x.jpg">\n');
});

test('headCommit: no repo is null; a damaged repo or an unreadable directory throws', async () => {
  const plain = join(root, 'plain');
  mkdirSync(plain);
  assert.equal(await headCommit(plain), null);
  const broken = join(root, 'broken');
  execFileSync('git', ['init', '-b', 'main', broken], { stdio: 'ignore' });
  writeFileSync(join(broken, '.git', 'HEAD'), 'not a ref\n');
  await assert.rejects(headCommit(broken), GitError);
  await assert.rejects(headCommit(join(root, 'does-not-exist')), Error);
  // A branch ref holding garbage is damage, not "no commits yet"
  const garbage = join(root, 'garbage-ref');
  execFileSync('git', ['init', '-b', 'main', garbage], { stdio: 'ignore' });
  mkdirSync(join(garbage, '.git', 'refs', 'heads'), { recursive: true });
  writeFileSync(join(garbage, '.git', 'refs', 'heads', 'main'), 'garbage\n');
  await assert.rejects(headCommit(garbage), GitError);
});

test('readBlobs reads many blobs with one call, leaves out unknown ids, and has no 16 MB limit', async () => {
  write(a, 'src/p/one.html', 'one \u00e9\n');
  write(a, 'src/p/two.html', 'two\n');
  write(a, 'src/p/big.html', 'x'.repeat(17 * 1024 * 1024));
  git(a, 'add', '-A');
  git(a, 'commit', '-m', 'blobs');
  const entries = await headTree(a, 'src/p');
  const oid = (name) => entries.find((e) => e.path.endsWith(name)).oid;
  const got = await readBlobs(a, [oid('one.html'), '1'.repeat(40), oid('big.html'), oid('two.html')]);
  assert.equal(got.get(oid('one.html')), 'one \u00e9\n');
  assert.equal(got.get(oid('two.html')), 'two\n');
  assert.equal(got.get(oid('big.html')).length, 17 * 1024 * 1024);
  assert.equal(got.has('1'.repeat(40)), false);
  assert.equal((await readBlobs(a, [])).size, 0);
});

test('aheadBehind counts local and upstream-only commits, null without an upstream', async () => {
  assert.deepEqual(await aheadBehind(a), { ahead: 0, behind: 0 });
  write(a, 'one.txt', '1');
  git(a, 'add', '-A');
  git(a, 'commit', '-m', 'local');
  assert.deepEqual(await aheadBehind(a), { ahead: 1, behind: 0 });
  const plain = join(root, 'plain');
  mkdirSync(plain);
  execFileSync('git', ['init', '-b', 'main', plain], { stdio: 'ignore' });
  assert.equal(await aheadBehind(plain), null);
});

test('lastVpCommitAt is the newest pushed Vanilla Press commit, null before any or without upstream', async () => {
  assert.equal(await lastVpCommitAt(a), null);
  write(a, 'd.txt', 'd');
  git(a, 'add', '-A');
  git(a, 'commit', '-m', 'Draft: x [CI Skip]');
  git(a, 'push');
  const pushed = git(a, 'log', '-1', '--format=%cI');
  assert.equal(await lastVpCommitAt(a), pushed);
  write(a, 'e.txt', 'e');
  git(a, 'add', '-A');
  git(a, 'commit', '-m', 'Edit: y');
  assert.equal(await lastVpCommitAt(a), pushed);
  const plain = join(root, 'plain');
  mkdirSync(plain);
  execFileSync('git', ['init', '-b', 'main', plain], { stdio: 'ignore' });
  assert.equal(await lastVpCommitAt(plain), null);
});

test('lastVpCommitAt counts a pushed Programs: commit', async () => {
  write(a, 'p.txt', 'p');
  git(a, 'add', '-A');
  git(a, 'commit', '-m', 'Hand edit');
  git(a, 'push');
  assert.equal(await lastVpCommitAt(a), null);
  write(a, 'q.txt', 'q');
  git(a, 'add', '-A');
  git(a, 'commit', '-m', 'Programs: add plasma');
  git(a, 'push');
  assert.equal(await lastVpCommitAt(a), git(a, 'log', '-1', '--format=%cI'));
});
