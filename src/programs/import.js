// Program import: scan a folder against the security rules, stage a copy in
// .vp/tmp/, install it all-or-nothing, and diff an update against the live copy.
// Programs go live in public, so a refusal stops the whole copy.
import { constants, rmSync } from 'node:fs';
import { lstat, mkdir, open, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { dirname, join, resolve, sep } from 'node:path';
import { ProgramError, SLUG } from './config.js';
import { MAX_BYTES, formatBytes } from '../media/limits.js';

export const LIMITS = { totalBytes: 52_428_800, files: 2000, fileBytes: MAX_BYTES, largeBytes: 10_485_760 };

const SKIP_SILENT = new Set(['.git', 'node_modules', '.DS_Store']);
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const KEY_BLOCK = /-----BEGIN[^\r\n]*PRIVATE KEY-----/;
const NOTHING_COPIED = 'Programs go live in public, so nothing was copied.';

const refuse = (message, rel) => new ProgramError(422, message, { refused: rel });
const fold = (name) => name.normalize('NFC').toLowerCase();

function secretName(name) {
  const n = name.toLowerCase();
  return n.endsWith('.pem') || n.endsWith('.key') || n.endsWith('.p12') || n.startsWith('id_rsa');
}

// Open without following a symlink swapped in after the lstat, and read only a regular file.
async function readRegular(file) {
  const fh = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!(await fh.stat()).isFile()) throw refuse(`${file} is not a regular file. ${NOTHING_COPIED}`);
    return await fh.readFile();
  } finally {
    await fh.close();
  }
}

export async function scanFolder(dir, { limits = LIMITS } = {}) {
  const files = [];
  const skipped = [];
  let total = 0;

  async function walk(abs, relPrefix) {
    const entries = await readdir(abs, { withFileTypes: true });
    const seen = new Map();
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const name = entry.name;
      const rel = relPrefix + name;
      if (SKIP_SILENT.has(name)) continue;
      if (name.startsWith('.')) {
        skipped.push(entry.isDirectory() ? `${rel}/` : rel);
        continue;
      }
      if (CONTROL.test(name)) {
        throw refuse(`"${rel.replace(/[\u0000-\u001f\u007f-\u009f]/g, '?')}" has a control character in its name. ${NOTHING_COPIED}`, rel);
      }
      const key = fold(name);
      if (seen.has(key)) {
        throw refuse(`${seen.get(key)} and ${name} differ only by case. macOS treats them as the same file, so nothing was copied.`, rel);
      }
      seen.set(key, name);

      const info = await lstat(join(abs, name));
      if (info.isSymbolicLink()) throw refuse(`${rel} is a symlink. ${NOTHING_COPIED}`, rel);
      if (info.isDirectory()) {
        await walk(join(abs, name), `${rel}/`);
        continue;
      }
      if (!info.isFile()) throw refuse(`${rel} is not a regular file. ${NOTHING_COPIED}`, rel);

      if (secretName(name)) throw refuse(`This folder has a private key (${rel}). ${NOTHING_COPIED}`, rel);
      if (info.size > limits.fileBytes) {
        throw refuse(`${rel} is too large (${formatBytes(info.size)}); the limit is ${formatBytes(limits.fileBytes)} a file. Nothing was copied.`, rel);
      }
      if (files.length + 1 > limits.files) {
        throw refuse(`This folder has too many files (the limit is ${limits.files.toLocaleString('en-US')}). Nothing was copied.`, rel);
      }
      total += info.size;
      if (total > limits.totalBytes) {
        throw refuse(`This folder is too large (over ${formatBytes(limits.totalBytes)}). Nothing was copied.`, rel);
      }
      let data;
      try {
        data = await readRegular(join(abs, name));
      } catch (e) {
        if (e instanceof ProgramError) throw e;
        if (e.code === 'ELOOP') throw refuse(`${rel} is a symlink. ${NOTHING_COPIED}`, rel);
        throw e;
      }
      if (KEY_BLOCK.test(data.toString('latin1'))) {
        throw refuse(`This folder has a private key (${rel}). ${NOTHING_COPIED}`, rel);
      }
      files.push({ rel, size: info.size });
    }
  }

  await walk(dir, '');
  if (!files.some((f) => f.rel === 'index.html')) {
    throw refuse('This folder has no index.html at its top level. A program needs one. Nothing was copied.', 'index.html');
  }
  return { files, skipped, total, large: total > limits.largeBytes };
}

const tmpRoot = (siteDir) => join(siteDir, '.vp', 'tmp');

async function newTmpDir(siteDir) {
  await mkdir(tmpRoot(siteDir), { recursive: true });
  const dir = join(tmpRoot(siteDir), randomBytes(8).toString('hex'));
  await mkdir(dir);
  return dir;
}

async function writeNew(root, rel, data) {
  const file = join(root, rel);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, data, { flag: 'wx' });
}

// Scan the staged copy, which is what will go live. Skipped names come from the source.
async function finish(tmpDir, skipped) {
  const scan = await scanFolder(tmpDir);
  return { tmpDir, scan: { ...scan, skipped } };
}

export async function stageFromFolder(siteDir, source) {
  let root;
  try {
    root = await realpath(source);
    if (!(await stat(root)).isDirectory()) throw new Error('not a directory');
  } catch {
    throw new ProgramError(422, `The source folder ${source} is gone or moved.`);
  }
  const first = await scanFolder(root);
  const tmpDir = await newTmpDir(siteDir);
  try {
    for (const { rel } of first.files) {
      try {
        await writeNew(tmpDir, rel, await readRegular(join(root, rel)));
      } catch (e) {
        if (e.code === 'ELOOP') throw refuse(`${rel} is a symlink. ${NOTHING_COPIED}`, rel);
        throw e;
      }
    }
    return await finish(tmpDir, first.skipped);
  } catch (e) {
    await rm(tmpDir, { recursive: true, force: true });
    throw e;
  }
}

function checkUploadPaths(files) {
  const names = new Set();
  const folded = new Map();
  const spelling = new Map();
  const dirs = new Set();
  for (const { rel } of files) {
    if (typeof rel !== 'string' || !rel || rel.startsWith('/') || rel.includes('\\')) {
      throw refuse(`"${rel}" is not a usable file path. ${NOTHING_COPIED}`, rel);
    }
    if (CONTROL.test(rel)) {
      throw refuse(`"${rel.replace(/[\u0000-\u001f\u007f-\u009f]/g, '?')}" has a control character in its name. ${NOTHING_COPIED}`, rel);
    }
    const parts = rel.split('/');
    if (parts.some((p) => p === '' || p === '.' || p === '..')) {
      throw refuse(`${rel} is a path that escapes the folder. ${NOTHING_COPIED}`, rel);
    }
    if (names.has(rel)) throw refuse(`${rel} appears twice. ${NOTHING_COPIED}`, rel);
    names.add(rel);
    // Every folder prefix and the file itself: one folded path, one spelling.
    for (let i = 1; i <= parts.length; i++) {
      const exact = parts.slice(0, i).join('/');
      const key = fold(exact);
      const seen = spelling.get(key);
      if (seen !== undefined && seen !== exact) {
        throw refuse(`${seen} and ${exact} differ only by case. macOS treats them as the same file, so nothing was copied.`, rel);
      }
      spelling.set(key, exact);
      if (i < parts.length) dirs.add(key);
    }
    folded.set(fold(rel), rel);
  }
  for (const [key, rel] of folded) {
    if (dirs.has(key)) throw refuse(`${rel} is both a file and a folder. ${NOTHING_COPIED}`, rel);
  }
}

export async function stageFromUpload(siteDir, files) {
  let list = files.map((f) => ({ rel: f.rel, data: f.data }));
  checkUploadPaths(list);
  // A picked folder arrives under its own name (plasma/index.html): drop that one wrapper.
  const tops = new Set(list.map((f) => f.rel.split('/')[0]));
  if (list.length && tops.size === 1 && list.every((f) => f.rel.includes('/'))) {
    list = list.map((f) => ({ rel: f.rel.slice(f.rel.indexOf('/') + 1), data: f.data }));
  }
  // Same skip rules as a folder: skipped files are never written to the stage.
  const skipped = new Set();
  const keep = [];
  for (const f of list) {
    const parts = f.rel.split('/');
    if (parts.some((p) => SKIP_SILENT.has(p))) continue;
    const dot = parts.findIndex((p) => p.startsWith('.'));
    if (dot >= 0) skipped.add(parts.slice(0, dot + 1).join('/') + (dot < parts.length - 1 ? '/' : ''));
    else keep.push(f);
  }
  const tmpDir = await newTmpDir(siteDir);
  try {
    for (const { rel, data } of keep) await writeNew(tmpDir, rel, data);
    const scan = await scanFolder(tmpDir);
    return { tmpDir, scan: { ...scan, skipped: [...skipped].sort() } };
  } catch (e) {
    await rm(tmpDir, { recursive: true, force: true });
    throw e;
  }
}

function inside(parent, child) {
  return resolve(child).startsWith(resolve(parent) + sep);
}

export async function installStaged(siteDir, tmpDir, area, slug, { replace = false } = {}) {
  if (typeof slug !== 'string' || !SLUG.test(slug)) throw new ProgramError(422, `"${slug}" isn't a usable slug.`);
  if (typeof area !== 'string' || !SLUG.test(area)) throw new ProgramError(422, `"${area}" isn't a usable area.`);
  if (!inside(tmpRoot(siteDir), tmpDir)) throw new ProgramError(422, 'That is not a staged folder.');

  const areaDir = join(siteDir, 'src', area);
  const target = join(areaDir, slug);
  await mkdir(areaDir, { recursive: true });
  const exists = await lstat(target).then(() => true, () => false);
  if (exists && !replace) throw new ProgramError(409, `"${slug}" already exists in /${area}/.`);

  if (!exists) {
    await rename(tmpDir, target);
    return;
  }
  const old = join(tmpRoot(siteDir), `${randomBytes(8).toString('hex')}-old`);
  try {
    await rename(target, old);
  } catch (e) {
    throw new ProgramError(500, `Could not replace "${slug}": ${e.message}. The old version is unchanged.`);
  }
  try {
    await rename(tmpDir, target);
  } catch (e) {
    try {
      await rename(old, target);
    } catch (back) {
      throw new ProgramError(500, `Could not replace "${slug}" (${e.message}) and could not put the old version back (${back.message}). It is saved in ${old}.`);
    }
    throw new ProgramError(500, `Could not replace "${slug}": ${e.message}. The old version is unchanged.`);
  }
  await rm(old, { recursive: true, force: true }).catch(() => {}); // leftovers go with clearTmp
}

// Regular files of the live folder, with the same skip rules as an import.
async function listCurrent(dir, prefix = '', out = []) {
  const entries = await readdir(dir, { withFileTypes: true }).catch((e) => {
    if (e.code === 'ENOENT') return [];
    throw e;
  });
  for (const e of entries) {
    if (SKIP_SILENT.has(e.name) || e.name.startsWith('.')) continue;
    if (e.isDirectory()) await listCurrent(join(dir, e.name), `${prefix}${e.name}/`, out);
    else if (e.isFile()) out.push(`${prefix}${e.name}`);
  }
  return out;
}

export async function diffFolders(currentDir, scan, stagedDir) {
  const current = new Set(await listCurrent(currentDir));
  const next = new Map(scan.files.map((f) => [f.rel, f.size]));
  const added = [];
  const changed = [];
  for (const [rel, size] of next) {
    if (!current.has(rel)) {
      added.push(rel);
      continue;
    }
    const a = join(currentDir, rel);
    if ((await stat(a)).size !== size) {
      changed.push(rel);
    } else if (!(await readFile(a)).equals(await readFile(join(stagedDir, rel)))) {
      changed.push(rel);
    }
  }
  const removed = [...current].filter((rel) => !next.has(rel));
  const sort = (xs) => xs.sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  return { added: sort(added), changed: sort(changed), removed: sort(removed) };
}

export function scanToken(scan) {
  const lines = scan.files.map((f) => `${f.rel}:${f.size}`).sort();
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

export function clearTmp(siteDir) {
  rmSync(tmpRoot(siteDir), { recursive: true, force: true });
}
