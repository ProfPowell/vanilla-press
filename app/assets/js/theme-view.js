/**
 * The Theme section's rules: the draft (what the user has picked and not
 * applied yet), the theme cards, the scheme control, the pages list and
 * notes. Pure, no DOM: tested in Node.
 *
 * @module app/theme-view
 */

const MODES = ['auto', 'light', 'dark'];
const FONTS = ['sans', 'serif', 'mono'];
const CORNERS = ['theme', 'square', 'round'];
const TIER_TEXT = { core: 'Core', color: 'Color', showcase: 'Showcase', community: 'Community', custom: 'Custom' };

/**
 * @typedef {Object} Draft
 * @property {string} name - theme id
 * @property {'auto'|'light'|'dark'} mode
 * @property {{ hue: number|null, headingFont: 'sans'|'serif'|'mono'|null,
 *   bodyFont: 'sans'|'serif'|'mono'|null, corners: 'theme'|'square'|'round' }} adjustments
 */

/**
 * The draft for a theme setting (GET /theme's `setting`, null when the site has none).
 * @param {object|null|undefined} setting
 * @returns {Draft}
 */
export function draftFrom(setting) {
  const adj = setting?.adjustments && typeof setting.adjustments === 'object' ? setting.adjustments : {};
  return {
    name: typeof setting?.name === 'string' && setting.name ? setting.name : 'default',
    mode: MODES.includes(setting?.mode) ? setting.mode : 'auto',
    adjustments: {
      hue: typeof adj.hue === 'number' && Number.isFinite(adj.hue) ? adj.hue : null,
      headingFont: FONTS.includes(adj.headingFont) ? adj.headingFont : null,
      bodyFont: FONTS.includes(adj.bodyFont) ? adj.bodyFont : null,
      corners: CORNERS.includes(adj.corners) ? adj.corners : 'theme',
    },
  };
}

/**
 * Whether the draft differs from what is applied.
 * @param {Draft} applied
 * @param {Draft} draft
 */
export function isDirty(applied, draft) {
  const a = applied.adjustments;
  const d = draft.adjustments;
  return applied.name !== draft.name || applied.mode !== draft.mode
    || a.hue !== d.hue || a.headingFont !== d.headingFont || a.bodyFont !== d.bodyFont || a.corners !== d.corners;
}

/**
 * The theme cards (R14): the current theme, then custom themes, then the
 * list order; the first `limit` unless expanded. A search covers every theme, by name (or id).
 * @param {Array<{ id: string, name: string, tier: string, custom?: boolean, only?: 'light'|'dark' }>} themes
 * @param {{ current: string, query?: string, expanded?: boolean, limit?: number }} options
 * @returns {{ cards: Array<{ id: string, name: string, tier: string, tierText: string, pressed: boolean,
 *   custom: boolean, only: 'light'|'dark'|null }>, total: number, toggleText: string|null }}
 */
export function cardModels(themes, { current, query = '', expanded = false, limit = 8 }) {
  const list = themes || [];
  const ordered = [
    ...list.filter((t) => t.id === current),
    ...list.filter((t) => t.id !== current && t.custom),
    ...list.filter((t) => t.id !== current && !t.custom),
  ];
  const q = String(query || '').trim().toLowerCase();
  const total = list.length;
  let shown;
  let toggleText = null;
  if (q) {
    shown = ordered.filter((t) => String(t.name).toLowerCase().includes(q) || t.id.includes(q));
  } else {
    shown = expanded ? ordered : ordered.slice(0, limit);
    if (total > limit) toggleText = expanded ? 'Fewer themes' : `All ${total} themes`;
  }
  return {
    cards: shown.map((t) => ({
      id: t.id,
      name: t.name,
      tier: t.tier,
      tierText: TIER_TEXT[t.tier] || '',
      pressed: t.id === current,
      custom: !!t.custom,
      only: t.only === 'light' || t.only === 'dark' ? t.only : null,
    })),
    total,
    toggleText,
  };
}

/**
 * The color scheme control for a theme: fixed when the theme has one scheme.
 * @param {{ name: string, only?: 'light'|'dark' }|null|undefined} theme
 * @returns {{ disabled: boolean, note: string|null }}
 */
export function schemeControl(theme) {
  if (theme?.only === 'light' || theme?.only === 'dark') {
    return { disabled: true, note: `${theme.name} is ${theme.only} only, so the color scheme is fixed.` };
  }
  return { disabled: false, note: null };
}

/**
 * The scheme a preview shows: a single-scheme theme's own, else the chosen
 * one, else (Reader's choice) the reader's.
 * @param {{ only?: 'light'|'dark' }|null|undefined} theme
 * @param {'auto'|'light'|'dark'} mode
 * @param {boolean} prefersDark
 * @returns {'light'|'dark'}
 */
export function schemeOf(theme, mode, prefersDark) {
  if (theme?.only === 'light' || theme?.only === 'dark') return theme.only;
  if (mode === 'light' || mode === 'dark') return mode;
  return prefersDark ? 'dark' : 'light';
}

/**
 * "Pages with their own theme".
 * @param {Array<{ id: string, title?: string, theme: string }>|undefined} pages
 * @param {string} siteId
 * @param {Array<{ id: string, name: string }>} [themes] - for theme names
 * @returns {{ empty: boolean, items: Array<{ title: string, themeName: string, href: string }> }}
 */
export function pagesModel(pages, siteId, themes = []) {
  const names = new Map(themes.map((t) => [t.id, t.name]));
  const items = (pages || []).map((p) => ({
    title: p.title || 'Untitled',
    themeName: names.get(p.theme) || p.theme,
    href: `/editor/?site=${encodeURIComponent(siteId)}#doc-${encodeURIComponent(p.id)}`,
  }));
  return { empty: items.length === 0, items };
}

/**
 * A note when the previews cannot use the site's own Vanilla Breeze.
 * @param {{ source: 'site'|'vp' }|undefined} vb
 * @returns {string|null}
 */
export function vbNote(vb) {
  return vb?.source === 'vp'
    ? "This site has no copy of Vanilla Breeze under src/, so these previews use Vanilla Press's own."
    : null;
}

/**
 * The hue of a computed `oklch(...)` color; 0 for `none`; null when it is not oklch.
 * @param {string} color
 * @returns {number|null}
 */
export function hueOf(color) {
  const m = /^oklch\(\s*(\S+)\s+(\S+)\s+([^\s/)]+)/i.exec(String(color || '').trim());
  if (!m) return null;
  if (m[3].toLowerCase() === 'none') return 0;
  const h = parseFloat(m[3]);
  return Number.isFinite(h) ? h : null;
}
