/**
 * Pixabay: free photos, with a key sent as a query parameter. The key is in the
 * request URL, so that URL must never be logged or shown.
 *
 * @module services/image-sources/pixabay
 */

import { PER_PAGE, compactCredit, fitWithin, text } from './shared.js';

/**
 * @param {string} query
 * @param {{ page: number, key: string }} options
 */
export function request(query, { page, key }) {
  return {
    url: `https://pixabay.com/api/?key=${encodeURIComponent(key)}&q=${encodeURIComponent(query)}` +
      `&page=${page}&per_page=${PER_PAGE}&image_type=photo&safesearch=true`,
    headers: {},
  };
}

/**
 * `largeImageURL` is the original scaled to at most 1280px on the long edge.
 * @param {any} json
 * @param {{ page?: number }} [options]
 */
export function normalize(json, { page = 1 } = {}) {
  const results = (json?.hits || []).map((hit) => ({
    source: 'pixabay',
    id: String(hit.id),
    mode: 'copy',
    thumb: hit.webformatURL,
    url: hit.largeImageURL,
    ...fitWithin(hit.imageWidth, hit.imageHeight, 1280, 1280),
    description: text(hit.tags),
    credit: compactCredit({
      name: hit.user,
      url: hit.user ? `https://pixabay.com/users/${text(hit.user)}-${hit.user_id}/` : '',
      site: 'Pixabay',
      siteUrl: hit.pageURL,
    }),
  }));
  return { results, hasMore: page * PER_PAGE < (json?.totalHits || 0) };
}
