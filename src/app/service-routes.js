/**
 * App-level routes for the Services screen: the catalog with each service's
 * state, a change to one service's key or switch, and web image search.
 * Responses carry only `hasKey`, never a key.
 *
 * @module app/service-routes
 */

import { sendJson } from '../server/router.js';
import { SERVICES } from '../services/catalog.js';
import { servicesState, updateService } from '../services/store.js';
import { createImageSearch } from '../services/image-search.js';

const PURPOSES = new Set(['picker', 'library']);
const MAX_QUERY = 100;

/**
 * @param {{ add: Function }} router
 * @param {{ env?: NodeJS.ProcessEnv, imageSearch?: ReturnType<typeof createImageSearch>,
 *   fetch?: typeof globalThis.fetch, now?: () => number, timeoutMs?: number }} context
 *   imageSearch: the app's shared instance; without one, one is made from fetch, now and timeoutMs.
 */
export function mountServiceRoutes(router, {
  env = process.env,
  fetch,
  now,
  timeoutMs,
  imageSearch = createImageSearch({ env, fetch, now, timeoutMs }),
} = {}) {
  router.add('GET', '/api/services', (req, res) => sendJson(res, 200, servicesState(env)));

  router.add('PUT', '/api/services/:id', (req, res) => {
    const { id } = req.params;
    if (!SERVICES.some((s) => s.id === id)) return sendJson(res, 404, { error: 'Unknown service' });
    const body = req.body;
    const { key, enabled } = body || {};
    const bad = !body || typeof body !== 'object' || Array.isArray(body) ||
      (key !== undefined && key !== null && typeof key !== 'string') ||
      (enabled !== undefined && typeof enabled !== 'boolean');
    if (bad) return sendJson(res, 400, { error: 'Expected { key?: string|null, enabled?: boolean }' });
    sendJson(res, 200, updateService(id, { key, enabled }, env));
  });

  router.add('GET', '/api/web-images', async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    if (!q) return sendJson(res, 400, { error: 'Type something to search for' });
    // Pixabay refuses a longer query, and each distinct query is a cache entry.
    if (q.length > MAX_QUERY) return sendJson(res, 400, { error: `Search for something shorter (${MAX_QUERY} characters at most)` });
    const purpose = req.query.for || 'picker';
    if (!PURPOSES.has(purpose)) return sendJson(res, 400, { error: "for must be 'picker' or 'library'" });
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    sendJson(res, 200, await imageSearch.search(q, { page, for: purpose }));
  });
}
