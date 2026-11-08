/**
 * Apply to site: write the applied theme (config/theme.json and the
 * adjustments file src/assets/themes/vp-site.css), check the build, commit
 * and push, as Update does for a post. And the live check's reading of a
 * page's `<html data-theme>` (R15).
 *
 * @module app/theme-apply
 */

import { existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileAtomic } from '../sync/atomic-write.js';
import { readHead as gitReadHead, GitNotConnectedError } from '../git/git.js';
import { BuildError, readSiteUrl } from './publish.js';
import { BACKUP_PATHS, THEME_PATHS } from './site-git.js';
import {
  readSetting, writeSetting, snapshotFile, restoreFile, themeSettingFile, dropVpThemeOnFirstCommit, themeConflictResolver,
  ThemeError,
} from './site-theme.js';
import { themeCatalog } from '../themes/site-vb.js';
import { MODES, SAFE_ID, ADJUST_ID, settingIds } from '../themes/theme-setting.js';
import {
  adjustmentsCss, isDefaultAdjustments, safeTokenName, safeTokenValue, FONT_STACKS, CORNER_RADII,
} from '../themes/theme-css.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const VP_CDN_DIR = join(ROOT, 'node_modules', 'vanilla-breeze', 'dist', 'cdn');
const MAX_COLORS = 200;
/** Apply's 409: another computer applied a theme meanwhile; GitHub's was kept. */
export const THEME_CHANGED = 'The theme was changed on another computer. Review it and apply again.';
const NO_VB = 'This site has no copy of Vanilla Breeze under src/, so only themes built into Vanilla Breeze can be applied.';

const isRecord = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const bad = (message) => new ThemeError(400, message);

/** A colors map: every name a custom property, every value safe (400 otherwise). */
function checkColors(map, scheme) {
  if (map == null) return {};
  if (!isRecord(map)) throw bad(`colors.${scheme} must be a map of custom properties.`);
  const out = {};
  const entries = Object.entries(map);
  if (entries.length > MAX_COLORS) throw bad(`At most ${MAX_COLORS} colors per scheme.`);
  for (const [name, value] of entries) {
    if (!safeTokenName(name)) throw bad(`colors.${scheme} has a name that is not a custom property.`);
    if (typeof value !== 'string' || !safeTokenValue(value)) throw bad(`The ${scheme} value of ${name} can't be used.`);
    out[name] = value.trim();
  }
  return out;
}

/**
 * The adjustments of an Apply request, checked and in a fixed shape; null when absent.
 * @param {unknown} adj
 * @returns {import('../themes/theme-css.js').Adjustments|null}
 */
function checkAdjustments(adj) {
  if (adj == null) return null;
  if (!isRecord(adj)) throw bad('adjustments must be an object.');
  const { hue = null, headingFont = null, bodyFont = null, corners = 'theme', colors = null } = adj;
  if (hue !== null && !(typeof hue === 'number' && Number.isFinite(hue))) throw bad('hue must be a number.');
  for (const font of [headingFont, bodyFont]) {
    if (font !== null && !(typeof font === 'string' && Object.hasOwn(FONT_STACKS, font))) {
      throw bad(`Fonts are one of ${Object.keys(FONT_STACKS).join(', ')}.`);
    }
  }
  if (corners !== null && corners !== 'theme' && !(typeof corners === 'string' && Object.hasOwn(CORNER_RADII, corners))) {
    throw bad('corners is theme, square or round.');
  }
  if (colors !== null && !isRecord(colors)) throw bad('colors must be { light, dark } maps.');
  const light = checkColors(colors?.light, 'light');
  const dark = checkColors(colors?.dark, 'dark');
  const hasColors = Object.keys(light).length > 0 || Object.keys(dark).length > 0;
  return { hue, headingFont, bodyFont, corners: corners || 'theme', colors: hasColors ? { light, dark } : null };
}

/** The request body, checked (400). */
function checkBody(body) {
  const b = isRecord(body) ? body : {};
  if (typeof b.name !== 'string' || !SAFE_ID.test(b.name)) throw bad('Choose a theme.');
  if (!MODES.includes(b.mode)) throw bad(`The color scheme is one of ${MODES.join(', ')}.`);
  return { name: b.name, mode: b.mode, adjustments: checkAdjustments(b.adjustments) };
}

/** Run ensureInstalled + runBuild; never throws (a failure is `{ ok: false, log }`). */
async function build(deps, siteDir) {
  try {
    await deps.ensureInstalled(siteDir);
    return await deps.runBuild(siteDir);
  } catch (err) {
    return { ok: false, log: err.message };
  }
}

/**
 * Apply a theme to the whole site: validate, make sure the site's VB copy is
 * there when the theme needs one of its files (R5: one build to vendor it),
 * write theme.json and vp-site.css (removed when nothing is adjusted), check
 * the build (on failure both files go back as they were), commit the backup
 * paths and THEME_PATHS (`Theme: <name>`), push. A theme conflict in the push
 * keeps GitHub's applied state (themeConflictResolver).
 * @param {{
 *   ws: import('../workspace/workspace.js').Workspace,
 *   db?: object,
 *   body: { name: string, mode: 'auto'|'light'|'dark', adjustments?: object|null },
 *   deps: { ensureInstalled: Function, runBuild: Function, commitPaths: Function, push: Function,
 *     gitStatus: Function, readHead?: Function, readSiteUrl?: Function },
 *   options?: { vpCdnDir?: string },
 * }} p
 * @returns {Promise<{ status: 'pushed'|'saved', url: string|null, sha: string|null, rebased: boolean, ids: string,
 *   themeChanged: boolean }>} themeChanged: another computer applied a theme meanwhile, the push
 *   kept GitHub's (the setting on disk is GitHub's now; the route answers 409)
 * @throws {ThemeError|BuildError|Error} 400 bad request or unknown theme; 422 R5, or a custom
 *   theme whose file is missing; git errors propagate
 */
export async function applyTheme({ ws, body, deps, options = {} }) {
  const { name, mode, adjustments } = checkBody(body);
  const siteDir = ws.siteDir;
  const catalog = () => themeCatalog({ siteDir, siteId: '', vpCdnDir: options.vpCdnDir || VP_CDN_DIR });
  const setting = readSetting(ws);
  const custom = setting?.custom || [];
  const customEntry = custom.find((c) => c.id === name) || null;
  const known = (cat) => Boolean(customEntry) || cat.themes.some((t) => t.id === name);
  let cat = catalog();
  // Without a site VB copy the catalog is VP's: the name is checked after the R5 build.
  if (cat.source === 'site' && !known(cat)) throw bad(`There is no theme "${name}".`);
  if (customEntry && !existsSync(join(siteDir, 'src', 'assets', 'themes', `${name}.css`))) {
    throw new ThemeError(422, `The custom theme "${customEntry.name}" has no file (src/assets/themes/${name}.css). `
      + 'Save or import it again, or choose another theme.');
  }

  // R5: the site's VB copy is often vendored by its build; build once, then look again.
  if (cat.source !== 'site') {
    const vendored = await build(deps, siteDir);
    if (!vendored.ok) throw new BuildError(vendored.log);
    cat = catalog();
    if (cat.source !== 'site' && !customEntry && !cat.builtIns.includes(name)) throw new ThemeError(422, NO_VB);
    if (!known(cat)) throw bad(`There is no theme "${name}".`);
  } else {
    await deps.ensureInstalled(siteDir);
  }

  // Write the applied state; a failed build puts both files back.
  const adjusted = adjustments !== null && !isDefaultAdjustments(adjustments);
  const settingFile = themeSettingFile(ws);
  const adjustFile = join(siteDir, 'src', 'assets', 'themes', `${ADJUST_ID}.css`);
  const before = { setting: snapshotFile(settingFile), adjust: snapshotFile(adjustFile) };
  const restore = () => {
    restoreFile(settingFile, before.setting);
    restoreFile(adjustFile, before.adjust);
  };
  try {
    if (adjusted) writeFileAtomic(adjustFile, adjustmentsCss(adjustments));
    else rmSync(adjustFile, { force: true });
    writeSetting(ws, {
      ...(setting || {}), name, mode, custom,
      adjust: adjusted ? ADJUST_ID : null,
      adjustments: adjusted ? adjustments : null,
    });
  } catch (err) {
    restore();
    throw err;
  }
  let checked;
  try {
    checked = await deps.runBuild(siteDir);
  } catch (err) {
    checked = { ok: false, log: err.message };
  }
  if (!checked?.ok) {
    restore();
    throw new BuildError(checked?.log ?? '');
  }

  const appliedOf = (st) => JSON.stringify([st?.name, st?.mode, st?.adjust ?? null, st?.adjustments ?? null]);
  const intended = appliedOf(readSetting(ws));
  const status = await deps.gitStatus(siteDir);
  let sha = null;
  if (status.isRepo) {
    await dropVpThemeOnFirstCommit(ws, deps.readHead || gitReadHead);
    sha = await deps.commitPaths(siteDir, [...BACKUP_PATHS, ...THEME_PATHS], `Theme: ${name}`);
  }
  const siteUrl = await (deps.readSiteUrl || readSiteUrl)(siteDir);
  const url = siteUrl ? `${siteUrl.replace(/\/+$/, '')}/` : null;
  // ids and themeChanged are read after the push: a theme conflict keeps GitHub's setting.
  const done = (pushStatus, rebased = false) => {
    const now = readSetting(ws);
    return { status: pushStatus, url, sha, rebased, ids: settingIds(now), themeChanged: appliedOf(now) !== intended };
  };

  if (!status.isRepo || !status.hasRemote || !status.hasUpstream) return done('saved');
  let pushed;
  try {
    pushed = await deps.push(siteDir, { yieldUntracked: [...THEME_PATHS], resolveConflicts: themeConflictResolver(ws) });
  } catch (err) {
    if (err instanceof GitNotConnectedError) return done('saved');
    throw err;
  }
  return done('pushed', Boolean(pushed?.rebased));
}

/**
 * The `data-theme` of a page's `<html>` element (whitespace collapsed), or null.
 * @param {string} html
 * @returns {string|null}
 */
export function htmlThemeAttr(html) {
  const tag = /<html(?=[\s>/])([^>]*)>/i.exec(String(html ?? ''));
  if (!tag) return null;
  const attr = /(?:^|[\s/])data-theme\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i.exec(tag[1]);
  if (!attr) return null;
  return (attr[1] ?? attr[2] ?? attr[3]).trim().split(/\s+/).filter(Boolean).join(' ');
}
