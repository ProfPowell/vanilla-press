/**
 * A site's theme setting on disk (config/theme.json) and its custom theme
 * library (src/assets/themes/<id>.css): migration from vp.json, the state
 * the Theme screen shows, and the library operations (save, import, rename,
 * delete). Library operations write at once and are committed at once (the
 * routes commit them in the backup queue), without changing the applied
 * state (R2): the look changes only with Apply. Publish/Update commit the
 * theme paths too (R3).
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
  normalizeSetting, slugId, themeFiles, modesFor, migrateVpJson, themeUsers, mergeSettings, ADJUST_ID, SAFE_ID, CUSTOM_URL_DIR,
} from '../themes/theme-setting.js';
import { themeCatalog } from '../themes/site-vb.js';
import { headCommit, headTree, readBlobs } from '../git/git.js';
import { rewriteComposerCss, customThemeCss, ThemeCssError } from '../themes/theme-css.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const VP_CDN_DIR = join(ROOT, 'node_modules', 'vanilla-breeze', 'dist', 'cdn');
const MAX_NAME = 80;
const PREVIEW_BLOCKS = 6;
const defaultGit = { headCommit, headTree, readBlobs };

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
 * A library change (`keepApplied`) on a site with no VB copy keeps the previous
 * entries of every non-custom id, and the previous `vb`.
 * @param {import('../workspace/workspace.js').Workspace} ws
 * @param {object} setting
 * @param {{ keepApplied?: object|null }} [options] - a library change: the files and
 *   modes entries of this (previous, normalized) setting's applied ids are kept as they were
 */
export function writeSetting(ws, setting, { keepApplied = null } = {}) {
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
  // A library change on a site with no VB copy yet (a fresh clone, before the first build) can't
  // recompute the VB entries: the ones it didn't touch (every id but the old custom ones) and vb stay.
  const carry = keepApplied && !vbUrl;
  if (carry) {
    const oldCustom = new Set(keepApplied.custom.map((c) => c.id));
    for (const [id, url] of Object.entries(keepApplied.files)) if (!oldCustom.has(id) && !(id in out.files)) out.files[id] = url;
    for (const [id, m] of Object.entries(keepApplied.modes)) if (!oldCustom.has(id) && !(id in modes)) modes[id] = m;
  }
  // A library change never changes the look: the applied ids keep their files and modes entries.
  if (keepApplied) {
    for (const id of [keepApplied.name, keepApplied.adjust].filter(Boolean)) {
      if (keepApplied.files[id]) out.files[id] = keepApplied.files[id];
      else delete out.files[id];
      if (keepApplied.modes[id]) modes[id] = keepApplied.modes[id];
      else delete modes[id];
    }
  }
  if (Object.keys(modes).length) out.modes = modes;
  if (vbUrl) out.vb = vbUrl;
  else if (carry && keepApplied.vb) out.vb = keepApplied.vb;
  if (s.custom.length) out.custom = s.custom;
  if (s.adjustments) out.adjustments = s.adjustments;
  writeJson(settingPath(ws), out);
}

/**
 * Copy a legacy `vp.json` theme to config/theme.json. vp.json is never
 * edited here (it is a backup path; theme.json is committed only by Apply,
 * Publish/Update (R3) or a library change): the commit that first carries
 * theme.json drops the key.
 * Nothing happens when theme.json already exists, vp.json is missing or
 * unreadable, or its theme is "default" (R1) or not a safe id.
 * @param {import('../workspace/workspace.js').Workspace} ws
 * @returns {boolean} true when it wrote theme.json
 */
export function migrateVpTheme(ws) {
  if (!ws?.configDir || existsSync(settingPath(ws))) return false;
  const { setting } = migrateVpJson(readJson(vpJsonPath(ws)));
  if (!setting) return false;
  writeSetting(ws, normalizeSetting(setting));
  return true;
}

/** A file's bytes, or null when it does not exist (for `restoreFile`). */
export function snapshotFile(file) {
  try {
    return readFileSync(file);
  } catch {
    return null;
  }
}

/** Put a file back as `snapshotFile` saw it (removed when it did not exist). */
export function restoreFile(file, bytes) {
  if (bytes === null) rmSync(file, { force: true });
  else writeFileAtomic(file, bytes);
}

/** config/theme.json's path in a workspace. */
export const themeSettingFile = settingPath;

/**
 * Before a commit that carries THEME_PATHS: when config/theme.json exists and
 * is not committed yet (this commit is the first to add it), drop the legacy
 * `theme` key from config/vp.json, so the two never disagree on GitHub. After
 * that commit vp.json is never touched again.
 * @param {import('../workspace/workspace.js').Workspace} ws
 * @param {(dir: string, path: string) => Promise<string|null>} readHead
 * @returns {Promise<boolean>} true when vp.json was rewritten
 */
export async function dropVpThemeOnFirstCommit(ws, readHead) {
  if (!existsSync(settingPath(ws))) return false;
  if ((await readHead(ws.siteDir, 'config/theme.json')) !== null) return false;
  const vp = readJson(vpJsonPath(ws));
  if (!isRecord(vp) || !Object.hasOwn(vp, 'theme')) return false;
  const { theme, ...rest } = vp;
  writeJson(vpJsonPath(ws), rest);
  return true;
}

/**
 * Run a commit that carries config/theme.json: `dropVpThemeOnFirstCommit` first,
 * then `commit(dropped)`; if the commit throws, vp.json is put back as it was
 * (its key must not go to GitHub without theme.json), and the error rethrown.
 * @template T
 * @param {import('../workspace/workspace.js').Workspace} ws
 * @param {(dir: string, path: string) => Promise<string|null>} readHead
 * @param {(dropped: boolean) => Promise<T>} commit - dropped: vp.json was rewritten
 * @returns {Promise<T>}
 */
export async function commitWithTheme(ws, readHead, commit) {
  const vpBefore = snapshotFile(vpJsonPath(ws));
  const dropped = await dropVpThemeOnFirstCommit(ws, readHead);
  try {
    return await commit(dropped);
  } catch (err) {
    if (dropped) restoreFile(vpJsonPath(ws), vpBefore);
    throw err;
  }
}

/**
 * Publish/Update (R3, R4): recompute theme.json's `files`, `modes` and `vb`
 * from the site as it is now. With `create`, a site with no theme.json gets
 * the default setting. An unreadable theme.json is left as it is.
 * @param {import('../workspace/workspace.js').Workspace} ws
 * @param {{ create?: boolean }} [options]
 */
export function refreshThemeSetting(ws, { create = false } = {}) {
  if (!existsSync(settingPath(ws))) {
    if (create) writeSetting(ws, DEFAULT_SETTING);
    return;
  }
  const current = readSetting(ws);
  if (current) writeSetting(ws, current);
}

const DEFAULT_SETTING = Object.freeze({ name: 'default', mode: 'auto' });

/**
 * The setting, creating `{ name: "default", mode: "auto" }` when there is none (R4).
 * @param {import('../workspace/workspace.js').Workspace} ws
 */
export function ensureThemeSetting(ws) {
  const current = readSetting(ws);
  if (current) return current;
  writeSetting(ws, DEFAULT_SETTING);
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
  const added = { id, name, ...entry(result) };
  const file = customFile(ws, id);
  writeFileAtomic(file, result.css);
  try {
    writeSetting(ws, { ...(setting || DEFAULT_SETTING), custom: [...custom, added] }, { keepApplied: setting }); // R4, one write
  } catch (err) {
    rmSync(file, { force: true }); // no file without an entry
    throw err;
  }
  return { theme: customInfo(added, options.siteId), result };
}

/**
 * Save a new custom theme from computed tokens (R10). Unsafe token names
 * and values are skipped (theme-css skippedTokens lists them); 422 when none is usable.
 * @param {import('../workspace/workspace.js').Workspace} ws
 * @param {{ name: string, base: string, tokens: { light: Record<string,string>, dark?: Record<string,string> },
 *   only?: 'light'|'dark' }} input - only: the theme has one scheme (default: the base custom theme's)
 * @param {{ siteId?: string, vpCdnDir?: string }} [options]
 */
export function saveCustomTheme(ws, { name, base, tokens, only } = {}, options = {}) {
  const n = checkName(name);
  if (typeof base !== 'string' || !SAFE_ID.test(base)) throw new ThemeError(400, 'The base theme must be a theme id.');
  if (!isRecord(tokens) || !isRecord(tokens.light) || (tokens.dark != null && !isRecord(tokens.dark))) {
    throw new ThemeError(400, 'tokens must be { light, dark } maps of custom properties.');
  }
  if (only != null && only !== 'light' && only !== 'dark') throw new ThemeError(400, 'only must be "light" or "dark".');
  // A copy of a one-scheme custom theme keeps its scheme: one block, marked like the base.
  const scheme = only ?? readSetting(ws)?.custom.find((c) => c.id === base)?.only ?? null;
  const sets = scheme ? { light: tokens.light } : tokens;
  return addCustom(ws, n, (id) => ({ css: customThemeCss(id, sets) }),
    () => ({ base, ...(scheme ? { only: scheme } : {}) }), options).theme;
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
  writeSetting(ws, { ...setting, custom: setting.custom.map((c) => (c.id === id ? renamed : c)) }, { keepApplied: setting });
  return customInfo(renamed, siteId);
}

/** A front matter value (JSON-quoted, single-quoted or bare), or null. */
export function frontMatterValue(text, key) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  const line = fm && new RegExp(`^${key}:[ \\t]*(.*?)[ \\t]*$`, 'm').exec(fm[1]);
  if (!line) return null;
  const v = line[1];
  try {
    const parsed = JSON.parse(v);
    return typeof parsed === 'string' ? parsed : null;
  } catch {
    return /^'.*'$/.test(v) ? v.slice(1, -1) : v;
  }
}

/**
 * Who uses a theme in the committed HEAD (what the next deploy builds): its
 * config/theme.json `name`, and pages under src/ whose front matter has the
 * theme (named by their title, else their path). Nothing committed: none.
 * @param {string} siteDir
 * @param {string} id
 * @param {{ headCommit: Function, headTree: Function, readBlobs: Function }} git
 * @returns {Promise<string[]>}
 */
export async function liveThemeUsers(siteDir, id, git) {
  if (!(await git.headCommit(siteDir))) return [];
  const users = [];
  const [setting] = await git.headTree(siteDir, 'config/theme.json');
  const pages = (await git.headTree(siteDir, 'src')).filter((e) => e.path.endsWith('.html'));
  const oids = [...new Set([...(setting ? [setting.oid] : []), ...pages.map((p) => p.oid)])];
  const texts = await git.readBlobs(siteDir, oids);
  const text = (e) => {
    if (!texts.has(e.oid)) throw new Error(`git has no file ${e.path}`);
    return texts.get(e.oid);
  };
  if (setting) {
    let name = null;
    try { name = JSON.parse(text(setting))?.name; } catch (err) { if (/^git has no/.test(err.message)) throw err; }
    if (name === id) users.push('the site theme');
  }
  for (const page of pages) {
    const t = text(page);
    if (frontMatterValue(t, 'theme') === id) users.push(frontMatterValue(t, 'title') || page.path);
  }
  return users;
}

/**
 * Delete a custom theme; 409 `{ usedBy }` while the site or a post uses it,
 * in the working copy or in committed HEAD; 503 when git can't be read (nothing deleted).
 * @param {import('../workspace/workspace.js').Workspace} ws
 * @param {import('better-sqlite3').Database} db
 * @param {string} id
 * @param {{ git?: { headCommit: Function, headTree: Function, readBlobs: Function } }} [options]
 */
export async function deleteCustomTheme(ws, db, id, { git = defaultGit } = {}) {
  findCustom(ws, id);
  let live;
  try {
    live = await liveThemeUsers(ws.siteDir, id, git);
  } catch (err) {
    throw new ThemeError(503, `Couldn't check whether the live site uses this theme (${err.message}). Nothing was deleted. Try again.`);
  }
  const { setting } = findCustom(ws, id); // read again after the wait
  const usedBy = [...new Set([...themeUsers(setting, getAllDocuments(db), id), ...live])];
  if (usedBy.length) throw new ThemeError(409, 'This theme is in use.', { usedBy });
  writeSetting(ws, { ...setting, custom: setting.custom.filter((c) => c.id !== id) }, { keepApplied: setting });
  rmSync(customFile(ws, id), { force: true });
}

const SETTING_REL = 'config/theme.json';
const THEMES_REL = 'src/assets/themes/';
const parseJson = (text) => {
  try {
    const v = JSON.parse(text);
    return isRecord(v) ? v : null;
  } catch {
    return null;
  }
};

/**
 * A conflict resolver for git's push (rebase): when every conflicted file is
 * a theme path, GitHub's version wins. config/theme.json is merged
 * (`mergeSettings`: GitHub's applied state when both computers changed it,
 * library entries from both); a custom theme file is GitHub's (removed when
 * GitHub removed it). Any other conflicted file: not resolved (false).
 * @param {import('../workspace/workspace.js').Workspace} ws
 * @returns {(p: { files: string[], readStage: (n: 1|2|3, path: string) => Promise<string|null> }) => Promise<boolean>}
 */
export function themeConflictResolver(ws) {
  return async ({ files, readStage }) => {
    if (!files.every((f) => f === SETTING_REL || f.startsWith(THEMES_REL))) return false;
    for (const f of files) {
      const file = join(ws.siteDir, f);
      const upstream = await readStage(2, f); // in a rebase, stage 2 is the branch being rebased onto: GitHub's
      if (upstream === null) {
        rmSync(file, { force: true });
        continue;
      }
      if (f === SETTING_REL) {
        const up = parseJson(upstream);
        const local = parseJson(await readStage(3, f));
        if (up && local) {
          writeJson(file, mergeSettings(parseJson(await readStage(1, f)), up, local));
          continue;
        }
      }
      writeFileAtomic(file, upstream);
    }
    return true;
  };
}
