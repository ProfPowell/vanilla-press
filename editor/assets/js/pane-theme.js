/**
 * The writing area's theme (site mode): the site theme, or the open post's
 * own page theme, with the same rules as Cook's `pageThemePlan`:
 *
 * - ids always start with the theme name, including "default", then the
 *   adjustment id (`vp-site`);
 * - page scope: just the page theme on the pane (the site's adjustments are
 *   dropped);
 * - article scope: the site ids stay on the pane, the page theme goes on
 *   `.editor-content`;
 * - forced scheme per id: `modes[id]`, else the site mode when light or dark,
 *   else none.
 *
 * Stylesheets load from the site's own Vanilla Breeze copy (the theme list's
 * `/sites/<id>/site/…` hrefs), so the pane looks like the live site.
 * The toolbar, sidebar and buttons are outside every `data-theme` element.
 *
 * @module editor/pane-theme
 */

import { SAFE_ID } from '../../../src/themes/theme-setting.js';

/** What a site with no theme.json gets once a post with its own theme is published (R4). */
const DEFAULT_SETTING = Object.freeze({ name: 'default', mode: 'auto', adjust: null, files: {}, modes: {} });

const has = (obj, key) => !!obj && typeof obj === 'object' && Object.hasOwn(obj, key);

/**
 * @typedef {{ ids: string, mode: string|null }} ThemeAttrs
 * @typedef {{ pane: ThemeAttrs, content: ThemeAttrs|null, strip: (ThemeAttrs & { text: string })|null,
 *   chip: string|null, hrefs: string[] }} PaneTheme
 */

/**
 * What the writing area shows for a post.
 * @param {{ name: string, mode?: string, adjust?: string|null, modes?: Object<string,string> }|null} setting
 * @param {{ theme?: string, themeScope?: string }} [meta]
 * @param {Array<{ id: string, name?: string, href?: string|null }>} [themes] - with preview hrefs
 * @returns {PaneTheme}
 */
export function paneTheme(setting, meta, themes) {
  const m = meta || {};
  const pageTheme = typeof m.theme === 'string' && SAFE_ID.test(m.theme) ? m.theme : null;
  const s = setting && setting.name ? setting : (pageTheme ? DEFAULT_SETTING : null);
  if (!s) return { pane: { ids: '', mode: null }, content: null, strip: null, chip: null, hrefs: [] };

  const scope = m.themeScope === 'article' ? 'article' : 'page';
  const siteIds = [s.name, ...(s.adjust ? [s.adjust] : [])];
  const siteForced = s.mode === 'light' || s.mode === 'dark' ? s.mode : null;
  const forced = (id) => (has(s.modes, id) ? s.modes[id] : null) || siteForced;
  const attrs = (ids, modeOf) => ({ ids: ids.join(' '), mode: forced(modeOf) });

  let pane;
  let content = null;
  let linkIds;
  if (pageTheme && scope === 'article') {
    pane = attrs(siteIds, s.name);
    content = attrs([pageTheme], pageTheme);
    linkIds = [...siteIds, pageTheme];
  } else if (pageTheme) {
    pane = attrs([pageTheme], pageTheme);
    linkIds = [pageTheme];
  } else {
    pane = attrs(siteIds, s.name);
    linkIds = siteIds;
  }

  const list = Array.isArray(themes) ? themes : [];
  const byId = (id) => list.find((t) => t && t.id === id);
  const hrefs = [];
  for (const id of new Set(linkIds)) {
    const href = byId(id)?.href;
    if (typeof href === 'string' && href) hrefs.push(href);
  }

  return {
    pane,
    content,
    strip: pageTheme
      ? { ...pane, text: scope === 'article' ? 'Header in site theme' : 'Header in page theme' }
      : null,
    chip: pageTheme ? `Page theme: ${byId(pageTheme)?.name || pageTheme}` : null,
    hrefs,
  };
}

/**
 * The theme list for the pane: GET /theme's themes, plus a stylesheet for every
 * entry of the setting's `files` the list has no href for (the adjustments file
 * `vp-site`): site paths are served under `/sites/<siteId>/site`.
 * @param {{ files?: Object<string,string> }|null} setting
 * @param {Array<{ id: string, name?: string, href?: string|null }>|null} themes
 * @param {string} siteId
 * @returns {Array<{ id: string, name?: string, href?: string|null }>}
 */
export function siteThemes(setting, themes, siteId) {
  const list = Array.isArray(themes) ? themes.map((t) => ({ ...t })) : [];
  const files = setting && setting.files && typeof setting.files === 'object' ? setting.files : {};
  for (const [id, url] of Object.entries(files)) {
    if (typeof url !== 'string' || !SAFE_ID.test(id)) continue;
    const href = url.startsWith('/') ? `/sites/${encodeURIComponent(siteId)}/site${url}` : url;
    const known = list.find((t) => t.id === id);
    if (!known) list.push({ id, name: id, href });
    else if (!known.href) known.href = href;
  }
  return list;
}

/** Set (or remove) `data-theme` and `data-mode` on an element. */
function setAttrs(el, attrs) {
  if (!el) return;
  if (attrs?.ids) el.setAttribute('data-theme', attrs.ids);
  else el.removeAttribute('data-theme');
  if (attrs?.mode) el.setAttribute('data-mode', attrs.mode);
  else el.removeAttribute('data-mode');
}

/**
 * Show a `paneTheme` result: theme attributes on `.editor-pane`,
 * `.editor-content` and the site header strip, the stylesheets it needs
 * (`<link data-vp-theme-css>`, added once each), and the "Page theme" chip.
 * @param {PaneTheme} model
 * @param {Document} [doc]
 */
export function applyPaneTheme(model, doc = document) {
  setAttrs(doc.querySelector('.editor-pane'), model.pane);
  setAttrs(doc.querySelector('.editor-content'), model.content);

  const strip = doc.querySelector('[data-site-strip]');
  if (strip) {
    strip.hidden = !model.strip;
    setAttrs(strip, model.strip);
    const note = strip.querySelector('[data-site-strip-note]');
    if (note) note.textContent = model.strip?.text || '';
  }

  const chip = doc.querySelector('[data-page-theme-chip]');
  if (chip) {
    chip.hidden = !model.chip;
    const text = chip.querySelector('[data-page-theme-name]');
    if (text) text.textContent = model.chip || '';
    // The dot shows the page theme's main color: it wears the page theme (page scope: the pane's ids).
    setAttrs(chip.querySelector('[data-page-theme-dot]'), model.chip ? (model.content || model.pane) : null);
  }

  const present = new Set([...doc.querySelectorAll('link[data-vp-theme-css]')].map((l) => l.getAttribute('href')));
  for (const href of model.hrefs) {
    if (present.has(href)) continue;
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.setAttribute('data-vp-theme-css', '');
    doc.head.append(link);
    present.add(href);
  }
}
