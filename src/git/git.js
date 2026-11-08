/**
 * Git operations for Vanilla Press. This is the only module that runs git.
 * Every call goes through runGit, which never lets git prompt for credentials.
 */
import { execFile, spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 60_000;

/** Thrown when a rebase onto the remote conflicts. The rebase is aborted first. */
export class GitConflictError extends Error {
  constructor(files) {
    const list = files.join(', ');
    super(`GitHub has changes that conflict with yours in: ${list}. Nothing was pushed. ` +
      `Open the site folder in a terminal or Git app, resolve the conflict in ${list}, then publish again.`);
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
  constructor(message, stderr = '', code = null) {
    super(message);
    this.name = 'GitError';
    this.stderr = stderr;
    this.code = code;
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
        // Paths are file names, never globs: a slug with `*` or `[` stages only that file.
        GIT_LITERAL_PATHSPECS: '1',
        GIT_ASKPASS: '',
        GIT_EDITOR: 'true', // rebase --continue keeps the message, never opens an editor
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
    throw new GitError(`git ${args[0]} failed: ${stderr}`, stderr, typeof err.code === 'number' ? err.code : null);
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
 * Commits the clone has and the upstream lacks (ahead), and the reverse (behind).
 * Does not fetch, so it reflects the last fetch.
 * @param {string} dir
 * @returns {Promise<{ahead: number, behind: number}|null>} null with no upstream
 */
export async function aheadBehind(dir) {
  const out = await tryGit(dir, ['rev-list', '--left-right', '--count', 'HEAD...@{u}']);
  if (!out) return null;
  const [ahead, behind] = out.split(/\s+/).map(Number);
  return Number.isFinite(ahead) && Number.isFinite(behind) ? { ahead, behind } : null;
}

/** Subjects of the commits Vanilla Press makes (see site-git.js and publish). */
const VP_COMMIT_SUBJECT = '^(Draft|Edit|Publish|Update|Unpublish|Components|Theme|Theme library): ';

/**
 * Commit time of the newest Vanilla Press commit on the upstream (the last backup).
 * @param {string} dir
 * @returns {Promise<string|null>} ISO 8601, or null when there is none or no upstream
 */
export async function lastVpCommitAt(dir) {
  const out = await tryGit(dir, ['log', '-1', '--format=%cI', '-E', `--grep=${VP_COMMIT_SUBJECT}`, '@{u}']);
  return out || null;
}

/**
 * Stage and commit only the given paths. Paths that neither exist nor are tracked are skipped.
 * @param {string} dir
 * @param {string[]} paths
 * @param {string | ((files: string[]) => string)} message - or a function of the staged file list
 * @returns {Promise<string|null>} the new commit sha, or null when nothing changed
 */
export async function commitPaths(dir, paths, message) {
  const usable = [];
  for (const p of paths) {
    if (existsSync(join(dir, p)) || (await runGit(dir, ['ls-files', '--', p]))) usable.push(p);
  }
  if (usable.length === 0) return null;
  await runGit(dir, ['add', '-A', '--', ...usable]);
  const staged = await runGit(dir, ['diff', '--cached', '--name-only', '--no-renames', '-z', '--', ...usable]);
  const files = staged.split('\0').filter(Boolean);
  if (files.length === 0) return null;
  // Name the files so anything the user already staged elsewhere stays out of this commit.
  const text = typeof message === 'function' ? message(files) : message;
  await runGit(dir, ['commit', '-m', text, '--', ...files]);
  return runGit(dir, ['rev-parse', 'HEAD']);
}

/** File names in `git status --porcelain -z` output (both names of a rename or copy). */
function porcelainFiles(out) {
  const parts = out.split('\0');
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (entry.length < 4) continue;
    files.push(entry.slice(3));
    if (entry[0] === 'R' || entry[0] === 'C') files.push(parts[++i]);
  }
  return files;
}

/** Tracked files with uncommitted changes (staged or not); untracked files are ignored. */
async function dirtyTrackedFiles(dir) {
  return porcelainFiles(await runGit(dir, ['status', '--porcelain', '-z', '--untracked-files=no'], { raw: true }));
}

const REJECTED = /rejected|non-fast-forward|fetch first/i;

/** Files the upstream changed since the merge base (`HEAD...@{u}`); call after a fetch. */
async function incomingFiles(dir) {
  return new Set(
    (await runGit(dir, ['diff', '--name-only', '--no-renames', '-z', 'HEAD...@{u}'])).split('\0').filter(Boolean),
  );
}

/**
 * Remove untracked (not ignored) files under `paths` that the upstream brings
 * in, so a rebase or fast-forward can check out the upstream's copy (git
 * refuses to overwrite an untracked file). Returns them with their bytes, for
 * `restoreYielded` when the pull fails.
 * @param {string} dir
 * @param {string[]} paths
 * @param {Set<string>} incoming
 * @returns {Promise<Array<{ path: string, bytes: Buffer }>>}
 */
async function yieldUntracked(dir, paths, incoming) {
  if (paths.length === 0 || incoming.size === 0) return [];
  const out = await runGit(dir, ['ls-files', '--others', '--exclude-standard', '-z', '--', ...paths], { raw: true });
  const yielded = [];
  for (const path of out.split('\0').filter(Boolean)) {
    if (!incoming.has(path)) continue;
    const file = join(dir, path);
    yielded.push({ path, bytes: readFileSync(file) });
    rmSync(file, { force: true });
  }
  return yielded;
}

/** Put yielded files back where nothing took their place (the pull failed). */
function restoreYielded(dir, yielded) {
  for (const { path, bytes } of yielded) {
    const file = join(dir, path);
    if (existsSync(file)) continue;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes);
  }
}

/**
 * Push to the upstream, rebasing once if the remote moved.
 * @param {string} dir
 * @param {{ yieldUntracked?: string[], resolveConflicts?: Function }} [options] -
 *   yieldUntracked: untracked files under these paths that the remote brings in are
 *   removed before the rebase: the remote's copy wins (they are put back if the rebase fails);
 *   resolveConflicts({ files, readStage(n, path) }): called when the rebase stops on
 *   conflicts; it writes the resolved files and returns true, or false to give up
 *   (the rebase is aborted and GitConflictError thrown)
 * @returns {Promise<{pushed: boolean, rebased: boolean, yielded?: string[], resolved?: string[]}>}
 *   yielded: the untracked files the remote's copy replaced; resolved: the files
 *   resolveConflicts settled (each only when there were any)
 */
export async function push(dir, { yieldUntracked: yieldPaths = [], resolveConflicts = null } = {}) {
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
  const incoming = await incomingFiles(dir);
  const clash = (await dirtyTrackedFiles(dir)).filter((f) => incoming.has(f));
  if (clash.length > 0) throw new GitStashConflictError([...new Set(clash)].sort());

  const yielded = await yieldUntracked(dir, yieldPaths, incoming);
  const resolved = new Set();
  const readStage = async (n, path) => {
    try {
      return await runGit(dir, ['show', `:${n}:${path}`], { raw: true });
    } catch {
      return null;
    }
  };
  /** Resolve each stop of the rebase; true when it finished. */
  const settle = async () => {
    for (let step = 0; step < 1000 && (await rebaseInProgress()); step++) {
      const files = await unmerged();
      if (files.length === 0 || !(await resolveConflicts({ files, readStage }))) return false;
      await runGit(dir, ['add', '-A', '--', ...files]);
      for (const f of files) resolved.add(f);
      const nothingStaged = (await tryGit(dir, ['diff', '--cached', '--quiet'])) !== null;
      try {
        await runGit(dir, ['rebase', nothingStaged ? '--skip' : '--continue']);
      } catch { /* stopped again: the loop looks at the next conflict */ }
    }
    return !(await rebaseInProgress());
  };
  try {
    await runGit(dir, ['pull', '--rebase', '--autostash']);
  } catch (err) {
    if (resolveConflicts && (await rebaseInProgress()) && (await unmerged()).length > 0 && (await settle())) {
      return finishPush();
    }
    const files = await unmerged();
    let failure = err;
    if (await rebaseInProgress()) {
      await runGit(dir, ['rebase', '--abort']);
      if (files.length > 0) failure = new GitConflictError(files);
    } else if (files.length > 0) {
      await tryGit(dir, ['reset', '--merge']);
      failure = new GitStashConflictError(files, { stashed: true });
    }
    restoreYielded(dir, yielded); // after the abort: HEAD is the local one again
    throw failure;
  }
  return finishPush();

  async function finishPush() {
    // Safety net: git can exit 0 even when the autostash re-apply left conflict markers.
    const leftover = await unmerged();
    if (leftover.length > 0) {
      await tryGit(dir, ['reset', '--merge']);
      throw new GitStashConflictError(leftover, { stashed: true });
    }
    await runGit(dir, ['push']);
    return {
      pushed: true, rebased: true,
      ...(yielded.length ? { yielded: yielded.map((y) => y.path) } : {}),
      ...(resolved.size ? { resolved: [...resolved].sort() } : {}),
    };
  }
}

/**
 * Files with uncommitted changes (staged, unstaged or untracked) under the given paths.
 * @param {string} dir
 * @param {string[]} paths
 * @returns {Promise<string[]>}
 */
export async function changedFiles(dir, paths) {
  if (paths.length === 0) return [];
  return porcelainFiles(
    await runGit(dir, ['status', '--porcelain', '-z', '--untracked-files=all', '--', ...paths], { raw: true }),
  );
}

/**
 * Tracked files under the given paths whose working-tree copy differs from
 * HEAD: modified or deleted (staged or not). Untracked files are not listed.
 * @param {string} dir
 * @param {string[]} paths
 * @returns {Promise<string[]>}
 */
export async function changedSinceHead(dir, paths) {
  if (paths.length === 0) return [];
  const out = await runGit(dir, ['diff', 'HEAD', '--name-only', '--no-renames', '--diff-filter=MDT', '-z', '--', ...paths], { raw: true });
  return out.split('\0').filter(Boolean);
}

/**
 * Whether the repo has a commit yet (`git rev-parse --verify HEAD`).
 * @param {string} dir
 * @returns {Promise<boolean>}
 */
export async function hasHead(dir) {
  return (await tryGit(dir, ['rev-parse', '--verify', '--quiet', 'HEAD'])) !== null;
}

/**
 * Whether the branch HEAD names exists as a ref (loose or packed), resolvable or not.
 * @param {string} dir
 * @returns {Promise<boolean>}
 */
async function branchRefExists(dir) {
  // Read HEAD itself: `git symbolic-ref` refuses a ref that doesn't resolve.
  const gitDir = await runGit(dir, ['rev-parse', '--absolute-git-dir']);
  const m = /^ref: (\S+)/.exec(readFileSync(join(gitDir, 'HEAD'), 'utf8'));
  if (!m) return false; // detached HEAD naming nothing: treated like no commits
  const ref = m[1];
  if (existsSync(join(gitDir, ref))) return true;
  const packed = join(gitDir, 'packed-refs');
  return existsSync(packed) && readFileSync(packed, 'utf8').split('\n').some((l) => l.endsWith(` ${ref}`));
}

/**
 * The HEAD commit's id, or null when there is no repo or no commit yet. Any
 * other failure (a damaged repo, a timeout) is thrown, so callers can fail closed.
 * @param {string} dir
 * @returns {Promise<string|null>}
 */
export async function headCommit(dir) {
  try {
    return (await runGit(dir, ['rev-parse', '--verify', '--quiet', 'HEAD'])) || null;
  } catch (err) {
    // `--verify --quiet` exits 1 with no message when HEAD names no commit yet.
    // But a branch ref that exists and doesn't resolve is damage: fail closed.
    if (err instanceof GitError && err.code === 1 && !err.stderr) {
      if (await branchRefExists(dir)) throw err;
      return null;
    }
    // No repo at all is "nothing committed"; a damaged .git is not.
    if (err instanceof GitError && /not a git repository/i.test(err.stderr) && !existsSync(join(dir, '.git'))) return null;
    throw err;
  }
}

/**
 * The files committed in HEAD under a path (`git ls-tree -r`), with their blob ids.
 * @param {string} dir
 * @param {string} path - repo-relative
 * @returns {Promise<Array<{ path: string, oid: string }>>}
 */
export async function headTree(dir, path) {
  const out = await runGit(dir, ['ls-tree', '-r', '-z', '--full-name', 'HEAD', '--', path], { raw: true });
  const entries = [];
  for (const line of out.split('\0')) {
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const [, type, oid] = line.slice(0, tab).split(' ');
    if (type === 'blob') entries.push({ path: line.slice(tab + 1), oid });
  }
  return entries;
}

/**
 * A blob's text by id (`git cat-file blob`).
 * @param {string} dir
 * @param {string} oid
 * @returns {Promise<string>}
 */
export async function readBlob(dir, oid) {
  return runGit(dir, ['cat-file', 'blob', oid], { raw: true });
}

/**
 * Several blobs' text by id with one `git cat-file --batch` process (no size
 * limit beyond memory). An id git doesn't have is left out of the result.
 * @param {string} dir
 * @param {string[]} oids
 * @returns {Promise<Map<string, string>>}
 */
export async function readBlobs(dir, oids) {
  const texts = new Map();
  if (oids.length === 0) return texts;
  const timeout = Number(process.env.VP_GIT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  const out = await new Promise((resolve, reject) => {
    const child = spawn('git', ['cat-file', '--batch'], {
      cwd: dir,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_LITERAL_PATHSPECS: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const chunks = [];
    let stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new GitError(`git cat-file timed out after ${Math.round(timeout / 1000)}s`)); }, timeout);
    child.stdout.on('data', (c) => chunks.push(c));
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', (err) => { clearTimeout(timer); reject(new GitError(`git cat-file failed: ${err.message}`, err.message)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new GitError(`git cat-file failed: ${stderr.trim()}`, stderr.trim(), code));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(oids.join('\n') + '\n');
  });
  let at = 0;
  for (const oid of oids) {
    const nl = out.indexOf(0x0a, at);
    if (nl < 0) throw new GitError('git cat-file gave a short answer');
    const header = out.toString('utf8', at, nl).split(' ');
    at = nl + 1;
    if (header[1] === 'missing') continue;
    const size = Number(header[2]);
    if (!Number.isFinite(size) || at + size > out.length) throw new GitError('git cat-file gave a short answer');
    texts.set(oid, out.toString('utf8', at, at + size));
    at += size + 1;
  }
  return texts;
}

/**
 * A file's text as committed in HEAD, or null when HEAD has no such file.
 * @param {string} dir
 * @param {string} path - repo-relative
 * @returns {Promise<string|null>}
 */
export async function readHead(dir, path) {
  try {
    return await runGit(dir, ['cat-file', 'blob', `HEAD:${path}`], { raw: true });
  } catch {
    return null;
  }
}

/**
 * `git pull --ff-only`: bring in the upstream's commits when that needs no merge.
 * Throws a GitError when history diverged or the pull would touch local changes.
 * @param {string} dir
 * @param {{ yieldUntracked?: string[] }} [options] - as push's: untracked files under
 *   these paths that the upstream brings in are removed first (put back on failure)
 * @returns {Promise<{ yielded: string[] }>}
 */
export async function pullFastForward(dir, { yieldUntracked: yieldPaths = [] } = {}) {
  if (yieldPaths.length === 0) {
    await runGit(dir, ['pull', '--ff-only']);
    return { yielded: [] };
  }
  await runGit(dir, ['fetch']);
  const yielded = await yieldUntracked(dir, yieldPaths, await incomingFiles(dir));
  try {
    await runGit(dir, ['pull', '--ff-only']);
  } catch (err) {
    restoreYielded(dir, yielded);
    throw err;
  }
  return { yielded: yielded.map((y) => y.path) };
}

/**
 * @param {string} url
 * @param {string} dest
 * @returns {Promise<void>}
 */
export async function cloneRepo(url, dest) {
  await runGit(process.cwd(), ['clone', '--', url, dest]); // `--`: a URL can never be read as an option
}
