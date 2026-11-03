/**
 * Minimal HTTP router for Vanilla Press dev server.
 *
 * Matches method + URL pattern (with :param captures).
 * Parses JSON request bodies for POST/PUT.
 *
 * @module server/router
 */

/**
 * Create a router.
 * @returns {{ add: Function, handle: Function }}
 */
export function createRouter() {
  const routes = [];

  /**
   * Register a route.
   * @param {string} method - HTTP method (GET, POST, PUT, DELETE)
   * @param {string} pattern - URL pattern with :param placeholders
   * @param {Function} handler - (req, res) => void
   */
  function add(method, pattern, handler) {
    const paramNames = [];
    const regex = pattern.replace(/:([^/]+)/g, (_, name) => {
      paramNames.push(name);
      return '([^/]+)';
    });
    routes.push({
      method: method.toUpperCase(),
      regex: new RegExp(`^${regex}$`),
      paramNames,
      handler,
    });
  }

  /**
   * Try to match and handle a request.
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @returns {Promise<boolean>} true if a route matched
   */
  async function handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;
    const method = req.method.toUpperCase();

    for (const route of routes) {
      if (route.method !== method) continue;
      const match = pathname.match(route.regex);
      if (!match) continue;

      // Extract params
      req.params = {};
      for (let i = 0; i < route.paramNames.length; i++) {
        req.params[route.paramNames[i]] = decodeURIComponent(match[i + 1]);
      }

      // Parse query string
      req.query = Object.fromEntries(url.searchParams);

      // Parse JSON body for POST/PUT. The media type must be exactly
      // application/json (parameters allowed) or multipart/form-data: a
      // CORS-safelisted type such as `text/plain;application/json` is refused,
      // so a cross-site form or fetch cannot smuggle a JSON body in.
      if (method === 'POST' || method === 'PUT') {
        const contentType = req.headers['content-type'] || '';
        const essence = contentType.split(';')[0].trim().toLowerCase();
        if (essence === 'application/json') {
          req.body = await readJsonBody(req);
        } else if (contentType && essence !== 'multipart/form-data') {
          sendJson(res, 415, { error: 'Unsupported content type: use application/json' });
          return true;
        }
      }

      await route.handler(req, res);
      return true;
    }

    return false;
  }

  return { add, handle };
}

/**
 * Read and parse a JSON request body.
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<Object>}
 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf-8');
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Read raw request body as Buffer.
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<Buffer>}
 */
export function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Send a JSON response.
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {*} data
 */
export function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}
