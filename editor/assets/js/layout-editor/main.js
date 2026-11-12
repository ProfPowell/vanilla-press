/**
 * The layout editor page (editor/layout.html?site=&kind=&name=): loads the
 * layout's tree, shows it on the canvas (views.js) with the `/` palette
 * (palette.js), and the bar above it: label, description, page structure,
 * Abstract (base only), Head (base only: head-dialog.js) and Save.
 *
 * Save PUTs the tree with the hash the layout was opened with. A 409 says
 * `This layout changed on disk since you opened it` with `Reload` (nothing
 * was written); a 422 lists Cook's problems; a success keeps the new hash.
 * Leaving with unsaved changes asks first in the page's `<confirm-panel>`
 * (as the post editor asks; never a browser confirm()); closing the tab
 * gets the browser's own leave-page warning.
 *
 * The inspector (inspector.js) shows the selected block's settings in
 * `[data-le-inspector]`, with the site's fields, lists and components from
 * `GET …/layout-files/context`; its changes are transactions (a slot
 * label, kept in meta, marks the layout unsaved). The preview pane
 * (preview-pane.js) mounts in `[data-le-preview]` and re-renders after each
 * edit; head edits live in meta (outside ProseMirror) and count as edits.
 *
 * @module editor/layout-editor/main
 */

import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { history, undo, redo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap } from 'prosemirror-commands';
import { layoutSchema } from './schema.js';
import { treeToDoc, docToTree } from './convert.js';
import { nodeViews, refreshSlotLabels, DOCUMENT_FIELDS } from './views.js';
import { createInspector } from './inspector.js';
import { LayoutPalette, palettePlugin, layoutRulesPlugin, fillEntries } from './palette.js';
import { createHeadDialog } from './head-dialog.js';
import { createPreviewPane, previewLayoutFor } from './preview-pane.js';
import '../components/confirm-panel.js';

/** Cook's VB page layouts (cook-ssg/layouts PAGE_LAYOUTS), without the empty value. */
export const PAGE_LAYOUTS = ['stack', 'sidebar-left', 'sidebar-right', 'holy-grail', 'app-shell', 'dashboard', 'article', 'landing'];

export const CHANGED_ON_DISK = 'This layout changed on disk since you opened it';
export const CHOSEN_BY_CHILDREN = 'Chosen by layouts built on this one';
const NO_PAGE_LAYOUT = '';

/** A problem from the server as text: `Line N: message`, or the string itself. */
const problemText = (p) => (typeof p === 'string' ? p : p?.line ? `Line ${p.line}: ${p.message}` : String(p?.message ?? p));

/**
 * Open a layout in the editor page's markup under `root`.
 * @param {{ root: Element, site: string, kind: 'layout'|'include', name: string, fetch?: typeof fetch,
 *   navigate?: (href: string) => void }} opts
 * @returns {Promise<{ view: EditorView|null, save: () => Promise<boolean>, isDirty: () => boolean,
 *   hash: () => string|null, meta: () => Object, tree: () => Object, headDialog: Object, palette: LayoutPalette,
 *   preview: () => Object|null,
 *   destroy: () => void }>}
 */
export async function openLayoutEditor({ root, site, kind, name, fetch = globalThis.fetch, navigate = (href) => { window.location.href = href; } }) {
  const $ = (sel) => root.querySelector(sel);
  const els = {
    back: $('[data-le-back]'),
    file: $('[data-le-file]'),
    fields: $('[data-le-info-fields]'),
    label: $('[data-le-label]'),
    description: $('[data-le-description]'),
    pageLayout: $('[data-le-page-layout]'),
    abstractField: $('[data-le-abstract-field]'),
    abstract: $('[data-le-abstract]'),
    add: $('[data-le-add]'),
    head: $('[data-le-head]'),
    save: $('[data-le-save]'),
    status: $('[data-le-status]'),
    canvas: $('[data-le-canvas]'),
    inspector: $('[data-le-inspector]'),
    preview: $('[data-le-preview]'),
    confirm: $('confirm-panel[data-confirm]'),
  };
  const url = `/api/sites/${encodeURIComponent(site)}/layout-files/${encodeURIComponent(kind)}/${encodeURIComponent(name)}`;
  const backHref = `/app/site.html?site=${encodeURIComponent(site)}&section=layouts`;
  const contextUrl = `/api/sites/${encodeURIComponent(site)}/layout-files/context`;
  const layoutsUrl = `/api/sites/${encodeURIComponent(site)}/layouts`;

  let view = null;
  let meta = null;
  let hash = null;
  let dirty = false;
  /** Bumped by every edit (canvas or bar): a save clears `dirty` only when nothing changed while it ran. */
  let edits = 0;
  let saving = false;
  const palette = new LayoutPalette();
  /** The inspector's site context; document fields until the route answers. */
  let context = { documentFields: DOCUMENT_FIELDS };
  const inspector = els.inspector ? createInspector({
    el: els.inspector,
    getView: () => view,
    getMeta: () => meta,
    getContext: () => context,
    onMetaChange: () => {
      setDirty(true);
      if (view) refreshSlotLabels(view, meta);
    },
  }) : null;
  /** The Head dialog (a base only); its changes edit meta.head. */
  const headDialog = createHeadDialog({
    root,
    getMeta: () => meta,
    getContext: () => context,
    onChange: () => setDirty(true),
    getChildren: () => children,
  });
  /** A base's children (the listing's baseFor), for the Head dialog's note. */
  let children = [];
  /** A child's parent regions ({ name, label }), for the palette and the canvas labels. */
  let parentSlots = [];
  /** The preview pane, once the layout is open. */
  let preview = null;

  // STATUS
  // -----------------------------
  function showStatus(text, { tone = 'info', problems = [], reload = false } = {}) {
    els.status.replaceChildren();
    els.status.dataset.tone = tone;
    if (text) {
      const p = document.createElement('p');
      p.textContent = text;
      els.status.append(p);
    }
    if (problems.length) {
      const ul = document.createElement('ul');
      ul.className = 'le-problems';
      for (const problem of problems) {
        const li = document.createElement('li');
        li.textContent = problemText(problem);
        ul.append(li);
      }
      els.status.append(ul);
    }
    if (reload) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Reload';
      btn.addEventListener('click', () => load());
      els.status.append(btn);
    }
  }

  function setDirty(value) {
    if (value) edits++;
    dirty = value;
    root.toggleAttribute?.('data-le-dirty', value);
    // An error (Cook's problems, changed on disk) stays up until the next save or reload
    if (value && els.status.dataset.tone !== 'error') showStatus('Unsaved changes');
    if (value) preview?.schedule();
  }

  // THE BAR
  // -----------------------------
  function option(value, text) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = text;
    return o;
  }

  function fillBar() {
    els.file.textContent = `${kind === 'include' ? 'src/includes' : 'src/layouts'}/${name}.html`;
    const hasInfo = meta.kind !== 'fragment' && meta.info && typeof meta.info === 'object';
    els.fields.hidden = !hasInfo;
    els.head.hidden = meta.kind !== 'base';
    els.head.disabled = meta.kind !== 'base';
    if (!hasInfo) return;
    els.label.value = meta.info.label ?? '';
    els.description.value = meta.info.description ?? '';
    const choices = [option(NO_PAGE_LAYOUT, 'Not set'), ...PAGE_LAYOUTS.map(v => option(v, v))];
    if (meta.kind === 'base') choices.push(option('${pageLayout}', CHOSEN_BY_CHILDREN));
    const current = meta.pageLayout ?? NO_PAGE_LAYOUT;
    if (!choices.some(o => o.value === current)) choices.push(option(current, current));
    els.pageLayout.replaceChildren(...choices);
    choices.find(o => o.value === current).selected = true;
    els.abstractField.hidden = meta.kind !== 'base';
    els.abstract.checked = meta.info.abstract === true;
  }

  /** Set (or, when empty and it was never there, leave out) an info key. */
  function setInfo(key, value) {
    if (value === '' && !(key in meta.info)) return;
    meta.info[key] = value;
    setDirty(true);
  }

  const onLabel = () => setInfo('label', els.label.value);
  const onDescription = () => setInfo('description', els.description.value);
  const onPageLayout = () => {
    const value = selectValue(els.pageLayout);
    meta.pageLayout = value === NO_PAGE_LAYOUT ? null : value;
    setDirty(true);
  };
  const onAbstract = () => {
    if (els.abstract.checked) meta.info.abstract = true;
    else delete meta.info.abstract;
    setDirty(true);
  };
  const onAdd = () => {
    if (!view) return;
    view.focus();
    palette.open(view);
  };
  const onSave = () => { save(); };
  const onHead = () => {
    if (meta?.kind === 'base') headDialog.open();
  };
  const onBack = async (e) => {
    if (!dirty) return;
    e.preventDefault();
    const leave = await els.confirm?.ask({
      heading: 'Leave without saving?',
      body: 'Your changes to this layout are not saved. Leaving discards them.',
      confirm: 'Leave',
    });
    if (leave) {
      dirty = false;
      navigate(els.back.href);
    }
  };
  const onBeforeUnload = (e) => {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = '';
  };

  els.back.href = backHref;
  els.label.addEventListener('input', onLabel);
  els.description.addEventListener('input', onDescription);
  els.pageLayout.addEventListener('change', onPageLayout);
  els.abstract.addEventListener('change', onAbstract);
  els.add.addEventListener('click', onAdd);
  els.save.addEventListener('click', onSave);
  els.head.addEventListener('click', onHead);
  els.back.addEventListener('click', onBack);
  globalThis.addEventListener?.('beforeunload', onBeforeUnload);

  // THE CANVAS
  // -----------------------------
  function mount(tree) {
    const converted = treeToDoc(tree, layoutSchema);
    meta = converted.meta;
    const state = EditorState.create({
      schema: layoutSchema,
      doc: converted.doc,
      plugins: [
        // First: while the palette is open it owns the keys
        palettePlugin(palette),
        layoutRulesPlugin(),
        history(),
        keymap({
          'Mod-z': undo,
          'Shift-Mod-z': redo,
          'Mod-y': redo,
          'Mod-s': () => { save(); return true; },
        }),
        keymap(baseKeymap),
      ],
    });
    if (view) view.destroy();
    els.canvas.replaceChildren();
    view = new EditorView(els.canvas, {
      state,
      nodeViews: nodeViews(() => meta, () => parentSlots),
      dispatchTransaction(tr) {
        if (!view) return;
        view.updateState(view.state.apply(tr));
        if (tr.docChanged) setDirty(true);
        inspector?.update(view.state);
      },
    });
    fillBar();
    inspector?.render();
  }

  async function load() {
    let res, data;
    try {
      res = await fetch(url);
      data = await res.json().catch(() => ({}));
    } catch (err) {
      showStatus(`Couldn't open this layout: ${err.message}`, { tone: 'error' });
      return;
    }
    if (!res.ok) {
      const problems = data.problems || [];
      const text = res.status === 409 && problems.length
        ? `Can't be edited here: ${problemText(problems[0])}`
        : data.error || `Couldn't open this layout (${res.status})`;
      showStatus(text, { tone: 'error', problems: problems.slice(1) });
      els.save.disabled = true;
      return;
    }
    hash = data.hash;
    // Before mounting, so filled regions are drawn with the parent's labels
    await loadParentRegions(data.tree);
    mount(data.tree);
    els.save.disabled = false;
    dirty = false;
    root.toggleAttribute?.('data-le-dirty', false);
    showStatus('');
    if (!els.preview) return;
    if (preview) preview.schedule();
    else {
      // An include is previewed through a layout that includes it
      const through = kind === 'include' ? previewLayoutFor(await fetchListing(), name) : null;
      preview = createPreviewPane({
        el: els.preview, site, kind, name, fetch, layout: through,
        getTree: () => docToTree(view.state.doc, meta),
      });
    }
  }

  // SAVE
  // -----------------------------
  /** @returns {Promise<boolean>} whether the layout was written */
  async function save() {
    if (!view || saving) return false;
    saving = true;
    els.save.disabled = true;
    showStatus('Saving…');
    const sent = edits;
    try {
      let tree;
      try {
        tree = docToTree(view.state.doc, meta);
      } catch (err) {
        showStatus(`Couldn't save: ${err.message}`, { tone: 'error' });
        return false;
      }
      let res, data;
      try {
        res = await fetch(url, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tree, hash }),
        });
        data = await res.json().catch(() => ({}));
      } catch (err) {
        showStatus(`Couldn't save: ${err.message}`, { tone: 'error' });
        return false;
      }
      if (res.status === 409 && (!data.error || data.error === CHANGED_ON_DISK)) {
        showStatus(CHANGED_ON_DISK, { tone: 'error', reload: true });
        return false;
      }
      if (res.status === 422) {
        showStatus(data.error || "This layout can't be saved", { tone: 'error', problems: data.problems || [] });
        return false;
      }
      if (!res.ok) {
        showStatus(data.error || `Couldn't save (${res.status})`, { tone: 'error' });
        return false;
      }
      hash = data.hash;
      if (edits !== sent) {
        // Edited while the save ran: those edits are not in the file yet
        showStatus('Unsaved changes');
        return true;
      }
      dirty = false;
      root.toggleAttribute?.('data-le-dirty', false);
      showStatus('Saved · Not published', { tone: 'done' });
      return true;
    } finally {
      saving = false;
      els.save.disabled = false;
    }
  }

  /** The inspector's context (fields, lists, components); without it the inspector still works. */
  async function loadContext() {
    try {
      const res = await fetch(contextUrl);
      if (!res.ok) return;
      const data = await res.json();
      if (data && typeof data === 'object') {
        context = { ...data, documentFields: Array.isArray(data.documentFields) && data.documentFields.length ? data.documentFields : DOCUMENT_FIELDS };
        inspector?.render();
      }
    } catch { /* the inspector offers free text */ }
  }

  /** The layouts and includes listing, or null. */
  async function fetchListing() {
    try {
      const res = await fetch(`/api/sites/${encodeURIComponent(site)}/layout-files`);
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  }

  /** A base's children, from the layouts listing. */
  async function loadChildren() {
    if (meta?.kind !== 'base') return;
    try {
      const data = await fetchListing();
      if (!data) return;
      const entry = (Array.isArray(data?.layouts) ? data.layouts : []).find(l => l?.name === name);
      children = Array.isArray(entry?.baseFor) ? entry.baseFor.filter(n => typeof n === 'string') : [];
    } catch { /* the note names no layouts */ }
  }

  /**
   * A child's palette offers the parent's regions it doesn't fill yet, and its
   * filled regions show as `Region: <label>`, by the parent's labels.
   */
  async function loadParentRegions(tree) {
    if (tree?.kind !== 'child' || !tree.parent) return;
    try {
      const res = await fetch(layoutsUrl);
      if (!res.ok) return;
      const data = await res.json();
      const parent = (Array.isArray(data?.layouts) ? data.layouts : []).find(l => l?.name === tree.parent);
      parentSlots = Array.isArray(parent?.slots) ? parent.slots : [];
      palette.extraEntries = (state) => fillEntries(parentSlots, state.doc, tree.parent);
    } catch { /* the palette offers the usual blocks */ }
  }

  await load();
  await loadContext();
  await loadChildren();

  return {
    get view() { return view; },
    save,
    isDirty: () => dirty,
    hash: () => hash,
    meta: () => meta,
    tree: () => (view ? docToTree(view.state.doc, meta) : null),
    headDialog,
    palette,
    preview: () => preview,
    destroy() {
      view?.destroy();
      view = null;
      palette.destroy();
      inspector?.destroy();
      headDialog.destroy();
      preview?.destroy();
      preview = null;
      els.label.removeEventListener('input', onLabel);
      els.description.removeEventListener('input', onDescription);
      els.pageLayout.removeEventListener('change', onPageLayout);
      els.abstract.removeEventListener('change', onAbstract);
      els.add.removeEventListener('click', onAdd);
      els.save.removeEventListener('click', onSave);
      els.head.removeEventListener('click', onHead);
      els.back.removeEventListener('click', onBack);
      globalThis.removeEventListener?.('beforeunload', onBeforeUnload);
    },
  };
}

/** A select's chosen value (the selected option's, so it works where `.value` is read-only). */
function selectValue(select) {
  const chosen = [...select.options].find(o => o.selected);
  return chosen ? chosen.value : select.value;
}

/** The page: open the layout named by `?site=&kind=&name=`. */
export function start() {
  const params = new URLSearchParams(window.location.search);
  const root = document.querySelector('[data-layout-editor-page]');
  const site = params.get('site');
  const kind = params.get('kind') === 'include' ? 'include' : 'layout';
  const name = params.get('name');
  if (!root || !site || !name) {
    const status = root?.querySelector('[data-le-status]');
    if (status) status.textContent = 'Open a layout from the Layouts screen.';
    return null;
  }
  document.title = `${name} · Layout · Vanilla Press`;
  return openLayoutEditor({ root, site, kind, name });
}

if (globalThis.location?.pathname?.endsWith('/layout.html') && globalThis.document?.querySelector('[data-layout-editor-page]')) {
  start();
}
