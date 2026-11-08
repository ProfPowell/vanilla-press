/**
 * The Media section: library grid, filters, search and uploads. Renders and wires events;
 * the rules live in src/media/library-view.js and editor/assets/js/media-upload.js.
 * @module media-page
 */
import { api, h } from './app-api.js';
import {
  FILTERS, TYPES, DROP_TEXT, filterMedia, headerCounts, tileModel, emptyText, needsAlt,
} from '../../../src/media/library-view.js';
import { createMediaDetail } from './media-detail.js';
import { ACCEPT_ATTR } from '../../../src/media/limits.js';
import { uploadMedia, createUploadQueue } from '../../../editor/assets/js/media-upload.js';

const ICONS = {
  video: '<rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="m10 9 5 3-5 3z"></path>',
  audio: '<path d="M9 18V5l11-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="17" cy="16" r="3"></circle>',
  pdf: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"></path><path d="M14 3v5h5"></path>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"></rect><circle cx="9" cy="10" r="2"></circle><path d="m21 16-5-5-9 9"></path>',
};

function icon(kind) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [k, v] of Object.entries({ width: 28, height: 28, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
  svg.innerHTML = ICONS[kind] || ICONS.image; // constant markup above, never file data
  return svg;
}

const isTextField = (el) => !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

/**
 * @param {{ siteId: string, root: HTMLElement }} opts
 * @returns {{ refresh: () => Promise<void>, select: (id: string|null) => void, selectByFilename: (name: string) => boolean, show: () => Promise<void>, hide: () => Promise<void> }}
 */
export function initMediaSection({ siteId, root }) {
  const base = `/api/sites/${encodeURIComponent(siteId)}`;
  const $ = (id) => root.querySelector(`#${id}`);
  const view = { filter: 'all', type: 'all', query: '' };
  let items = [];
  let selectedId = null;

  const showError = (message) => {
    $('media-error').textContent = message || '';
    $('media-error').hidden = !message;
  };

  // --- Static controls ---
  $('media-file').accept = ACCEPT_ATTR;
  $('media-drop').textContent = DROP_TEXT;
  $('media-filters').replaceChildren(...FILTERS.map(([value, label]) =>
    h('button', { type: 'button', 'data-filter': value, 'aria-pressed': String(value === view.filter) }, label)));
  $('media-type').replaceChildren(...TYPES.map(([value, label]) => h('option', { value }, label)));

  // --- Library ---
  function tile(item) {
    const m = tileModel(item);
    const thumb = h('span', { class: 'media-thumb' });
    if (m.thumb) {
      thumb.append(h('img', { src: `/sites/${encodeURIComponent(siteId)}/media/${encodeURIComponent(item.filename)}`, alt: '', loading: 'lazy' }));
    } else {
      thumb.append(icon(m.kind), h('span', {}, m.typeLabel));
    }
    const btn = h('button', { type: 'button', class: 'media-tile', 'data-id': item.id, 'aria-pressed': String(item.id === selectedId) },
      thumb,
      h('span', { class: 'media-name' }, m.name));
    if (m.badges.length) {
      btn.append(h('span', { class: 'media-badges' }, ...m.badges.map((b) =>
        h('span', { class: 'media-badge', 'data-badge': b.toLowerCase().replaceAll(' ', '-') }, b))));
    }
    return h('li', {}, btn);
  }

  function render() {
    const counts = headerCounts(items);
    $('media-count').textContent = counts.count;
    $('media-missing-alt').textContent = counts.missingAlt ? ` \u00b7 ${counts.missingAlt}` : '';
    $('media-missing-alt').hidden = !counts.missingAlt;
    for (const btn of $('media-filters').querySelectorAll('button')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.filter === view.filter));
    }
    const shown = filterMedia(items, view);
    const focused = document.activeElement?.closest?.('.media-tile')?.dataset.id; // rebuilding must not drop focus
    $('media-grid').replaceChildren(...shown.map(tile));
    if (focused) $('media-grid').querySelector(`[data-id="${CSS.escape(focused)}"]`)?.focus();
    $('media-empty').textContent = emptyText(view);
    $('media-empty').hidden = shown.length > 0;
  }

  let latest = 0;
  async function refresh() {
    const mine = ++latest;
    try {
      const fresh = await api(`${base}/media`);
      if (mine !== latest) return; // a newer refresh is in flight: keep its answer
      items = fresh;
      showError('');
    } catch (err) {
      if (mine === latest) showError(err.message);
    }
    if (selectedId && !items.some((i) => i.id === selectedId)) { selectedId = null; detail.show(null); }
    render();
  }

  // --- Detail panel ---
  const detail = createMediaDetail({
    siteId,
    base,
    root,
    host: {
      getItem: (id) => items.find((i) => i.id === id),
      replaceItem(fresh) {
        const at = items.findIndex((i) => i.id === fresh.id);
        if (at >= 0) items[at] = fresh;
        render();
      },
      showError,
      refresh,
      deleted(item) {
        // The next tile in view order, else the one before.
        const order = filterMedia(items, view).map((i) => i.id);
        const at = order.indexOf(item.id);
        const nextId = order[at + 1] ?? order[at - 1] ?? null;
        items = items.filter((i) => i.id !== item.id);
        selectedId = null;
        render();
        select(nextId);
        ($('media-grid').querySelector('.media-tile[aria-pressed="true"]') || $('media-upload')).focus();
        refresh();
      },
      async copySaved(copy) {
        await refresh();
        select(copy.id);
        $('media-grid').querySelector(`[data-id="${CSS.escape(copy.id)}"]`)?.scrollIntoView({ block: 'nearest' });
      },
    },
  });
  const { flushAlt } = detail;

  /** @param {string|null} id @param {{ focusAlt?: boolean }} [opts] */
  function select(id, { focusAlt = false } = {}) {
    if (id !== detail.shownId()) flushAlt(); // the pending alt is saved to the item it was typed for
    selectedId = id;
    for (const btn of $('media-grid').querySelectorAll('.media-tile')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.id === id));
    }
    const item = items.find((i) => i.id === id) || null;
    if (!item) selectedId = null;
    detail.show(item);
    if (focusAlt && item && needsAlt(item)) detail.focusAlt();
    root.dispatchEvent(new CustomEvent('media-select', { detail: { item } }));
  }

  /** Select the file with this name (a deep link). Returns whether it was found. */
  function selectByFilename(name) {
    const hit = name && items.find((i) => i.filename === name);
    if (!hit) return false;
    if (hit.id !== detail.shownId()) select(hit.id); // already shown: don't rebuild the panel over a pending alt
    $('media-grid').querySelector(`[data-id="${CSS.escape(hit.id)}"]`)?.scrollIntoView({ block: 'nearest' });
    return true;
  }

  $('media-grid').addEventListener('click', (e) => {
    const btn = e.target.closest('.media-tile');
    if (!btn) return;
    select(btn.dataset.id === selectedId ? null : btn.dataset.id);
    // Below the grid at phone width: bring the panel into view.
    if (selectedId && matchMedia('(max-width: 52rem)').matches) $('media-detail').scrollIntoView({ block: 'nearest' });
  });
  $('media-filters').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-filter]');
    if (!btn) return;
    view.filter = btn.dataset.filter;
    render();
  });
  $('media-type').addEventListener('change', (e) => { view.type = e.target.value; render(); });
  $('media-search').addEventListener('input', (e) => { view.query = e.target.value; render(); });

  // --- Uploads ---
  const rows = new Map();
  const handled = new Set();

  function uploadRow(entry) {
    const row = h('li', { class: 'upload-item' },
      h('span', { class: 'upload-name' }, entry.name),
      h('progress', { max: '1', value: '0' }),
      h('span', { class: 'upload-state' }),
      h('p', { class: 'upload-note', hidden: true }),
      h('p', { class: 'upload-error', hidden: true }));
    const dismiss = h('button', { type: 'button', hidden: true }, 'Dismiss');
    dismiss.addEventListener('click', () => queue.dismiss(entry.key));
    row.append(dismiss);
    return row;
  }

  const STATE_TEXT = { waiting: 'Waiting', uploading: 'Uploading', done: 'Uploaded', error: 'Not uploaded' };

  function renderUploads() {
    const entries = queue.entries();
    const keys = new Set(entries.map((e) => e.key));
    for (const [key, row] of rows) if (!keys.has(key)) { row.remove(); rows.delete(key); }
    for (const entry of entries) {
      let row = rows.get(entry.key);
      if (!row) { row = uploadRow(entry); rows.set(entry.key, row); $('media-uploads').append(row); }
      row.dataset.state = entry.state;
      const bar = row.querySelector('progress');
      bar.value = entry.progress;
      bar.hidden = entry.state === 'error' || entry.state === 'done';
      bar.setAttribute('aria-label', `Uploading ${entry.name}`);
      row.querySelector('.upload-state').textContent = STATE_TEXT[entry.state];
      const note = row.querySelector('.upload-note');
      note.textContent = entry.note || '';
      note.hidden = !entry.note;
      const err = row.querySelector('.upload-error');
      err.textContent = entry.error || '';
      err.hidden = !entry.error;
      row.querySelector('button').hidden = entry.state !== 'done' && entry.state !== 'error';
    }
    $('media-uploads').hidden = entries.length === 0; // the role=status wrapper around the list stays
  }

  // After a batch settles: refresh the library, then select the first file that finished.
  let settling = false;
  async function settleBatch() {
    const entries = queue.entries();
    if (settling || entries.some((e) => e.state === 'waiting' || e.state === 'uploading')) return;
    const fresh = entries.filter((e) => e.state === 'done' && !handled.has(e.key));
    if (!fresh.length) return;
    for (const e of fresh) handled.add(e.key);
    settling = true;
    await refresh();
    settling = false;
    select(fresh[0].item.id, { focusAlt: true });
    await settleBatch(); // files added while refreshing
  }

  const queue = createUploadQueue({
    upload: (file, opts) => uploadMedia(base, file, opts),
    onChange: () => { renderUploads(); settleBatch(); },
  });

  $('media-upload').addEventListener('click', () => $('media-file').click());
  $('media-file').addEventListener('change', (e) => {
    queue.add([...e.target.files]);
    e.target.value = '';
  });

  // Drops anywhere on the section.
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  let dragDepth = 0;
  root.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    $('media-drop').dataset.dragging = '';
  });
  root.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  root.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    if (--dragDepth <= 0) { dragDepth = 0; delete $('media-drop').dataset.dragging; }
  });
  root.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    delete $('media-drop').dataset.dragging;
    queue.add([...e.dataTransfer.files]);
  });

  // Paste uploads clipboard files while this section is showing and focus isn't in a text field.
  document.addEventListener('paste', (e) => {
    if (root.hidden || isTextField(document.activeElement)) return;
    const files = [...(e.clipboardData?.files || [])];
    if (!files.length) return;
    e.preventDefault();
    queue.add(files);
  });

  // A file dropped on the rail or header would navigate the app away: refuse it while Media shows.
  for (const type of ['dragover', 'drop']) {
    window.addEventListener(type, (e) => {
      if (root.hidden || !hasFiles(e)) return;
      e.preventDefault();
      if (type === 'dragover' && !root.contains(e.target)) e.dataTransfer.dropEffect = 'none';
    });
  }

  // --- Show and hide ---
  // Called by the site page each time the section is shown (including the first) and when it is left.
  async function show() {
    await refresh();
    selectByFilename(new URLSearchParams(location.search).get('file'));
  }
  const hide = () => flushAlt();
  detail.show(null);

  return { refresh, select, selectByFilename, show, hide };
}
