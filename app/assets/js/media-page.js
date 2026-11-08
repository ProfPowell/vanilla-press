/**
 * The Media section: library grid, filters, search and uploads. Renders and wires events;
 * the rules live in src/media/library-view.js and editor/assets/js/media-upload.js.
 * @module media-page
 */
import { api, h } from './app-api.js';
import {
  FILTERS, TYPES, DROP_TEXT, ALT_PLACEHOLDER, ALT_HINT, filterMedia, headerCounts, tileModel, emptyText,
  detailModel, needsAlt, altForCheckbox, createAltSaver, deleteDecision,
} from '../../../src/media/library-view.js';
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
    if (selectedId && !items.some((i) => i.id === selectedId)) { selectedId = null; renderDetail(null); }
    render();
  }

  // --- Detail panel ---
  const displayUrl = (item) => `/sites/${encodeURIComponent(siteId)}/media/${encodeURIComponent(item.filename)}`;
  const detailBody = $('media-detail-body');
  const setStatus = (text) => { $('media-detail-status').textContent = text || ''; };
  let shownId = null; // the item the panel is built for
  let paintToken = 0;

  const saver = createAltSaver({
    save: async (id, alt) => {
      try {
        const fresh = await api(`${base}/media/${encodeURIComponent(id)}`, { method: 'PUT', body: { alt } });
        const at = items.findIndex((i) => i.id === id);
        if (at >= 0) items[at] = fresh;
        render();
        if (shownId === id) { syncAltUi(fresh); setStatus('Saved'); }
      } catch (err) {
        const name = items.find((i) => i.id === id)?.filename || 'a file';
        showError(`Couldn't save the alt text for ${name}. ${err.message} Select the file and try again.`);
        if (shownId === id) setStatus('');
        throw err;
      }
    },
  });
  const flushAlt = () => saver.flush().catch(() => {}); // save() has already shown its error

  /** The alt field's look and the hint follow the stored state. */
  function syncAltUi(item) {
    const alt = detailBody.querySelector('#media-alt');
    if (!alt) return;
    const state = item.kind === 'image' ? (item.alt == null ? 'missing' : item.alt === '' ? 'decorative' : 'written') : 'written';
    alt.dataset.state = state;
    detailBody.querySelector('#media-alt-hint').hidden = state !== 'missing';
  }

  function previewEl(item, token) {
    const box = h('div', { class: 'detail-preview' });
    const src = displayUrl(item);
    if (item.missing) {
      box.append(h('p', { class: 'detail-missing' }, 'This file is missing from src/media.'));
    } else if (item.kind === 'image') {
      box.append(h('img', { src, alt: item.alt || '' }));
    } else if (item.kind === 'audio') {
      box.append(h('audio-player', {}, h('audio', { controls: true, src })));
    } else if (item.kind === 'video') {
      box.append(h('video-player', {}, h('video', { controls: true, src })));
    } else if (item.kind === 'pdf') {
      box.dataset.kind = 'pdf';
      import('/assets/pdf-viewer/pdf-viewer.js').then(() => {
        if (token === paintToken) box.append(h('pdf-viewer', { src, 'no-print': true }));
      }).catch(() => {
        if (token === paintToken) box.append(h('p', { class: 'detail-missing' }, "Couldn't load the PDF viewer. Reload the page to try again."));
      });
    }
    return box;
  }

  function altField(item) {
    const alt = h('textarea', { id: 'media-alt', rows: '3', placeholder: ALT_PLACEHOLDER, 'aria-describedby': 'media-alt-hint' });
    alt.value = item.alt || '';
    alt.disabled = item.alt === '';
    const hint = h('p', { id: 'media-alt-hint', class: 'detail-hint' }, ALT_HINT);
    const deco = h('input', { type: 'checkbox', id: 'media-decorative' });
    deco.checked = item.alt === '';
    alt.addEventListener('input', () => {
      setStatus('');
      saver.change(item.id, alt.value === '' ? null : alt.value);
    });
    deco.addEventListener('change', () => {
      setStatus('');
      alt.value = '';
      alt.disabled = deco.checked;
      saver.change(item.id, altForCheckbox(deco.checked));
      flushAlt();
      if (!deco.checked) alt.focus();
    });
    return h('div', { class: 'detail-group' },
      h('label', { for: 'media-alt', class: 'detail-label' }, 'Alt text'),
      alt, hint,
      h('label', { class: 'detail-check' }, deco, 'Decorative (alt="")'));
  }

  function urlField(model) {
    const code = h('code', { class: 'detail-url', id: 'media-url' }, model.url);
    const copy = h('button', { type: 'button' }, 'Copy');
    let timer = null;
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(model.url);
        setStatus('');
        copy.textContent = 'Copied';
        clearTimeout(timer);
        timer = setTimeout(() => { copy.textContent = 'Copy'; }, 2000);
      } catch {
        const range = document.createRange();
        range.selectNodeContents(code);
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        setStatus("Couldn't copy. The URL is selected; press Ctrl+C or ⌘C.");
      }
    });
    return h('div', { class: 'detail-group' },
      h('p', { class: 'detail-label' }, 'URL'),
      h('div', { class: 'detail-url-row' }, code, copy));
  }

  function usedInList(model) {
    const group = h('div', { class: 'detail-group' }, h('p', { class: 'detail-label' }, 'Used in'));
    if (!model.usedIn.length) {
      group.append(h('p', { class: 'detail-muted' }, 'Not used in any post.'));
      return group;
    }
    group.append(h('ul', { class: 'detail-used' }, ...model.usedIn.map((u) =>
      h('li', {}, h('a', { href: u.href }, u.title), ` (${u.statusText})`))));
    return group;
  }

  async function deleteItem(item, message) {
    await flushAlt();
    const decision = deleteDecision(item);
    if (!decision.allowed) {
      message.textContent = decision.message;
      message.hidden = false;
      return;
    }
    message.hidden = true;
    const yes = await document.querySelector('confirm-panel').ask({ heading: decision.heading, body: decision.body, confirm: decision.confirm });
    if (!yes) return;
    // The next tile in view order, else the one before.
    const order = filterMedia(items, view).map((i) => i.id);
    const at = order.indexOf(item.id);
    const nextId = order[at + 1] ?? order[at - 1] ?? null;
    try {
      await api(`${base}/media/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
    } catch (err) {
      message.textContent = err.message;
      message.hidden = false;
      return;
    }
    items = items.filter((i) => i.id !== item.id);
    selectedId = null;
    render();
    select(nextId);
    ($('media-grid').querySelector('.media-tile[aria-pressed="true"]') || $('media-upload')).focus();
    refresh();
  }

  /** Build the panel for one item (or the empty panel for null). */
  function renderDetail(item) {
    const token = ++paintToken;
    shownId = item ? item.id : null;
    setStatus('');
    const aside = $('media-detail');
    if (!item) {
      aside.removeAttribute('aria-labelledby');
      aside.setAttribute('aria-label', 'File details');
      detailBody.replaceChildren(h('p', { class: 'detail-muted' }, 'Select a file to see its details.'));
      return;
    }
    const model = detailModel(item, { siteId, locale: navigator.language });
    aside.removeAttribute('aria-label');
    aside.setAttribute('aria-labelledby', 'detail-title');
    const message = h('p', { class: 'error', role: 'alert', hidden: true });
    const del = h('button', { type: 'button', class: 'danger-text' }, 'Delete…');
    del.addEventListener('click', () => deleteItem(item, message));
    const actions = h('div', { class: 'detail-actions' });
    if (model.canEdit) {
      const edit = h('button', { type: 'button', 'data-action': 'edit-image' }, 'Edit image');
      // Task 8 listens for this and opens the image editor.
      edit.addEventListener('click', () => root.dispatchEvent(new CustomEvent('media-edit', { detail: { item } })));
      actions.append(edit);
    }
    actions.append(del);
    detailBody.replaceChildren(
      previewEl(item, token),
      h('div', {},
        h('h2', { id: 'detail-title' }, model.title),
        model.original ? h('p', { class: 'detail-muted' }, `Uploaded as ${model.original}`) : null,
        h('p', { class: 'detail-muted' }, model.meta),
        model.dims ? h('p', { class: 'detail-muted' }, model.dims) : null),
      model.showAlt ? altField(item) : null,
      urlField(model),
      usedInList(model),
      message,
      actions);
    if (model.showAlt) syncAltUi(item);
  }

  /** @param {string|null} id @param {{ focusAlt?: boolean }} [opts] */
  function select(id, { focusAlt = false } = {}) {
    if (id !== shownId) flushAlt(); // the pending alt is saved to the item it was typed for
    selectedId = id;
    for (const btn of $('media-grid').querySelectorAll('.media-tile')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.id === id));
    }
    const item = items.find((i) => i.id === id) || null;
    if (!item) selectedId = null;
    renderDetail(item);
    if (focusAlt && item && needsAlt(item)) detailBody.querySelector('#media-alt')?.focus();
    root.dispatchEvent(new CustomEvent('media-select', { detail: { item } }));
  }

  /** Select the file with this name (a deep link). Returns whether it was found. */
  function selectByFilename(name) {
    const hit = name && items.find((i) => i.filename === name);
    if (!hit) return false;
    select(hit.id);
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
    window.addEventListener(type, (e) => { if (!root.hidden && hasFiles(e)) e.preventDefault(); });
  }

  // --- Show and hide ---
  // Called by the site page each time the section is shown (including the first) and when it is left.
  async function show() {
    await refresh();
    selectByFilename(new URLSearchParams(location.search).get('file'));
  }
  const hide = () => flushAlt();
  renderDetail(null);

  return { refresh, select, selectByFilename, show, hide };
}
