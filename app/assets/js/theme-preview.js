/**
 * DOM helpers for the Theme section's cards and preview: theme stylesheets,
 * the colors a hue change gives (read from the real theme CSS) and the
 * preview's adjustments stylesheet.
 *
 * @module app/theme-preview
 */
import { hueColorExpr } from '../../../src/themes/theme-css.js';
import { hueOf } from './theme-view.js';

/** The tokens a hue change writes as literal colors, per scheme (R7). */
export const HUE_TOKENS = ['--color-primary', '--color-interactive'];

const loaded = new Map();

/**
 * Load a theme's stylesheet once: one `<link rel="stylesheet" data-vp-theme-css="<id>">`
 * per id. Themes with no stylesheet (built into Vanilla Breeze) need none.
 * @param {{ id: string, href?: string|null }} theme
 */
export function ensureThemeCss(theme) {
  if (!theme?.href || loaded.has(theme.id)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = theme.href;
  link.dataset.vpThemeCss = theme.id;
  loaded.set(theme.id, new Promise((resolve) => {
    link.addEventListener('load', resolve, { once: true });
    link.addEventListener('error', resolve, { once: true });
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

/**
 * Put the preview's adjustments CSS (scoped to vp-site) in `<style id="vp-site-preview">`.
 * @param {string} cssText
 */
export function setPreviewCss(cssText) {
  let style = document.getElementById('vp-site-preview');
  if (!style) {
    style = document.createElement('style');
    style.id = 'vp-site-preview';
    document.head.append(style);
  }
  style.textContent = cssText;
}

const DROP_ELEMENTS = 'script, iframe, object, embed, frame, frameset, style, link, meta, base, form, input, button, select, textarea';

/**
 * A post's rendered HTML as an inert fragment for the preview: no scripts,
 * frames, forms, event handler attributes or javascript: links.
 * @param {string} html
 * @returns {DocumentFragment}
 */
export function previewFragment(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = String(html || '');
  for (const el of tpl.content.querySelectorAll(DROP_ELEMENTS)) el.remove();
  for (const el of tpl.content.querySelectorAll('*')) {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on') || (/^(href|src|xlink:href|action|formaction)$/.test(name) && /^\s*javascript:/i.test(attr.value))) {
        el.removeAttribute(attr.name);
      }
    }
  }
  return tpl.content;
}
