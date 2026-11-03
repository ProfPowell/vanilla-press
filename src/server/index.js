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
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { migrate } from '../store/migrate.js';
import { resolveWorkspace, openWorkspaceDb } from '../workspace/workspace.js';
import { createRouter } from './router.js';
import { mountApi } from './api.js';
import { syncFromSite } from '../sync/from-site.js';
import { serveStatic } from './static.js';
import { refuseForeign } from './guard.js';
import { componentsState } from '../app/components.js';
import { CATALOG } from '../components/catalog.js';
import { packageDir } from '../components/describe.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

/**
 * Serve `/components/<pkg>/<path>` from VP's own node_modules, for catalog
 * packages only (fixture mode's counterpart of the app's
 * `/sites/<id>/components/...`); false when not served.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @returns {boolean}
 */
export function serveComponent(req, res) {
  let decoded;
  try { decoded = decodeURIComponent(new URL(req.url, 'http://local').pathname); } catch { return false; }
  if (!decoded.startsWith('/components/')) return false;
  const rest = decoded.slice('/components/'.length);
  const entry = CATALOG.find((e) => rest.startsWith(`${e.package}/`));
  if (!entry) return false;
  const found = packageDir(entry.package, { siteDir: null, vpRoot: ROOT });
  if (!found) return false;
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return serveStatic(req, res, [{ prefix: `/components/${entry.package}/`, dir: found.dir }]);
}

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
  // GET /api/components; fixture mode (no site) has every package on.
  mountApi(router, db, {
    rootDir: ROOT, mediaDir, workspace: ws,
    componentsState: () => componentsState({ siteDir: ws.siteDir, vpRoot: ROOT }),
  });

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
      // Refuse other sites' pages (CSRF) and rebound host names
      if (refuseForeign(req, res, server.address().port)) return;

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
      if (serveComponent(req, res)) return;
      if (serveStatic(req, res, staticMounts)) return;

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

  server.listen(port, '127.0.0.1', () => {
    console.log(`Vanilla Press dev server running at http://127.0.0.1:${port}/editor/`);
    console.log(`API: http://127.0.0.1:${port}/api/`);
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
