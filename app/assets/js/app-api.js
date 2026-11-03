/**
 * Small fetch wrapper for the app API. Throws Error(message) using the server's
 * `{ error }` text when there is one.
 * @module app-api
 */

/**
 * @param {string} path - e.g. `/api/sites`
 * @param {{ method?: string, body?: unknown }} [options]
 * @returns {Promise<any>} parsed JSON
 */
export async function api(path, { method = 'GET', body } = {}) {
  const init = { method };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, init);
  } catch {
    throw new Error('Cannot reach the Vanilla Press app. Is it still running?');
  }
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

/**
 * Create an element with attributes and children (strings become text nodes).
 * @param {string} tag
 * @param {Object<string, string|boolean>} [attrs]
 * @param {...(Node|string|null)} children
 * @returns {HTMLElement}
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children) if (c != null) el.append(c);
  return el;
}

/** Local date like "Nov 2, 2026" from an ISO string. */
export function formatDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
