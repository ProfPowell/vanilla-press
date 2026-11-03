import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  gitStatus, commitPaths, push, cloneRepo,
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
