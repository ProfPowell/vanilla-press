/**
 * The layout editor's preview pane: the unsaved layout rendered around a
 * document by the site's own Cook, in a sandboxed iframe.
 *
 * - The iframe is `sandbox="allow-scripts"` (never `allow-same-origin`, so
 *   the page can't reach the editor) with `referrerpolicy="no-referrer"`.
 *   It loads from the site's preview server (`layout-preview.js`), whose
 *   URL is the same for every render, so each render adds `?v=<n>`.
 * - The document select lists documents that aren't archived, and defaults to the most recent document whose
 *   effective layout (its own, else its collection's) is this one, else the
 *   most recent post, else `Sample page`.
 * - `Desktop` / `Narrow` set `data-width`, sized as the Theme preview's.
 * - `schedule()` renders 600 ms after the last edit: the tree is serialized
 *   by the site's Cook (`POST …/layout-files/serialize`) and sent as the
 *   override for this layout (or include) with `POST …/layout-preview`.
 * - A failed render (`{ ok: false, log }`, an error status, no network)
 *   shows the log's last lines as text in the pane; the editor carries on
 *   (Review Focus 4). Nothing here throws into the editor.
 *
 * @module editor/layout-editor/preview-pane
 */

import { collectionOutput } from '../../../../src/sync/paths.js';

export const PREVIEW_DELAY_MS = 600;
export const SAMPLE_PAGE = 'Sample page';
/** Lines of a failed build's log shown in the pane. */
export const LOG_LINES = 30;

const WIDTHS = [['desktop', 'Desktop'], ['narrow', 'Narrow']];

const stamp = (doc) => {
  const t = Date.parse(doc?.meta?.updated || doc?.meta?.created || '');
  return Number.isNaN(t) ? 0 : t;
};

/** A document the select offers: not archived. */
const previewable = (d) => d && typeof d.id === 'string' && d.meta && typeof d.meta === 'object' && d.meta.status !== 'archived';

/**
 * The document to preview a layout with: the most recent whose effective
 * layout is `layout`, else the most recent post, else null (the sample page).
 * @param {Array<{ id: string, meta: Object }>} docs
 * @param {Object} collectionsConfig - the site's `collections` config
 * @param {string} layout
 * @returns {Object|null}
 */
export function defaultPreviewDocument(docs, collectionsConfig, layout) {
  const recent = (Array.isArray(docs) ? docs : [])
    .filter(previewable)
    .sort((a, b) => stamp(b) - stamp(a));
  const effective = (d) => d.meta.layout || collectionOutput(d.meta.collection, collectionsConfig || {}).layout;
  return recent.find(d => effective(d) === layout)
    || recent.find(d => d.meta.collection === 'posts')
    || null;
}

/** The last `n` lines of a log. */
export function logTail(log, n = LOG_LINES) {
  const lines = String(log ?? '').replace(/\s+$/, '').split('\n');
  return lines.slice(-n).join('\n');
}

function el(tag, attrs = {}, text = null) {
  const out = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    out.setAttribute(k, v === true ? '' : v);
  }
  if (text !== null) out.textContent = text;
  return out;
}

/** A select's chosen value (the selected option's, so it works where `.value` is read-only). */
function selectValue(select) {
  const chosen = [...select.querySelectorAll('option')].find(o => o.selected);
  return chosen ? chosen.value : select.value;
}

let ids = 0;

/**
 * The preview pane in `el`.
 * @param {{ el: Element, site: string, kind: 'layout'|'include', name: string, getTree: () => Object,
 *   fetch?: typeof fetch, layout?: string|null, delay?: number }} opts -
 *   layout: the layout to render the page with (default: this layout's name; an include needs one);
 *   getTree: the unsaved tree (may throw: the pane says why)
 * @returns {{ ready: Promise<void>, schedule: () => void, render: () => Promise<void>,
 *   setWidth: (w: string) => void, destroy: () => void }}
 */
export function createPreviewPane({
  el: root, site, kind, name, getTree, fetch = globalThis.fetch, layout = null, delay = PREVIEW_DELAY_MS,
}) {
  const api = `/api/sites/${encodeURIComponent(site)}`;
  const prefix = `le-preview-${++ids}`;
  const pageLayout = layout || (kind === 'layout' ? name : null);
  let timer = null;
  let version = 0;
  let destroyed = false;
  /** Bumped by each render: an older render's answer is dropped. */
  let seq = 0;

  // MARKUP
  // -----------------------------
  const head = el('div', { class: 'le-preview-head' });
  const docLabel = el('label', { for: `${prefix}-doc`, class: 'le-preview-doc' }, 'Preview with ');
  const docSelect = el('select', { id: `${prefix}-doc`, 'data-lp-doc': true });
  docSelect.append(el('option', { value: '' }, SAMPLE_PAGE));
  docLabel.append(docSelect);
  const widths = el('div', { role: 'group', 'aria-label': 'Preview width', class: 'segmented le-preview-widths' });
  for (const [value, text] of WIDTHS) {
    widths.append(el('button', { type: 'button', 'data-width': value, 'aria-pressed': value === 'desktop' ? 'true' : 'false' }, text));
  }
  head.append(docLabel, widths);
  const status = el('p', { class: 'le-preview-status', 'data-lp-status': true, role: 'status', 'aria-live': 'polite' });
  const log = el('pre', { class: 'le-preview-log', 'data-lp-log': true, hidden: true });
  const stage = el('div', { class: 'le-preview-stage' });
  const frame = el('iframe', {
    class: 'le-preview-frame',
    'data-width': 'desktop',
    title: `Preview of the ${name} ${kind === 'include' ? 'include' : 'layout'}`,
    sandbox: 'allow-scripts',
    referrerpolicy: 'no-referrer',
    allow: "autoplay 'none'; fullscreen 'none'",
  });
  stage.append(frame);
  root.replaceChildren(head, status, log, stage);

  // STATE SHOWN
  // -----------------------------
  function say(text) {
    status.textContent = text;
  }

  function showLog(text) {
    log.textContent = logTail(text);
    log.hidden = !text;
    root.toggleAttribute?.('data-lp-failed', Boolean(text));
  }

  function setWidth(width) {
    if (!WIDTHS.some(([w]) => w === width)) return;
    frame.dataset.width = width;
    for (const btn of widths.querySelectorAll('button[data-width]')) {
      btn.setAttribute('aria-pressed', btn.dataset.width === width ? 'true' : 'false');
    }
  }

  // REQUESTS
  // -----------------------------
  async function getJson(url, init) {
    const res = await fetch(url, init);
    const data = await res.json().catch(() => ({}));
    return { res, data: data ?? {} };
  }

  const post = (url, body) => getJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const problemText = (p) => (typeof p === 'string' ? p : p?.line ? `Line ${p.line}: ${p.message}` : String(p?.message ?? p));

  /** Render now (the debounce calls this). Never throws. */
  async function render() {
    if (destroyed) return;
    clearTimeout(timer);
    timer = null;
    const mine = ++seq;
    const stale = () => destroyed || mine !== seq;
    if (!pageLayout) {
      say('There is no layout to preview this include with.');
      return;
    }
    say('Rendering…');
    try {
      let tree;
      try {
        tree = getTree();
      } catch (err) {
        say('');
        showLog(`This layout can't be previewed: ${err.message}`);
        return;
      }
      const ser = await post(`${api}/layout-files/serialize`, { tree, kind });
      if (stale()) return;
      if (!ser.res.ok || typeof ser.data.html !== 'string') {
        const problems = (ser.data.problems || []).map(problemText);
        say('');
        showLog([ser.data.error || `Couldn't prepare the preview (${ser.res.status})`, ...problems].join('\n'));
        return;
      }
      const body = {
        layouts: kind === 'include' ? {} : { [name]: ser.data.html },
        includes: kind === 'include' ? { [name]: ser.data.html } : {},
        layout: pageLayout,
      };
      const docId = selectValue(docSelect);
      if (docId) body.docId = docId;
      const out = await post(`${api}/layout-preview`, body);
      if (stale()) return;
      if (!out.res.ok) {
        say('');
        showLog(out.data.error || `Couldn't preview (${out.res.status})`);
        return;
      }
      if (!out.data.ok) {
        say('The preview build failed:');
        showLog(out.data.log || 'The build failed without a log.');
        return;
      }
      say('');
      showLog('');
      const url = new URL(out.data.url, globalThis.location?.href ?? 'http://127.0.0.1/');
      url.searchParams.set('v', String(++version));
      frame.setAttribute('src', url.href);
    } catch (err) {
      if (stale()) return;
      say('');
      showLog(`Couldn't preview: ${err?.message ?? err}`);
    }
  }

  /** Render `delay` ms after the last call. */
  function schedule() {
    if (destroyed) return;
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; render(); }, delay);
  }

  /** The documents and the collections config, for the select; on failure, the sample page. */
  async function loadDocuments() {
    let docs = [];
    let collections = {};
    try {
      const { res, data } = await getJson(`${api}/documents`);
      if (res.ok && Array.isArray(data)) docs = data;
    } catch { /* the sample page */ }
    try {
      const { res, data } = await getJson(`${api}/config/collections`);
      const parsed = res.ok && typeof data.value === 'string' ? JSON.parse(data.value) : null;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) collections = parsed;
    } catch { /* defaults */ }
    if (destroyed) return;
    const recent = docs
      .filter(previewable)
      .sort((a, b) => stamp(b) - stamp(a));
    const pick = pageLayout ? defaultPreviewDocument(recent, collections, pageLayout) : null;
    const options = [el('option', { value: '' }, SAMPLE_PAGE)];
    for (const d of recent) {
      const label = `${d.meta.title || d.meta.slug || d.id}${d.meta.collection ? ` (${d.meta.collection})` : ''}`;
      options.push(el('option', { value: d.id }, label));
    }
    docSelect.replaceChildren(...options);
    (options.find(o => o.value === (pick?.id ?? '')) || options[0]).selected = true;
  }

  const onWidth = (e) => {
    const btn = e.target.closest?.('button[data-width]');
    if (btn) setWidth(btn.dataset.width);
  };
  const onDoc = () => { render(); };
  widths.addEventListener('click', onWidth);
  docSelect.addEventListener('change', onDoc);

  const ready = (async () => {
    await loadDocuments();
    await render();
  })().catch(() => {});

  return {
    ready,
    schedule,
    render,
    setWidth,
    destroy() {
      destroyed = true;
      clearTimeout(timer);
      timer = null;
      widths.removeEventListener('click', onWidth);
      docSelect.removeEventListener('change', onDoc);
    },
  };
}
