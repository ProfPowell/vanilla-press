/**
 * API client for Vanilla Press editor.
 *
 * Thin fetch wrapper for all content API endpoints.
 * All methods return parsed JSON or throw on error.
 *
 * @module editor/api-client
 */

import { SITE, apiBase } from './site-context.js';

/** `/api/sites/<site>` in the app's editor (`?site=`), else `/api` (`vp serve`). */
const BASE = apiBase(SITE);

let workspacePromise = null;

/**
 * Make an API request.
 * @param {string} path
 * @param {Object} [options]
 * @returns {Promise<*>}
 */
async function request(path, options = {}) {
  const { method = 'GET', body, query } = options;

  let url = `${BASE}${path}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') {
        params.set(k, v);
      }
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const fetchOptions = { method };
  if (body !== undefined) {
    fetchOptions.headers = { 'Content-Type': 'application/json' };
    fetchOptions.body = JSON.stringify(body);
  }

  const res = await fetch(url, fetchOptions);
  const data = await parseBody(res);

  if (!res.ok) {
    const err = new Error(data.error || `API error ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

/**
 * Parse a response body as JSON. A non-JSON body (e.g. a text/plain 500)
 * becomes `{ error: <its text> }` when the response is an error.
 * @param {Response} res
 * @returns {Promise<*>}
 */
async function parseBody(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    if (res.ok) throw new Error(`API returned invalid JSON (${res.status})`);
    return { error: text.trim() || `API error ${res.status}` };
  }
}

export const api = {
  /** List documents, optionally filtered by collection and status. */
  listDocuments(collection, status) {
    return request('/documents', { query: { collection, status } });
  },

  /** Get a single document by ID. */
  getDocument(id) {
    return request(`/documents/${encodeURIComponent(id)}`);
  },

  /** Create a new document. */
  createDocument(doc) {
    return request('/documents', { method: 'POST', body: doc });
  },

  /** Update an existing document. */
  updateDocument(id, doc) {
    return request(`/documents/${encodeURIComponent(id)}`, { method: 'PUT', body: doc });
  },

  /** Replace the stored document with its version on disk (after a 409). */
  reloadDocument(id) {
    return request(`/documents/${encodeURIComponent(id)}/reload`, { method: 'POST' });
  },

  /** Which site is being edited: { site, syncEnabled, previewUrl }. Cached. */
  getWorkspace() {
    workspacePromise ||= request('/workspace');
    return workspacePromise;
  },

  /** Delete a document. */
  deleteDocument(id) {
    return request(`/documents/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  /** List all collection names. */
  listCollections() {
    return request('/collections');
  },

  /** Full-text search. */
  search(query) {
    return request('/search', { query: { q: query } });
  },

  /** Sync every document to the site. */
  syncAll() {
    return request('/sync', { method: 'POST' });
  },

  /** Upload a media file. */
  async uploadMedia(file, alt = '') {
    const form = new FormData();
    form.append('file', file);
    if (alt) form.append('alt', alt);

    const res = await fetch(`${BASE}/media`, { method: 'POST', body: form });
    const data = await parseBody(res);
    if (!res.ok) throw new Error(data.error || `Upload failed: ${res.status}`);
    return data;
  },

  /** List uploaded media. */
  listMedia() {
    return request('/media');
  },

  /** List available Vanilla Breeze themes: [{ id, name, tier, file }]. */
  listThemes() {
    return request('/themes');
  },

  /** Get a config value. Returns { key, value }. */
  getConfig(key) {
    return request(`/config/${encodeURIComponent(key)}`);
  },

  /** Set a config value. */
  setConfig(key, value) {
    return request(`/config/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: { value },
    });
  },

  /** Get all config as an object. */
  getAllConfig() {
    return request('/config');
  },

  // --- App only (per-site base, `?site=`) ---

  /** Publish: build, commit and push. { status: 'pushed'|'saved', url }; errors carry `data` (log, files). */
  publishDocument(id) {
    return request(`/documents/${encodeURIComponent(id)}/publish`, { method: 'POST' });
  },

  /** Unpublish: same shape as publishDocument. */
  unpublishDocument(id) {
    return request(`/documents/${encodeURIComponent(id)}/unpublish`, { method: 'POST' });
  },

  /** Whether the published page is live: { live, url }. */
  getLive(id) {
    return request(`/documents/${encodeURIComponent(id)}/live`);
  },

  /** Draft backup state: { pending, lastPushAt, error, connected }. */
  getStatus() {
    return request('/status');
  },

  /** Start (or reuse) the site's dev server: { url }. */
  startPreview() {
    return request('/preview', { method: 'POST' });
  },
};
