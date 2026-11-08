/**
 * The Theme section: start from a theme, adjust it, see it live. The draft
 * (choices not applied yet) lives in this module until the page reloads, so
 * leaving the section and coming back keeps it. Rules live in theme-view.js,
 * DOM helpers in theme-preview.js. Custom themes (save, import, rename,
 * delete) are written and committed at once by the server; Apply builds,
 * commits and pushes the draft, then watches for the live site.
 *
 * The preview is a sandboxed iframe (no scripts) whose page links the site's
 * Vanilla Breeze, the theme and the adjustments, as the live site would: the
 * post's HTML never enters the app's document. Changes update that page's
 * <html> attributes and stylesheets in place.
 * @module theme-page
 */
import { api, h, formatDate } from './app-api.js';
import {
  draftFrom, isDirty, cardModels, schemeControl, schemeOf, pagesModel, vbNote, previewSrcdoc,
  applyBody, applyOutcome, deleteRefusalText, libraryNotice, importTooBig, LIVE_POLL_MS, LIVE_POLL_FOR_MS,
} from './theme-view.js';
import {
  ensureThemeCss, themeCssReady, themeCssLoaded, computeColors, computeTokens, cssText, themeHue, setPreviewCss,
  quietPreview,
} from './theme-preview.js';
import { adjustmentsCss, skippedTokens, themeTokenNames, IMPORT_LIMIT as IMPORT_LIMIT_BYTES } from '../../../src/themes/theme-css.js';
import { ADJUST_ID } from '../../../src/themes/theme-setting.js';
import { actionPendingText, publishFailure } from '../../../editor/assets/js/site-context.js';

const LAYOUT_HREF = '/app/assets/theme-preview-frame.css';
/** Saving a theme that declares no tokens of its own (default): Vanilla Breeze's tokens of these kinds. */
const BASE_TOKENS = /^--(color|hue|lightness|chroma|font|radius|shadow)-/;
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

  /** A custom card's menu: Rename… and Delete…, in a disclosure. */
  function cardMenu(c) {
    return h('details', { class: 'theme-card-menu' },
      h('summary', { 'aria-label': `${c.name}: rename or delete` },
        h('span', { 'aria-hidden': 'true' }, '⋯')),
      h('div', { class: 'theme-card-menu-list' },
        h('button', { type: 'button', 'data-menu': 'rename', 'data-id': c.id }, 'Rename…'),
        h('button', { type: 'button', 'data-menu': 'delete', 'data-id': c.id, class: 'danger' }, 'Delete…')));
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

  // --- Notes, the Apply state and the error report ---
  function showNotice(text) {
    $('theme-notice').textContent = text || '';
  }

  /** The header's status slot: `tone` 'error' or 'done' colors it. */
  function setApplyState(text, tone = '') {
    const el = $('theme-apply-state');
    el.replaceChildren(text || '');
    if (tone) el.dataset.tone = tone;
    else delete el.dataset.tone;
  }

  function showReport(message, { log, files } = {}) {
    const body = [h('p', {}, message)];
    if (log) body.push(h('details', {}, h('summary', {}, 'Build log'), h('pre', {}, log)));
    if (files?.length) body.push(h('ul', {}, ...files.map((f) => h('li', {}, f))));
    $('theme-report-body').replaceChildren(...body);
    $('theme-report').hidden = false;
  }

  function clearReport() {
    $('theme-report').hidden = true;
    $('theme-report-body').replaceChildren();
  }

  $('theme-report-close').addEventListener('click', () => {
    clearReport();
    $('theme-apply').focus();
  });

  // --- Dialogs (native <dialog>: Escape closes, focus goes back to the opener) ---
  /**
   * Open a dialog; `submit` runs on its form's submit while the dialog stays
   * open. It returns an error text to show in the dialog, or nothing to close it.
   */
  function openDialog(dialog, { opener, refocus, first, error, ok, busyText, submit }) {
    const form = dialog.querySelector('form');
    const okText = ok.textContent;
    error.textContent = '';
    const close = () => {
      dialog.close();
      form.onsubmit = null;
      // The opener may have been re-rendered (a card's menu): `refocus` finds its new self.
      ((opener?.isConnected ? opener : refocus?.()) || $('theme-apply')).focus();
    };
    dialog.querySelector('[data-dialog-cancel]').onclick = close;
    dialog.oncancel = (e) => { e.preventDefault(); if (!ok.disabled) close(); };
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (ok.disabled) return;
      ok.disabled = true;
      ok.textContent = busyText;
      error.textContent = '';
      let problem;
      try {
        problem = await submit();
      } catch (err) {
        problem = err.message;
      } finally {
        ok.disabled = false;
        ok.textContent = okText;
      }
      if (problem) {
        error.textContent = problem;
        first.focus();
      } else {
        close();
      }
    };
    dialog.showModal();
    first.focus();
  }

  /** Ask for a theme name in the name dialog; `submit(name)` as for openDialog. */
  function askName({ opener, refocus, title, description, value = '', ok, busyText, submit }) {
    $('theme-name-title').textContent = title;
    $('theme-name-desc').textContent = description;
    $('theme-name-ok').textContent = ok;
    const input = $('theme-name-input');
    input.value = value;
    openDialog($('theme-name-dialog'), {
      opener, refocus, first: input, error: $('theme-name-error'), ok: $('theme-name-ok'), busyText,
      submit: () => {
        const name = input.value.trim();
        if (!name) return 'Give the theme a name.';
        return submit(name);
      },
    });
    input.select();
  }

  /** A library route's error text: the server's, with what it could not use. */
  const libraryError = (err) => {
    const dropped = err.data?.dropped;
    return dropped?.length ? `${err.message} Not kept: ${dropped.join(', ')}` : err.message;
  };

  /** A new custom theme (saved or imported) becomes the draft's theme, with no adjustments. */
  async function useNewTheme(theme) {
    draft = { ...draft, name: theme.id, adjustments: { hue: null, headingFont: null, bodyFont: null, corners: 'theme' } };
    await load();
  }

  // --- Save as a new theme (R10) ---
  /** The tokens to save: what the base theme's CSS declares, plus what the adjustments set. */
  async function tokensToSave() {
    const d = await currentDraft();
    const theme = currentTheme();
    const vbHref = state?.vb?.url || VP_VB_HREF;
    const adjCss = adjustmentsCss(d.adjustments);
    let names = themeTokenNames(await cssText(theme.href || vbHref), theme.id);
    if (!names.length) {
      // A theme that declares nothing (default) is Vanilla Breeze's own tokens.
      names = themeTokenNames(await cssText(vbHref), null).filter((n) => BASE_TOKENS.test(n));
    }
    names = [...names, ...themeTokenNames(adjCss, ADJUST_ID)];
    return computeTokens(root, theme, names, adjCss);
  }

  $('theme-save-new').addEventListener('click', (e) => {
    const theme = currentTheme();
    askName({
      opener: e.currentTarget,
      title: 'Save as a new theme',
      description: `A copy of ${theme.name} with your adjustments, kept with this site's themes.`,
      value: '',
      ok: 'Save',
      busyText: 'Saving…',
      submit: async (name) => {
        let res;
        try {
          const tokens = await tokensToSave();
          res = await api(`${base}/theme/custom`, { method: 'POST', body: { name, base: theme.id, tokens } });
        } catch (err) {
          return libraryError(err);
        }
        showError('');
        showNotice(libraryNotice('save', res));
        await useNewTheme(res.theme);
      },
    });
  });

  // --- Import from Theme Composer (R11) ---
  const TOO_BIG = 'That file is over 256 KB.';
  $('theme-import-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    $('theme-import-error').textContent = '';
    if (!file) return;
    if (file.size > IMPORT_LIMIT_BYTES) {
      $('theme-import-error').textContent = TOO_BIG;
      e.target.value = '';
      return;
    }
    const text = await file.text();
    if (importTooBig(text)) {
      $('theme-import-error').textContent = TOO_BIG;
      e.target.value = '';
      return;
    }
    $('theme-import-text').value = text;
  });

  $('theme-import').addEventListener('click', (e) => {
    $('theme-import-file').value = '';
    $('theme-import-text').value = '';
    $('theme-import-name').value = '';
    openDialog($('theme-import-dialog'), {
      opener: e.currentTarget,
      first: $('theme-import-file'),
      error: $('theme-import-error'),
      ok: $('theme-import-ok'),
      busyText: 'Importing…',
      submit: async () => {
        const css = $('theme-import-text').value;
        const name = $('theme-import-name').value.trim();
        if (!css.trim()) return 'Choose a theme.css file or paste its text.';
        if (importTooBig(css)) return TOO_BIG;
        if (!name) return 'Give the theme a name.';
        let res;
        try {
          res = await api(`${base}/theme/import`, { method: 'POST', body: { name, css } });
        } catch (err) {
          return libraryError(err);
        }
        showError('');
        showNotice(libraryNotice('import', res));
        await useNewTheme(res.theme);
      },
    });
  });

  // --- A custom card's menu: Rename…, Delete… ---
  const closeMenus = (except) => {
    for (const d of $('theme-cards').querySelectorAll('details.theme-card-menu[open]')) if (d !== except) d.open = false;
  };
  $('theme-cards').addEventListener('toggle', (e) => {
    if (e.target.matches?.('details.theme-card-menu') && e.target.open) closeMenus(e.target);
  }, true);
  $('theme-cards').addEventListener('keydown', (e) => {
    const menu = e.target.closest?.('details.theme-card-menu[open]');
    if (e.key === 'Escape' && menu) {
      e.preventDefault();
      menu.open = false;
      menu.querySelector('summary').focus();
    }
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest?.('details.theme-card-menu')) closeMenus(null);
  });

  $('theme-cards').addEventListener('click', (e) => {
    const item = e.target.closest('button[data-menu]');
    if (!item) return;
    const theme = themeById(item.dataset.id);
    const menu = item.closest('details');
    const summary = menu.querySelector('summary');
    menu.open = false;
    if (!theme) return;
    if (item.dataset.menu === 'rename') renameTheme(theme, summary);
    else deleteTheme(theme, summary);
  });

  const menuButton = (id) => [...$('theme-cards').querySelectorAll('button[data-theme-id]')]
    .find((b) => b.dataset.themeId === id)?.parentElement.querySelector('.theme-card-menu summary') || null;

  function renameTheme(theme, opener) {
    askName({
      opener,
      refocus: () => menuButton(theme.id),
      title: `Rename ${theme.name}`,
      description: 'Posts and the site setting keep using it: only its name changes.',
      value: theme.name,
      ok: 'Rename',
      busyText: 'Renaming…',
      submit: async (name) => {
        let res;
        try {
          res = await api(`${base}/theme/custom/${encodeURIComponent(theme.id)}`, { method: 'PATCH', body: { name } });
        } catch (err) {
          return libraryError(err);
        }
        showError('');
        showNotice(libraryNotice('rename', res));
        await load();
      },
    });
  }

  async function deleteTheme(theme, opener) {
    const panel = document.querySelector('confirm-panel');
    const go = await panel.ask({
      heading: `Delete ${theme.name}?`,
      body: "This removes the theme and its file from the site's themes. It can be recovered only from git history.",
      confirm: 'Delete theme',
    });
    if (!go) { opener.focus(); return; }
    showNotice('');
    let res;
    try {
      res = await api(`${base}/theme/custom/${encodeURIComponent(theme.id)}`, { method: 'DELETE' });
    } catch (err) {
      if (err.status === 409 && Array.isArray(err.data?.usedBy)) showError(deleteRefusalText(theme.name, err.data.usedBy));
      else showError(err.message);
      if (opener.isConnected) opener.focus();
      return;
    }
    showError('');
    showNotice(libraryNotice('delete', res));
    // The draft (not applied) may have been this theme: back to the applied one.
    if (draft.name === theme.id) draft = { ...draft, name: applied.name, adjustments: { ...draft.adjustments, hue: null } };
    await load();
    $('theme-save-new').focus();
  }

  // --- Apply to site ---
  let applying = false;
  let liveTimer = null;
  let liveToken = 0;

  function cancelLive() {
    clearTimeout(liveTimer);
    liveTimer = null;
    liveToken++;
  }

  function showLive(url) {
    const el = $('theme-apply-state');
    el.dataset.tone = 'done';
    el.replaceChildren(h('a', { href: url, target: '_blank', rel: 'noopener' },
      'Live ↗', h('span', { class: 'visually-hidden' }, ' (opens the site in a new tab)')));
  }

  /** Poll GET /theme/live every 10 s for up to 5 min. */
  function watchLive(url) {
    const token = ++liveToken;
    const started = Date.now();
    const tick = async () => {
      liveTimer = null;
      if (token !== liveToken) return;
      try {
        const res = await api(`${base}/theme/live`);
        if (token !== liveToken) return;
        if (res.live) return showLive(res.url || url);
      } catch { /* try again */ }
      if (Date.now() - started >= LIVE_POLL_FOR_MS) return setApplyState('Still deploying, check Cloudflare');
      liveTimer = setTimeout(tick, LIVE_POLL_MS);
    };
    tick();
  }

  /** The draft without its colors: what isDirty compares. */
  const baseline = (d) => ({ name: d.name, mode: d.mode, adjustments: {
    hue: d.adjustments.hue, headingFont: d.adjustments.headingFont, bodyFont: d.adjustments.bodyFont, corners: d.adjustments.corners,
  } });

  $('theme-apply').addEventListener('click', async () => {
    if (applying || !state) return;
    applying = true;
    const btn = $('theme-apply');
    const hadFocus = document.activeElement === btn;
    btn.disabled = true;
    clearReport();
    cancelLive();
    showError('');
    showNotice('');
    setApplyState(actionPendingText('apply'));
    try {
      const d = await currentDraft();
      let result;
      try {
        result = await api(`${base}/theme/apply`, { method: 'POST', body: applyBody(d, d.adjustments.colors) });
      } catch (err) {
        const failure = publishFailure(err, 'apply');
        setApplyState(failure.message, 'error');
        if (failure.reload) {
          // Committed on this computer; only the push failed.
          applied = baseline(d);
          renderDirty();
        }
        if (failure.log !== undefined) {
          showReport('Build failed. Nothing was pushed, and the live site still has the previous theme.', { log: failure.log });
        } else if (failure.files) {
          showReport(`${failure.message.replace(/\.$/, '')}. Conflicting files:`, { files: failure.files });
        }
        // Another computer applied meanwhile (or the push changed things): show what is applied now.
        if (err.status === 409 || failure.reload) await load();
        return;
      }
      applied = baseline(d);
      renderDirty();
      const out = applyOutcome(result);
      setApplyState(out.text, out.liveUrl ? '' : 'done');
      if (out.liveUrl) watchLive(out.liveUrl);
    } finally {
      applying = false;
      btn.disabled = false;
      // A disabled button loses focus: give it back to a keyboard user.
      if (hadFocus && (document.activeElement === document.body || !document.activeElement)) btn.focus();
    }
  });

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
    markApplied: () => { applied = baseline(draft); renderDirty(); },
  };
}
