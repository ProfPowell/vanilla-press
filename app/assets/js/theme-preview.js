/**
 * DOM helpers for the Theme section's cards and preview: theme stylesheets
 * in the app (cards, color probe), the colors a hue change gives (read from
 * the real theme CSS), and the preview iframe's adjustments stylesheet.
 *
 * @module app/theme-preview
 */
import { hueColorExpr } from '../../../src/themes/theme-css.js';
import { ADJUST_ID } from '../../../src/themes/theme-setting.js';
import { hueOf, tokenReads } from './theme-view.js';

/** The tokens a hue change writes as literal colors, per scheme (R7). */
export const HUE_TOKENS = ['--color-primary', '--color-interactive'];

const loaded = new Map();
const ready = new Set();

/**
 * Load a theme's stylesheet into the app once: one `<link rel="stylesheet" data-vp-theme-css="<id>">`
 * per id (for the cards and the color probe). Themes with no stylesheet (built into Vanilla Breeze) need none.
 * @param {{ id: string, href?: string|null }|null} theme
 */
export function ensureThemeCss(theme) {
  if (!theme) return;
  if (!theme.href) { ready.add(theme.id); return; }
  if (loaded.has(theme.id)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = theme.href;
  link.dataset.vpThemeCss = theme.id;
  loaded.set(theme.id, new Promise((resolve) => {
    const done = () => { ready.add(theme.id); resolve(); };
    link.addEventListener('load', done, { once: true });
    link.addEventListener('error', done, { once: true });
  }));
  document.head.append(link);
}

/**
 * Resolves when a theme's stylesheet has loaded (or failed, or there is none).
 * @param {string} id
 * @returns {Promise<void>}
 */
export function themeCssReady(id) {
  return Promise.resolve(loaded.get(id));
}

/**
 * Whether a theme's stylesheet is in the app already (true for themes with none),
 * so values read from it now are the theme's.
 * @param {string} id
 */
export function themeCssLoaded(id) {
  return ready.has(id);
}

/** A hidden themed element with a probe inside, for reading computed values. */
function withProbe(host, base, scheme, read) {
  const box = document.createElement('div');
  box.hidden = true;
  box.className = 'theme-probe';
  box.setAttribute('aria-hidden', 'true');
  box.dataset.theme = base;
  box.dataset.mode = scheme;
  box.style.colorScheme = scheme;
  const probe = document.createElement('span');
  box.append(probe);
  host.append(box);
  try {
    return read(probe);
  } finally {
    box.remove();
  }
}

/**
 * The literal colors a hue gives a base theme's primary and interactive
 * colors in each scheme, read with getComputedStyle from a probe whose color
 * is `hueColorExpr(...)` (never the expression itself: written back into its
 * own token it would be a cycle).
 * @param {HTMLElement} probeHost
 * @param {string} base - theme id
 * @param {number} hue
 * @returns {{ light: Record<string,string>, dark: Record<string,string> }}
 */
export function computeColors(probeHost, base, hue) {
  const out = { light: {}, dark: {} };
  for (const scheme of ['light', 'dark']) {
    withProbe(probeHost, base, scheme, (probe) => {
      for (const token of HUE_TOKENS) {
        probe.style.color = hueColorExpr(token, hue);
        out[scheme][token] = getComputedStyle(probe).color;
      }
    });
  }
  return out;
}

/**
 * The hue of a theme's own primary color in a scheme (0 for a gray one).
 * @param {HTMLElement} probeHost
 * @param {string} base
 * @param {'light'|'dark'} [scheme]
 * @returns {number}
 */
export function themeHue(probeHost, base, scheme = 'light') {
  return withProbe(probeHost, base, scheme, (probe) => {
    probe.style.color = 'oklch(from var(--color-primary) l c h)';
    return Math.round(hueOf(getComputedStyle(probe).color) ?? 0) % 360;
  });
}

const cssTexts = new Map();

/**
 * A stylesheet's text (a theme's file, or the site's vanilla-breeze.css for a
 * built-in theme), fetched once.
 * @param {string} href
 * @returns {Promise<string>}
 */
export function cssText(href) {
  if (!cssTexts.has(href)) {
    const p = fetch(href).then((r) => {
      if (!r.ok) throw new Error(`Couldn't read ${href} (${r.status})`);
      return r.text();
    });
    p.catch(() => cssTexts.delete(href));
    cssTexts.set(href, p);
  }
  return cssTexts.get(href);
}

/**
 * The computed values of `names` for a base theme with the draft's
 * adjustments on top, in each scheme (R10): read from a hidden probe with
 * `data-theme="<base> vp-site"` while the adjustments CSS (scoped to vp-site)
 * is in the document. Empty values are left out. A theme with one scheme
 * gives that scheme only, as `light` (the saved theme's one block).
 * @param {HTMLElement} probeHost
 * @param {{ id: string, only?: 'light'|'dark' }} base - its stylesheet must be loaded
 * @param {string[]} names
 * @param {string} adjustmentsCssText - adjustmentsCss(...) output, '' for none
 * @returns {{ light: Record<string,string>, dark?: Record<string,string> }}
 */
export function computeTokens(probeHost, base, names, adjustmentsCssText) {
  const style = document.createElement('style');
  style.textContent = adjustmentsCssText || '';
  document.head.append(style);
  try {
    const read = (scheme) => withProbe(probeHost, `${base.id} ${ADJUST_ID}`, scheme, (probe) => {
      const cs = getComputedStyle(probe.parentElement);
      const out = {};
      for (const name of new Set(names)) {
        const value = cs.getPropertyValue(name).trim();
        if (value) out[name] = value;
      }
      return out;
    });
    return Object.fromEntries(tokenReads(base).map(([set, scheme]) => [set, read(scheme)]));
  } finally {
    style.remove();
  }
}

/**
 * Put the preview's adjustments CSS (scoped to vp-site) in `<style id="vp-site-preview">`
 * of a document: the preview iframe's.
 * @param {string} cssText
 * @param {Document} [doc]
 */
export function setPreviewCss(cssText, doc = document) {
  let style = doc.getElementById('vp-site-preview');
  if (!style || style.localName !== 'style') {
    style = doc.createElement('style');
    doc.head.append(style);
    style.id = 'vp-site-preview';
  }
  style.textContent = cssText;
}

const FOCUSABLE = 'a[href], area[href], button, input, select, textarea, summary, iframe, object, embed, '
  + 'audio[controls], video[controls], [tabindex], [contenteditable]:not([contenteditable="false"])';

/**
 * Take the preview page out of the tab order and out of reach of the pointer:
 * it stays readable (a screen reader can browse it) but nothing in it acts.
 * The iframe's sandbox already stops scripts, forms, popups and top navigation.
 * @param {Document} doc
 */
export function quietPreview(doc) {
  for (const el of doc.querySelectorAll(FOCUSABLE)) el.setAttribute('tabindex', '-1');
  for (const el of doc.querySelectorAll('audio, video')) {
    el.removeAttribute('autoplay');
    el.pause?.();
  }
}
