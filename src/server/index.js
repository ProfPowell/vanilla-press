/**
 * Vanilla Press development server.
 *
 * Serves the editor UI, API endpoints, media files, and shared source files
 * from a single origin (no CORS needed).
 *
 * Usage: node src/server/index.js [--port 3007]
 *
 * @module server/index
 */

import { createServer } from 'node:http';
import { parseArgs } from 'node:util';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync, statSync } from 'node:fs';
import Database from 'better-sqlite3';
import { migrate } from '../store/migrate.js';
import { resolveWorkspace, openWorkspaceDb } from '../workspace/workspace.js';
import { createRouter } from './router.js';
import { mountApi } from './api.js';
import { syncFromSite } from '../sync/from-site.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const MIME_TYPES = {
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
 * Start the dev server.
 * @param {Object} [options]
 * @param {number} [options.port=3007]
 * @param {string} [options.dbPath] - Fixture-mode DB override (also VP_DB)
 * @param {string} [options.site] - Cook site directory (also VP_SITE)
 * @returns {import('node:http').Server}
 */
export function startServer(options = {}) {
  const port = options.port || 3007;
  const ws = resolveWorkspace({ site: options.site, repoRoot: ROOT });
  const mediaDir = ws.mediaDir;

  // Open database. Fixture mode keeps the dbPath / VP_DB overrides.
  let dbPath = ws.dbPath;
  let db;
  if (ws.siteDir) {
    db = openWorkspaceDb(ws);
  } else {
    dbPath = options.dbPath || process.env.VP_DB || ws.dbPath;
    db = new Database(dbPath);
    migrate(db);
  }

  // The site's committed JSON wins: bring on-disk changes into the store first.
  if (ws.syncEnabled) {
    const { imported, skipped, removed } = syncFromSite(ws, db);
    console.log(`Synced from ${ws.contentDir}: ${imported.length} loaded, ${skipped.length} skipped, ${removed.length} removed`);
  }

  // Set up router with API routes
  const router = createRouter();
  mountApi(router, db, { rootDir: ROOT, mediaDir, workspace: ws });

  // Static file mount points: URL prefix → filesystem path
  const staticMounts = [
    { prefix: '/editor/', dir: join(ROOT, 'editor') },
    { prefix: '/src/', dir: join(ROOT, 'src') },
    { prefix: '/media/', dir: mediaDir },
    { prefix: '/test/', dir: join(ROOT, 'test') },
    { prefix: '/kitchen-sink/', dir: join(ROOT, 'kitchen-sink') },
    { prefix: '/assets/vb/', dir: join(ROOT, 'node_modules', 'vanilla-breeze', 'dist', 'cdn') },
    { prefix: '/assets/code-block/', dir: join(ROOT, 'node_modules', '@profpowell', 'code-block', 'dist') },
  ];

  const server = createServer(async (req, res) => {
    try {
      // Try API routes first
      const handled = await router.handle(req, res);
      if (handled) return;

      // Redirect /editor to /editor/
      if (req.url === '/editor') {
        res.writeHead(302, { Location: '/editor/' });
        res.end();
        return;
      }

      // Redirect root to editor
      if (req.url === '/') {
        res.writeHead(302, { Location: '/editor/' });
        res.end();
        return;
      }

      // Try static file serving
      const urlPath = decodeURIComponent(req.url.split('?')[0]);

      for (const mount of staticMounts) {
        if (urlPath.startsWith(mount.prefix)) {
          const relPath = urlPath.slice(mount.prefix.length);
          const filePath = join(mount.dir, relPath);
          if (serveFile(res, filePath)) return;
        }
      }

      // 404
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    } catch (err) {
      console.error('Server error:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
      }
    }
  });

  server.listen(port, () => {
    console.log(`Vanilla Press dev server running at http://localhost:${port}/editor/`);
    console.log(`API: http://localhost:${port}/api/`);
    console.log(`DB: ${dbPath}`);
    console.log(ws.syncEnabled ? `Site: ${ws.siteDir} (syncing)` : 'Fixture mode: demo content, not synced');
  });

  // Clean shutdown
  const shutdown = () => {
    console.log('\nShutting down...');
    db.close();
    server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return server;
}

/**
 * Serve a static file.
 * @param {import('node:http').ServerResponse} res
 * @param {string} filePath
 * @returns {boolean} true if file was served
 */
function serveFile(res, filePath) {
  // Prevent directory traversal
  if (filePath.includes('..')) return false;

  try {
    if (!existsSync(filePath)) return false;
    const stat = statSync(filePath);

    // Serve index.html for directories
    if (stat.isDirectory()) {
      const indexPath = join(filePath, 'index.html');
      if (existsSync(indexPath)) {
        return serveFile(res, indexPath);
      }
      return false;
    }

    const ext = extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const content = readFileSync(filePath);

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': content.length,
      'Cache-Control': 'no-cache',
    });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

// --- CLI entry point ---
if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({
    options: {
      port: { type: 'string', default: '3007' },
      site: { type: 'string' },
    },
    allowPositionals: true,
  });

  startServer({ port: parseInt(values.port, 10), site: values.site });
}
