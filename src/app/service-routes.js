/**
 * App-level routes for the Services screen: the catalog with each service's
 * state, a change to one service's key or switch, web image search, a
 * same-origin copy of a result's image, and Unsplash's download ping.
 * Responses carry only `hasKey`, never a key. The image and ping routes work
 * from a result this server's search cached, never from a URL a client sends.
 *
 * @module app/service-routes
 */

import { sendJson } from '../server/router.js';
import { SERVICES } from '../services/catalog.js';
import { servicesState, updateService, serviceKey } from '../services/store.js';
import { createImageSearch } from '../services/image-search.js';
import { inspectFile } from '../media/inspect.js';

const PURPOSES = new Set(['picker', 'library']);
const MAX_QUERY = 100;
const EXPIRED = 'Search again — this result has expired';
/** Unsplash asks for the ping; it should not hold up inserting the photo. */
const PING_TIMEOUT_MS = 5000;
/**
 * The image proxy never stores what it serves, so it takes a larger original
 * (60 MiB, 60 seconds) than an import (MAX_BYTES): the editor downsizes it to
 * 2,400px before it is uploaded.
 */
const PROXY_MAX_BYTES = 62_914_560;
const PROXY_TIMEOUT_MS = 60_000;

/**
 * @param {{ add: Function }} router
 * @param {{ env?: NodeJS.ProcessEnv, imageSearch?: ReturnType<typeof createImageSearch>,
 *   fetch?: typeof globalThis.fetch, now?: () => number, timeoutMs?: number }} context
 *   imageSearch: the app's shared instance; without one, one is made from fetch, now and timeoutMs.
 *   fetch also sends the Unsplash download ping.
 */
export function mountServiceRoutes(router, {
  env = process.env,
  fetch = globalThis.fetch,
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

  // The bytes of a cached copy-mode result, from this origin (the editor can draw them
  // on a canvas). The type is what the bytes are, never what the remote claims, and the
  // response may not run anything.
  router.add('GET', '/api/web-images/:source/:id/image', async (req, res) => {
    const { source, id } = req.params;
    const item = imageSearch.get(source, id);
    if (!item) return sendJson(res, 404, { error: EXPIRED });
    if (item.mode !== 'copy') return sendJson(res, 400, { error: 'This image is used by link only; load it from its own URL' });
    let data;
    try {
      ({ data } = await imageSearch.image(source, id, { maxBytes: PROXY_MAX_BYTES, timeoutMs: PROXY_TIMEOUT_MS }));
    } catch (err) {
      return sendJson(res, err.status || 502, { error: err.message });
    }
    const info = inspectFile(data, '');
    if (!info || info.kind !== 'image') return sendJson(res, 415, { error: 'The service sent something that is not an image' });
    res.writeHead(200, {
      'Content-Type': info.mime,
      'Content-Length': data.length,
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    });
    res.end(data);
  });

  // Unsplash's guidelines: inserting a photo pings its download_location, with the key.
  // The key is sent only to api.unsplash.com and never appears in a response or a log.
  router.add('POST', '/api/web-images/unsplash/:id/download', async (req, res) => {
    const item = imageSearch.get('unsplash', req.params.id);
    if (!item || !item.downloadLocation) return sendJson(res, 404, { error: EXPIRED });
    let target;
    try {
      target = new URL(item.downloadLocation);
    } catch {
      return sendJson(res, 404, { error: EXPIRED });
    }
    if (target.protocol !== 'https:' || target.hostname !== 'api.unsplash.com') {
      return sendJson(res, 404, { error: EXPIRED });
    }
    const key = serviceKey('unsplash', env);
    if (!key) return sendJson(res, 409, { error: 'Unsplash has no key; add it under Services' });
    let ok = false;
    try {
      const answer = await fetch(target.href, {
        headers: { Authorization: `Client-ID ${key}` },
        signal: AbortSignal.timeout(PING_TIMEOUT_MS),
      });
      ok = answer.ok;
    } catch { /* reported below, without the error: it could carry the request */ }
    if (!ok) return sendJson(res, 502, { error: "Unsplash couldn't be told about the download" });
    res.writeHead(204);
    res.end();
  });
}
