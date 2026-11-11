// Which posts use which media files. Pure and browser-safe.

/**
 * The decoded `<file>` of a `/media/<file>` URL (query and hash ignored), or null.
 * @param {unknown} url
 * @returns {string|null}
 */
export function mediaFileOf(url) {
  if (typeof url !== 'string' || !url.startsWith('/media/')) return null;
  const path = url.slice('/media/'.length).split(/[?#]/)[0];
  if (!path || path.includes('/')) return null;
  try {
    return decodeURIComponent(path);
  } catch {
    return null;
  }
}

/**
 * The `/media/<file>` URL of a library file, with the name percent-encoded so
 * `#`, `%`, `?` and spaces survive (a slugged name is unchanged).
 * @param {string} filename
 * @returns {string}
 */
export function mediaSrc(filename) {
  return `/media/${encodeURIComponent(filename)}`;
}

/**
 * A linked item's remote URL, parsed: https on images.unsplash.com, with no
 * user, password or port. Null for anything else.
 * @param {unknown} url
 * @returns {URL|null}
 */
export function linkedUrl(url) {
  if (typeof url !== 'string' || url === '') return null;
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.hostname !== 'images.unsplash.com' || u.username || u.password || u.port) return null;
  return u;
}

/**
 * What identifies a linked photo: its origin and path. The query (Unsplash's
 * `ixid`, size and format) differs between searches of the same photo.
 * @param {unknown} url
 * @returns {string|null}
 */
export function linkedKey(url) {
  const u = linkedUrl(url);
  return u ? u.origin + u.pathname : null;
}

/**
 * Linked items for `mediaRefs`/`mediaUsage`: linkedKey -> filename.
 * @param {Iterable<[string, string]>} pairs [remote URL, filename]
 * @returns {Map<string, string>}
 */
export function linkedIndex(pairs) {
  const index = new Map();
  for (const [url, filename] of pairs) {
    const key = linkedKey(url);
    if (key && !index.has(key)) index.set(key, filename);
  }
  return index;
}

/**
 * The URL a post uses for a library item: a linked item's remote URL (an
 * Unsplash photo has no file), else its `/media/<file>` URL.
 * @param {{ filename: string, linked?: boolean, src?: string }} item MediaItem
 * @returns {string}
 */
export function mediaItemSrc(item) {
  return item.linked ? item.src : mediaSrc(item.filename);
}

/** Attribute names that can hold a media URL, by node type. */
const URL_ATTRS = {
  figure: ['src'],
  embed: ['url'],
  component: ['src', 'poster'],
  link: ['href'],
  card: ['href'],
};

/**
 * Every media file a document refers to: figure and component sources, embed
 * URLs, links, and the featured image. A linked library item (a remote image,
 * no file) counts where the same photo is used (same `linkedKey`), by its filename.
 * @param {{ meta?: Object, blocks?: Array }} doc
 * @param {{ linked?: Map<string, string> }} [options] linked items, from `linkedIndex`
 * @returns {Set<string>}
 */
export function mediaRefs(doc, { linked } = {}) {
  const found = new Set();
  const add = (url) => {
    const file = mediaFileOf(url) ?? (linked ? linked.get(linkedKey(url)) : null);
    if (file) found.add(file);
  };
  const walk = (node) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== 'object') return;
    for (const attr of URL_ATTRS[node.type] || []) add(node.attrs?.[attr]);
    if (node.children) walk(node.children);
  };
  add(doc?.meta?.image);
  walk(doc?.blocks);
  return found;
}

/**
 * @param {Array<{ id: string, meta: Object, blocks: Array }>} docs
 * @param {{ linked?: Map<string, string> }} [options] linked items, from `linkedIndex`
 * @returns {Map<string, Array<{ id: string, title: string, status: string }>>}
 */
export function mediaUsage(docs, options) {
  const usage = new Map();
  for (const doc of docs) {
    for (const file of mediaRefs(doc, options)) {
      if (!usage.has(file)) usage.set(file, []);
      usage.get(file).push({ id: doc.id, title: doc.meta?.title ?? '', status: doc.meta?.status ?? 'draft' });
    }
  }
  return usage;
}

/** HTML attributes whose value can be a media URL in a page. */
const HTML_URL_ATTR = /(?:^|[\s"'/])(src|href|poster|content|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;

const ENTITIES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };
/** Decode the character references an attribute value may hold. */
export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, ref) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      try { return String.fromCodePoint(code); } catch { return m; }
    }
    return ENTITIES[ref.toLowerCase()] ?? m;
  });
}

/**
 * Every media file an HTML page (as committed: front matter and markup) refers
 * to: `/media/<file>` in src, href, poster, content and srcset attributes, and
 * any front matter value (the featured image). External URLs and text are ignored.
 * @param {unknown} html
 * @returns {Set<string>}
 */
export function liveMediaRefs(html) {
  const found = new Set();
  if (typeof html !== 'string') return found;
  const add = (url) => {
    const file = mediaFileOf(url.trim());
    if (file) found.add(file);
  };
  let body = html;
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(html);
  if (fm) {
    body = html.slice(fm[0].length);
    for (const line of fm[1].split(/\r?\n/)) {
      const m = /^[\w-]+:[ \t]*(.*?)[ \t]*$/.exec(line);
      if (!m) continue;
      let value = m[1];
      if (value.startsWith('"')) {
        try { value = JSON.parse(value); } catch { continue; }
      } else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
      if (typeof value === 'string') add(value);
    }
  }
  for (const m of body.matchAll(HTML_URL_ATTR)) {
    const value = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
    if (m[1].toLowerCase() === 'srcset') {
      for (const candidate of value.split(',')) add(candidate.trim().split(/\s+/)[0] || '');
    } else add(value);
  }
  return found;
}
