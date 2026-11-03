/**
 * Machine-local registry of Cook sites managed by the app, plus folder browsing.
 *
 * @module app/registry
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, appendFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { writeFileAtomic } from '../sync/atomic-write.js';

/**
 * @typedef {{ id: string, name: string, path: string, addedAt: string }} Site
 */

/**
 * Directory holding sites.json.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function configDir(env = process.env) {
  return env.VP_CONFIG_DIR || join(homedir(), '.config', 'vanilla-press');
}

function sitesFile(env) {
  return join(configDir(env), 'sites.json');
}

function readSites(env) {
  const file = sitesFile(env);
  if (!existsSync(file)) return [];
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    if (!Array.isArray(data)) throw new Error('expected an array');
    return data;
  } catch (err) {
    throw new Error(`Cannot read ${file}: ${err.message}`);
  }
}

function writeSites(sites, env) {
  writeFileAtomic(sitesFile(env), JSON.stringify(sites, null, 2) + '\n');
}

/**
 * Whether a folder is a Cook site (package.json depends on cook-ssg).
 * @param {string} dir
 * @returns {boolean}
 */
export function isCookSite(dir) {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    return Boolean(pkg.dependencies?.['cook-ssg'] || pkg.devDependencies?.['cook-ssg']);
  } catch {
    return false;
  }
}

/**
 * @param {{ env?: NodeJS.ProcessEnv }} [opts]
 * @returns {Site[]}
 */
export function listSites({ env = process.env } = {}) {
  return readSites(env);
}

/**
 * @param {string} id
 * @param {{ env?: NodeJS.ProcessEnv }} [opts]
 * @returns {Site|null}
 */
export function getSite(id, { env = process.env } = {}) {
  return readSites(env).find((s) => s.id === id) || null;
}

function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'site';
}

function ensureGitignored(dir) {
  const file = join(dir, '.gitignore');
  if (!existsSync(file)) {
    writeFileSync(file, '.vp/\n');
    return;
  }
  const text = readFileSync(file, 'utf8');
  if (text.split(/\r?\n/).some((l) => l.trim() === '.vp/')) return;
  appendFileSync(file, (text === '' || text.endsWith('\n') ? '' : '\n') + '.vp/\n');
}

/**
 * Register a Cook site.
 * @param {{ path: string, name?: string }} input
 * @param {{ env?: NodeJS.ProcessEnv }} [opts]
 * @returns {Site}
 */
export function addSite({ path, name } = {}, { env = process.env } = {}) {
  const abs = resolve(path);
  if (!isCookSite(abs)) throw new Error(`Not a Cook site: ${abs}`);
  const sites = readSites(env);
  if (sites.some((s) => s.path === abs)) throw new Error(`Already added: ${abs}`);

  const base = slug(basename(abs));
  let id = base;
  for (let n = 2; sites.some((s) => s.id === id); n++) id = `${base}-${n}`;

  mkdirSync(join(abs, '.vp'), { recursive: true });
  ensureGitignored(abs);

  const site = { id, name: name || basename(abs), path: abs, addedAt: new Date().toISOString() };
  writeSites([...sites, site], env);
  return site;
}

/**
 * Forget a site (its folder is untouched).
 * @param {string} id
 * @param {{ env?: NodeJS.ProcessEnv }} [opts]
 * @returns {boolean}
 */
export function removeSite(id, { env = process.env } = {}) {
  const sites = readSites(env);
  const rest = sites.filter((s) => s.id !== id);
  if (rest.length === sites.length) return false;
  writeSites(rest, env);
  return true;
}

/**
 * List the visible subfolders of a directory, marking Cook sites.
 * @param {string} dir
 * @returns {{ path: string, parent: string, folders: { name: string, path: string, isSite: boolean }[] }}
 */
export function listFolders(dir) {
  const abs = resolve(dir);
  const folders = readdirSync(abs, { withFileTypes: true })
    .filter((e) => !e.name.startsWith('.'))
    .map((e) => ({ name: e.name, path: join(abs, e.name) }))
    .filter((f) => {
      try { return statSync(f.path).isDirectory(); } catch { return false; }
    })
    .map((f) => ({ ...f, isSite: isCookSite(f.path) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { path: abs, parent: dirname(abs), folders };
}
