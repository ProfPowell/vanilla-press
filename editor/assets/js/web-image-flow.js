/**
 * What choosing a web image result does (browser only):
 *
 * - **Link (Unsplash):** the server adds it to the library as a linked item
 *   (its URL and credit, never a file) and tells Unsplash about the download;
 *   the result is that MediaItem (`linked: true`, `src` the photo's URL).
 * - **Edit first:** load the image (same origin, through the app) into an
 *   `<image-editor>`; Save uploads the edit, at most 2400px, credited as
 *   adapted. A different picture opened or dropped in the editor is the
 *   writer's own: it is saved with no credit.
 * - **Too big** (over 2400px on its long edge), or **size unknown**: load it,
 *   downsize it on a canvas if it needs it, and upload that, credited (not
 *   adapted: it is the same picture).
 * - **Otherwise:** the server copies it into the library (`/media/import`);
 *   one it refuses as too large (413) is downsized in the browser instead.
 *
 * Which of these runs is `importPath` (image-fit.js).
 * @module editor/web-image-flow
 */

import { api } from './api-client.js';
import { fitWithin, importPath } from './image-fit.js';
import { exportFormat } from '../../../src/media/types.js';

const QUALITY = 0.92;

/** What a writer sees when the browser can't decode an image (not the browser's own words). */
export const DECODE_ERROR = "This image couldn't be opened. Try another one.";

/** Shown under the editor once the writer opens or drops another picture. */
export const REPLACED_NOTE = "This is a different picture now, so it won't carry the web credit.";
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
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    throw new Error(DECODE_ERROR);
  }
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

/**
 * Upload `blob` as `<source>-<id>.<ext>`, with the result's alt, `credit` and
 * source; with `credit: null`, none of the three (the picture is not the result's).
 */
function upload(result, blob, credit) {
  const name = `${result.source}-${result.id}.${EXT[blob.type] || 'jpg'}`.replace(/[^\w.-]/g, '-');
  return api.uploadMedia(new File([blob], name, { type: blob.type }), credit
    ? { alt: result.description || null, credit, source: result.source }
    : {});
}

/** Load a copy-mode result through the proxy and upload it at most 2400px, credited. */
async function downsizeAndUpload(result) {
  const blob = await fetchImage(result);
  return upload(result, await fitBlob(blob, formatOf(blob)), result.credit);
}

/**
 * Load the result's image into an `<image-editor>` in `slot`. Resolves with
 * the uploaded MediaItem on Save, or null on Cancel. A failed save keeps the edits.
 */
async function editThenUpload(result, slot, saveText) {
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
  try {
    // Edits at 2400px lose nothing (the copy is capped there) and keep a huge original responsive
    blob = await fitBlob(blob, format);
  } catch (err) {
    slot.replaceChildren();
    slot.hidden = true;
    throw err;
  }
  const url = URL.createObjectURL(blob);
  const editor = h('image-editor', { src: url, format });
  // The first load is the result; any later one is a picture the writer opened or dropped
  let loads = 0;
  const replacedNote = h('p', { class: 'web-image-edit-note', role: 'status' });
  editor.addEventListener('image-load', () => {
    loads += 1;
    if (loads > 1) replacedNote.textContent = REPLACED_NOTE;
  });
  const error = h('p', { class: 'media-picker-error', role: 'alert', hidden: true });
  const save = h('button', { type: 'button', class: 'primary', 'data-action': 'save-edit' }, saveText);
  const cancel = h('button', { type: 'button', 'data-action': 'cancel-edit' }, 'Cancel');
  slot.replaceChildren(editor, replacedNote, error, h('div', { class: 'web-image-edit-actions' }, save, cancel));
  save.focus();

  return new Promise((resolve) => {
    // Escape belongs to the editor (it closes a tool); with no tool open it is
    // Cancel: back to the results. Never the picker's: that would lose the search.
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      if (editor.currentTool) return;
      if (!cancel.disabled) close(null);
    };
    slot.addEventListener('keydown', onKey, true);
    const close = (value) => {
      slot.removeEventListener('keydown', onKey, true);
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
        const credit = loads > 1 ? null : { ...result.credit, adapted: true };
        close(await upload(result, edited, credit));
      } catch (err) {
        error.textContent = `${err.message || "Couldn't save the image."} Your edits are still here; try again.`;
        error.hidden = false;
        save.textContent = saveText;
        save.disabled = cancel.disabled = false;
      }
    });
  });
}

/**
 * Use a web image search result.
 * @param {object} result a WebImage from `api.searchWebImages`
 * @param {{ edit?: boolean, editIn?: HTMLElement, saveText?: string }} [opts] `editIn`: where
 *   the image editor shows (required for `edit`); `saveText`: its Save button's words
 * @returns {Promise<object|null>} the MediaItem (a linked one for an Unsplash photo);
 *   null when editing was cancelled
 */
export async function chooseWebImage(result, { edit = false, editIn, saveText = 'Save and insert' } = {}) {
  switch (importPath(result, { edit })) {
    case 'link':
      // The server pings Unsplash (once) and answers the linked item, new or already there
      return api.importWebImage({ source: result.source, id: result.id });
    case 'edit':
      return editThenUpload(result, editIn, saveText);
    case 'downsize':
    case 'probe':
      return downsizeAndUpload(result);
    default:
      try {
        return await api.importWebImage({ source: result.source, id: result.id });
      } catch (err) {
        if (err.status !== 413) throw err;
        return downsizeAndUpload(result); // the proxy takes a larger original than an import
      }
  }
}
