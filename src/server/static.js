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
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/**
 * Headers for user-uploaded media: sandboxed (an SVG or PDF opened directly
 * can't run script) and never sniffed into another type.
 */
export const MEDIA_HEADERS = {
  'Content-Security-Policy': 'sandbox',
  'X-Content-Type-Options': 'nosniff',
};

/**
 * Parse a single `Range: bytes=...` value against a file size.
 * @returns {{ start: number, end: number } | 'unsatisfiable' | null} null: no range, or a
 *   form we ignore (multi-range, malformed or last-before-first), which is served whole.
 */
function parseRange(value, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(value || '').trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start;
  let end;
  if (m[1] === '') {
    const n = Number(m[2]);
    if (n === 0 || size === 0) return 'unsatisfiable';
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    // RFC 9110 14.1.2: last before first is not a valid range spec, so it is ignored.
    if (m[2] !== '' && Number(m[2]) < start) return null;
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
    if (start >= size) return 'unsatisfiable';
  }
  return { start, end };
}

/**
 * Serve a file (or a directory's index.html).
 * With `headers`, those headers are added and single byte ranges are honoured.
 * @param {import('node:http').ServerResponse} res
 * @param {string} filePath
 * @param {{ req?: import('node:http').IncomingMessage, headers?: Record<string, string> }} [options]
 * @returns {boolean} true if a file was served
 */
export function serveFile(res, filePath, { req, headers } = {}) {
  try {
    if (!existsSync(filePath)) return false;
    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      const indexPath = join(filePath, 'index.html');
      return existsSync(indexPath) ? serveFile(res, indexPath, { req, headers }) : false;
    }
    const content = readFileSync(filePath);
    const base = {
      'Content-Type': MIME_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      ...(headers ? { ...headers, 'Accept-Ranges': 'bytes' } : {}),
    };
    const range = headers ? parseRange(req?.headers?.range, content.length) : null;
    if (range === 'unsatisfiable') {
      res.writeHead(416, { ...base, 'Content-Range': `bytes */${content.length}`, 'Content-Length': 0 });
      res.end();
    } else if (range) {
      const part = content.subarray(range.start, range.end + 1);
      res.writeHead(206, {
        ...base, 'Content-Range': `bytes ${range.start}-${range.end}/${content.length}`, 'Content-Length': part.length,
      });
      res.end(part);
    } else {
      res.writeHead(200, { ...base, 'Content-Length': content.length });
      res.end(content);
    }
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
 * @param {{ headers?: Record<string, string> }} [options] - extra response headers (and ranges)
 * @returns {boolean} true if a file was served
 */
export function serveStatic(req, res, mounts, { headers } = {}) {
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
    if (serveFile(res, filePath, { req, headers })) return true;
  }
  return false;
}
