/**
 * The size an image is stored at: pure, no DOM. Tested in Node.
 *
 * @module editor/image-fit
 */

/** A copy of a web image is at most this many pixels on its long edge. */
export const MAX_EDGE = 2400;

/**
 * `width` × `height` scaled down (never up) so the long edge is at most `max`,
 * keeping the aspect ratio. An unknown size is left as it is.
 * @param {number} width
 * @param {number} height
 * @param {number} [max]
 * @returns {{ width: number, height: number, scaled: boolean }}
 */
export function fitWithin(width, height, max = MAX_EDGE) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  const long = Math.max(w, h);
  if (!w || !h || long <= max) return { width: w, height: h, scaled: false };
  const ratio = max / long;
  return {
    width: Math.max(1, Math.round(w * ratio)),
    height: Math.max(1, Math.round(h * ratio)),
    scaled: true,
  };
}
