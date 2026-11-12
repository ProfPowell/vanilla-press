/**
 * @file layout-preview.js
 * @description The layout editor's preview (rulings P2, P3, P5): a working copy
 * of a site under `<configDir>/layout-preview/<siteId>/`, built with the site's
 * own Cook, and a small static server for the copy's `dist/`.
 *
 * Each render mirrors the site's `src/`, `config/`, `plugins/` and
 * `package.json` into the copy (unchanged files skipped by size and mtime,
 * files gone from the site deleted), links `node_modules` to the site's,
 * writes the unsaved layout and include sources over the copy, writes the
 * draft as `src/vp-layout-preview.html` and runs `cook build` there. Nothing
 * is ever written under the site directory (Review Focus 4): the copy holds
 * regular files only, apart from the one `node_modules` link.
 */

import { spawn as nodeSpawn } from 'node:child_process';
import { createServer } from 'node:http';
import {
  existsSync, lstatSync, statSync, readdirSync, mkdirSync, rmSync, copyFileSync, utimesSync,
  writeFileSync, symlinkSync, readlinkSync, createReadStream, realpathSync,
} from 'node:fs';
import { join, extname, sep, dirname } from 'node:path';
import { collectLog, durationText } from './site-process.js';
import { MIME_TYPES } from '../server/static.js';
import { pageHtml } from '../sync/to-site.js';

export const PREVIEW_PAGE = 'vp-layout-preview';

/** A preview build that runs longer is stopped, so one hung build can't freeze the site's previews. */
export const PREVIEW_BUILD_TIMEOUT_MS = 120_000;

/** What the site contributes to the copy: directories, then files. */
const MIRROR_DIRS = ['src', 'config', 'plugins'];
const MIRROR_FILES = ['package.json'];

const NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

/** The page previewed when there is no document draft. */
export const SAMPLE_DOC = Object.freeze({
  id: PREVIEW_PAGE,
  meta: {
    title: 'Sample page',
    description: 'A sample page for previewing layouts.',
    slug: PREVIEW_PAGE,
    collection: 'pages',
  },
  blocks: [{
    type: 'paragraph',
    children: [{ type: 'text', value: 'This is a sample paragraph. The page you are editing shows its layout around text like this.' }],
  }],
});

/** Remove a path of any kind (a file, a link, a directory tree). */
const remove = (abs) => rmSync(abs, { recursive: true, force: true });

/** lstat, or null when the path is missing. */
function lstatOrNull(abs) {
  try { return lstatSync(abs); } catch { return null; }
}

/**
 * The source entry's stat as the copy sees it: a symlink is followed to a
 * regular file; a link to a directory (or anything else) is skipped.
 */
function sourceStat(abs) {
  const st = lstatOrNull(abs);
  if (!st || !st.isSymbolicLink()) return st;
  try {
    const target = statSync(abs);
    return target.isFile() ? target : null;
  } catch {
    return null;
  }
}

/**
 * Same mtime at whole-millisecond precision: utimes stamps millisecond Dates,
 * while APFS keeps sub-millisecond source mtimes.
 */
const sameMtime = (a, b) => Math.floor(a.mtimeMs) === Math.floor(b.mtimeMs);

/** Copy one file when its size or mtime differs (or `force`); the copy keeps the source's mtime. */
function mirrorFile(from, to, st, force) {
  const have = lstatOrNull(to);
  if (have && !have.isFile()) remove(to);
  else if (have && !force && have.size === st.size && sameMtime(have, st)) return;
  if (have?.isFile()) rmSync(to);
  copyFileSync(from, to);
  utimesSync(to, st.atime, st.mtime);
}

/** Mirror a directory tree. node_modules is never entered; `forced` paths are recopied. */
function mirrorDir(from, to, forced) {
  const have = lstatOrNull(to);
  if (have && !have.isDirectory()) remove(to);
  if (!have || !have.isDirectory()) mkdirSync(to, { recursive: true });
  const keep = new Set();
  for (const name of readdirSync(from)) {
    if (name === 'node_modules') continue;
    const src = join(from, name);
    const st = sourceStat(src);
    if (!st) continue;
    const dest = join(to, name);
    if (st.isDirectory()) mirrorDir(src, dest, forced);
    else if (st.isFile()) mirrorFile(src, dest, st, forced.has(dest));
    else continue;
    keep.add(name);
  }
  for (const name of readdirSync(to)) {
    if (!keep.has(name)) remove(join(to, name));
  }
}

/**
 * Bring the copy in line with the site. `forced` holds copy paths written
 * over by the last render (overrides, the draft), recopied whatever their stat.
 */
function mirrorSite(siteDir, copyDir, forced) {
  mkdirSync(copyDir, { recursive: true });
  for (const dir of MIRROR_DIRS) {
    const src = join(siteDir, dir);
    const st = sourceStat(src);
    if (st?.isDirectory()) mirrorDir(src, join(copyDir, dir), forced);
    else remove(join(copyDir, dir));
  }
  for (const file of MIRROR_FILES) {
    const src = join(siteDir, file);
    const st = sourceStat(src);
    if (st?.isFile()) mirrorFile(src, join(copyDir, file), st, forced.has(join(copyDir, file)));
    else remove(join(copyDir, file));
  }
  // node_modules: a link to the site's, never a copy.
  const link = join(copyDir, 'node_modules');
  const target = join(siteDir, 'node_modules');
  const have = lstatOrNull(link);
  if (have && !(have.isSymbolicLink() && readlinkSync(link) === target)) remove(link);
  if (!lstatOrNull(link) && existsSync(target)) symlinkSync(target, link, 'dir');
}

/** Write text at a copy-relative path, replacing whatever is there (never writing through a link). */
function writeOver(abs, text) {
  mkdirSync(dirname(abs), { recursive: true });
  remove(abs);
  writeFileSync(abs, text);
}

/** SIGKILL a child's process group. */
function killGroup(child) {
  try {
    if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
    else child.kill('SIGKILL');
  } catch { /* already gone */ }
}

/**
 * The static server for a copy's dist/: GET and HEAD only, 127.0.0.1,
 * `Access-Control-Allow-Origin: *` (the sandboxed iframe has a null origin and
 * loads module scripts), `Cache-Control: no-store`, a directory serves its
 * index.html, `..` and anything resolving outside dist/ are refused.
 * @param {string} distDir
 * @param {number} port - 0 for any free port
 * @returns {Promise<import('node:http').Server>}
 */
function startStaticServer(distDir, port) {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
  const send = (res, status, text) => {
    res.writeHead(status, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(text);
  };
  const server = createServer((req, res) => {
    // Only our own host names: a DNS-rebound name must not read draft previews.
    const { port: bound } = server.address();
    if (![`127.0.0.1:${bound}`, `localhost:${bound}`].includes(String(req.headers.host).toLowerCase())) {
      return send(res, 403, 'Forbidden');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    let pathname;
    try {
      pathname = decodeURIComponent(req.url.split('?')[0]);
    } catch {
      return send(res, 400, 'Bad request');
    }
    const segments = pathname.split(/[/\\]/);
    if (segments.includes('..') || pathname.includes('\0')) return send(res, 403, 'Forbidden');
    let abs = join(distDir, ...segments.filter(Boolean));
    let root;
    try {
      root = realpathSync(distDir);
      let st = statSync(abs);
      if (st.isDirectory()) {
        abs = join(abs, 'index.html');
        st = statSync(abs);
      }
      if (!st.isFile()) return send(res, 404, 'Not found');
      const real = realpathSync(abs);
      if (real !== root && !real.startsWith(root + sep)) return send(res, 403, 'Forbidden');
      res.writeHead(200, {
        ...headers,
        'Content-Type': MIME_TYPES[extname(real).toLowerCase()] || 'application/octet-stream',
        'Content-Length': st.size,
      });
      if (req.method === 'HEAD') return res.end();
      createReadStream(real).on('error', () => res.destroy()).pipe(res);
    } catch {
      send(res, 404, 'Not found');
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}

/**
 * The layout preview for one site.
 *
 * `render` calls are serialized; when several overlap, queued ones that a
 * newer call has overtaken are skipped and every caller gets the newest
 * call's result (the page at the URL is that one).
 *
 * @param {{
 *   site: { id: string, path: string },
 *   configDir: string,
 *   spawn?: typeof nodeSpawn,
 *   freePort?: () => Promise<number>,
 *   buildTimeoutMs?: number,
 * }} opts - freePort: the port to serve on (default: any free port the OS gives);
 *   buildTimeoutMs: default PREVIEW_BUILD_TIMEOUT_MS (2 min)
 */
export function createLayoutPreview({
  site, configDir, spawn = nodeSpawn, freePort = async () => 0, buildTimeoutMs = PREVIEW_BUILD_TIMEOUT_MS,
}) {
  if (!NAME.test(String(site?.id))) throw new Error(`Invalid site id: ${site?.id}`);
  const siteDir = site.path;
  const copyDir = join(configDir, 'layout-preview', site.id);
  const cookBin = join(siteDir, 'node_modules', 'cook-ssg', 'bin', 'cook.js');

  /** Copy paths written over by the last render: the next mirror restores them. */
  let forced = new Set();
  let server = null;
  let serverStarting = null;
  let child = null;
  let closed = false;

  let chain = Promise.resolve();
  let seq = 0;
  /** The newest render's promise. */
  let newest = null;

  function ensureServer() {
    if (server) return Promise.resolve(server);
    serverStarting ??= (async () => {
      const port = await freePort();
      const s = await startStaticServer(join(copyDir, 'dist'), port);
      if (closed) {
        await new Promise((r) => s.close(() => r()));
        throw new Error('Layout preview closed');
      }
      server = s;
      return s;
    })().finally(() => { serverStarting = null; });
    return serverStarting;
  }

  function build() {
    return new Promise((resolve) => {
      if (!existsSync(cookBin)) {
        resolve({ ok: false, log: `This site's Cook is not installed (no ${join('node_modules', 'cook-ssg', 'bin', 'cook.js')}); run npm install.` });
        return;
      }
      const c = spawn(process.execPath, [cookBin, 'build'], {
        cwd: copyDir,
        env: { ...process.env, NODE_ENV: 'production' },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      });
      child = c;
      const tail = collectLog(c);
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; killGroup(c); }, buildTimeoutMs);
      const done = (r) => {
        clearTimeout(timer);
        if (child === c) child = null;
        resolve(r);
      };
      c.on('error', (err) => done({ ok: false, log: `${tail()}${err.message}` }));
      c.on('close', (code) => {
        if (timedOut) return done({ ok: false, log: `${tail()}\nThe preview build took too long (over ${durationText(buildTimeoutMs)}) and was stopped.` });
        if (closed) return done({ ok: false, log: 'Layout preview closed' });
        done({ ok: code === 0, log: tail() });
      });
    });
  }

  async function doRender({ layouts = {}, includes = {}, doc = null, layout, mediaAlt } = {}) {
    if (closed) return { ok: false, log: 'Layout preview closed' };
    const overrides = [];
    for (const [kind, map] of [['layouts', layouts], ['includes', includes]]) {
      for (const [name, text] of Object.entries(map || {})) {
        if (!NAME.test(name)) return { ok: false, log: `Invalid ${kind === 'layouts' ? 'layout' : 'include'} name: ${name}` };
        if (typeof text !== 'string') return { ok: false, log: `The ${name} source is not text` };
        overrides.push([join(copyDir, 'src', kind, `${name}.html`), text]);
      }
    }
    if (typeof layout !== 'string' || !NAME.test(layout)) return { ok: false, log: `Invalid layout name: ${layout}` };
    let page;
    try {
      page = pageHtml(doc || SAMPLE_DOC, { layout, mediaAlt: doc ? mediaAlt : undefined });
    } catch (err) {
      return { ok: false, log: `The draft could not be rendered: ${err.message}` };
    }

    try {
      mirrorSite(siteDir, copyDir, forced);
      const draft = join(copyDir, 'src', `${PREVIEW_PAGE}.html`);
      forced = new Set([draft, ...overrides.map(([abs]) => abs)]);
      for (const [abs, text] of overrides) writeOver(abs, text);
      writeOver(draft, page);
    } catch (err) {
      return { ok: false, log: `The preview copy could not be prepared: ${err.message}` };
    }

    const result = await build();
    if (!result.ok) return { ok: false, log: result.log };
    const s = await ensureServer();
    return { ok: true, url: `http://127.0.0.1:${s.address().port}/${PREVIEW_PAGE}/` };
  }

  return {
    /**
     * @param {{ layouts?: Record<string, string>, includes?: Record<string, string>, doc?: Object, layout: string,
     *   mediaAlt?: (src: string) => string|null }} req - doc: a document draft (default: a sample page)
     * @returns {Promise<{ ok: true, url: string } | { ok: false, log: string }>}
     */
    async render(req) {
      const mine = ++seq;
      const run = chain.then(() => (mine === seq ? doRender(req) : null))
        .catch((err) => ({ ok: false, log: err.message }));
      chain = run;
      newest = run;
      // Settle with the newest call's result, following any newer call made meanwhile.
      let target;
      let r;
      do {
        target = newest;
        r = await target;
      } while (target !== newest);
      return r;
    },

    /** Stop any running build and the static server. */
    async close() {
      closed = true;
      if (child) killGroup(child);
      await serverStarting?.catch(() => {});
      if (server) {
        const s = server;
        server = null;
        await new Promise((r) => {
          s.close(() => r());
          s.closeAllConnections?.();
        });
      }
    },

    /** SIGKILL a running build, synchronously (for `process.on('exit')`). */
    killSync() {
      if (child) killGroup(child);
    },
  };
}
