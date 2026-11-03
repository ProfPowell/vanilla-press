/**
 * Static file serving shared by the dev server and the app server.
 *
 * @module server/static
 */

import { join, extname, resolve, sep } from 'node:path';
import { readFileSync, existsSync, statSync } from 'node:fs';

export const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/**
 * Serve a file (or a directory's index.html).
 * @param {import('node:http').ServerResponse} res
 * @param {string} filePath
 * @returns {boolean} true if a file was served
 */
export function serveFile(res, filePath) {
  try {
    if (!existsSync(filePath)) return false;
    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      const indexPath = join(filePath, 'index.html');
      return existsSync(indexPath) ? serveFile(res, indexPath) : false;
    }
    const content = readFileSync(filePath);
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[extname(filePath)] || 'application/octet-stream',
      'Content-Length': content.length,
      'Cache-Control': 'no-cache',
    });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

/**
 * Serve `req` from the first matching mount. A path whose decoded form has a
 * `..` segment (or that is not valid percent-encoding) is never served.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {{ prefix: string, dir: string }[]} mounts
 * @returns {boolean} true if a file was served
 */
export function serveStatic(req, res, mounts) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split('?')[0]);
  } catch {
    return false;
  }
  if (urlPath.includes('\0') || urlPath.split(/[\\/]/).includes('..')) return false;
  for (const mount of mounts) {
    if (!urlPath.startsWith(mount.prefix)) continue;
    const base = resolve(mount.dir);
    const filePath = resolve(base, '.' + sep + urlPath.slice(mount.prefix.length));
    if (filePath !== base && !filePath.startsWith(base + sep)) continue;
    if (serveFile(res, filePath)) return true;
  }
  return false;
}
