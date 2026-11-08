/**
 * The site theme setting (config/theme.json): validation, ids, stylesheet
 * map, migration from vp.json. Pure and browser-safe: no node imports.
 * Rules match Cook's theme plugin; ids always start with the theme name,
 * including "default".
 *
 * @module themes/theme-setting
 */

export const SAFE_ID = /^[a-z0-9-]+$/;
export const MODES = ['auto', 'light', 'dark'];
export const ADJUST_ID = 'vp-site';
export const CUSTOM_URL_DIR = '/assets/themes';

const isSafeId = (v) => typeof v === 'string' && SAFE_ID.test(v);
const isUrl = (v) => typeof v === 'string'
  && !/[\s"'`<>\\]/.test(v)
  && ((v.startsWith('/') && !v.startsWith('//')) || /^https?:\/\/[^/]/.test(v));
const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * @typedef {Object} VpThemeSetting
 * @property {string} name
 * @property {'auto'|'light'|'dark'} mode
 * @property {string|null} adjust
 * @property {Record<string,string>} files
 * @property {Record<string,'light'|'dark'>} modes
 * @property {string|null} vb
 * @property {Array<{id:string,name:string,base:string,only?:'light'|'dark'}>} custom
 * @property {object|null} adjustments
 */

/**
 * Validate a raw theme setting. Unsafe entries are dropped.
 * @param {unknown} raw
 * @returns {VpThemeSetting|null}
 */
export function normalizeSetting(raw) {
  if (!isPlain(raw) || !isSafeId(raw.name)) return null;
  const files = Object.create(null);
  if (isPlain(raw.files)) {
    for (const [id, url] of Object.entries(raw.files)) if (isSafeId(id) && isUrl(url)) files[id] = url;
  }
  const modes = Object.create(null);
  if (isPlain(raw.modes)) {
    for (const [id, m] of Object.entries(raw.modes)) if (isSafeId(id) && (m === 'light' || m === 'dark')) modes[id] = m;
  }
  const custom = [];
  if (Array.isArray(raw.custom)) {
    for (const c of raw.custom) {
      if (!isPlain(c) || !isSafeId(c.id)) continue;
      const entry = {
        id: c.id,
        name: typeof c.name === 'string' && c.name ? c.name : c.id,
        base: isSafeId(c.base) ? c.base : 'default',
      };
      if (c.only === 'light' || c.only === 'dark') entry.only = c.only;
      custom.push(entry);
    }
  }
  return {
    name: raw.name,
    mode: MODES.includes(raw.mode) ? raw.mode : 'auto',
    adjust: isSafeId(raw.adjust) ? raw.adjust : null,
    files,
    modes,
    vb: isUrl(raw.vb) ? raw.vb : null,
    custom,
    adjustments: isPlain(raw.adjustments) ? raw.adjustments : null,
  };
}

/**
 * Slug of a theme name, unique against taken ids (retro-mine, retro-mine-2).
 * @param {string} name
 * @param {Iterable<string>} taken
 * @returns {string}
 */
export function slugId(name, taken) {
  const used = new Set(taken);
  const base = String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'theme';
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/**
 * The files map for theme.json: every theme that needs its own stylesheet.
 * @param {{ vbUrl: string|null, vbIds: string[], builtIns: string[], custom: Array<{id:string}>, adjust: string|null }} p
 * @returns {Record<string,string>}
 */
export function themeFiles({ vbUrl, vbIds = [], builtIns = [], custom = [], adjust = null }) {
  const files = {};
  if (vbUrl) {
    const dir = vbUrl.slice(0, Math.max(0, vbUrl.lastIndexOf('/')));
    for (const id of vbIds) if (!builtIns.includes(id)) files[id] = `${dir}/themes/${id}.css`;
  }
  for (const c of custom) files[c.id] = `${CUSTOM_URL_DIR}/${c.id}.css`;
  if (adjust) files[adjust] = `${CUSTOM_URL_DIR}/${adjust}.css`;
  return files;
}

/**
 * The generic `modes` map for Cook: custom themes that only have one scheme.
 * @param {Array<{id:string, only?:string}>} custom
 * @returns {Record<string,'light'|'dark'>}
 */
export function modesFor(custom) {
  const out = {};
  for (const c of custom || []) if (c.only === 'light' || c.only === 'dark') out[c.id] = c.only;
  return out;
}

/**
 * data-theme ids for the site theme: always starts with the name (including
 * "default"), then the adjustment id. "" only when there is no setting.
 * @param {{name:string, adjust?:string|null}|null} setting
 * @returns {string}
 */
export function settingIds(setting) {
  if (!setting || !setting.name) return '';
  return [setting.name, ...(setting.adjust ? [setting.adjust] : [])].join(' ');
}

/**
 * Move a legacy vp.json `theme` into a setting (R1: "default" is dropped).
 * @param {object} vp
 * @returns {{ setting: VpThemeSetting|null, vp: object }}
 */
export function migrateVpJson(vp) {
  const src = isPlain(vp) ? vp : {};
  if (!Object.hasOwn(src, 'theme')) return { setting: null, vp: { ...src } };
  const { theme, ...rest } = src;
  if (theme === 'default') return { setting: null, vp: rest };
  if (!isSafeId(theme)) return { setting: null, vp: { ...src } };
  return { setting: { name: theme, mode: 'auto', files: {} }, vp: rest };
}

/**
 * Who uses a theme: the site theme first, then post titles.
 * @param {{name:string}|null} setting
 * @param {Array<{id:string, meta?:{title?:string, theme?:string}}>} docs
 * @param {string} id
 * @returns {string[]}
 */
export function themeUsers(setting, docs, id) {
  const users = [];
  if (setting && setting.name === id) users.push('the site theme');
  for (const d of docs || []) {
    if (d?.meta?.theme === id) users.push(d.meta.title || d.id);
  }
  return users;
}
