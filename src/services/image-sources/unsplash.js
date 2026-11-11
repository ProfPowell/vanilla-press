/**
 * Unsplash: photos used by link only (hotlinked, never copied or edited), with a
 * key sent as `Client-ID`. Credit links carry Unsplash's referral UTM.
 *
 * @module services/image-sources/unsplash
 */

import { PER_PAGE, compactCredit, fitWithin, text } from './shared.js';

const UTM = 'utm_source=vanilla_press&utm_medium=referral';

/** A link with the referral UTM added. */
function withUtm(url) {
  const link = text(url);
  if (!link) return '';
  return `${link}${link.includes('?') ? '&' : '?'}${UTM}`;
}

/**
 * @param {string} query
 * @param {{ page: number, key: string }} options
 */
export function request(query, { page, key }) {
  return {
    url: `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&page=${page}&per_page=${PER_PAGE}`,
    headers: { Authorization: `Client-ID ${key}` },
  };
}

/**
 * The URL asks for at most 2400px wide (`fit=max` never scales up).
 * @param {any} json
 * @param {{ page?: number }} [options]
 */
export function normalize(json, { page = 1 } = {}) {
  const results = (json?.results || []).map((photo) => ({
    source: 'unsplash',
    id: String(photo.id),
    mode: 'link',
    thumb: photo.urls?.small,
    url: `${photo.urls?.raw}&w=2400&fit=max&q=80&auto=format`,
    ...fitWithin(photo.width, photo.height, 2400, Infinity),
    description: text(photo.alt_description) || text(photo.description),
    downloadLocation: photo.links?.download_location,
    credit: compactCredit({
      name: photo.user?.name,
      url: withUtm(photo.user?.links?.html),
      site: 'Unsplash',
      siteUrl: withUtm(photo.links?.html),
    }),
  }));
  return { results, hasMore: page < (json?.total_pages || 0) };
}
