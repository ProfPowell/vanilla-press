/**
 * Runs a site's own npm scripts (install, build) and finds free ports.
 *
 * @module app/site-process
 */

import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';

const LOG_LIMIT = 4000;
export const BUILD_TIMEOUT_MS = 10 * 60_000;

/**
 * Spawn npm in a new process group so the whole tree can be killed.
 * @param {string[]} args
 * @param {{ cwd: string, env?: NodeJS.ProcessEnv, spawn?: typeof nodeSpawn }} opts
 */
export function spawnNpm(args, { cwd, env = {}, spawn = nodeSpawn }) {
  return spawn('npm', args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
}

/**
 * Collect a rolling tail of a child's stdout and stderr.
 * @param {import('node:child_process').ChildProcess} child
 * @returns {() => string}
 */
export function collectLog(child) {
  let log = '';
  const add = (chunk) => {
    log += chunk.toString();
    if (log.length > LOG_LIMIT * 2) log = log.slice(-LOG_LIMIT);
  };
  child.stdout?.on('data', add);
  child.stderr?.on('data', add);
  return () => log.slice(-LOG_LIMIT);
}

/** SIGKILL a child's process group (npm and everything it started). */
function killGroup(child) {
  try {
    if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
    else child.kill('SIGKILL');
  } catch { /* already gone */ }
}

/**
 * A timeout as people say it: "5 min" from a minute up, else "2 s".
 * @param {number} ms
 * @returns {string}
 */
export function durationText(ms) {
  return ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 1000)} s`;
}

const npmTimeoutNote = (ms) => `npm took too long (over ${durationText(ms)}) and was stopped.`;
const buildTimeoutNote = (ms) => `Build timed out after ${Math.round(ms / 1000)} s and was stopped.`;

/**
 * Run npm to completion. With `timeoutMs`, a run that takes longer is killed
 * (its whole process group) and reported as failed with `timedOut: true` and
 * `timeoutNote(timeoutMs)` at the end of its log (default: "npm took too long (over N min)").
 * @param {string} dir
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ timeoutMs?: number, timeoutNote?: (ms: number) => string }} [opts]
 * @returns {Promise<{ ok: boolean, log: string, timedOut?: boolean }>}
 */
export function runNpm(dir, args, env = {}, { timeoutMs, timeoutNote = npmTimeoutNote } = {}) {
  return new Promise((resolve) => {
    const child = spawnNpm(args, { cwd: dir, env });
    const tail = collectLog(child);
    let timedOut = false;
    const timer = timeoutMs > 0 ? setTimeout(() => { timedOut = true; killGroup(child); }, timeoutMs) : null;
    const done = (result) => { clearTimeout(timer); resolve(result); };
    child.on('error', (err) => done({ ok: false, log: `${tail()}${err.message}`.slice(-LOG_LIMIT) }));
    child.on('close', (code) => {
      if (timedOut) {
        const note = `\n${timeoutNote(timeoutMs)}`;
        return done({ ok: false, timedOut: true, log: `${tail()}${note}`.slice(-LOG_LIMIT) });
      }
      done({ ok: code === 0, log: tail() });
    });
  });
}

/**
 * Run `npm install` when node_modules is missing.
 * @param {string} dir
 * @param {{ run?: (dir: string, args: string[]) => Promise<{ ok: boolean, log: string } | void> }} [opts]
 * @returns {Promise<void>}
 */
export async function ensureInstalled(dir, { run = runNpm } = {}) {
  if (existsSync(join(dir, 'node_modules'))) return;
  const res = await run(dir, ['install']);
  if (res && res.ok === false) throw new Error(`npm install failed: ${res.log}`);
}

/**
 * Run the site's `npm run build` with NODE_ENV=production. A build that runs
 * longer than `timeoutMs` (default 10 minutes) is stopped and reported as failed.
 * @param {string} dir
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<{ ok: boolean, log: string }>}
 */
export function runBuild(dir, { timeoutMs = BUILD_TIMEOUT_MS } = {}) {
  return runNpm(dir, ['run', 'build'], { NODE_ENV: 'production' }, { timeoutMs, timeoutNote: buildTimeoutNote });
}

function canListen(port, host) {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once('error', () => resolve(false));
    const onListening = () => srv.close(() => resolve(true));
    if (host) srv.listen(port, host, onListening);
    else srv.listen(port, onListening);
  });
}

// Both probes are needed: on macOS a loopback bind succeeds even when another
// server holds the wildcard address (*:port).
async function isFree(port) {
  return (await canListen(port, '127.0.0.1')) && (await canListen(port));
}

/**
 * First port at or above `start` that can be listened on at both 127.0.0.1 and the wildcard address.
 * @param {number} [start]
 * @returns {Promise<number>}
 */
export async function freePort(start = 4100) {
  for (let port = start; port < 65536; port++) {
    if (await isFree(port)) return port;
  }
  throw new Error('No free port available');
}
