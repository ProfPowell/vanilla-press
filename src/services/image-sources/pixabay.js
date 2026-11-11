/**
 * Pixabay: free photos, with a key sent as a query parameter. The key is in the
 * request URL, so that URL must never be logged or shown.
 *
 * @module services/image-sources/pixabay
 */

import { PER_PAGE, compactCredit, fitWithin, text, withUrl } from './shared.js';

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
 * Pixabay answers a wrong or missing key with HTTP 400 and
 * "[ERROR 400] Invalid or missing API key", not 401.
 * @param {number} status
 * @param {string} body
 */
export function isKeyError(status, body) {
  return status === 400 && /api key/i.test(body);
}

/** The user's profile page, which needs both the name and the numeric id. */
function profileUrl(hit) {
  const user = text(hit.user);
  const userId = hit.user_id;
  if (!user || userId === undefined || userId === null || userId === '') return '';
  return `https://pixabay.com/users/${encodeURIComponent(user)}-${encodeURIComponent(userId)}/`;
}

/**
 * `largeImageURL` is the original scaled to at most 1280px on the long edge.
 * @param {any} json
 * @param {{ page?: number }} [options]
 */
export function normalize(json, { page = 1 } = {}) {
  const results = withUrl((json?.hits || []).map((hit) => ({
    source: 'pixabay',
    id: String(hit.id),
    mode: 'copy',
    thumb: hit.webformatURL,
    url: text(hit.largeImageURL),
    ...fitWithin(hit.imageWidth, hit.imageHeight, 1280, 1280),
    description: text(hit.tags),
    credit: compactCredit({
      name: hit.user,
      url: profileUrl(hit),
      site: 'Pixabay',
      siteUrl: hit.pageURL,
    }),
  })));
  return { results, hasMore: page * PER_PAGE < (json?.totalHits || 0) };
}
