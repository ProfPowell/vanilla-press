/**
 * Request guard for the local servers. Binding to 127.0.0.1 alone does not
 * stop a web page in the user's browser from sending requests to us (CSRF),
 * or a rebound DNS name from reading our responses. So:
 *
 * - the Host header must be `127.0.0.1:<port>` or `localhost:<port>` (DNS rebinding);
 * - a request other than GET/HEAD/OPTIONS must have no Origin, or our own (CSRF).
 *
 * - an `/api/` request the browser marks `Sec-Fetch-Site: cross-site` or `same-site` is
 *   refused: a program served from another port of this machine is same-site, and must
 *   not reach the API (absent, `same-origin` and `none` pass; pages are not the API).
 *
 * Strict JSON content types are enforced in the router (see router.js).
 *
 * @module server/guard
 */

const API_PREFIX = '/api/';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** @param {number} port */
function allowedHosts(port) {
  return [`127.0.0.1:${port}`, `localhost:${port}`];
}

/**
 * Whether a request may be handled.
 * @param {{ method?: string, url?: string, headers: Object<string, string|undefined> }} req
 * @param {number} port - the port the server is bound to
 * @returns {boolean}
 */
export function checkRequest(req, port) {
  const hosts = allowedHosts(port);
  const host = String(req.headers.host || '').toLowerCase();
  if (!hosts.includes(host)) return false;
  if (String(req.url || '').startsWith(API_PREFIX)) {
    const site = String(req.headers['sec-fetch-site'] || '').toLowerCase();
    if (site === 'cross-site' || site === 'same-site') return false;
  }
  const method = String(req.method || 'GET').toUpperCase();
  if (SAFE_METHODS.has(method)) return true;
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  return hosts.some((h) => String(origin).toLowerCase() === `http://${h}`);
}

/**
 * Respond 403 `{ error: 'Forbidden' }` and return true when the request is refused.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {number} port
 * @returns {boolean}
 */
export function refuseForeign(req, res, port) {
  if (checkRequest(req, port)) return false;
  const body = JSON.stringify({ error: 'Forbidden' });
  res.writeHead(403, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
  return true;
}
