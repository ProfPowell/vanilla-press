/**
 * Shrinks a photo in the browser before it is uploaded, so a phone picture does not fill the
 * media library or slow the site. JPEG, PNG and WebP over the limit become a JPEG; everything
 * else (and anything the browser cannot decode) goes up as it is.
 * @module downscale
 */

const SHRINKABLE = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * The size to draw at, or null when the image already fits.
 * @param {number} width
 * @param {number} height
 * @param {number} maxEdge
 * @returns {{width: number, height: number}|null}
 */
export function planDownscale(width, height, maxEdge) {
  if (!(width > 0) || !(height > 0) || !(maxEdge > 0)) return null;
  const long = Math.max(width, height);
  if (long <= maxEdge) return null;
  const scale = maxEdge / long;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** A canvas to draw on: OffscreenCanvas where there is one, else a canvas element. */
function makeCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = globalThis.document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

const toBlob = (canvas, type, quality) => (canvas.convertToBlob
  ? canvas.convertToBlob({ type, quality })
  : new Promise((resolve) => canvas.toBlob(resolve, type, quality)));

/**
 * @param {File|Blob} file
 * @param {{ maxEdge?: number, quality?: number }} [options]
 * @returns {Promise<Blob|File>} the original, or a JPEG whose long edge is `maxEdge`
 */
export async function downscaleImage(file, { maxEdge = 2400, quality = 0.85 } = {}) {
  if (!SHRINKABLE.includes(file?.type) || typeof createImageBitmap !== 'function') return file;
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  try {
    const plan = planDownscale(bitmap.width, bitmap.height, maxEdge);
    if (!plan) return file;
    const canvas = makeCanvas(plan.width, plan.height);
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff'; // a PNG's see-through areas would turn black as a JPEG
    context.fillRect(0, 0, plan.width, plan.height);
    context.drawImage(bitmap, 0, 0, plan.width, plan.height);
    const out = await toBlob(canvas, 'image/jpeg', quality);
    if (!out) return file;
    const stem = String(file.name || 'photo').replace(/\.[^./\\]*$/, '') || 'photo';
    return new File([out], `${stem}.jpg`, { type: 'image/jpeg' });
  } catch {
    return file;
  } finally {
    bitmap.close?.();
  }
}
