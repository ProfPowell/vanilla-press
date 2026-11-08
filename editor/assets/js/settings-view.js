/**
 * What the Post settings panel shows: the publishing status box, the
 * Collection choices, the URL prefix and the Featured image. Pure (no DOM), for meta-panel.js.
 *
 * @module editor/settings-view
 */

import { collectionOutput } from '../../../src/sync/paths.js';
import { mediaFileOf } from '../../../src/media/usage.js';

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
  const day = publishedDay(meta, locale);
  return { title: `Published${day ? ` ${day}` : ''}`, note: liveOutOfDate ? NOT_LIVE_NOTE : null };
}

/**
 * The post's published day, e.g. "Nov 3, 2026", or '' without a valid date.
 * A date-only value ("2026-11-03", as imported front matter gives) is the
 * written calendar day in every time zone; a timestamp is shown in local time.
 * @param {{ published?: string }} meta
 * @param {string} [locale] - the browser's by default
 * @returns {string}
 */
export function publishedDay(meta, locale) {
  const value = meta?.published;
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(String(value));
  return date.toLocaleDateString(locale, {
    year: 'numeric', month: 'short', day: 'numeric', ...(dateOnly ? { timeZone: 'UTC' } : {}),
  });
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

/**
 * The Featured image field: whether the post has one, its URL and the name to show
 * (the file name for `/media/<file>`, else the URL).
 * @param {{ image?: string|null }} meta
 * @returns {{ set: boolean, src: string|null, name: string|null }}
 */
export function featuredModel(meta) {
  const src = meta?.image;
  if (typeof src !== 'string' || !src) return { set: false, src: null, name: null };
  return { set: true, src, name: mediaFileOf(src) || src };
}
