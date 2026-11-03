import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  gitStatus, commitPaths, push, cloneRepo,
  GitConflictError, GitNotConnectedError, GitError,
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
