/**
 * The size a web image is stored at, and how it gets there: pure, no DOM.
 * Tested in Node.
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

/**
 * How a chosen web image search result reaches the post:
 * - `link`: used by its URL (Unsplash), never copied or edited;
 * - `edit`: loaded into the image editor, saved at most `MAX_EDGE`;
 * - `downsize`: known to be over `MAX_EDGE`: made smaller in the browser;
 * - `probe`: size unknown: loaded and measured in the browser, made smaller if
 *   it needs to be (the server would store it at whatever size it is);
 * - `import`: known to fit: the server copies it.
 * @param {{ mode: 'copy'|'link', width?: number, height?: number }} result
 * @param {{ edit?: boolean }} [opts]
 * @returns {'link'|'edit'|'downsize'|'probe'|'import'}
 */
export function importPath(result, { edit = false } = {}) {
  if (result.mode === 'link') return 'link';
  if (edit) return 'edit';
  if (!(Number(result.width) > 0) || !(Number(result.height) > 0)) return 'probe';
  return fitWithin(result.width, result.height).scaled ? 'downsize' : 'import';
}
