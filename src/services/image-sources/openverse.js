/**
 * Openverse: openly licensed images, no key. Only CC BY, CC0 and public-domain
 * marked works are searched.
 *
 * @module services/image-sources/openverse
 */

import { PER_PAGE, compactCredit, text } from './shared.js';

/**
 * @param {string} query
 * @param {{ page: number }} options
 * @returns {{ url: string, headers: Record<string, string> }}
 */
export function request(query, { page }) {
  const url = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page=${page}` +
    `&page_size=${PER_PAGE}&license=by,cc0,pdm&mature=false`;
  return { url, headers: {} };
}

/** 'wikimedia_commons' -> 'Wikimedia Commons'. */
function titleCase(id) {
  return text(id).split(/[_\s-]+/).filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1)).join(' ');
}

/** CC BY carries a license line; CC0 and the public-domain mark need none. */
function licenseOf(item) {
  if (item.license !== 'by') return { license: '', licenseUrl: '' };
  return { license: `CC BY ${text(item.license_version)}`, licenseUrl: item.license_url };
}

/**
 * @param {any} json
 * @param {{ page?: number }} [options]
 */
export function normalize(json, { page = json?.page ?? 1 } = {}) {
  const results = (json?.results || []).map((item) => ({
    source: 'openverse',
    id: String(item.id),
    mode: 'copy',
    thumb: item.thumbnail,
    url: item.url,
    width: item.width || 0,
    height: item.height || 0,
    description: text(item.title),
    credit: compactCredit({
      name: item.creator,
      url: item.creator_url,
      site: titleCase(item.source),
      siteUrl: item.foreign_landing_url,
      ...licenseOf(item),
    }),
  }));
  return { results, hasMore: page < (json?.page_count || 0) };
}
