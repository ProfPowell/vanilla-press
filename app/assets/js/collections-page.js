/**
 * The Collections section: the list of collections, New collection (from a template), and
 * one collection's view with an Items tab (a mount point for the items list) and a Design tab
 * (collection-design.js). Renders and wires events; the rules live on the server. Questions
 * are native <dialog>s (see theme-dialogs.js), never browser prompts.
 * @module collections-page
 */
import { api, h } from './app-api.js';
import { openDialog } from './theme-dialogs.js';
import { createDesignEditor } from './collection-design.js';

const levelName = (level) => ({ public: 'Public', friends: 'Friends' }[level] || 'Private');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * @param {{ siteId: string, root: HTMLElement }} opts
 * @returns {{ show: () => Promise<void>, hide: () => Promise<void> }}
 */
export function initCollectionsSection({ siteId, root }) {
  const base = `/api/sites/${encodeURIComponent(siteId)}/catalogs`;
  const $ = (id) => root.querySelector(`#${id}`);
  const sectionHref = (query = '') => `site.html?site=${encodeURIComponent(siteId)}&section=collections${query}`;
  let collections = [];
  let templates = null; // { templates, agencies }, loaded once
  let route = { catalogId: null, tab: 'items' };
  const drafts = new Map(); // catalog id -> { editor, container }: kept across tabs, views and hide/show
  let latest = 0;

  const showError = (message) => {
    $('collections-error').textContent = message || '';
    $('collections-error').hidden = !message;
  };

  // --- Addresses: ?catalog=<id>&tab=design ---
  function readRoute() {
    const q = new URLSearchParams(globalThis.location?.search || '');
    return { catalogId: q.get('catalog') || null, tab: q.get('tab') === 'design' ? 'design' : 'items' };
  }
  const routeHref = (r) => sectionHref(r.catalogId ? `&catalog=${encodeURIComponent(r.catalogId)}${r.tab === 'design' ? '&tab=design' : ''}` : '');

  /** Move to a view: updates the address, then draws it. */
  async function go(next) {
    if (route.catalogId && next.catalogId !== route.catalogId) {
      const draft = drafts.get(route.catalogId);
      if (draft?.editor.isDirty()) {
        const discard = await confirm({
          title: 'Discard unsaved design changes?',
          description: 'This collection\u2019s design has changes that are not saved. Leaving it throws them away.',
          ok: 'Discard changes', busyText: 'Leaving\u2026',
        });
        if (!discard) return;
      }
      drafts.delete(route.catalogId);
    }
    route = next;
    if (typeof history !== 'undefined') history.pushState(null, '', routeHref(route));
    await render();
  }

  // --- Dialogs ---
  /** A yes/no question with an optional list. Resolves true only when confirmed. */
  function confirm({ title, description, items = [], ok = 'OK', busyText = 'Working…' }) {
    const dialog = $('collections-confirm-dialog');
    $('collections-confirm-title').textContent = title;
    $('collections-confirm-desc').textContent = description;
    $('collections-confirm-list').replaceChildren(...items.map((text) => h('li', {}, text)));
    $('collections-confirm-ok').textContent = ok;
    return new Promise((resolve) => {
      let answered = false;
      dialog.addEventListener('close', () => resolve(answered), { once: true });
      openDialog(dialog, {
        opener: globalThis.document?.activeElement, first: $('collections-confirm-ok'), error: $('collections-confirm-error'),
        ok: $('collections-confirm-ok'), busyText,
        submit: async () => { answered = true; },
      });
    });
  }

  function openNewDialog(opener) {
    const select = $('collections-new-template');
    const options = [...templates.templates.map((t) => ({ value: t.id, label: t.label, description: t.description })),
      { value: 'blank', label: 'Blank', description: 'No fields yet: add your own.' }];
    select.replaceChildren(...options.map((o) => h('option', { value: o.value }, o.label)));
    const hint = () => { $('collections-new-hint').textContent = options.find((o) => o.value === select.value)?.description || ''; };
    select.onchange = hint;
    hint();
    $('collections-new-title').value = '';
    openDialog($('collections-new-dialog'), {
      opener, first: $('collections-new-title'), error: $('collections-new-error'), ok: $('collections-new-ok'), busyText: 'Creating…',
      submit: async () => {
        const title = $('collections-new-title').value.trim();
        if (!title) return 'Give the collection a title.';
        const created = await api(base, { method: 'POST', body: { title, template: select.value } });
        collections = [...collections, { ...created, itemCount: 0, publishedCount: 0 }];
        await go({ catalogId: created.id, tab: 'design' });
      },
    });
  }

  // --- The list ---
  function renderList() {
    $('collections-summary').textContent = collections.length ? plural(collections.length, 'collection') : '';
    $('collections-empty').hidden = collections.length > 0;
    $('collections-list').replaceChildren(...collections.map((c) => {
      const itemCount = c.itemCount ?? 0;
      return h('li', { class: 'collections-row', 'data-id': c.id },
        h('a', { href: routeHref({ catalogId: c.id, tab: 'items' }), class: 'collections-name' }, c.title),
        h('span', { class: 'collections-level', 'data-level': c.access }, levelName(c.access)),
        h('span', { class: 'collections-counts' }, `${plural(itemCount, 'item')} · ${c.publishedCount ?? 0} published`));
    }));
  }

  // --- One collection ---
  function renderCollection() {
    const c = collections.find((x) => x.id === route.catalogId);
    if (!c) {
      showError('That collection was not found.');
      return false;
    }
    $('collection-title').textContent = c.title;
    $('collection-summary').textContent =
      `${levelName(c.access)} · ${plural(c.itemCount ?? 0, 'item')} · ${c.publishedCount ?? 0} published`;
    $('collection-back').setAttribute('href', sectionHref());
    for (const b of $('collection-tabs').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.tab === route.tab));
    $('collection-items').hidden = route.tab !== 'items';
    $('collection-design').hidden = route.tab !== 'design';
    if (route.tab === 'design') {
      // An edited design stays as it is; a clean one is rebuilt so it shows the latest counts.
      let draft = drafts.get(c.id);
      if (!draft || !draft.editor.isDirty()) {
        const container = h('div', { class: 'design-editor' });
        draft = {
          container,
          editor: createDesignEditor({
            siteId, container, catalog: c, agencies: templates.agencies, confirm,
            onSaved(saved) {
              collections = collections.map((x) => (x.id === saved.id ? { ...x, ...saved, itemCount: x.itemCount, publishedCount: saved.publishedCount ?? x.publishedCount } : x));
              $('collection-title').textContent = saved.title;
            },
          }),
        };
        drafts.set(c.id, draft);
      }
      $('collection-design').replaceChildren(draft.container);
    }
    return true;
  }

  async function render() {
    showError('');
    const one = !!route.catalogId;
    $('collections-list-view').hidden = one;
    $('collection-view').hidden = !one;
    if (one) {
      if (!renderCollection()) {
        route = { catalogId: null, tab: 'items' };
        $('collections-list-view').hidden = false;
        $('collection-view').hidden = true;
        renderList();
      }
    } else {
      renderList();
    }
  }

  async function refresh() {
    const mine = ++latest;
    try {
      const [list, tpl] = await Promise.all([api(base), templates || api(`${base}/templates`)]);
      if (mine !== latest) return;
      collections = list.catalogs;
      templates = tpl;
      showError('');
    } catch (err) {
      if (mine === latest) showError(err.message);
      return;
    }
    await render();
  }

  // --- Events ---
  $('collections-new').addEventListener('click', () => { if (templates) openNewDialog($('collections-new')); });
  root.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button > 0) return;
    const tab = e.target.closest?.('#collection-tabs button[data-tab]');
    if (tab) { go({ catalogId: route.catalogId, tab: tab.dataset.tab }); return; }
    const a = e.target.closest?.('#collections-list a, #collection-back');
    if (!a) return;
    e.preventDefault();
    const id = new URL(a.getAttribute('href'), 'http://x/').searchParams.get('catalog');
    go({ catalogId: id, tab: 'items' });
  });

  // Called by the site page each time the section is shown (including the first) and when it is left.
  async function show() {
    route = readRoute();
    await refresh();
  }
  async function hide() { /* nothing is pending: the design editor keeps its edits until the section is drawn again */ }

  return { show, hide };
}
