/**
 * Pexels: free photos, with a key sent in the Authorization header.
 *
 * @module services/image-sources/pexels
 */

import { PER_PAGE, compactCredit, fitWithin, text } from './shared.js';

/**
 * @param {string} query
 * @param {{ page: number, key: string }} options
 */
export function request(query, { page, key }) {
  return {
    url: `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&page=${page}&per_page=${PER_PAGE}`,
    headers: { Authorization: key },
  };
}

/**
 * `large2x` is the original fitted to 940x650 CSS px at 2x density.
 * @param {any} json
 */
export function normalize(json) {
  const results = (json?.photos || []).map((photo) => ({
    source: 'pexels',
    id: String(photo.id),
    mode: 'copy',
    thumb: photo.src?.medium,
    url: photo.src?.large2x,
    ...fitWithin(photo.width, photo.height, 940 * 2, 650 * 2),
    description: text(photo.alt),
    credit: compactCredit({
      name: photo.photographer,
      url: photo.photographer_url,
      site: 'Pexels',
      siteUrl: photo.url,
    }),
  }));
  return { results, hasMore: Boolean(json?.next_page) };
}
