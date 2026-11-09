/**
 * Find a site's own copy of Vanilla Breeze and build the theme catalog.
 *
 * @module themes/site-vb
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep, posix } from 'node:path';
import { BUILT_IN_THEMES, listThemes } from './list-themes.js';

const VB_FILE = 'vanilla-breeze.css';

/**
 * Breadth-first search of src/ for the shallowest vanilla-breeze.css.
 * @param {string} siteDir
 * @returns {{ dir: string, url: string }|null}
 */
export function findSiteVb(siteDir) {
  const root = join(siteDir, 'src');
  if (!existsSync(root)) return null;
  let level = [root];
  while (level.length) {
    const next = [];
    for (const dir of level) {
      let entries;
      try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      if (entries.some(e => e.isFile() && e.name === VB_FILE)) {
        return { dir, url: '/' + relative(root, join(dir, VB_FILE)).split(sep).join('/') };
      }
      for (const e of entries) {
        if (e.isDirectory() && e.name !== 'node_modules') next.push(join(dir, e.name));
      }
    }
    level = next;
  }
  return null;
}

/**
 * Theme ids compiled into a vanilla-breeze.css: "default" plus every
 * [data-theme~=id] selector, minus a11y-* ids.
 * @param {string} cssText
 * @returns {string[]}
 */
export function builtInThemeIds(cssText) {
  const ids = new Set(['default']);
  for (const m of String(cssText).matchAll(/\[data-theme~=(?:"([a-z0-9-]+)"|([a-z0-9-]+))\]/g)) {
    const id = m[1] || m[2];
    if (!id.startsWith('a11y-')) ids.add(id);
  }
  return [...ids];
}

/**
 * The themes a site can use: its own VB copy when it has one, else VP's.
 * @param {{ siteDir: string, siteId: string, vpCdnDir: string }} p
 * @returns {{ source: 'site'|'vp', vbUrl: string|null, builtIns: string[], themes: object[] }}
 */
export function themeCatalog({ siteDir, siteId, vpCdnDir }) {
  const vb = findSiteVb(siteDir);
  if (!vb) {
    return {
      source: 'vp',
      vbUrl: null,
      builtIns: BUILT_IN_THEMES,
      themes: listThemes(vpCdnDir, { builtIns: BUILT_IN_THEMES, hrefBase: '/assets/vb' }),
    };
  }
  const builtIns = builtInThemeIds(readFileSync(join(vb.dir, VB_FILE), 'utf-8'));
  const vbDir = posix.dirname(vb.url);
  const hrefBase = `/sites/${siteId}/site${vbDir === "/" ? "" : vbDir}`;
  return { source: 'site', vbUrl: vb.url, builtIns, themes: listThemes(vb.dir, { builtIns, hrefBase }) };
}
