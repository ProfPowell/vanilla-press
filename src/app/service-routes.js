/**
 * App-level routes for the Services screen: the catalog with each service's
 * state, and a change to one service's key or switch. Responses carry only
 * `hasKey`, never a key.
 *
 * @module app/service-routes
 */

import { sendJson } from '../server/router.js';
import { SERVICES } from '../services/catalog.js';
import { servicesState, updateService } from '../services/store.js';

/**
 * @param {{ add: Function }} router
 * @param {{ env?: NodeJS.ProcessEnv }} context
 */
export function mountServiceRoutes(router, { env = process.env } = {}) {
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
}
