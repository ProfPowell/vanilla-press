/**
 * What choosing a web image result does (browser only):
 *
 * - **Link (Unsplash):** tell Unsplash about the download, then use the
 *   photo by its URL: `{ src, alt, credit }`. It is never copied.
 * - **Edit first:** load the image (same origin, through the app) into an
 *   `<image-editor>`; Save uploads the edit, at most 2400px, credited as
 *   adapted.
 * - **Too big** (over 2400px on its long edge): downsize it on a canvas and
 *   upload that, credited (not adapted: it is the same picture).
 * - **Otherwise:** the server copies it into the library (`/media/import`).
 *
 * @module editor/web-image-flow
 */

import { api } from './api-client.js';
import { fitWithin } from './image-fit.js';
import { exportFormat } from '../../../src/media/types.js';

const QUALITY = 0.92;
/** The extension for a type the library accepts (the server checks the bytes too). */
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };

function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  node.append(...children);
  return node;
}

/** The image bytes of a copy-mode result, from this origin. Errors carry the server's message. */
async function fetchImage(result) {
  let res;
  try {
    res = await fetch(api.webImageUrl(result.source, result.id));
  } catch {
    throw new Error("The app didn't answer. Is vp still running?");
  }
  if (!res.ok) {
    let message = '';
    try { message = (await res.json()).error; } catch { /* no JSON body */ }
    throw new Error(message || `Couldn't load the image (${res.status}).`);
  }
  return res.blob();
}

/** The format to export `blob` as: its own when the editor can write it, else JPEG. */
const formatOf = (blob) => exportFormat(blob.type) || 'jpeg';

/** `blob` at most 2400px on its long edge (re-encoded only when it was larger). */
async function fitBlob(blob, format) {
  const bitmap = await createImageBitmap(blob);
  try {
    const fit = fitWithin(bitmap.width, bitmap.height);
    if (!fit.scaled) return blob;
    const canvas = document.createElement('canvas');
    canvas.width = fit.width;
    canvas.height = fit.height;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, fit.width, fit.height);
    const out = await new Promise((resolve) => canvas.toBlob(resolve, `image/${format}`, QUALITY));
    if (!out) throw new Error("Couldn't make a smaller copy of the image.");
    return out;
  } finally {
    bitmap.close();
  }
}

/** Upload `blob` as `<source>-<id>.<ext>`, with the result's alt, credit and source. */
function upload(result, blob, credit) {
  const name = `${result.source}-${result.id}.${EXT[blob.type] || 'jpg'}`.replace(/[^\w.-]/g, '-');
  return api.uploadMedia(new File([blob], name, { type: blob.type }), {
    alt: result.description || null,
    credit,
    source: result.source,
  });
}

/**
 * Load the result's image into an `<image-editor>` in `slot`. Resolves with
 * the uploaded MediaItem on Save, or null on Cancel. A failed save keeps the edits.
 */
async function editThenUpload(result, slot) {
  slot.replaceChildren(h('p', { class: 'web-image-edit-loading', role: 'status' }, 'Loading the image…'));
  slot.hidden = false;
  let blob;
  try {
    [blob] = await Promise.all([
      fetchImage(result),
      import('/assets/image-editor/image-editor.js').catch(() => {
        throw new Error("Couldn't load the image editor. Reload the page to try again.");
      }),
    ]);
  } catch (err) {
    slot.replaceChildren();
    slot.hidden = true;
    throw err;
  }
  const format = formatOf(blob);
  const url = URL.createObjectURL(blob);
  const editor = h('image-editor', { src: url, format });
  const error = h('p', { class: 'media-picker-error', role: 'alert', hidden: true });
  const save = h('button', { type: 'button', class: 'primary', 'data-action': 'save-edit' }, 'Save and insert');
  const cancel = h('button', { type: 'button', 'data-action': 'cancel-edit' }, 'Cancel');
  slot.replaceChildren(editor, error, h('div', { class: 'web-image-edit-actions' }, save, cancel));
  save.focus();

  return new Promise((resolve) => {
    const close = (value) => {
      URL.revokeObjectURL(url);
      slot.replaceChildren();
      slot.hidden = true;
      resolve(value);
    };
    cancel.addEventListener('click', () => close(null));
    save.addEventListener('click', async () => {
      error.hidden = true;
      save.disabled = cancel.disabled = true;
      save.textContent = 'Saving…';
      try {
        const edited = await fitBlob(await editor.getBlob(format, QUALITY), format);
        close(await upload(result, edited, { ...result.credit, adapted: true }));
      } catch (err) {
        error.textContent = `${err.message || "Couldn't save the image."} Your edits are still here; try again.`;
        error.hidden = false;
        save.textContent = 'Save and insert';
        save.disabled = cancel.disabled = false;
      }
    });
  });
}

/**
 * Use a web image search result.
 * @param {object} result a WebImage from `api.searchWebImages`
 * @param {{ edit?: boolean, editIn?: HTMLElement }} [opts] `editIn`: where
 *   the image editor shows (required for `edit`)
 * @returns {Promise<object|{ src: string, alt: string|null, credit: object }|null>}
 *   the new MediaItem; the link for an Unsplash photo; null when editing was cancelled
 */
export async function chooseWebImage(result, { edit = false, editIn } = {}) {
  if (result.mode === 'link') {
    await api.pingUnsplash(result.id);
    // No description is no alt yet (the figure's alt field opens), not decorative
    return { src: result.url, alt: result.description || null, credit: result.credit };
  }
  if (edit) return editThenUpload(result, editIn);
  if (fitWithin(result.width, result.height).scaled) {
    const blob = await fetchImage(result);
    return upload(result, await fitBlob(blob, formatOf(blob)), result.credit);
  }
  return api.importWebImage({ source: result.source, id: result.id });
}
