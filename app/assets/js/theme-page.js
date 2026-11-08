/**
 * The Theme section: start from a theme, adjust it, see it live. The draft
 * (choices not applied yet) lives in this module until the page reloads, so
 * leaving the section and coming back keeps it. Rules live in theme-view.js,
 * DOM helpers in theme-preview.js. The custom theme library (save, import,
 * rename, delete) is theme-library.js, its dialogs theme-dialogs.js; Apply
 * and the live check are theme-apply-ui.js.
 *
 * The preview is a sandboxed iframe (no scripts) whose page links the site's
 * Vanilla Breeze, the theme and the adjustments, as the live site would: the
 * post's HTML never enters the app's document. Changes update that page's
 * <html> attributes and stylesheets in place.
 * @module theme-page
 */
import { api, h, formatDate } from './app-api.js';
import {
  draftFrom, isDirty, cardModels, schemeControl, schemeOf, pagesModel, vbNote, previewSrcdoc, baselineOf,
} from './theme-view.js';
import {
  ensureThemeCss, themeCssReady, themeCssLoaded, computeColors, themeHue, setPreviewCss, quietPreview,
} from './theme-preview.js';
import { initThemeLibrary, cardMenu } from './theme-library.js';
import { initApplyUi } from './theme-apply-ui.js';
import { adjustmentsCss, skippedTokens } from '../../../src/themes/theme-css.js';
import { ADJUST_ID } from '../../../src/themes/theme-setting.js';

const LAYOUT_HREF = '/app/assets/theme-preview-frame.css';
const VP_VB_HREF = '/assets/vb/vanilla-breeze.css';

const SAMPLE = {
  title: 'A sample post',
  paragraphs: [
    'This is how a post on your site reads with this theme: headings, body text, links and buttons.',
    'Write a post to see it here instead.',
  ],
};

/**
 * @param {{ siteId: string, root: HTMLElement }} opts
 */
export function initThemeSection({ siteId, root }) {
  const base = `/api/sites/${encodeURIComponent(siteId)}`;
  const $ = (id) => root.querySelector(`#${id}`);
  const prefersDark = matchMedia('(prefers-color-scheme: dark)');

  /** Server state from GET /theme, the applied draft, and the page's own state. */
  let state = null;
  let applied = draftFrom(null);
  let draft = draftFrom(null);
  /** Literal colors for the draft's hue (R7), and the hue they were computed for. */
  let colors = null;
  let colorsFor = '';
  const view = { query: '', expanded: false, width: 'desktop' };
  let siteName = '';

  const themeById = (id) => state?.themes.find((t) => t.id === id) || null;
  const currentTheme = () => themeById(draft.name) || { id: draft.name, name: draft.name };

  function showError(message) {
    $('theme-error').textContent = message || '';
    $('theme-error').hidden = !message;
  }

  // --- Cards ---
  function card(c) {
    const theme = themeById(c.id);
    ensureThemeCss(theme);
    const swatch = h('span', { class: 'theme-swatch', 'data-theme': c.id, 'aria-hidden': 'true' },
      h('span', { class: 'theme-swatch-aa' }, 'Aa'),
      h('span', { class: 'theme-swatch-bar' }));
    if (c.only) swatch.dataset.mode = c.only;
    const tier = c.only ? `${c.tierText} · ${c.only === 'light' ? 'Light only' : 'Dark only'}` : c.tierText;
    return h('li', { 'data-custom': c.custom || null },
      h('button', { type: 'button', class: 'theme-card', 'data-theme-id': c.id, 'aria-pressed': String(c.pressed) },
        swatch,
        h('span', { class: 'theme-card-text' },
          h('span', { class: 'theme-card-name' }, c.name),
          h('span', { class: 'theme-card-tier' }, tier))),
      c.custom ? cardMenu(c) : null);
  }


  function renderCards() {
    const m = cardModels(state.themes, { current: draft.name, query: view.query, expanded: view.expanded });
    $('theme-cards').replaceChildren(...m.cards.map(card));
    // More than a screenful scrolls in its own region, so Adjust stays near.
    $('theme-cards').toggleAttribute('data-scroll', m.cards.length > 8);
    const more = $('theme-more');
    more.hidden = !m.toggleText;
    more.textContent = m.toggleText || '';
    more.setAttribute('aria-expanded', String(view.expanded));
    const empty = $('theme-cards-empty');
    empty.textContent = view.query.trim() && !m.cards.length ? `No themes match "${view.query.trim()}".` : '';
    empty.hidden = !empty.textContent;
  }

  // --- Adjust ---
  // A fixed group stays focusable (aria-disabled) so its reason, linked with aria-describedby, is found.
  const pressGroup = (group, attr, value, disabled = false) => {
    for (const btn of $(group).querySelectorAll(`button[${attr}]`)) {
      btn.setAttribute('aria-pressed', String(btn.getAttribute(attr) === value));
      if (disabled) btn.setAttribute('aria-disabled', 'true');
      else btn.removeAttribute('aria-disabled');
    }
  };

  /** The theme's own hue, rounded as the slider shows it. */
  const ownHue = (theme) => Math.round(themeHue(root, theme.id, schemeOf(theme, draft.mode, prefersDark.matches)));

  function renderAdjust() {
    const theme = currentTheme();
    $('theme-adjust-title').textContent = `Adjust ${theme.name}`;
    const scheme = schemeControl(theme);
    pressGroup('theme-scheme', 'data-scheme', scheme.disabled ? theme.only : draft.mode, scheme.disabled);
    $('theme-scheme-note').textContent = scheme.note || '';
    $('theme-scheme-note').hidden = !scheme.note;
    if (scheme.note) $('theme-scheme').setAttribute('aria-describedby', 'theme-scheme-note');
    else $('theme-scheme').removeAttribute('aria-describedby');
    pressGroup('theme-corners', 'data-corners', draft.adjustments.corners);
    $('theme-heading-font').value = draft.adjustments.headingFont || '';
    $('theme-body-font').value = draft.adjustments.bodyFont || '';
    const hue = draft.adjustments.hue ?? ownHue(theme);
    $('theme-hue').value = String(Math.round(hue));
    $('theme-hue-value').textContent = `${Math.round(hue)}°`;
    $('theme-hue').setAttribute('aria-valuetext', `${Math.round(hue)} degrees${draft.adjustments.hue == null ? ", the theme's own" : ''}`);
  }

  // --- Preview ---
  const frame = $('theme-preview-frame');
  /** The preview iframe's document once it has loaded, else null. */
  let frameDoc = null;

  const previewScheme = () => schemeOf(currentTheme(), draft.mode, prefersDark.matches);

  /** Build the preview page (on load: the site name and preview post may have changed). */
  function buildPreview() {
    const post = state?.preview;
    $('theme-preview-post').textContent = post?.title ? ` · ${post.title}` : '';
    frameDoc = null;
    frame.srcdoc = previewSrcdoc({
      vbHref: state?.vb?.url || VP_VB_HREF,
      themeHref: currentTheme().href || null,
      layoutHref: LAYOUT_HREF,
      dataTheme: `${draft.name} ${ADJUST_ID}`,
      mode: previewScheme(),
      adjustCss: '',
      siteName,
      post: post ? { title: post.title, dateText: post.date ? formatDate(post.date) : '', html: post.html } : null,
      sample: SAMPLE,
    });
  }

  /** Fit the iframe to its page (no inner scrollbar). */
  function fitPreview() {
    if (!frameDoc?.documentElement) return;
    frame.style.blockSize = `${Math.ceil(frameDoc.documentElement.scrollHeight)}px`;
  }

  frame.addEventListener('load', () => {
    const doc = frame.contentDocument;
    if (!doc?.documentElement || frame.srcdoc === '') return;
    frameDoc = doc;
    quietPreview(doc);
    // Theme stylesheets, fonts and images change the page's height after it loads.
    doc.addEventListener('load', fitPreview, true);
    doc.fonts?.ready.then(fitPreview);
    syncPreview();
  });

  /** Put the draft on the preview page: ids and scheme on <html>, the theme's stylesheet, the adjustments. */
  function syncPreview(css = adjustmentsCss(adjustmentsWithColors())) {
    if (!frameDoc) return;
    const html = frameDoc.documentElement;
    html.setAttribute('data-theme', `${draft.name} ${ADJUST_ID}`);
    html.setAttribute('data-mode', previewScheme());
    const link = frameDoc.getElementById('vp-theme-css');
    const href = currentTheme().href;
    if (link && link.getAttribute('href') !== (href ?? null)) {
      if (href) link.setAttribute('href', href);
      else link.removeAttribute('href');
    }
    setPreviewCss(css, frameDoc);
    requestAnimationFrame(fitPreview);
  }

  /**
   * The adjustments with literal colors for the draft's hue, recomputed when the
   * hue or base changes. Colors are read only once the base theme's CSS is in
   * the app; before that none are returned (and none cached).
   */
  function adjustmentsWithColors() {
    const { hue } = draft.adjustments;
    if (hue == null) {
      colors = null;
      colorsFor = '';
    } else if (colorsFor !== `${draft.name}:${hue}`) {
      if (!themeCssLoaded(draft.name)) return { ...draft.adjustments, colors: null };
      colors = computeColors(root, draft.name, hue);
      colorsFor = `${draft.name}:${hue}`;
    }
    return { ...draft.adjustments, colors };
  }

  function renderPreview() {
    frame.dataset.width = view.width;
    pressGroup('theme-width', 'data-width', view.width);
    syncPreview();
    const skipped = skippedTokens(colors);
    $('theme-skipped').textContent = skipped.length
      ? `These colors can't be used, so they are left out: ${skipped.join(', ')}.`
      : '';
  }

  function renderDirty() {
    $('theme-dirty').textContent = state && isDirty(applied, draft) ? 'Unapplied changes' : '';
  }

  function renderPages() {
    const m = pagesModel(state.pages, siteId, state.themes);
    $('theme-pages-empty').hidden = !m.empty;
    $('theme-pages').hidden = m.empty;
    $('theme-pages').replaceChildren(...m.items.map((p) =>
      h('li', {}, h('a', { href: p.href }, p.title), h('span', { class: 'theme-note' }, ` · ${p.themeName}`))));
  }

  /** Re-render after a draft change; the base theme's CSS loads first so colors read right. */
  async function update({ cards = false } = {}) {
    if (!state) return;
    ensureThemeCss(themeById(draft.name));
    if (cards) renderCards();
    const name = draft.name;
    await themeCssReady(name);
    if (name !== draft.name) return; // a newer update renders the newer base
    renderAdjust();
    renderPreview();
    renderDirty();
  }

  // --- Events ---
  $('theme-cards').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-theme-id]');
    if (!btn || btn.dataset.themeId === draft.name) return;
    // A new base starts from its own hue; fonts, corners and scheme carry over.
    draft = { ...draft, name: btn.dataset.themeId, adjustments: { ...draft.adjustments, hue: null } };
    for (const b of $('theme-cards').querySelectorAll('button[data-theme-id]')) {
      b.setAttribute('aria-pressed', String(b === btn));
    }
    update();
  });

  $('theme-more').addEventListener('click', () => {
    view.expanded = !view.expanded;
    renderCards();
  });

  $('theme-search').addEventListener('input', (e) => {
    view.query = e.target.value;
    renderCards();
  });

  $('theme-hue').addEventListener('input', (e) => {
    // Back on the theme's own hue is no hue change: no literal colors, nothing unapplied.
    const value = Number(e.target.value);
    const hue = themeCssLoaded(draft.name) && value === ownHue(currentTheme()) ? null : value;
    draft = { ...draft, adjustments: { ...draft.adjustments, hue } };
    update();
  });

  $('theme-scheme').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-scheme]');
    if (!btn || btn.getAttribute('aria-disabled') === 'true') return;
    draft = { ...draft, mode: btn.dataset.scheme };
    update();
  });

  $('theme-corners').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-corners]');
    if (!btn) return;
    draft = { ...draft, adjustments: { ...draft.adjustments, corners: btn.dataset.corners } };
    update();
  });

  for (const id of ['theme-heading-font', 'theme-body-font']) {
    $(id).addEventListener('change', (e) => {
      draft = { ...draft, adjustments: { ...draft.adjustments, [e.target.dataset.adjust]: e.target.value || null } };
      update();
    });
  }

  // R9: Reset clears hue, fonts, corners and sets Reader's choice.
  $('theme-reset').addEventListener('click', () => {
    draft = { ...draft, mode: 'auto', adjustments: { hue: null, headingFont: null, bodyFont: null, corners: 'theme' } };
    update();
  });

  $('theme-width').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-width]');
    if (!btn) return;
    view.width = btn.dataset.width;
    renderPreview();
    requestAnimationFrame(fitPreview);
  });

  prefersDark.addEventListener('change', () => update());

  function showNotice(text) {
    $('theme-notice').textContent = text || '';
  }

  /** The draft and its literal colors, once the base theme's CSS has loaded. */
  async function currentDraft() {
    let name;
    do {
      name = draft.name;
      ensureThemeCss(themeById(name));
      await themeCssReady(name);
    } while (name !== draft.name);
    return { ...draft, adjustments: adjustmentsWithColors() };
  }

  // --- Make your own (theme-library.js) and Apply (theme-apply-ui.js) ---
  initThemeLibrary({
    $, root, base,
    vbHref: () => state?.vb?.url || VP_VB_HREF,
    getDraft: () => draft,
    setDraft: (d) => { draft = d; },
    getApplied: () => applied,
    currentTheme, themeById, currentDraft, load, showNotice, showError,
  });
  const applyUi = initApplyUi({
    $, base, currentDraft, load, showError, showNotice,
    setApplied: (b) => { applied = b; renderDirty(); },
  });

  // --- Load ---
  async function load() {
    try {
      const [theme, sites] = await Promise.all([api(`${base}/theme`), api('/api/sites')]);
      siteName = sites.find((s) => s.id === siteId)?.name || '';
      const first = !state;
      state = theme;
      applied = draftFrom(theme.setting);
      if (first) draft = applied;
      const note = vbNote(theme.vb);
      $('theme-vb-note').textContent = note || '';
      $('theme-vb-note').hidden = !note;
      renderPages();
      buildPreview();
      showError('');
      await update({ cards: true });
    } catch (err) {
      showError(err.message);
    }
  }

  return {
    /** Load (first view) or refresh the server state; the draft is kept. */
    show: load,
    /** The draft and its literal colors: read once the base theme's CSS has loaded. */
    draft: currentDraft,
    /** The last GET /theme response. */
    state: () => state,
    /** The draft is what is applied now. */
    markApplied: () => { applied = baselineOf(draft); renderDirty(); },
    /** The section was left: stop the live check after Apply. */
    hide: () => applyUi.stop(),
  };
}
