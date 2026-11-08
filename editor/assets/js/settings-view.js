/**
 * What the Post settings panel shows: the publishing status box, the
 * Collection choices, the URL prefix, the Featured image and Appearance. Pure (no DOM), for meta-panel.js.
 *
 * @module editor/settings-view
 */

import { collectionOutput } from '../../../src/sync/paths.js';
import { mediaFileOf } from '../../../src/media/usage.js';
import { SAFE_ID, ADJUST_ID } from '../../../src/themes/theme-setting.js';

const NOT_LIVE_NOTE = "Your saved edits aren't on the live site yet. Update builds the site and pushes them.";
const DRAFT_NOTE = 'Publish builds the site and puts this post live.';

/**
 * The status box: "Published Nov 3, 2026" (with the not-live note while a
 * published post's saved edits wait for Update), or "Draft".
 * @param {{ status?: string, published?: string }} meta
 * @param {{ liveOutOfDate: boolean, locale?: string }} options - locale: the browser's by default
 * @returns {{ title: string, note: string|null }}
 */
export function statusBox(meta, { liveOutOfDate, locale } = {}) {
  if (meta?.status !== 'published') return { title: 'Draft', note: DRAFT_NOTE };
  const day = publishedDay(meta, locale);
  return { title: `Published${day ? ` ${day}` : ''}`, note: liveOutOfDate ? NOT_LIVE_NOTE : null };
}

/**
 * The post's published day, e.g. "Nov 3, 2026", or '' without a valid date.
 * A date-only value ("2026-11-03", as imported front matter gives) is the
 * written calendar day in every time zone; a timestamp is shown in local time.
 * @param {{ published?: string }} meta
 * @param {string} [locale] - the browser's by default
 * @returns {string}
 */
export function publishedDay(meta, locale) {
  const value = meta?.published;
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(String(value));
  return date.toLocaleDateString(locale, {
    year: 'numeric', month: 'short', day: 'numeric', ...(dateOnly ? { timeZone: 'UTC' } : {}),
  });
}

/**
 * The Collection select's options: the site's `collections` config names in
 * order, plus `current` when the config doesn't list it.
 * @param {Object|null|undefined} collectionsConfig
 * @param {string} current
 * @returns {string[]}
 */
export function collectionOptions(collectionsConfig, current) {
  const names = collectionsConfig && typeof collectionsConfig === 'object' ? Object.keys(collectionsConfig) : [];
  return current && !names.includes(current) ? [...names, current] : names;
}

/**
 * The URL before the slug: `/<collection>/`, the collection's configured
 * `path` when it sets one, `/` for pages (postUrlPath's rule).
 * @param {string} collection
 * @param {Object} [collectionsConfig]
 * @returns {string}
 */
export function urlPrefix(collection, collectionsConfig) {
  const dir = collectionOutput(collection, collectionsConfig || {}).path.replace(/^\/+|\/+$/g, '');
  return `/${dir ? dir + '/' : ''}`;
}

/**
 * The Featured image field: whether the post has one, its URL and the name to show
 * (the file name for `/media/<file>`, else the URL).
 * @param {{ image?: string|null }} meta
 * @returns {{ set: boolean, src: string|null, name: string|null }}
 */
export function featuredModel(meta) {
  const src = meta?.image;
  if (typeof src !== 'string' || !src) return { set: false, src: null, name: null };
  return { set: true, src, name: mediaFileOf(src) || src };
}

/** How many theme cards Appearance shows before "All N themes" (as the Theme screen, R14). */
export const APPEARANCE_CARD_LIMIT = 8;

/**
 * The themes a post can take, in card order (R14): `current` first, then
 * custom themes, then the list order. The adjustments file is not a theme.
 * @param {{ setting: { adjust?: string|null }|null, themes: Array<{ id: string, name?: string, custom?: boolean, only?: string }> }} data
 * @param {string|null} [current]
 * @returns {Array<{ id: string, name?: string, custom?: boolean, only?: string }>}
 */
export function pageThemeChoices({ setting, themes } = {}, current = null) {
  const list = (Array.isArray(themes) ? themes : [])
    .filter((t) => t && SAFE_ID.test(t.id) && t.id !== ADJUST_ID && t.id !== setting?.adjust);
  return [
    ...list.filter((t) => t.id === current),
    ...list.filter((t) => t.id !== current && t.custom),
    ...list.filter((t) => t.id !== current && !t.custom),
  ];
}

/**
 * The Appearance section: the site theme or the post's own theme, the theme
 * cards (`pageThemeChoices` order; the first 8 unless expanded, with an
 * "All N themes" / "Fewer themes" toggle), the "Apply to" scope and the note
 * saying what is stored with the post (`noteKeys`: its key part, set as code).
 * An unsafe `meta.theme` counts as none; an empty `themeScope` as page.
 * @param {{ theme?: string, themeScope?: string }} meta
 * @param {{ setting: { name?: string, adjust?: string|null }|null,
 *   themes: Array<{ id: string, name?: string, custom?: boolean, only?: string }>, siteId?: string, expanded?: boolean }} data
 * @returns {{ own: boolean, siteName: string, cards: Array<{ id: string, name: string, pressed: boolean,
 *   only: 'light'|'dark'|null }>, total: number, toggleText: string|null, scope: 'page'|'article',
 *   note: string|null, noteKeys: string|null, adjustHref: string }}
 */
export function appearanceModel(meta, { setting, themes, siteId = '', expanded = false } = {}) {
  const theme = typeof meta?.theme === 'string' && SAFE_ID.test(meta.theme) ? meta.theme : null;
  const ordered = pageThemeChoices({ setting, themes }, theme);
  const siteTheme = setting?.name || 'default';
  const siteName = ordered.find((t) => t.id === siteTheme)?.name || (siteTheme === 'default' ? 'Default' : siteTheme);
  const scope = theme && meta.themeScope === 'article' ? 'article' : 'page';
  const total = ordered.length;
  const shown = expanded ? ordered : ordered.slice(0, APPEARANCE_CARD_LIMIT);
  const noteKeys = theme ? `theme: "${theme}"${scope === 'article' ? ', themeScope: "article"' : ''}` : null;
  return {
    own: !!theme,
    siteName,
    cards: theme
      ? shown.map((t) => ({
        id: t.id,
        name: t.name || t.id,
        pressed: t.id === theme,
        only: t.only === 'light' || t.only === 'dark' ? t.only : null,
      }))
      : [],
    total,
    toggleText: theme && total > APPEARANCE_CARD_LIMIT ? (expanded ? 'Fewer themes' : `All ${total} themes`) : null,
    scope,
    note: noteKeys ? `Saved with this post as ${noteKeys}. The site theme and other pages are unchanged.` : null,
    noteKeys,
    adjustHref: `/app/site.html?site=${encodeURIComponent(siteId)}&section=theme`,
  };
}
