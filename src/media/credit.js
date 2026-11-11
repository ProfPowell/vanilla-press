/**
 * Image credits: who made a photo, where it came from and under what license.
 * Pure (no imports), so the editor loads it from `/src/media/credit.js` too.
 *
 * A credit's links end up as `href`s in published pages, so a link with a
 * scheme other than http or https is never kept.
 *
 * @module media/credit
 */

/**
 * @typedef {{ name?: string, url?: string, site?: string, siteUrl?: string,
 *   license?: string, licenseUrl?: string, adapted?: boolean }} Credit
 */

/** The string keys, in the order a credit keeps them. */
const STRING_KEYS = ['name', 'url', 'site', 'siteUrl', 'license', 'licenseUrl'];
const TEXT_KEYS = ['name', 'site', 'license'];
const LINK_KEYS = ['url', 'siteUrl', 'licenseUrl'];
const KEYS = new Set([...STRING_KEYS, 'adapted']);

/** Where a library image's credit came from: a web image service, or written by hand. */
export const MEDIA_SOURCES = ['openverse', 'pexels', 'pixabay', 'manual'];

/**
 * The media source `x` names, or null.
 * @param {unknown} x
 * @returns {string|null}
 */
export const mediaSource = (x) => (MEDIA_SOURCES.includes(x) ? x : null);

const isPlainObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

/**
 * Whether a link is safe as an href: http(s), or no scheme at all. Browsers
 * ignore tabs, newlines and leading controls in a URL, so those are removed first.
 */
function safeLink(value) {
  const bare = value.replace(/[\u0000-\u0020\u007f]/g, '');
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(bare);
  return !scheme || /^https?$/i.test(scheme[1]);
}

/**
 * A credit with strings trimmed and empty strings, unknown keys, unsafe links
 * and `adapted: false` dropped; null when nothing is left to show. A JSON
 * string is read first.
 * @param {unknown} x
 * @returns {Credit|null}
 */
export function normalizeCredit(x) {
  let value = x;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!isPlainObject(value)) return null;
  /** @type {Credit} */
  const credit = {};
  for (const key of STRING_KEYS) {
    const field = value[key];
    if (typeof field !== 'string') continue;
    const trimmed = field.trim();
    if (!trimmed) continue;
    if (LINK_KEYS.includes(key) && !safeLink(trimmed)) continue;
    credit[key] = trimmed;
  }
  if (!TEXT_KEYS.some((key) => key in credit)) return null;
  if (value.adapted === true) credit.adapted = true;
  return credit;
}

/**
 * A credit as the media table keeps it: normalized JSON text, or null.
 * @param {unknown} x
 * @returns {string|null}
 */
export function storedCredit(x) {
  const credit = normalizeCredit(x);
  return credit ? JSON.stringify(credit) : null;
}

/**
 * Whether `x` is a credit as a client may send one: an object with only known
 * keys of the right types, safe links, and something to show.
 * @param {unknown} x
 * @returns {boolean}
 */
export function validCredit(x) {
  if (!isPlainObject(x)) return false;
  for (const [key, value] of Object.entries(x)) {
    if (!KEYS.has(key)) return false;
    if (key === 'adapted') {
      if (typeof value !== 'boolean') return false;
    } else if (typeof value !== 'string') {
      return false;
    } else if (LINK_KEYS.includes(key) && value.trim() && !safeLink(value.trim())) {
      return false;
    }
  }
  return normalizeCredit(x) !== null;
}

/**
 * The credit line as text and links: `Photo by {name}` then ` on {site}`, or
 * `Photo from {site}` with no name; then `, {license}` and `, adapted`. Every
 * part with a link carries `href`; neighbouring plain parts are joined.
 * @param {unknown} credit
 * @returns {Array<{ text: string, href?: string }>}
 */
export function creditParts(credit) {
  const c = normalizeCredit(credit);
  if (!c) return [];
  const parts = [];
  const add = (text, href) => {
    const last = parts[parts.length - 1];
    if (!href && last && !last.href) last.text += text;
    else parts.push(href ? { text, href } : { text });
  };
  if (c.name) {
    add('Photo by ');
    add(c.name, c.url);
    if (c.site) {
      add(' on ');
      add(c.site, c.siteUrl);
    }
  } else if (c.site) {
    add('Photo from ');
    add(c.site, c.siteUrl);
  }
  if (c.license) {
    if (parts.length) add(', ');
    add(c.license, c.licenseUrl);
  }
  if (c.adapted) add(', adapted'); // a credit always has a name, site or license before this
  return parts;
}

/**
 * The credit line as plain text.
 * @param {unknown} credit
 * @returns {string}
 */
export function creditText(credit) {
  return creditParts(credit).map((part) => part.text).join('');
}
