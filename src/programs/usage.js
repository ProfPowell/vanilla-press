// Where a program is used: saved posts and committed pages that link to
// /<area>/<slug>, with or without the trailing slash, or to any file inside it.
// Remove is refused while a program is used.
import { decodeEntities } from '../media/usage.js';
import { createLiveMedia } from '../app/live-media.js';
import { SLUG } from './config.js';

/** href and src attribute values in a page. */
const URL_ATTR = /(?:^|[\s"'/])(href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;

/** The site path of a URL that points into this site, or null. */
function sitePath(url, siteHost) {
  if (url.startsWith('/') && !url.startsWith('//')) return url;
  if (!siteHost) return null;
  let parsed;
  try {
    parsed = new URL(url.startsWith('//') ? `https:${url}` : url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return parsed.host === siteHost ? parsed.pathname : null;
}

/**
 * The `'<area>/<slug>'` keys of every href or src in a page that points at
 * `/<area>/<slug>`, `/<area>/<slug>/` or a file inside it.
 * @param {unknown} html
 * @param {{ areas?: string[], siteHost?: string|null }} [options] - areas: only these
 *   (default: any); siteHost: absolute URLs on this host count too
 * @returns {Set<string>}
 */
export function programRefs(html, { areas, siteHost } = {}) {
  const found = new Set();
  if (typeof html !== 'string') return found;
  const only = areas ? new Set(areas) : null;
  for (const m of html.matchAll(URL_ATTR)) {
    const path = sitePath(decodeEntities(m[2] ?? m[3] ?? m[4] ?? '').trim(), siteHost);
    if (!path) continue;
    const [area, slug] = path.split(/[?#]/)[0].split('/').slice(1, 3);
    if (!area || !slug || !SLUG.test(area) || !SLUG.test(slug)) continue;
    if (only && !only.has(area)) continue;
    found.add(`${area}/${slug}`);
  }
  return found;
}

/**
 * The posts and pages that use a program, one entry each: a saved post by its title
 * (also when only its committed page still links it), any other committed page by its
 * path. The program's own pages don't count.
 * @param {{ docs: Array<{ id: string, title: string, path: string, html: string }>,
 *   live: Map<string, Array<{ path: string, vpId: string|null }>>,
 *   area: string, slug: string, siteHost?: string|null }} input - docs: saved documents with
 *   their rendered bodies; live: createLiveMedia's map with programRefs keys
 * @returns {Array<{ title: string, path: string }>}
 */
export function programUsage({ docs, live, area, slug, siteHost = null }) {
  const key = `${area}/${slug}`;
  const own = `src/${area}/${slug}/`;
  const out = [];
  const listed = new Set();
  const add = (title, path, docId) => {
    const id = docId || path;
    if (listed.has(id)) return;
    listed.add(id);
    out.push({ title, path });
  };
  for (const doc of docs) {
    if (programRefs(doc.html, { siteHost }).has(key)) add(doc.title, doc.path, doc.id);
  }
  const byId = new Map(docs.map((d) => [d.id, d]));
  for (const { path, vpId } of live.get(key) || []) {
    if (path.startsWith(own)) continue;
    const doc = vpId ? byId.get(vpId) : null;
    if (doc) add(doc.title, doc.path, doc.id);
    else add(path, path, null);
  }
  return out;
}

/**
 * The committed pages' program links, for one site: a function of the site's host
 * answering the live map (createLiveMedia with programRefs). A new host starts a new map.
 * @param {string} siteDir
 * @param {import('../app/live-media.js').LiveMediaGit} git
 * @returns {(siteHost: string|null) => Promise<Map<string, Array<{ path: string, vpId: string|null }>>>}
 */
export function createLivePrograms(siteDir, git) {
  let current = null; // { siteHost, live }
  return (siteHost) => {
    if (!current || current.siteHost !== siteHost) {
      current = { siteHost, live: createLiveMedia(siteDir, git, { refs: (html) => programRefs(html, { siteHost }) }) };
    }
    return current.live();
  };
}
