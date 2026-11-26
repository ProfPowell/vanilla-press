/**
 * One collection's items: a table (thumbnail, title, status, level, updated) with a text
 * filter and New item, and the item editor in its place when one is opened. Renders and wires
 * events only; the rules live on the server.
 * @module collection-items
 */
import { api, h, formatDate } from './app-api.js';
import { effectiveLevel } from '../../../src/catalogs/model.js';
import { createItemEditor } from './collection-item-editor.js';

const levelName = (level) => ({ public: 'Public', friends: 'Friends' }[level] || 'Private');

/**
 * @param {{ siteId: string, container: HTMLElement, catalog: Object, agencies: Object,
 *   confirm: (q: Object) => Promise<boolean>,
 *   onCounts?: (counts: {itemCount: number, publishedCount: number}) => void,
 *   upload?: Function, downscale?: Function }} opts
 * @returns {{ show: () => Promise<void>, isDirty: () => boolean }}
 */
export function createItemsView({ siteId, container, catalog, agencies, confirm, onCounts, upload, downscale }) {
  const base = `/api/sites/${encodeURIComponent(siteId)}/catalogs/${encodeURIComponent(catalog.id)}/items`;
  let items = [];
  let tags = [];
  let editor = null; // the open item editor, when there is one
  let latest = 0;
  const parts = {};

  const reportCounts = () => onCounts?.({ itemCount: items.length, publishedCount: items.filter((i) => i.status === 'published').length });
  const setError = (message) => { parts.error.textContent = message || ''; parts.error.hidden = !message; };

  function row(item) {
    const main = (item.photos || []).find((p) => p.main) || item.photos?.[0];
    const open = h('button', { type: 'button', 'data-role': 'open', class: 'item-open' }, item.title || 'Untitled');
    open.addEventListener('click', () => openEditor(item.id));
    return h('tr', { 'data-item-id': item.id, 'data-title': (item.title || '').toLowerCase() },
      h('td', {}, main ? h('img', { class: 'item-thumb', src: `/sites/${encodeURIComponent(siteId)}/media/${encodeURIComponent(main.file)}`, alt: '', loading: 'lazy', width: '48', height: '48' }) : null),
      h('td', {}, open),
      h('td', {}, item.status === 'published' ? 'Published' : 'Draft'),
      h('td', {}, levelName(effectiveLevel(catalog, item))),
      h('td', {}, formatDate(item.updated)));
  }

  function applyFilter() {
    const needle = parts.filter.value.trim().toLowerCase();
    let shown = 0;
    for (const tr of parts.body.children) {
      const match = !needle || tr.getAttribute('data-title').includes(needle);
      tr.toggleAttribute('hidden', !match);
      if (match) shown++;
    }
    parts.empty.hidden = shown > 0;
    parts.empty.textContent = items.length ? 'No items match.' : 'No items yet. Add one with its title.';
  }

  function drawList() {
    const sorted = [...items].sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
    parts.body.replaceChildren(...sorted.map(row));
    applyFilter();
  }

  async function load() {
    const mine = ++latest;
    try {
      const data = await api(base);
      if (mine !== latest) return;
      items = data.items;
      tags = data.tags || [];
      setError('');
    } catch (err) {
      if (mine === latest) setError(err.message);
      return;
    }
    reportCounts();
    drawList();
  }

  async function openEditor(itemId) {
    setError('');
    let item;
    try { item = await api(`${base}/${encodeURIComponent(itemId)}`); } catch (err) { setError(err.message); return; }
    const holder = h('div', { class: 'item-editor' });
    editor = createItemEditor({
      siteId, container: holder, catalog, item, tags, agencies, confirm, upload, downscale,
      onSaved(saved) {
        items = items.some((i) => i.id === saved.id) ? items.map((i) => (i.id === saved.id ? saved : i)) : [...items, saved];
        reportCounts();
      },
    });
    editor.backButton.addEventListener('click', closeEditor);
    container.replaceChildren(holder);
    holder.querySelector('#item-title')?.focus?.();
  }

  async function closeEditor() {
    if (editor?.isDirty()) {
      const discard = await confirm({
        title: 'Discard unsaved changes?', description: 'This item has changes that are not saved. Leaving it throws them away.',
        ok: 'Discard changes', busyText: 'Leaving…',
      });
      if (!discard) return;
    }
    editor = null;
    container.replaceChildren(parts.list);
    await load();
    parts.newButton.focus?.();
  }

  async function createItem() {
    const title = parts.newTitle.value.trim();
    if (!title) { setError('Give the item a title.'); parts.newTitle.focus?.(); return; }
    setError('');
    try {
      const created = await api(base, { method: 'POST', body: { title } });
      parts.newTitle.value = '';
      items = [...items, created];
      reportCounts();
      await openEditor(created.id);
    } catch (err) {
      setError(err.data?.errors?.join(' ') || err.message);
    }
  }

  // --- Build ---
  parts.error = h('p', { id: 'items-error', class: 'error', role: 'alert', hidden: true });
  parts.newTitle = h('input', { type: 'text', id: 'items-new-title', maxlength: '160', placeholder: 'Title of the new item', 'aria-label': 'Title of the new item', autocomplete: 'off' });
  parts.newTitle.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); createItem(); } });
  parts.newButton = h('button', { type: 'button', id: 'items-new', class: 'primary' }, 'New item');
  parts.newButton.addEventListener('click', createItem);
  parts.filter = h('input', { type: 'search', id: 'items-filter', placeholder: 'Filter by title', 'aria-label': 'Filter items by title', autocomplete: 'off' });
  parts.filter.addEventListener('input', applyFilter);
  parts.body = h('tbody', {});
  parts.empty = h('p', { class: 'empty', hidden: true });
  parts.list = h('div', { class: 'items-list' },
    parts.error,
    h('div', { class: 'design-add' }, parts.newTitle, parts.newButton, parts.filter),
    h('table', { class: 'design-fields items-table' },
      h('thead', {}, h('tr', {}, ...['Photo', 'Title', 'Status', 'Who can see it', 'Updated'].map((t) => h('th', { scope: 'col' }, t)))),
      parts.body),
    parts.empty);
  container.replaceChildren(parts.list);

  return {
    /** Draw the list (fresh from the server), unless an item is open: that stays as it is. */
    async show() { if (!editor) await load(); },
    isDirty: () => !!editor?.isDirty(),
  };
}
