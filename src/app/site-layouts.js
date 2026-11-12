/**
 * @file site-layouts.js
 * @description The layouts a site offers, for the editor's layout select.
 * The checker is loaded from the site's own Cook (`<siteDir>/node_modules/cook-ssg`)
 * so it always matches the Cook that builds the site. A Cook without
 * `cook-ssg/layouts` falls back to a plain scan of `src/layouts`.
 */

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { readdir, readFile } from 'node:fs/promises';

export const OLD_COOK_MESSAGE =
  "This site's Cook is too old for layouts built on other layouts; update cook-ssg";

/** Import `cook-ssg/layouts` from the site's own install; null on any failure. */
export async function importCook(siteDir) {
  try {
    const require = createRequire(join(siteDir, 'package.json'));
    return await import(pathToFileURL(require.resolve('cook-ssg/layouts')).href);
  } catch {
    return null;
  }
}

async function readLayoutFiles(siteDir) {
  const dir = join(siteDir, 'src', 'layouts');
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries) {
    try {
      if (e.isFile() && e.name.endsWith('.html')) {
        out.push({ name: e.name.slice(0, -5), html: await readFile(join(dir, e.name), 'utf8') });
      } else if (e.isDirectory()) {
        out.push({ name: e.name, html: await readFile(join(dir, e.name, 'index.html'), 'utf8') });
      }
    } catch { /* no index.html or unreadable: not a layout */ }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function fallbackLayout({ name, html }) {
  const source = html.replace(/<!--[\s\S]*?-->/g, '');
  const slots = new Set();
  for (const [, slot] of source.matchAll(/\$\{\s*slot:([\w-]+)\s*\}/g)) {
    if (slot !== 'head') slots.add(slot);
  }
  const child = /<(?:html|body)\b[^>]*\bdata-template\b/i.test(source);
  return {
    name, label: name, abstract: false, usable: !child, editable: true, missing: false,
    slots: [...slots].map((s) => ({ name: s, label: s })),
  };
}

/**
 * @param {string|null} siteDir
 * @param {{ importCook?: (siteDir: string) => Promise<object|null> }} [options]
 * @returns {Promise<{ supported: boolean, message: string|null, layouts: object[] }>}
 */
export async function siteLayouts(siteDir, { importCook: load = importCook } = {}) {
  if (!siteDir) return { supported: false, message: null, layouts: [] };

  const cook = await load(siteDir);
  let message = OLD_COOK_MESSAGE;
  if (cook && typeof cook.listLayouts === 'function') {
    try {
      const { layouts } = await cook.listLayouts(siteDir);
      return {
        supported: true,
        message: null,
        layouts: layouts.map((e) => ({
          name: e.name,
          label: e.label || e.name,
          abstract: Boolean(e.abstract),
          usable: true,
          editable: Boolean(e.editable),
          missing: false,
          slots: (e.slots || []).filter((s) => s.name !== 'head').map((s) => ({ name: s.name, label: s.label })),
        })),
      };
    } catch (err) {
      message = `This site's Cook couldn't read its layouts: ${err?.message ?? err}`;
    }
  }

  const files = await readLayoutFiles(siteDir);
  return { supported: false, message, layouts: files.map(fallbackLayout) };
}
