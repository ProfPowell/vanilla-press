/**
 * The media picker: a modal <dialog> for choosing a file from the site's
 * library, or uploading one and choosing it.
 *
 * `openMediaPicker({ kind })` resolves with the chosen MediaItem, or null when
 * the dialog is closed (Escape, Close). Focus returns to whatever had it.
 * Pure logic (filtering, tiles, alt states, upload checks) lives in
 * src/media and media-upload.js; this module only renders and wires events.
 *
 * @module editor/components/media-picker
 */

import { api } from '../api-client.js';
import { SITE, displayMediaUrl } from '../site-context.js';
import { createUploadQueue } from '../media-upload.js';
import { filterMedia, tileModel, altForCheckbox, emptyText, ALT_PLACEHOLDER } from '../../../../src/media/library-view.js';
import { ACCEPTED } from '../../../../src/media/types.js';
import { ACCEPT_ATTR } from '../../../../src/media/limits.js';

const HEADINGS = {
  image: 'Choose an image',
  video: 'Choose a video',
  audio: 'Choose audio',
  pdf: 'Choose a PDF',
  all: 'Choose a file',
};

/** What one kind is called in messages. */
const KIND_NOUN = { image: 'an image', video: 'a video', audio: 'an audio file', pdf: 'a PDF' };

const extsFor = (kind) => ACCEPTED.filter((t) => t.kind === kind).flatMap((t) => t.exts);
const acceptFor = (kind) => (HEADINGS[kind] && kind !== 'all'
  ? extsFor(kind).map((e) => `.${e}`).join(',')
  : ACCEPT_ATTR);

/** An error when `file` isn't the kind this picker offers, else null. */
function wrongKind(file, kind) {
  if (kind === 'all' || !KIND_NOUN[kind]) return null;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (extsFor(kind).includes(ext)) return null;
  const list = extsFor(kind).map((e) => e.toUpperCase()).join(', ');
  return `${file.name} isn't ${KIND_NOUN[kind]}. Upload one of these here: ${list}.`;
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k in node && typeof v !== 'string') node[k] = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  node.append(...children.filter((c) => c != null && c !== false));
  return node;
}

let current = null;

/**
 * Open the picker.
 * @param {{ kind?: 'image'|'video'|'audio'|'pdf'|'all', heading?: string }} [opts]
 * @returns {Promise<object|null>} the chosen MediaItem, or null
 */
export function openMediaPicker({ kind = 'all', heading } = {}) {
  if (current) current.finish(null);
  return new Promise((resolve) => {
    current = createPicker({ kind: HEADINGS[kind] ? kind : 'all', heading, resolve });
  });
}

function createPicker({ kind, heading, resolve }) {
  const opener = document.activeElement;
  const titleId = 'media-picker-title';
  let items = [];
  let query = '';
  let loaded = false;
  let uploaded = null; // the item just uploaded, waiting for "Use this file"
  let done = false;

  const search = el('input', {
    type: 'search', class: 'media-picker-search', autofocus: true, 'aria-label': 'Search files',
    placeholder: 'Search by name or alt text',
    oninput: () => { query = search.value; renderGrid(); },
  });
  const fileInput = el('input', {
    type: 'file', accept: acceptFor(kind), hidden: true,
    onchange: () => { addFiles(fileInput.files); fileInput.value = ''; },
  });
  const uploadBtn = el('button', { type: 'button', class: 'media-picker-upload-btn', onclick: () => fileInput.click() }, 'Upload…');
  const status = el('div', { class: 'media-picker-status', role: 'status' });
  const selected = el('div', { class: 'media-picker-selected', hidden: true });
  const grid = el('ul', { class: 'media-picker-grid', 'aria-label': 'Files' });
  const empty = el('p', { class: 'media-picker-empty', hidden: true });

  const dialog = el('dialog', { class: 'media-picker', 'aria-labelledby': titleId },
    el('header', { class: 'media-picker-header' },
      el('h2', { id: titleId }, heading || HEADINGS[kind]),
      el('button', { type: 'button', class: 'media-picker-close', onclick: () => finish(null) }, 'Close')),
    el('div', { class: 'media-picker-tools' }, search, uploadBtn, fileInput),
    el('p', { class: 'media-picker-drop-hint' }, 'Or drop a file anywhere in this window.'),
    status,
    selected,
    grid,
    empty);

  // Escape: the dialog's cancel event. Close it ourselves so the promise settles.
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
  // A search box with text eats the first Escape (it clears itself): close on any Escape.
  dialog.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    finish(null);
  });
  dialog.addEventListener('dragover', (e) => { e.preventDefault(); dialog.dataset.dragging = ''; });
  dialog.addEventListener('dragleave', (e) => { if (e.target === dialog) delete dialog.dataset.dragging; });
  dialog.addEventListener('drop', (e) => {
    e.preventDefault();
    delete dialog.dataset.dragging;
    if (e.dataTransfer?.files?.length) addFiles([e.dataTransfer.files[0]]);
  });

  const queue = createUploadQueue({
    upload: (file, { onProgress }) => api.uploadMedia(file, { onProgress }),
    concurrency: 1,
    // A queue change is a newer event than a refused drop: its message goes
    onChange: () => { precheckError = ''; renderUploads(); },
  });
  /** Keys of finished uploads already handled. */
  const handled = new Set();
  /** A dropped or chosen file of the wrong kind (never uploaded). */
  let precheckError = '';

  function addFiles(files) {
    const file = files[0];
    if (!file) return;
    const refused = wrongKind(file, kind);
    if (refused) { precheckError = refused; renderUploads(); return; }
    queue.add([file]);
  }

  /** The refused file's message, then the queue: uploads in progress and the last one's outcome. */
  function renderUploads() {
    if (done) return;
    const entries = queue.entries();
    const parts = [];
    if (precheckError) parts.push(el('p', { class: 'media-picker-error', role: 'alert' }, precheckError));
    for (const e of entries) {
      if (e.state !== 'waiting' && e.state !== 'uploading') continue;
      parts.push(el('p', { class: 'media-picker-progress' },
        el('span', { class: 'media-picker-file' }, e.name), ' ',
        el('progress', { max: 1, value: e.progress, 'aria-label': `Uploading ${e.name}` }), ' Uploading…'));
    }
    const finished = entries.filter((e) => e.state === 'done' || e.state === 'error').pop();
    if (finished?.state === 'error') parts.push(el('p', { class: 'media-picker-error', role: 'alert' }, finished.error));
    if (finished?.state === 'done' && finished.note) parts.push(el('p', { class: 'media-picker-note' }, finished.note));
    status.replaceChildren(...parts);

    // Newly finished uploads join the grid; the newest is selected
    let newest = null;
    for (const e of entries) {
      if (e.state !== 'done' || handled.has(e.key)) continue;
      handled.add(e.key);
      items = [e.item, ...items.filter((i) => i.id !== e.item.id)];
      newest = e.item;
    }
    if (newest) {
      renderGrid();
      showUploaded(newest);
    }
  }

  /** The new upload, selected: an image gets its alt fields; then "Use this file". */
  function showUploaded(item) {
    uploaded = item;
    const isImage = item.kind === 'image';
    const error = el('p', { class: 'media-picker-error', role: 'alert', hidden: true });
    const altId = 'media-picker-alt';
    const altArea = isImage ? el('textarea', { id: altId, rows: 2, placeholder: ALT_PLACEHOLDER }) : null;
    const decorative = isImage ? el('input', { type: 'checkbox', id: 'media-picker-decorative' }) : null;
    if (isImage) {
      altArea.value = item.alt ?? '';
      decorative.checked = item.alt === '';
      altArea.disabled = decorative.checked;
      decorative.addEventListener('change', () => {
        altArea.disabled = decorative.checked;
        if (decorative.checked) altArea.value = '';
        else altArea.focus();
      });
    }
    const use = el('button', { type: 'button', class: 'primary', onclick: async () => {
      let chosen = item;
      if (isImage) {
        const text = altArea.value.trim();
        const alt = decorative.checked ? altForCheckbox(true) : (text || altForCheckbox(false));
        if (alt !== (item.alt ?? null)) {
          use.disabled = true;
          try {
            chosen = await api.setMediaAlt(item.id, alt);
          } catch (err) {
            use.disabled = false;
            error.textContent = `Couldn't save the alt text: ${err.message}. Try again, or close and set it on the Media screen.`;
            error.hidden = false;
            return;
          }
        }
      }
      finish(chosen);
    } }, 'Use this file');

    selected.replaceChildren(
      el('p', { class: 'media-picker-selected-name' }, 'Uploaded ', el('span', { class: 'media-picker-file' }, item.filename)),
      isImage ? el('div', { class: 'media-picker-preview' }, el('img', { src: displayMediaUrl(item.src, SITE), alt: '' })) : null,
      isImage ? el('div', { class: 'field' }, el('label', { for: altId }, 'Alt text'), altArea) : null,
      isImage ? el('div', { class: 'field field-check' }, decorative, el('label', { for: 'media-picker-decorative' }, 'Decorative (no alt text needed)')) : null,
      error,
      use);
    selected.hidden = false;
    (isImage && !decorative.checked ? altArea : use).focus();
  }

  function renderGrid() {
    if (done) return;
    const shown = filterMedia(items, { type: kind, query });
    grid.replaceChildren(...shown.map((item) => {
      const tile = tileModel(item);
      const thumb = tile.thumb
        ? el('img', { src: displayMediaUrl(item.src, SITE), alt: '', loading: 'lazy' })
        : el('span', {}, tile.typeLabel);
      return el('li', {}, el('button', {
        type: 'button', class: 'media-picker-tile', disabled: Boolean(item.missing),
        onclick: () => finish(item),
      },
      el('span', { class: 'media-picker-thumb' }, thumb),
      el('span', { class: 'media-picker-name' }, tile.name),
      tile.badges.length
        ? el('span', { class: 'media-picker-badges' }, ...tile.badges.map((b) =>
          el('span', { class: 'media-picker-badge', 'data-badge': b === 'Missing file' ? 'missing-file' : 'no-alt' }, b)))
        : null));
    }));
    empty.hidden = !loaded || shown.length > 0;
    empty.textContent = emptyText({ type: kind, query });
  }

  function finish(result) {
    if (done) return;
    done = true;
    if (current === picker) current = null;
    dialog.close();
    dialog.remove();
    if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus();
    resolve(result);
  }

  const picker = { finish };

  document.body.appendChild(dialog);
  dialog.showModal();
  const loading = el('p', { class: 'media-picker-loading' }, 'Loading the media library…');
  status.replaceChildren(loading);
  api.listMedia().then((list) => {
    if (done) return;
    // An upload that finished first stays in the list
    const fresh = Array.isArray(list) ? list : [];
    items = uploaded ? [uploaded, ...fresh.filter((i) => i.id !== uploaded.id)] : fresh;
    loaded = true;
    if (loading.isConnected) status.replaceChildren();
    renderGrid();
  }, (err) => {
    if (done) return;
    status.replaceChildren(el('p', { class: 'media-picker-error', role: 'alert' },
      `Couldn't load the media library: ${err.message}. You can still upload a file, or close and try again.`));
  });

  return picker;
}
