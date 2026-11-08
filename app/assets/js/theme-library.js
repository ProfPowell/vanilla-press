/**
 * The Theme section's custom theme library: Save as a new theme (R10),
 * Import from Theme Composer (R11), and a custom card's menu (Rename…,
 * Delete…). The server writes and commits each change at once; the notes it
 * sends (`dropped`, `skipped`, `note`) are shown as text only.
 *
 * @module app/theme-library
 */
import { api, h } from './app-api.js';
import { libraryNotice, deleteRefusalText, importTooBig } from './theme-view.js';
import { computeTokens, cssText } from './theme-preview.js';
import { openDialog, askName } from './theme-dialogs.js';
import { adjustmentsCss, themeTokenNames, IMPORT_LIMIT } from '../../../src/themes/theme-css.js';
import { ADJUST_ID } from '../../../src/themes/theme-setting.js';

/** Saving a theme that declares no tokens of its own (default): Vanilla Breeze's tokens of these kinds. */
const BASE_TOKENS = /^--(color|hue|lightness|chroma|font|radius|shadow)-/;
const TOO_BIG = 'That file is over 256 KB.';
const NO_ADJUSTMENTS = Object.freeze({ hue: null, headingFont: null, bodyFont: null, corners: 'theme' });

/**
 * A custom card's menu: Rename… and Delete…, in a disclosure.
 * @param {{ id: string, name: string }} c
 */
export function cardMenu(c) {
  return h('details', { class: 'theme-card-menu' },
    h('summary', { 'aria-label': `${c.name}: rename or delete` },
      h('span', { 'aria-hidden': 'true' }, '⋯')),
    h('div', { class: 'theme-card-menu-list' },
      h('button', { type: 'button', 'data-menu': 'rename', 'data-id': c.id }, 'Rename…'),
      h('button', { type: 'button', 'data-menu': 'delete', 'data-id': c.id, class: 'danger' }, 'Delete…')));
}

/** A library route's error text: the server's, with what it could not use. */
const libraryError = (err) => {
  const dropped = err.data?.dropped;
  return dropped?.length ? `${err.message} Not kept: ${dropped.join(', ')}` : err.message;
};

/**
 * Wire the library's buttons, dialogs and card menus.
 * @param {{ $: (id: string) => HTMLElement, root: HTMLElement, base: string, vbHref: () => string,
 *   getDraft: () => object, setDraft: (d: object) => void, getApplied: () => object,
 *   currentTheme: () => object, themeById: (id: string) => object|null,
 *   currentDraft: () => Promise<object>, load: () => Promise<void>,
 *   showNotice: (text: string) => void, showError: (text: string) => void }} ctx
 */
export function initThemeLibrary(ctx) {
  const { $, root, base } = ctx;
  const fallback = $('theme-apply');

  /**
   * Run a library request from a dialog: its error text stays in the dialog;
   * on success the note shows and `after` runs.
   */
  async function libraryCall(action, request, after) {
    let res;
    try {
      res = await request();
    } catch (err) {
      return libraryError(err);
    }
    ctx.showError('');
    ctx.showNotice(libraryNotice(action, res));
    await after(res);
  }

  /** A new custom theme (saved or imported) becomes the draft's theme, with no adjustments. */
  async function useNewTheme(res) {
    ctx.setDraft({ ...ctx.getDraft(), name: res.theme.id, adjustments: { ...NO_ADJUSTMENTS } });
    await ctx.load();
  }

  // --- Save as a new theme (R10) ---
  /** What the base theme's CSS declares plus what the adjustments set, computed in each scheme. */
  async function tokensToSave(theme) {
    const d = await ctx.currentDraft();
    const vbHref = ctx.vbHref();
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
    const theme = ctx.currentTheme();
    askName($, {
      opener: e.currentTarget,
      fallback,
      title: 'Save as a new theme',
      description: `A copy of ${theme.name} with your adjustments, kept with this site's themes.`,
      ok: 'Save',
      busyText: 'Saving…',
      submit: (name) => libraryCall('save', async () => {
        const tokens = await tokensToSave(theme);
        const only = theme.only === 'light' || theme.only === 'dark' ? theme.only : undefined;
        return api(`${base}/theme/custom`, { method: 'POST', body: { name, base: theme.id, tokens, only } });
      }, useNewTheme),
    });
  });

  // --- Import from Theme Composer (R11) ---
  $('theme-import-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    $('theme-import-error').textContent = '';
    if (!file) return;
    const text = file.size > IMPORT_LIMIT ? null : await file.text();
    if (text === null || importTooBig(text)) {
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
      fallback,
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
        return libraryCall('import', () => api(`${base}/theme/import`, { method: 'POST', body: { name, css } }), useNewTheme);
      },
    });
  });

  // --- A custom card's menu: Rename…, Delete… ---
  const cards = $('theme-cards');
  const closeMenus = (except) => {
    for (const d of cards.querySelectorAll('details.theme-card-menu[open]')) if (d !== except) d.open = false;
  };
  cards.addEventListener('toggle', (e) => {
    if (e.target.matches?.('details.theme-card-menu') && e.target.open) closeMenus(e.target);
  }, true);
  cards.addEventListener('keydown', (e) => {
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

  cards.addEventListener('click', (e) => {
    const item = e.target.closest('button[data-menu]');
    if (!item) return;
    const theme = ctx.themeById(item.dataset.id);
    const menu = item.closest('details');
    const summary = menu.querySelector('summary');
    menu.open = false;
    if (!theme) return;
    if (item.dataset.menu === 'rename') renameTheme(theme, summary);
    else deleteTheme(theme, summary);
  });

  /** A custom card's menu button, found again after the cards were rendered anew. */
  const menuButton = (id) => [...cards.querySelectorAll('button[data-theme-id]')]
    .find((b) => b.dataset.themeId === id)?.parentElement.querySelector('.theme-card-menu summary') || null;

  function renameTheme(theme, opener) {
    askName($, {
      opener,
      refocus: () => menuButton(theme.id),
      fallback,
      title: `Rename ${theme.name}`,
      description: 'Posts and the site setting keep using it: only its name changes.',
      value: theme.name,
      ok: 'Rename',
      busyText: 'Renaming…',
      submit: (name) => libraryCall('rename',
        () => api(`${base}/theme/custom/${encodeURIComponent(theme.id)}`, { method: 'PATCH', body: { name } }),
        () => ctx.load()),
    });
  }

  async function deleteTheme(theme, opener) {
    const go = await document.querySelector('confirm-panel').ask({
      heading: `Delete ${theme.name}?`,
      body: "This removes the theme and its file from the site's themes. It can be recovered only from git history.",
      confirm: 'Delete theme',
    });
    if (!go) { opener.focus(); return; }
    ctx.showNotice('');
    let res;
    try {
      res = await api(`${base}/theme/custom/${encodeURIComponent(theme.id)}`, { method: 'DELETE' });
    } catch (err) {
      if (err.status === 409 && Array.isArray(err.data?.usedBy)) ctx.showError(deleteRefusalText(theme.name, err.data.usedBy));
      else ctx.showError(err.message);
      if (opener.isConnected) opener.focus();
      return;
    }
    ctx.showError('');
    ctx.showNotice(libraryNotice('delete', res));
    // The draft was built on the deleted theme (it is never the applied one: that delete
    // is refused). Go back to the applied look whole, scheme and adjustments too, rather
    // than leave adjustments chosen for a theme that is gone on another base.
    if (ctx.getDraft().name === theme.id) ctx.setDraft({ ...ctx.getApplied() });
    await ctx.load();
    $('theme-save-new').focus();
  }
}
