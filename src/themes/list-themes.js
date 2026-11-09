/**
 * List the Vanilla Breeze themes available in a VB CDN build.
 *
 * VB's dist/cdn/themes/manifest.json covers most themes with a tier
 * (core, showcase, community), but not the plain color themes
 * (amber, ocean, ...), so the theme CSS files are the source of truth and
 * the manifest only supplies tiers. Themes built into vanilla-breeze.css
 * need no extra stylesheet.
 *
 * @module themes/list-themes
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Themes compiled into the main vanilla-breeze.css bundle. */
export const BUILT_IN_THEMES = ['default', 'modern', 'minimal', 'classic'];

/**
 * @typedef {Object} ThemeInfo
 * @property {string} id - data-theme value
 * @property {string} name - Display name
 * @property {string} tier - 'core' | 'color' | 'showcase' | 'community'
 * @property {string|null} file - Stylesheet under themes/, or null when built in
 * @property {string|null} href - URL of the stylesheet whenever the file exists (built-ins too), else null
 */

/**
 * @param {string} vbCdnDir - Path to vanilla-breeze/dist/cdn
 * @param {{ builtIns?: string[], hrefBase?: string|null }} [opts]
 * @returns {ThemeInfo[]} Sorted: core first, then by tier and name
 */
export function listThemes(vbCdnDir, { builtIns = BUILT_IN_THEMES, hrefBase = null } = {}) {
  const themesDir = join(vbCdnDir, 'themes');
  const manifestPath = join(themesDir, 'manifest.json');
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf-8')) : {};
  const files = existsSync(themesDir)
    ? readdirSync(themesDir).filter(f => f.endsWith('.css')).map(f => f.slice(0, -4))
    : [];

  const ids = new Set([...builtIns, ...files]);
  const themes = [...ids].map(id => ({
    id,
    name: toName(id),
    tier: builtIns.includes(id) ? 'core' : (manifest[id]?.tier || 'color'),
    file: id !== 'default' && files.includes(id) && !builtIns.includes(id) ? `${id}.css` : null,
    href: hrefBase != null && files.includes(id) ? `${hrefBase}/themes/${id}.css` : null,
  }));

  const order = { core: 0, color: 1, showcase: 2, community: 3 };
  return themes.sort((a, b) =>
    (a.id === 'default' ? -1 : b.id === 'default' ? 1 : 0)
    || (order[a.tier] ?? 9) - (order[b.tier] ?? 9)
    || a.name.localeCompare(b.name));
}

function toName(id) {
  return id.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
