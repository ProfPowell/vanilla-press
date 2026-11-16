/**
 * Small fetch wrapper for the app API. Throws Error(message) using the server's
 * `{ error }` text when there is one; the error also carries `status` and `data`.
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
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data; // the whole refusal body, for callers that need more than the message
    throw err;
  }
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

/** Component packages for a site: `{ cookSupportsPackages, packages }`. */
export function listComponents(siteId) {
  return api(`/api/sites/${encodeURIComponent(siteId)}/components`);
}

/**
 * Turn a package on or off. Resolves `{ status, body }` for any HTTP response so callers can
 * classify refusals (409 in use / dirty, 502 npm); throws only when the app is unreachable.
 */
export async function setComponent(siteId, pkg, enabled) {
  let res;
  try {
    res = await fetch(`/api/sites/${encodeURIComponent(siteId)}/components/${encodeURIComponent(pkg)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
  } catch {
    throw new Error('Cannot reach the Vanilla Press app. Is it still running?');
  }
  let body = null;
  try { body = await res.json(); } catch { /* no body */ }
  return { status: res.status, body };
}

const layoutPath = (siteId, kind, name) =>
  `/api/sites/${encodeURIComponent(siteId)}/layout-files/${encodeURIComponent(kind)}/${encodeURIComponent(name)}`;

/** Layouts and includes of a site: `{ supported, message, layouts, includes }`. */
export function listLayoutFiles(siteId) {
  return api(`/api/sites/${encodeURIComponent(siteId)}/layout-files`);
}

/** One editable layout or include: `{ tree, hash, problems }`. Throws (status 409) when it can't be edited here. */
export function readLayoutFile(siteId, kind, name) {
  return api(layoutPath(siteId, kind, name));
}

/** Save a tree; `hash` is the one read at open (null for a new file). Resolves `{ hash }`. */
export function saveLayoutFile(siteId, kind, name, { tree, hash }) {
  return api(layoutPath(siteId, kind, name), { method: 'PUT', body: { tree, hash } });
}

/** Create from `start: { type: 'child'|'copy'|'blank', from? }`. Resolves `{ name, hash }`. */
export function createLayoutFile(siteId, { kind, name, label, start }) {
  return api(`/api/sites/${encodeURIComponent(siteId)}/layout-files`, { method: 'POST', body: { kind, name, label, start } });
}

/** Delete an unused layout or include; a 409 error carries `data.usedBy` and `data.baseFor`. */
export function deleteLayoutFile(siteId, kind, name) {
  return api(layoutPath(siteId, kind, name), { method: 'DELETE' });
}

/**
 * Publish layout files: commit and push the named ones (always explicit names).
 * Resolves `{ status: 'pushed'|'saved', sha }`; a refusal carries `status` and `data`
 * (409 `{ problems }`, 502 `{ committed: true }`).
 */
export function publishLayoutFiles(siteId, files) {
  return api(`/api/sites/${encodeURIComponent(siteId)}/layout-files/publish`, { method: 'POST', body: { files } });
}

const socialBase = (siteId) => `/api/sites/${encodeURIComponent(siteId)}/social`;

/** The stored accounts: `{ accounts, cookReady, needsCook }`. */
export function getSocial(siteId) {
  return api(socialBase(siteId));
}

/** Every stored account checked again: `{ results }`. Never writes. */
export function recheckSocial(siteId) {
  return api(`${socialBase(siteId)}/recheck`);
}

/** Check one new account: `{ service, status, handle, displayName?, avatar?, message? }`. */
export function checkSocial(siteId, service, input) {
  return api(`${socialBase(siteId)}/check`, { method: 'POST', body: { service, input } });
}

/** Save the whole list: `{ accounts, committed, note? }`. */
export function saveSocial(siteId, accounts, saveUnchecked = false) {
  return api(`${socialBase(siteId)}/accounts`, { method: 'PUT', body: { accounts, ...(saveUnchecked ? { saveUnchecked: true } : {}) } });
}

/** The rendered list for the editor preview: `{ html }`. */
export function socialLinksPreview(siteId, services, variant) {
  const q = new URLSearchParams();
  if (services) q.set('services', services);
  if (variant) q.set('variant', variant);
  return api(`${socialBase(siteId)}/links${q.size ? `?${q}` : ''}`);
}

/** Save the About section (null removes it): `{ about, committed, note? }`. */
export function saveAbout(siteId, about) {
  return api(`${socialBase(siteId)}/about`, { method: 'PUT', body: { about } });
}

/** Save the Contact section (null removes it): `{ contact, committed, note? }`. */
export function saveContact(siteId, contact) {
  return api(`${socialBase(siteId)}/contact`, { method: 'PUT', body: { contact } });
}

/** Save the whole Following list: `{ following, committed, note? }`. */
export function saveFollowing(siteId, following) {
  return api(`${socialBase(siteId)}/following`, { method: 'PUT', body: { following } });
}

/** The About Markdown rendered on the server the way the build renders it: `{ html }`. 409 when the site's packages are not installed. */
export function previewAbout(siteId, body) {
  return api(`${socialBase(siteId)}/about/preview`, { method: 'POST', body: { body } });
}

/** Merge an OPML file's text into the list: `{ following, added, skipped, unchanged, committed, note? }`. */
export function importOpml(siteId, opml) {
  return api(`${socialBase(siteId)}/following/import`, { method: 'POST', body: { opml } });
}

/** Where the OPML export downloads from. */
export function followingOpmlUrl(siteId) {
  return `${socialBase(siteId)}/following.opml`;
}
