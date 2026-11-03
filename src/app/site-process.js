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

/**
 * Run npm to completion.
 * @param {string} dir
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<{ ok: boolean, log: string }>}
 */
export function runNpm(dir, args, env = {}) {
  return new Promise((resolve) => {
    const child = spawnNpm(args, { cwd: dir, env });
    const tail = collectLog(child);
    child.on('error', (err) => resolve({ ok: false, log: `${tail()}${err.message}`.slice(-LOG_LIMIT) }));
    child.on('close', (code) => resolve({ ok: code === 0, log: tail() }));
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
 * Run the site's `npm run build` with NODE_ENV=production.
 * @param {string} dir
 * @returns {Promise<{ ok: boolean, log: string }>}
 */
export function runBuild(dir) {
  return runNpm(dir, ['run', 'build'], { NODE_ENV: 'production' });
}

function isFree(port) {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
  });
}

/**
 * First port at or above `start` that can be listened on at 127.0.0.1.
 * @param {number} [start]
 * @returns {Promise<number>}
 */
export async function freePort(start = 4100) {
  for (let port = start; port < 65536; port++) {
    if (await isFree(port)) return port;
  }
  throw new Error('No free port available');
}
