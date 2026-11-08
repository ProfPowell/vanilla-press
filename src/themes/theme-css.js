/**
 * Theme CSS that Vanilla Press writes: a Theme Composer import rewritten to
 * a custom theme, a saved theme from computed tokens, and the site's
 * adjustments layer (vp-site). Pure and browser-safe: no node imports.
 *
 * Nothing from an imported file is passed through as CSS text. The output is
 * regenerated from fixed selectors plus custom properties whose names match
 * safeTokenName and whose values pass safeTokenValue, so an import can only
 * set custom properties on [data-theme~="<id>"] inside @layer bundle-theme.
 *
 * @module themes/theme-css
 */

import { SAFE_ID, ADJUST_ID } from './theme-setting.js';

export const IMPORT_LIMIT = 256 * 1024;

export class ThemeCssError extends Error {
  /** @param {string} message @param {number} status @param {string[]} [dropped] */
  constructor(message, status, dropped = []) {
    super(message);
    this.name = 'ThemeCssError';
    this.status = status;
    this.dropped = dropped;
  }
}

/** VB's three stacks (src/tokens/typography.css), R8. */
export const FONT_STACKS = Object.freeze({
  sans: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  serif: 'Charter, "Bitstream Charter", "Sitka Text", Cambria, serif',
  mono: 'ui-monospace, "Cascadia Code", "Source Code Pro", Menlo, monospace',
});

const RADIUS_TOKENS = ['--radius-xs', '--radius-s', '--radius-sm', '--radius-m', '--radius-l', '--radius-xl', '--radius-2xl'];
const ROUND = ['0.375rem', '0.5rem', '0.625rem', '0.75rem', '1rem', '1.25rem', '1.5rem'];

/** Corner choices, R8. */
export const CORNER_RADII = Object.freeze({
  square: Object.freeze(Object.fromEntries(RADIUS_TOKENS.map((t) => [t, '0']))),
  round: Object.freeze(Object.fromEntries(RADIUS_TOKENS.map((t, i) => [t, ROUND[i]]))),
});

const LAYER = 'bundle-theme';
const MAX_VALUE = 2000;
const MAX_LABEL = 80;
const MAX_DEPTH = 32;
const MAX_DROPPED = 50;

// ── token checks ──────────────────────────────────────────────────────────

/** @param {unknown} name */
export function safeTokenName(name) {
  return typeof name === 'string' && /^--[a-z0-9-]+$/.test(name);
}

/** Functions that can load a resource or read the document. */
const RESOURCE_FN = /(url|src|image|image-set|cross-fade|element|paint|attr)\s*\(/i;

/**
 * A custom property value safe to write inside a rule: none of the R11
 * characters (url( { } < ; @), no escapes, !important, comments, control
 * characters or resource functions; strings closed; brackets balanced.
 * @param {unknown} value
 */
export function safeTokenValue(value) {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (!v || v.length > MAX_VALUE) return false;
  if (/[{};<@\\!\u0000-\u001f\u007f]/.test(v)) return false;
  if (v.includes('/*') || v.includes('*/')) return false;
  if (RESOURCE_FN.test(v)) return false;
  const stack = [];
  let quote = '';
  for (const ch of v) {
    if (quote) { if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[') stack.push(ch);
    else if (ch === ')' || ch === ']') {
      if (stack.pop() !== (ch === ')' ? '(' : '[')) return false;
    }
  }
  return !quote && stack.length === 0;
}

const assertId = (id) => {
  if (typeof id !== 'string' || !SAFE_ID.test(id)) throw new ThemeCssError('Theme id must be lowercase letters, digits and hyphens.', 400);
};

// ── tokenizer ─────────────────────────────────────────────────────────────

/** Replace comments with a space; strings (which end at a newline) are kept. */
function stripComments(text) {
  let out = '';
  let i = 0;
  let quote = '';
  while (i < text.length) {
    const ch = text[i];
    if (quote) {
      out += ch;
      if (ch === '\\' && i + 1 < text.length) { out += text[i + 1]; i += 2; continue; }
      if (ch === quote || ch === '\n') quote = '';
      i++;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
      out += ' ';
      continue;
    }
    if (ch === '\\' && i + 1 < text.length) { out += ch + text[i + 1]; i += 2; continue; }
    if (ch === '"' || ch === "'") quote = ch;
    out += ch;
    i++;
  }
  return out;
}

/**
 * Scan from i to the first stop character outside strings, escapes and
 * nested braces. `}` at brace depth 0 always stops. Returns the stop index
 * (text.length at the end).
 */
function scan(text, i, stops) {
  let depth = 0;
  let quote = '';
  for (; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote || ch === '\n') quote = '';
      continue;
    }
    if (ch === '\\') { i++; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (depth === 0 && (stops.includes(ch) || ch === '}')) return i;
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
  }
  return text.length;
}

/** Index of the `}` matching the `{` at open (or text.length). */
function matchBrace(text, open) {
  return scan(text, open + 1, '');
}

/**
 * @typedef {{type:'decl', name:string, value:string}
 *   | {type:'at', prelude:string, block:string|null}
 *   | {type:'rule', prelude:string, block:string}} Item
 */

/** Parse a stylesheet or block body into items. Stray `}` are skipped. */
function parseItems(text) {
  /** @type {Item[]} */
  const items = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch) || ch === ';' || ch === '}') { i++; continue; }
    if (ch === '@') {
      const j = scan(text, i, ';{');
      const prelude = text.slice(i, j).trim();
      if (text[j] === '{') {
        const end = matchBrace(text, j);
        items.push({ type: 'at', prelude, block: text.slice(j + 1, end) });
        i = end + 1;
      } else {
        items.push({ type: 'at', prelude, block: null });
        i = j + (text[j] === ';' ? 1 : 0);
      }
      continue;
    }
    const custom = /^--[^\s:;{}]*\s*:/.exec(text.slice(i, i + 512));
    const j = custom ? scan(text, i, ';') : scan(text, i, ';{');
    if (!custom && text[j] === '{') {
      const end = matchBrace(text, j);
      items.push({ type: 'rule', prelude: text.slice(i, j).trim(), block: text.slice(j + 1, end) });
      i = end + 1;
      continue;
    }
    const chunk = text.slice(i, j);
    const colon = chunk.indexOf(':');
    if (colon === -1) items.push({ type: 'decl', name: chunk.trim(), value: '' });
    else items.push({ type: 'decl', name: chunk.slice(0, colon).trim(), value: chunk.slice(colon + 1) });
    i = j + (text[j] === ';' ? 1 : 0);
  }
  return items;
}

const squash = (s) => s.replace(/\s+/g, ' ').trim();
const label = (s) => {
  const t = squash(s);
  return t.length > MAX_LABEL ? `${t.slice(0, MAX_LABEL)}…` : t;
};

// ── Composer import ───────────────────────────────────────────────────────

const LIGHT_SELECTORS = new Set([':root', 'html']);
const DARK_SELECTORS = new Set([':root[data-mode=dark]', '[data-mode=dark]', 'html[data-mode=dark]']);

/** 'light' | 'dark' | null for a selector list made only of theme selectors. */
function selectorScheme(prelude) {
  const parts = prelude.split(',').map((p) => p.replace(/\s+/g, '').replace(/["']/g, '').toLowerCase());
  if (parts.every((p) => LIGHT_SELECTORS.has(p))) return 'light';
  if (parts.every((p) => DARK_SELECTORS.has(p))) return 'dark';
  return null;
}

/** 'light' | 'dark' | null for @media (prefers-color-scheme: …). */
function mediaScheme(prelude) {
  const m = /^@media\s*\(\s*prefers-color-scheme\s*:\s*(dark|light)\s*\)$/i.exec(squash(prelude));
  return m ? /** @type {'light'|'dark'} */ (m[1].toLowerCase()) : null;
}

function byteLength(text) {
  return new TextEncoder().encode(text).length;
}

/**
 * Rewrite a Theme Composer theme.css as a custom theme.
 * @param {string} cssText
 * @param {string} id
 * @returns {{ css: string, schemes: 'both'|'light'|'dark', dropped: string[] }}
 */
export function rewriteComposerCss(cssText, id) {
  assertId(id);
  if (typeof cssText !== 'string') throw new ThemeCssError('No theme CSS was given.', 422);
  if (cssText.length > IMPORT_LIMIT || byteLength(cssText) > IMPORT_LIMIT) {
    throw new ThemeCssError('That file is over 256 KB.', 413);
  }
  const light = new Map();
  const dark = new Map();
  const seen = new Set();
  const drop = (s) => { const l = label(s); if (l) seen.add(l); };
  const droppedList = () => {
    const list = [...seen].slice(0, MAX_DROPPED);
    if (seen.size > MAX_DROPPED) list.push(`…and ${seen.size - MAX_DROPPED} more`);
    return list;
  };

  const takeBlock = (block, target) => {
    for (const item of parseItems(block)) {
      if (item.type !== 'decl') { drop(item.prelude); continue; }
      const value = squash(item.value);
      if (!safeTokenName(item.name) || !safeTokenValue(value)) { drop(item.name); continue; }
      target.delete(item.name);
      target.set(item.name, value);
    }
  };

  const walk = (text, inScheme) => {
    for (const item of parseItems(text)) {
      if (item.type === 'rule') {
        const scheme = selectorScheme(item.prelude);
        if (!scheme) { drop(item.prelude); continue; }
        takeBlock(item.block, inScheme === 'dark' || scheme === 'dark' ? dark : light);
      } else if (item.type === 'at') {
        const scheme = inScheme ? null : mediaScheme(item.prelude);
        if (scheme && item.block !== null) walk(item.block, scheme);
        else drop(item.prelude);
      } else {
        drop(item.name);
      }
    }
  };
  walk(stripComments(cssText), null);

  if (!light.size && !dark.size) {
    throw new ThemeCssError('Nothing usable: the file sets no custom properties on :root.', 422, droppedList());
  }
  const lightDecls = Object.fromEntries(light);
  const darkDecls = Object.fromEntries(dark);
  let css; let schemes;
  if (light.size && dark.size) {
    schemes = 'both';
    css = layered(id, lightDecls, darkDecls);
  } else {
    const only = light.size ? lightDecls : darkDecls;
    schemes = light.size ? singleSchemeOf(lightDecls) : 'dark';
    css = layered(id, only, null);
  }
  return { css, schemes, dropped: droppedList() };
}

// ── writers ───────────────────────────────────────────────────────────────

/** Declarations that pass the checks, one per line. */
function declLines(decls, indent) {
  const lines = [];
  if (!decls || typeof decls !== 'object') return lines;
  for (const [name, raw] of Object.entries(decls)) {
    const value = typeof raw === 'string' ? squash(raw) : '';
    if (safeTokenName(name) && safeTokenValue(value)) lines.push(`${indent}${name}: ${value};`);
  }
  return lines;
}

/** Base block, [data-mode=dark] block and the auto media rule. */
function schemeRules(id, base, dark, indent) {
  const sel = `[data-theme~="${id}"]`;
  const inner = `${indent}  `;
  const out = [];
  const baseLines = declLines(base, inner);
  if (baseLines.length) out.push(`${indent}${sel} {`, ...baseLines, `${indent}}`);
  const darkLines = declLines(dark, `${inner}  `);
  if (darkLines.length) {
    out.push(`${indent}${sel}[data-mode="dark"] {`, ...darkLines.map((l) => l.slice(2)), `${indent}}`);
    out.push(`${indent}@media (prefers-color-scheme: dark) { ${sel}:not([data-mode="light"]) {`,
      ...darkLines, `${indent}} }`);
  }
  return out;
}

function layered(id, light, dark) {
  return [`@layer ${LAYER} {`, ...schemeRules(id, light, dark, '  '), '}', ''].join('\n');
}

const isRecord = (d) => !!d && typeof d === 'object' && !Array.isArray(d);

/**
 * Names in a light/dark token set that customThemeCss (and the colors of
 * adjustmentsCss) skip as unsafe, in order, each once. Callers use it to
 * tell the user which computed values were not saved.
 * @param {{ light?: Record<string,string>, dark?: Record<string,string> }|null|undefined} sets
 * @returns {string[]}
 */
export function skippedTokens(sets) {
  const out = new Set();
  for (const decls of [sets?.light, sets?.dark]) {
    if (!isRecord(decls)) continue;
    for (const [name, raw] of Object.entries(decls)) {
      if (!safeTokenName(name) || !safeTokenValue(typeof raw === 'string' ? squash(raw) : '')) out.add(name);
    }
  }
  return [...out];
}

/**
 * A saved theme from computed tokens, both schemes when dark is given.
 * Unsafe names and values are skipped (see skippedTokens). Throws
 * ThemeCssError 422 (with the skipped names as `dropped`) when the light
 * set is missing or has no usable token.
 * @param {string} id
 * @param {{ light: Record<string,string>, dark?: Record<string,string> }} sets
 */
export function customThemeCss(id, sets) {
  assertId(id);
  const light = isRecord(sets) && isRecord(sets.light) ? sets.light : null;
  const dark = isRecord(sets) && isRecord(sets.dark) ? sets.dark : null;
  if (!light || !declLines(light, '').length) {
    throw new ThemeCssError('Nothing usable: the theme has no tokens that can be saved.', 422, skippedTokens(sets));
  }
  return layered(id, light, dark);
}

// ── adjustments (vp-site) ─────────────────────────────────────────────────

/**
 * @typedef {Object} Adjustments
 * @property {number|null} hue
 * @property {'sans'|'serif'|'mono'|null} headingFont
 * @property {'sans'|'serif'|'mono'|null} bodyFont
 * @property {'theme'|'square'|'round'} corners
 * @property {{ light: Record<string,string>, dark: Record<string,string> }|null} colors
 */

const validHue = (h) => typeof h === 'number' && Number.isFinite(h);
const fontOf = (k) => (typeof k === 'string' && Object.hasOwn(FONT_STACKS, k) ? FONT_STACKS[k] : null);
const cornersOf = (c) => (typeof c === 'string' && Object.hasOwn(CORNER_RADII, c) ? CORNER_RADII[c] : null);
const formatHue = (h) => String(Math.round(h * 100) / 100);
const hasDecls = (d) => !!d && typeof d === 'object' && Object.keys(d).length > 0;

/** Tokens the hue, font and corner settings own; colors cannot set them. */
const SETTING_TOKENS = new Set(['--hue-primary', '--font-heading', '--font-body', ...RADIUS_TOKENS]);
const colorDecls = (d) => (isRecord(d)
  ? Object.fromEntries(Object.entries(d).filter(([name]) => !SETTING_TOKENS.has(name)))
  : null);

/** @param {Adjustments|null|undefined} adj */
export function isDefaultAdjustments(adj) {
  if (!adj || typeof adj !== 'object') return true;
  const colors = adj.colors && typeof adj.colors === 'object' ? adj.colors : null;
  return !validHue(adj.hue) && !fontOf(adj.headingFont) && !fontOf(adj.bodyFont)
    && !cornersOf(adj.corners) && !(colors && (hasDecls(colors.light) || hasDecls(colors.dark)));
}

/**
 * The site's adjustments file: unlayered, scoped to vp-site (R7).
 * '' when nothing is adjusted.
 * @param {Adjustments} adj
 */
export function adjustmentsCss(adj) {
  if (isDefaultAdjustments(adj)) return '';
  const decls = Object.create(null);
  if (validHue(adj.hue)) decls['--hue-primary'] = formatHue(adj.hue);
  const colors = adj.colors && typeof adj.colors === 'object' ? adj.colors : {};
  const light = colorDecls(colors.light);
  if (light) Object.assign(decls, light);
  const heading = fontOf(adj.headingFont);
  const body = fontOf(adj.bodyFont);
  if (heading) decls['--font-heading'] = heading;
  if (body) decls['--font-body'] = body;
  const radii = cornersOf(adj.corners);
  if (radii) Object.assign(decls, radii);
  const dark = colorDecls(colors.dark);
  return [...schemeRules(ADJUST_ID, decls, dark, ''), ''].join('\n');
}

/**
 * The color a hue change gives a token, keeping a minimum chroma (R7).
 * @param {string} token
 * @param {number} hue
 */
export function hueColorExpr(token, hue) {
  if (!safeTokenName(token)) throw new TypeError(`Unsafe token name: ${token}`);
  if (!validHue(hue)) throw new TypeError(`Hue must be a number: ${hue}`);
  return `oklch(from var(${token}) l max(c, 0.1) ${formatHue(hue)})`;
}

// ── reading theme CSS ─────────────────────────────────────────────────────

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Custom property names declared in rules whose selector mentions
 * [data-theme~=<id>] (any quoting); id null reads every rule.
 * @param {string} cssText
 * @param {string|null} id
 * @returns {string[]}
 */
export function themeTokenNames(cssText, id) {
  if (typeof cssText !== 'string') return [];
  const mentions = id == null ? null
    : new RegExp(`\\[\\s*data-theme\\s*~=\\s*(["']?)${escapeRe(id)}\\1\\s*(?:[is]\\s*)?\\]`);
  const names = new Set();
  const walk = (text, inMatch, depth) => {
    if (depth > MAX_DEPTH) return;
    for (const item of parseItems(text)) {
      if (item.type === 'decl') {
        if (inMatch && safeTokenName(item.name)) names.add(item.name);
      } else if (item.type === 'rule') {
        walk(item.block, inMatch || !mentions || mentions.test(item.prelude), depth + 1);
      } else if (item.block !== null) {
        walk(item.block, inMatch, depth + 1);
      }
    }
  };
  walk(stripComments(cssText), false, 0);
  return [...names];
}

// ── scheme detection (R11) ────────────────────────────────────────────────

const num = (s, pctScale = 1) => {
  const t = s.trim().toLowerCase();
  if (t === 'none') return 0;
  const n = parseFloat(t);
  if (!Number.isFinite(n)) return NaN;
  return t.endsWith('%') ? (n / 100) * pctScale : n;
};

/** OKLab lightness of an sRGB color with 0–1 channels. */
function okLightness(r, g, b) {
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [R, G, B] = [r, g, b].map((c) => lin(Math.min(1, Math.max(0, c))));
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
}

function hslToRgb(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)];
}

/** Perceptual lightness 0–1 of a color value, or NaN when unknown. */
function lightnessOf(value) {
  const v = value.trim().toLowerCase();
  if (v === 'black') return 0;
  if (v === 'white') return 1;
  let m = /^#([0-9a-f]{3,8})$/.exec(v);
  if (m) {
    let hex = m[1];
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join('');
    if (hex.length !== 6 && hex.length !== 8) return NaN;
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    return okLightness(r, g, b);
  }
  m = /^([a-z]+)\(\s*([^)]*)\)$/.exec(v);
  if (!m) return NaN;
  const args = m[2].split(/[\s,/]+/).filter(Boolean);
  switch (m[1]) {
    case 'oklch': case 'oklab': return num(args[0]);
    case 'lch': case 'lab': return num(args[0], 100) / 100;
    case 'rgb': case 'rgba': {
      const [r, g, b] = args.slice(0, 3).map((a) => (a.endsWith('%') ? num(a) : num(a) / 255));
      return okLightness(r, g, b);
    }
    case 'hsl': case 'hsla': {
      const h = num(args[0]);
      const s = num(args[1]); const l = num(args[2]);
      const sat = args[1]?.endsWith('%') ? s : s / 100;
      const lig = args[2]?.endsWith('%') ? l : l / 100;
      return okLightness(...hslToRgb(((h % 360) + 360) % 360, sat, lig));
    }
    default: return NaN;
  }
}

/**
 * The scheme of a single-block theme (R11): dark when --color-background
 * has a lightness under 0.5 (OKLCH L; hex, rgb and hsl are converted to
 * OKLab lightness), otherwise light.
 * @param {Record<string,string>} decls
 * @returns {'light'|'dark'}
 */
export function singleSchemeOf(decls) {
  const bg = decls && typeof decls['--color-background'] === 'string' ? decls['--color-background'] : '';
  const l = lightnessOf(bg);
  return Number.isFinite(l) && l < 0.5 ? 'dark' : 'light';
}
