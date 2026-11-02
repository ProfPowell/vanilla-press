/**
 * Output paths for synced documents (pure, no filesystem access).
 *
 * @module sync/paths
 */

/**
 * Resolve where a collection's HTML pages go and which layout they use.
 * Defaults: `{ path: c, layout: 'post' }`; `pages` is `{ path: '', layout: 'page' }`.
 * @param {string} collection
 * @param {Object<string, {path?: string, layout?: string}>} [collectionsConfig]
 * @returns {{ path: string, layout: string }}
 */
export function collectionOutput(collection, collectionsConfig = {}) {
  const isPages = collection === 'pages';
  const defaults = { path: isPages ? '' : collection, layout: isPages ? 'page' : 'post' };
  const override = (collectionsConfig && collectionsConfig[collection]) || {};
  return {
    path: typeof override.path === 'string' ? override.path : defaults.path,
    layout: typeof override.layout === 'string' && override.layout ? override.layout : defaults.layout,
  };
}

/**
 * Site-relative output paths for a document.
 * `html` is null unless the document is published.
 * @param {{ meta: { slug: string, collection: string, status: string } }} doc
 * @param {Object} [collectionsConfig]
 * @returns {{ json: string, html: string|null }}
 */
export function outputPaths(doc, collectionsConfig) {
  const { slug, collection, status } = doc.meta;
  const { path } = collectionOutput(collection, collectionsConfig);
  const dir = path.replace(/^\/+|\/+$/g, '');
  return {
    json: `content/${collection}/${slug}.json`,
    html: status === 'published' ? `src/${dir ? dir + '/' : ''}${slug}.html` : null,
  };
}
