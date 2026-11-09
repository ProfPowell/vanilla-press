/**
 * The program server, for "Open": a separate-origin, read-only static server that
 * runs programs. A program is served from its own port so its scripts are never
 * on the app's origin (they get no cookies, storage or API of the app's page).
 *
 * Routes: GET/HEAD `/<siteId>/<area>/<slug>/<rest>` (empty rest = index.html).
 * Only files inside a configured area's program folder are served; dotfiles and
 * symlinks never are. Everything else is a plain-text 404.
 *
 * @module programs/program-server
 */

import { createServer } from 'node:http';
import { lstatSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';
import { readPrograms, effectiveSandbox, SLUG } from './config.js';
import { serveFile } from '../server/static.js';
import { checkRequest } from '../server/guard.js';
import { HOST, listen } from '../server/listen.js';

export const SANDBOX_CSP = 'sandbox allow-scripts allow-forms allow-popups allow-pointer-lock allow-modals';

const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cache-Control': 'no-store',
};

function reply(res, status, text, extra = {}) {
  res.writeHead(status, {
    ...BASE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(text), ...extra,
  });
  res.end(text);
}

const notFound = (res) => reply(res, 404, 'Not Found');

/** lstat that never throws: null when the path is missing. */
function lstatOrNull(p) {
  try {
    return lstatSync(p);
  } catch {
    return null;
  }
}

/**
 * The file a request names, or null. Walks each component with lstat so no
 * symlink (a folder or the file) is followed, then checks the real path again.
 * @returns {{ file: string, isDir: boolean } | null}
 */
function locate(srcDir, area, slug, rest) {
  const segments = [area, slug, ...rest];
  let cur = srcDir;
  let stat = null;
  for (const seg of segments) {
    cur = join(cur, seg);
    stat = lstatOrNull(cur);
    if (!stat || stat.isSymbolicLink()) return null;
  }
  const programDir = join(srcDir, area, slug);
  let real;
  let realProgram;
  try {
    real = realpathSync(cur);
    realProgram = realpathSync(programDir);
  } catch {
    return null;
  }
  if (real !== realProgram && !real.startsWith(realProgram + sep)) return null;
  if (stat.isDirectory()) return { file: cur, isDir: true };
  return stat.isFile() ? { file: cur, isDir: false } : null;
}

/**
 * @param {{ port?: number, resolveSite: (siteId: string) => ({ siteDir: string } | null) }} options
 *   port 0: the OS picks, otherwise `port`, `port+1`, ... is tried.
 * @returns {Promise<{ server: import('node:http').Server, port: number, url: string, close: () => Promise<void> }>}
 */
export async function startProgramServer({ port = 0, resolveSite }) {
  let bound = 0;

  function handle(req, res) {
    // The Host check is the app guard's, for this server's own port (GET-shaped, off /api/).
    if (!checkRequest({ method: 'GET', url: '/', headers: { host: req.headers.host } }, bound)) {
      return reply(res, 403, 'Forbidden');
    }
    const method = String(req.method || '').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') return reply(res, 405, 'Method Not Allowed', { Allow: 'GET, HEAD' });

    const rawUrl = String(req.url || '');
    const q = rawUrl.indexOf('?');
    const rawPath = q === -1 ? rawUrl : rawUrl.slice(0, q);
    const query = q === -1 ? '' : rawUrl.slice(q);
    if (!rawPath.startsWith('/')) return notFound(res);

    const parts = rawPath.slice(1).split('/');
    const trailing = parts.length > 1 && parts[parts.length - 1] === '';
    if (trailing) parts.pop();
    let segments;
    try {
      segments = parts.map((p) => decodeURIComponent(p));
    } catch {
      return notFound(res);
    }
    // siteId, area, slug, and at least nothing more; every segment a plain name.
    if (segments.length < 3) return notFound(res);
    if (segments.some((s) => s === '' || s.startsWith('.') || /[/\\\0]/.test(s))) return notFound(res);
    const [siteId, area, slug, ...rest] = segments;
    if (!SLUG.test(slug)) return notFound(res);

    let site;
    let config;
    try {
      site = resolveSite(siteId);
      if (!site || !site.siteDir) return notFound(res);
      config = readPrograms(site.siteDir); // per request: area and sandbox changes apply at once
    } catch {
      return notFound(res);
    }
    if (!config.areas.some((a) => a && a.path === area)) return notFound(res);

    const found = locate(join(site.siteDir, 'src'), area, slug, rest);
    if (!found) return notFound(res);

    if (found.isDir && !trailing) {
      return reply(res, 301, '', { Location: `${rawPath}/${query}` });
    }
    let file = found.file;
    if (found.isDir) {
      const idx = locate(join(site.siteDir, 'src'), area, slug, [...rest, 'index.html']);
      if (!idx || idx.isDir) return notFound(res);
      file = idx.file;
    } else if (trailing) {
      return notFound(res);
    }

    const headers = { ...BASE_HEADERS };
    if (effectiveSandbox(config, area, slug)) headers['Content-Security-Policy'] = SANDBOX_CSP;
    if (!serveFile(res, file, { req, headers })) notFound(res);
  }

  const server = createServer((req, res) => {
    try {
      handle(req, res);
    } catch {
      if (!res.headersSent) reply(res, 500, 'Server Error');
      else res.end();
    }
  });

  bound = await listen(server, port);

  const close = () => new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections?.();
  });
  return { server, port: bound, url: `http://${HOST}:${bound}`, close };
}
