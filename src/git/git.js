/**
 * Git operations for Vanilla Press. This is the only module that runs git.
 * Every call goes through runGit, which never lets git prompt for credentials.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 60_000;

/** Thrown when a rebase onto the remote conflicts. The rebase is aborted first. */
export class GitConflictError extends Error {
  constructor(files) {
    super(`Merge conflict in: ${files.join(', ')}`);
    this.name = 'GitConflictError';
    this.files = files;
  }
}

/**
 * Thrown when the remote changed files the user is editing outside Vanilla Press.
 * Normally raised before anything is touched (the repo is left exactly as it was).
 * With `stashed: true` (last-resort safety net) the user's changes are in `git stash`.
 */
export class GitStashConflictError extends Error {
  constructor(files, { stashed = false } = {}) {
    super(stashed
      ? `Re-applying your uncommitted changes conflicted in: ${files.join(', ')}. ` +
        'They are kept in `git stash` (git stash pop to get them back). Nothing was pushed.'
      : `GitHub has changes to files you're editing outside Vanilla Press: ${files.join(', ')}. ` +
        'Commit or discard your changes to those files, then publish again.');
    this.name = 'GitStashConflictError';
    this.files = files;
  }
}

/** Thrown when the repo has no remote or no upstream branch. */
export class GitNotConnectedError extends Error {
  constructor(message = 'This site is not connected to a remote repository') {
    super(message);
    this.name = 'GitNotConnectedError';
  }
}

/** Any other git failure; stderr holds git's own message. */
export class GitError extends Error {
  constructor(message, stderr = '') {
    super(message);
    this.name = 'GitError';
    this.stderr = stderr;
  }
}

/**
 * Run git in a directory.
 * @param {string} dir
 * @param {string[]} args
 * @returns {Promise<string>} trimmed stdout
 */
async function runGit(dir, args, { raw = false } = {}) {
  const timeout = Number(process.env.VP_GIT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd: dir,
      // No prompt may ever reach a terminal: HTTPS (TERMINAL_PROMPT), askpass helpers, ssh.
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_ASKPASS: '',
        GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND || 'ssh -o BatchMode=yes',
      },
      maxBuffer: 16 * 1024 * 1024,
      timeout,
    });
    return raw ? stdout : stdout.trim();
  } catch (err) {
    if (err.killed) {
      throw new GitError(`git ${args[0]} timed out after ${Math.round(timeout / 1000)}s`, String(err.stderr ?? ''));
    }
    const stderr = String(err.stderr ?? err.message ?? '').trim();
    throw new GitError(`git ${args[0]} failed: ${stderr}`, stderr);
  }
}

/** Like runGit but returns null instead of throwing. */
async function tryGit(dir, args) {
  try {
    return await runGit(dir, args);
  } catch {
    return null;
  }
}

/**
 * @param {string} dir
 * @returns {Promise<{isRepo: boolean, branch: string|null, hasRemote: boolean, hasUpstream: boolean}>}
 */
export async function gitStatus(dir) {
  const inside = await tryGit(dir, ['rev-parse', '--is-inside-work-tree']);
  if (inside !== 'true') return { isRepo: false, branch: null, hasRemote: false, hasUpstream: false };
  const branch = (await tryGit(dir, ['symbolic-ref', '--short', 'HEAD'])) || null;
  const remotes = await tryGit(dir, ['remote']);
  const upstream = await tryGit(dir, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  return { isRepo: true, branch, hasRemote: Boolean(remotes), hasUpstream: Boolean(upstream) };
}

/**
 * Stage and commit only the given paths. Paths that neither exist nor are tracked are skipped.
 * @param {string} dir
 * @param {string[]} paths
 * @param {string} message
 * @returns {Promise<string|null>} the new commit sha, or null when nothing changed
 */
export async function commitPaths(dir, paths, message) {
  const usable = [];
  for (const p of paths) {
    if (existsSync(join(dir, p)) || (await runGit(dir, ['ls-files', '--', p]))) usable.push(p);
  }
  if (usable.length === 0) return null;
  await runGit(dir, ['add', '-A', '--', ...usable]);
  const staged = await runGit(dir, ['diff', '--cached', '--name-only', '-z', '--', ...usable]);
  const files = staged.split('\0').filter(Boolean);
  if (files.length === 0) return null;
  // Name the files so anything the user already staged elsewhere stays out of this commit.
  await runGit(dir, ['commit', '-m', message, '--', ...files]);
  return runGit(dir, ['rev-parse', 'HEAD']);
}

/** Tracked files with uncommitted changes (staged or not); untracked files are ignored. */
async function dirtyTrackedFiles(dir) {
  const parts = (await runGit(dir, ['status', '--porcelain', '-z', '--untracked-files=no'], { raw: true })).split('\0');
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (entry.length < 4) continue;
    files.push(entry.slice(3));
    if (entry[0] === 'R' || entry[0] === 'C') files.push(parts[++i]);
  }
  return files;
}

const REJECTED = /rejected|non-fast-forward|fetch first/i;

/**
 * Push to the upstream, rebasing once if the remote moved.
 * @param {string} dir
 * @returns {Promise<{pushed: boolean, rebased: boolean}>}
 */
export async function push(dir) {
  const status = await gitStatus(dir);
  if (!status.hasRemote) throw new GitNotConnectedError();
  if (!status.hasUpstream) throw new GitNotConnectedError('The current branch has no upstream');
  try {
    await runGit(dir, ['push']);
    return { pushed: true, rebased: false };
  } catch (err) {
    if (!(err instanceof GitError) || !REJECTED.test(err.stderr)) throw err;
  }
  const unmerged = async () => ((await tryGit(dir, ['diff', '--name-only', '--diff-filter=U'])) || '')
    .split('\n').filter(Boolean);
  const rebaseInProgress = async () => {
    for (const name of ['rebase-merge', 'rebase-apply']) {
      const path = await runGit(dir, ['rev-parse', '--git-path', name]);
      if (existsSync(join(dir, path))) return true;
    }
    return false;
  };

  // Refuse up front if the remote changed a file the user has uncommitted edits to,
  // so the autostash re-apply can never conflict and nothing is modified.
  await runGit(dir, ['fetch']);
  const incoming = new Set(
    (await runGit(dir, ['diff', '--name-only', '-z', 'HEAD...@{u}'])).split('\0').filter(Boolean),
  );
  const clash = (await dirtyTrackedFiles(dir)).filter((f) => incoming.has(f));
  if (clash.length > 0) throw new GitStashConflictError([...new Set(clash)].sort());

  try {
    await runGit(dir, ['pull', '--rebase', '--autostash']);
  } catch (err) {
    const files = await unmerged();
    if (await rebaseInProgress()) {
      await runGit(dir, ['rebase', '--abort']);
      if (files.length > 0) throw new GitConflictError(files);
      throw err;
    }
    if (files.length > 0) {
      await tryGit(dir, ['reset', '--merge']);
      throw new GitStashConflictError(files, { stashed: true });
    }
    throw err;
  }
  // Safety net: git can exit 0 even when the autostash re-apply left conflict markers.
  const leftover = await unmerged();
  if (leftover.length > 0) {
    await tryGit(dir, ['reset', '--merge']);
    throw new GitStashConflictError(leftover, { stashed: true });
  }
  await runGit(dir, ['push']);
  return { pushed: true, rebased: true };
}

/**
 * @param {string} url
 * @param {string} dest
 * @returns {Promise<void>}
 */
export async function cloneRepo(url, dest) {
  await runGit(process.cwd(), ['clone', url, dest]);
}
