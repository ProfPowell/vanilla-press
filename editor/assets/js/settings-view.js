/**
 * What the Post settings panel shows: the publishing status box, the
 * Collection choices and the URL prefix. Pure (no DOM), for meta-panel.js.
 *
 * @module editor/settings-view
 */

import { collectionOutput } from '../../../src/sync/paths.js';

const NOT_LIVE_NOTE = "Your saved edits aren't on the live site yet. Update builds the site and pushes them.";
const DRAFT_NOTE = 'Publish builds the site and puts this post live.';

/**
 * The status box: "Published Nov 3, 2026" (with the not-live note while a
 * published post's saved edits wait for Update), or "Draft".
 * @param {{ status?: string, published?: string }} meta
 * @param {{ liveOutOfDate: boolean, locale?: string }} options - locale: the browser's by default
 * @returns {{ title: string, note: string|null }}
 */
export function statusBox(meta, { liveOutOfDate, locale } = {}) {
  if (meta?.status !== 'published') return { title: 'Draft', note: DRAFT_NOTE };
  const date = meta.published ? new Date(meta.published) : null;
  const day = date && !Number.isNaN(date.getTime())
    ? ` ${date.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' })}`
    : '';
  return { title: `Published${day}`, note: liveOutOfDate ? NOT_LIVE_NOTE : null };
}

/**
 * The Collection select's options: the site's `collections` config names in
 * order, plus `current` when the config doesn't list it.
 * @param {Object|null|undefined} collectionsConfig
 * @param {string} current
 * @returns {string[]}
 */
export function collectionOptions(collectionsConfig, current) {
  const names = collectionsConfig && typeof collectionsConfig === 'object' ? Object.keys(collectionsConfig) : [];
  return current && !names.includes(current) ? [...names, current] : names;
}

/**
 * The URL before the slug: `/<collection>/`, the collection's configured
 * `path` when it sets one, `/` for pages (postUrlPath's rule).
 * @param {string} collection
 * @param {Object} [collectionsConfig]
 * @returns {string}
 */
export function urlPrefix(collection, collectionsConfig) {
  const dir = collectionOutput(collection, collectionsConfig || {}).path.replace(/^\/+|\/+$/g, '');
  return `/${dir ? dir + '/' : ''}`;
}
