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
 * URLs, links, and the featured image.
 * @param {{ meta?: Object, blocks?: Array }} doc
 * @returns {Set<string>}
 */
export function mediaRefs(doc) {
  const found = new Set();
  const add = (url) => {
    const file = mediaFileOf(url);
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
 * @returns {Map<string, Array<{ id: string, title: string, status: string }>>}
 */
export function mediaUsage(docs) {
  const usage = new Map();
  for (const doc of docs) {
    for (const file of mediaRefs(doc)) {
      if (!usage.has(file)) usage.set(file, []);
      usage.get(file).push({ id: doc.id, title: doc.meta?.title ?? '', status: doc.meta?.status ?? 'draft' });
    }
  }
  return usage;
}
