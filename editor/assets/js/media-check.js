/**
 * Whether a library file an audio, video or PDF block points at is gone from
 * the site's `src/media` (a figure learns this from its image failing to load;
 * these blocks have nothing to load, so they ask the server). No DOM: tested in Node.
 *
 * @module editor/media-check
 */

import { mediaFileOf } from '../../../src/media/usage.js';
import { SITE, displayMediaUrl } from './site-context.js';

/**
 * True when `url` is a `/media/<file>` URL and the server answers 404 for it.
 * Any other answer, or no answer (offline), is "not known to be missing".
 * @param {unknown} url - the stored URL
 * @param {{ site?: string|null, fetchFn?: typeof fetch }} [opts]
 * @returns {Promise<boolean>}
 */
export async function isMissingMedia(url, { site = SITE, fetchFn = globalThis.fetch } = {}) {
  if (!mediaFileOf(url)) return false;
  try {
    const res = await fetchFn(displayMediaUrl(url, site), { method: 'HEAD', cache: 'no-store' });
    return res.status === 404;
  } catch {
    return false;
  }
}

/** The text a block shows in place of its file: "Missing file: song.mp3". */
export function missingText(url) {
  return `Missing file: ${mediaFileOf(url) ?? url}`;
}

/** The text an audio or video block shows: its placeholder, or the missing-file note. */
export function embedText({ type, url }, missing) {
  return missing ? missingText(url) : `[${type}: ${url}]`;
}
