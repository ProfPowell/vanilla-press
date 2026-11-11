/**
 * The media picker: a modal <dialog> for choosing a file from the site's
 * library, or uploading one and choosing it. An image picker in the app's
 * editor also has a "From the web" tab: a search of the web image services.
 *
 * `openMediaPicker({ kind })` resolves with the chosen MediaItem, or null when
 * the dialog is closed (Escape, Close). A web image copied into the library
 * resolves as its MediaItem (after the alt step); one used by link (Unsplash)
 * as `{ src, alt, credit }`. Focus returns to whatever had it.
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
import { chooseWebImage } from '../web-image-flow.js';

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

  const libraryParts = [
    el('div', { class: 'media-picker-tools' }, search, uploadBtn, fileInput),
    el('p', { class: 'media-picker-drop-hint' }, 'Or drop a file anywhere in this window.'),
    status,
    selected,
    grid,
    empty,
  ];
  // The web tab: images only, and only in the app (its search and editor are the app's)
  const web = kind === 'image' && SITE ? createWebTab() : null;

  const dialog = el('dialog', { class: 'media-picker', 'aria-labelledby': titleId },
    el('header', { class: 'media-picker-header' },
      el('h2', { id: titleId }, heading || HEADINGS[kind]),
      el('button', { type: 'button', class: 'media-picker-close', onclick: () => finish(null) }, 'Close')),
    ...(web ? [web.tabs, web.libraryPanel, web.webPanel] : libraryParts));

  // Escape: the dialog's cancel event. Close it ourselves so the promise settles.
  // While a web image is being edited, Escape leaves the editor (back to the
  // results), never the picker: closing would lose the edits and the search.
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    if (web?.leaveEditor()) return;
    finish(null);
  });
  // A search box with text eats the first Escape (it clears itself): close on any Escape.
  // The image editor handles its own Escape first (and prevents it).
  dialog.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    if (web?.leaveEditor()) return;
    finish(null);
  });
  dialog.addEventListener('dragover', (e) => { e.preventDefault(); dialog.dataset.dragging = ''; });
  dialog.addEventListener('dragleave', (e) => { if (e.target === dialog) delete dialog.dataset.dragging; });
  dialog.addEventListener('drop', (e) => {
    e.preventDefault();
    delete dialog.dataset.dragging;
    if (!e.dataTransfer?.files?.length) return;
    web?.select('library'); // the upload's progress shows there
    addFiles([e.dataTransfer.files[0]]);
  });

  /**
   * "Your library" (the picker as it always was) and "From the web" tabs.
   * Arrow keys, Home and End move between the tabs.
   */
  function createWebTab() {
    const tabIds = { library: 'media-picker-tab-library', web: 'media-picker-tab-web' };
    const panelIds = { library: 'media-picker-panel-library', web: 'media-picker-panel-web' };
    const tab = (name, text) => el('button', {
      type: 'button', role: 'tab', id: tabIds[name], class: 'media-picker-tab',
      'aria-controls': panelIds[name], 'data-tab': name,
      onclick: () => select(name, { focus: true }),
    }, text);
    const tabButtons = { library: tab('library', 'Your library'), web: tab('web', 'From the web') };
    const tabs = el('div', { class: 'media-picker-tabs', role: 'tablist', 'aria-label': 'Where the image comes from' },
      tabButtons.library, tabButtons.web);
    tabs.addEventListener('keydown', (e) => {
      const order = ['library', 'web'];
      const at = order.indexOf(e.target.dataset?.tab);
      if (at < 0) return;
      const next = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: order.length - 1 }[e.key];
      if (next === undefined) return;
      e.preventDefault();
      const name = order[(next + order.length) % order.length];
      select(name);
      tabButtons[name].focus();
    });

    const libraryPanel = el('div', { role: 'tabpanel', id: panelIds.library, class: 'media-picker-panel', 'aria-labelledby': tabIds.library },
      ...libraryParts);
    // Defined on first use: the element class needs a DOM (Node tests import this module)
    const defined = import('./web-image-search.js');
    const searchEl = el('web-image-search', { for: 'picker' });
    const webStatus = el('div', { class: 'media-picker-status', role: 'status' });
    defined.catch(() => webStatus.replaceChildren(el('p', { class: 'media-picker-error', role: 'alert' },
      "Couldn't load the web search. Reload the page to try again.")));
    const editSlot = el('div', { class: 'media-picker-web-edit', hidden: true });
    const webPanel = el('div', { role: 'tabpanel', id: panelIds.web, class: 'media-picker-panel', 'aria-labelledby': tabIds.web },
      webStatus, editSlot, searchEl);

    let busy = false;
    // A new search clears the last choice's error ("Search again — …")
    const clearError = () => { if (!busy) webStatus.replaceChildren(); };
    searchEl.addEventListener('submit', clearError);
    searchEl.addEventListener('input', clearError);
    searchEl.addEventListener('web-image-choose', async (e) => {
      if (busy || done) return;
      const { result, edit } = e.detail;
      busy = true;
      // Editing shows its own progress where the editor goes
      webStatus.replaceChildren(...(edit ? [] : [el('p', { class: 'media-picker-loading' },
        result.mode === 'link' ? 'Inserting…' : 'Adding it to your library…')]));
      if (edit) searchEl.hidden = true;
      let chosen;
      try {
        chosen = await chooseWebImage(result, { edit, editIn: editSlot });
      } catch (err) {
        if (done) return;
        webStatus.replaceChildren(el('p', { class: 'media-picker-error', role: 'alert' }, err.message));
        searchEl.hidden = false;
        busy = false;
        return;
      }
      busy = false;
      if (done) return;
      webStatus.replaceChildren();
      searchEl.hidden = false;
      if (!chosen) { // editing cancelled: back to the results
        searchEl.focus();
        return;
      }
      if (!chosen.filename) { finish(chosen); return; } // used by link
      // A copy is in the library now: its alt text, then "Use this file"
      items = [chosen, ...items.filter((i) => i.id !== chosen.id)];
      select('library');
      renderGrid();
      showUploaded(chosen, { added: true });
    });

    function select(name, { focus = false } = {}) {
      for (const [n, button] of Object.entries(tabButtons)) {
        const on = n === name;
        button.setAttribute('aria-selected', String(on));
        button.tabIndex = on ? 0 : -1;
      }
      libraryPanel.hidden = name !== 'library';
      webPanel.hidden = name !== 'web';
      if (focus && name === 'web') defined.then(() => { if (!webPanel.hidden) searchEl.focus(); }, () => {});
      else if (focus) search.focus();
    }
    select('library');

    /** While editing: Cancel the edit (when it can be) and say so; else false. */
    function leaveEditor() {
      if (editSlot.hidden) return false;
      editSlot.querySelector('[data-action="cancel-edit"]:not(:disabled)')?.click();
      return true;
    }

    return { tabs, libraryPanel, webPanel, select, leaveEditor };
  }

  const queue = createUploadQueue({
    upload: (file, { onProgress }) => api.uploadMedia(file, { onProgress }),
    concurrency: 1,
    // A file added or an upload finishing is newer than a refused drop: its
    // message goes. Progress ticks keep it.
    onChange: () => {
      const states = queue.entries().map((e) => `${e.key}:${e.state}`).join(' ');
      if (states !== lastStates) precheckError = '';
      lastStates = states;
      renderUploads();
    },
  });
  /** The queue's entries and their states at the last change. */
  let lastStates = '';
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

  /**
   * The new upload, selected: an image gets its alt fields; then "Use this file".
   * `added`: a web image just copied in (its alt is the result's description).
   */
  function showUploaded(item, { added = false } = {}) {
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
      el('p', { class: 'media-picker-selected-name' }, added ? 'Added to your library as ' : 'Uploaded ', el('span', { class: 'media-picker-file' }, item.filename)),
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
