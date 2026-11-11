/**
 * Helpers the image-search adapters share.
 *
 * @module services/image-sources/shared
 */

/** Results asked for per page, from every source. */
export const PER_PAGE = 20;

/**
 * A credit with every string trimmed and every empty value left out.
 * @param {Record<string, unknown>} fields
 * @returns {{ name?: string, url?: string, site?: string, siteUrl?: string,
 *   license?: string, licenseUrl?: string, adapted?: boolean }}
 */
export function compactCredit(fields) {
  const credit = {};
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) credit[key] = trimmed;
    } else if (typeof value === 'boolean') {
      credit[key] = value;
    }
  }
  return credit;
}

/** A trimmed string, or '' for anything else. */
export function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * The size of an image scaled down (never up) to fit a box.
 * @param {number} width
 * @param {number} height
 * @param {number} maxWidth
 * @param {number} maxHeight
 * @returns {{ width: number, height: number }}
 */
export function fitWithin(width, height, maxWidth, maxHeight) {
  if (!(width > 0 && height > 0)) return { width: width || 0, height: height || 0 };
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}
