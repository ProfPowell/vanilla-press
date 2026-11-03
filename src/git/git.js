/**
 * Git operations for Vanilla Press. This is the only module that runs git.
 * Every call goes through runGit, which never lets git prompt for credentials.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Thrown when a rebase onto the remote conflicts. The rebase is aborted first. */
export class GitConflictError extends Error {
  constructor(files) {
    super(`Merge conflict in: ${files.join(', ')}`);
    this.name = 'GitConflictError';
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
async function runGit(dir, args) {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd: dir,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout.trim();
  } catch (err) {
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
  try {
    await runGit(dir, ['pull', '--rebase', '--autostash']);
  } catch (err) {
    const files = ((await tryGit(dir, ['diff', '--name-only', '--diff-filter=U'])) || '')
      .split('\n').filter(Boolean);
    await tryGit(dir, ['rebase', '--abort']);
    if (files.length > 0) throw new GitConflictError(files);
    throw err;
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
