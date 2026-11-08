/**
 * A site's theme setting on disk (config/theme.json) and its custom theme
 * library (src/assets/themes/<id>.css): migration from vp.json, the state
 * the Theme screen shows, and the library operations (save, import, rename,
 * delete). Library operations write at once (R2); they go live with the next
 * Apply or Publish/Update (R3).
 *
 * @module app/site-theme
 */

import { readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileAtomic } from '../sync/atomic-write.js';
import { getAllDocuments } from '../store/content.js';
import { render } from '../renderers/html.js';
import {
  normalizeSetting, slugId, themeFiles, modesFor, migrateVpJson, themeUsers, ADJUST_ID, SAFE_ID, CUSTOM_URL_DIR,
} from '../themes/theme-setting.js';
import { themeCatalog } from '../themes/site-vb.js';
import { rewriteComposerCss, customThemeCss, ThemeCssError } from '../themes/theme-css.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const VP_CDN_DIR = join(ROOT, 'node_modules', 'vanilla-breeze', 'dist', 'cdn');
const MAX_NAME = 80;
const PREVIEW_BLOCKS = 6;

/** A refused theme operation: `status` and the extra JSON `body` fields to send with `error`. */
export class ThemeError extends Error {
  /** @param {number} status @param {string} message @param {object} [body] */
  constructor(status, message, body = {}) {
    super(message);
    this.name = 'ThemeError';
    this.status = status;
    this.body = body;
  }
}

const settingPath = (ws) => join(ws.configDir, 'theme.json');
const vpJsonPath = (ws) => join(ws.configDir, 'vp.json');
const customFile = (ws, id) => join(ws.siteDir, 'src', 'assets', 'themes', `${id}.css`);

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

const writeJson = (file, value) => writeFileAtomic(file, JSON.stringify(value, null, 2) + '\n');

const catalogOf = (ws, { siteId = '', vpCdnDir = VP_CDN_DIR } = {}) =>
  themeCatalog({ siteDir: ws.siteDir, siteId, vpCdnDir });

/**
 * The setting in config/theme.json, normalized; null when there is none (or it is unreadable).
 * @param {import('../workspace/workspace.js').Workspace} ws
 * @returns {import('../themes/theme-setting.js').VpThemeSetting|null}
 */
export function readSetting(ws) {
  return normalizeSetting(readJson(settingPath(ws)));
}

/**
 * Write config/theme.json (atomic, 2-space JSON). `files` and `modes` are
 * recomputed from the site's VB copy and `custom`; whatever the caller passed is ignored.
 * @param {import('../workspace/workspace.js').Workspace} ws
 * @param {object} setting
 */
export function writeSetting(ws, setting) {
  const s = normalizeSetting(setting);
  if (!s) throw new ThemeError(400, 'A theme setting needs a theme id.');
  const cat = catalogOf(ws);
  const vbUrl = cat.source === 'site' ? cat.vbUrl : null;
  const out = {
    name: s.name,
    mode: s.mode,
    ...(s.adjust ? { adjust: s.adjust } : {}),
    files: themeFiles({
      vbUrl, vbIds: cat.themes.map((t) => t.id), builtIns: cat.builtIns, custom: s.custom, adjust: s.adjust,
    }),
  };
  const modes = modesFor(s.custom);
  if (Object.keys(modes).length) out.modes = modes;
  if (vbUrl) out.vb = vbUrl;
  if (s.custom.length) out.custom = s.custom;
  if (s.adjustments) out.adjustments = s.adjustments;
  writeJson(settingPath(ws), out);
}

/**
 * Move a legacy `vp.json` theme to config/theme.json (R1: "default" is only
 * dropped). Nothing happens when theme.json already exists, vp.json is
 * missing or unreadable, or its theme is not a safe id.
 * @param {import('../workspace/workspace.js').Workspace} ws
 * @returns {boolean} true when it wrote theme.json
 */
export function migrateVpTheme(ws) {
  if (!ws?.configDir || existsSync(settingPath(ws))) return false;
  const vp = readJson(vpJsonPath(ws));
  if (!vp || typeof vp !== 'object' || Array.isArray(vp) || !Object.hasOwn(vp, 'theme')) return false;
  const { setting, vp: rest } = migrateVpJson(vp);
  if (!setting && Object.hasOwn(rest, 'theme')) return false; // unsafe id: left as it is
  if (setting) writeSetting(ws, normalizeSetting(setting));
  writeJson(vpJsonPath(ws), rest);
  return Boolean(setting);
}

/**
 * The setting, creating `{ name: "default", mode: "auto" }` when there is none (R4).
 * @param {import('../workspace/workspace.js').Workspace} ws
 */
export function ensureThemeSetting(ws) {
  const current = readSetting(ws);
  if (current) return current;
  writeSetting(ws, { name: 'default', mode: 'auto' });
  return readSetting(ws);
}

const customHref = (siteId, id) => (siteId ? `/sites/${siteId}/site${CUSTOM_URL_DIR}/${id}.css` : null);

/** The ThemeInfo of a custom entry. */
function customInfo(c, siteId) {
  return {
    id: c.id, name: c.name, tier: 'custom', custom: true,
    ...(c.only ? { only: c.only } : {}),
    href: customHref(siteId, c.id), base: c.base,
  };
}

const dateOf = (d) => d.meta.published || d.meta.updated || d.meta.created || '';
const newestFirst = (a, b) => (dateOf(a) < dateOf(b) ? 1 : dateOf(a) > dateOf(b) ? -1 : 0);

/**
 * What the Theme screen shows.
 * @param {import('../workspace/workspace.js').Workspace} ws
 * @param {import('better-sqlite3').Database} db
 * @param {{ siteId: string, vpCdnDir?: string }} options
 */
export function themeState(ws, db, { siteId, vpCdnDir = VP_CDN_DIR }) {
  const setting = readSetting(ws);
  const cat = catalogOf(ws, { siteId, vpCdnDir });
  const docs = getAllDocuments(db);
  const pages = docs.filter((d) => d.meta.theme).map((d) => ({
    id: d.id, title: d.meta.title, status: d.meta.status, theme: d.meta.theme, themeScope: d.meta.themeScope || 'page',
  }));
  const published = docs.filter((d) => d.meta.status === 'published').sort(newestFirst);
  const pick = published[0] || docs.filter((d) => d.meta.status !== 'published').sort(newestFirst)[0] || null;
  const preview = pick && {
    title: pick.meta.title,
    date: dateOf(pick) || null,
    html: render({ ...pick, blocks: (pick.blocks || []).slice(0, PREVIEW_BLOCKS) }, { scope: 'content' }),
  };
  return {
    setting,
    vb: { source: cat.source, url: cat.source === 'site' ? `/sites/${siteId}/site${cat.vbUrl}` : null },
    themes: [...cat.themes, ...(setting?.custom || []).map((c) => customInfo(c, siteId))],
    pages,
    preview,
  };
}

function checkName(name) {
  const n = typeof name === 'string' ? name.trim() : '';
  if (!n) throw new ThemeError(400, 'Give the theme a name.');
  if (n.length > MAX_NAME || /[\u0000-\u001f\u007f]/.test(n)) throw new ThemeError(400, `A theme name is at most ${MAX_NAME} characters, on one line.`);
  return n;
}

const isRecord = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** Run a theme-css call, turning its errors into ThemeErrors. */
function css(fn) {
  try {
    return fn();
  } catch (err) {
    if (err instanceof ThemeCssError) throw new ThemeError(err.status, err.message, { dropped: err.dropped });
    throw err;
  }
}

/** A new custom theme: the id (unique against the catalog, custom themes and vp-site), its file, its entry. */
function addCustom(ws, name, makeCss, entry, options) {
  const setting = readSetting(ws);
  const custom = setting?.custom || [];
  const taken = [...catalogOf(ws, options).themes.map((t) => t.id), ...custom.map((c) => c.id), ADJUST_ID];
  const id = slugId(name, taken);
  const result = css(() => makeCss(id));
  writeFileAtomic(customFile(ws, id), result.css);
  const added = { id, name, ...entry(result) };
  writeSetting(ws, { ...ensureThemeSetting(ws), custom: [...custom, added] }); // R4
  return { theme: customInfo(added, options.siteId), result };
}

/**
 * Save a new custom theme from computed tokens (R10). Unsafe token names
 * and values are skipped (theme-css skippedTokens lists them); 422 when none is usable.
 * @param {import('../workspace/workspace.js').Workspace} ws
 * @param {{ name: string, base: string, tokens: { light: Record<string,string>, dark?: Record<string,string> } }} input
 * @param {{ siteId?: string, vpCdnDir?: string }} [options]
 */
export function saveCustomTheme(ws, { name, base, tokens } = {}, options = {}) {
  const n = checkName(name);
  if (typeof base !== 'string' || !SAFE_ID.test(base)) throw new ThemeError(400, 'The base theme must be a theme id.');
  if (!isRecord(tokens) || !isRecord(tokens.light) || (tokens.dark != null && !isRecord(tokens.dark))) {
    throw new ThemeError(400, 'tokens must be { light, dark } maps of custom properties.');
  }
  return addCustom(ws, n, (id) => ({ css: customThemeCss(id, tokens) }), () => ({ base }), options).theme;
}

/**
 * Import a Theme Composer theme.css (R11).
 * @param {import('../workspace/workspace.js').Workspace} ws
 * @param {{ name: string, css: string }} input
 * @param {{ siteId?: string, vpCdnDir?: string }} [options]
 * @returns {{ theme: object, dropped: string[] }}
 */
export function importCustomTheme(ws, { name, css: text } = {}, options = {}) {
  const n = checkName(name);
  if (typeof text !== 'string') throw new ThemeError(400, 'Choose a theme.css file to import.');
  const { theme, result } = addCustom(ws, n, (id) => rewriteComposerCss(text, id),
    (r) => ({ base: 'default', ...(r.schemes === 'both' ? {} : { only: r.schemes }) }), options);
  return { theme, dropped: result.dropped };
}

function findCustom(ws, id) {
  const setting = readSetting(ws);
  const entry = setting?.custom.find((c) => c.id === id);
  if (!entry) throw new ThemeError(404, 'No such custom theme.');
  return { setting, entry };
}

/**
 * Rename a custom theme; the id stays (R12).
 * @param {import('../workspace/workspace.js').Workspace} ws
 * @param {string} id
 * @param {string} name
 * @param {{ siteId?: string }} [options]
 */
export function renameCustomTheme(ws, id, name, { siteId } = {}) {
  const n = checkName(name);
  const { setting, entry } = findCustom(ws, id);
  const renamed = { ...entry, name: n };
  writeSetting(ws, { ...setting, custom: setting.custom.map((c) => (c.id === id ? renamed : c)) });
  return customInfo(renamed, siteId);
}

/**
 * Delete a custom theme; 409 `{ usedBy }` while the site or a post uses it.
 * @param {import('../workspace/workspace.js').Workspace} ws
 * @param {import('better-sqlite3').Database} db
 * @param {string} id
 */
export function deleteCustomTheme(ws, db, id) {
  const { setting } = findCustom(ws, id);
  const usedBy = themeUsers(setting, getAllDocuments(db), id);
  if (usedBy.length) throw new ThemeError(409, 'This theme is in use.', { usedBy });
  writeSetting(ws, { ...setting, custom: setting.custom.filter((c) => c.id !== id) });
  rmSync(customFile(ws, id), { force: true });
}
