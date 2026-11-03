/**
 * Loads web component scripts for the editor (and the site screen's "Try it")
 * and builds live component elements the way the HTML renderer writes them.
 *
 * - `componentScriptUrl` / `createLoader` / `attributeEntries`: pure, tested in Node.
 * - `loadComponent`: the page's shared loader (one import per package, cached).
 * - `createComponentElement`, `syncAttributes`, `setComponentValue`: DOM helpers,
 *   only touch the DOM when called. User strings never go through innerHTML.
 *
 * A component script that fails to import resolves 'failed'; nothing here
 * throws into the caller (ProseMirror node views).
 *
 * @module editor/component-loader
 */

/** @typedef {import('../../../src/components/describe.js').ComponentDescriptor} ComponentDescriptor */

import { isSafeComponentTag, isSafeAttrName } from '../../../src/schema/component-names.js';
import { SITE } from './site-context.js';

/** Percent-encode a path segment, keeping a package scope's `@` readable. */
const segment = (s) => encodeURIComponent(s).replace(/^%40/, '@');
const segments = (path) => path.split('/').filter(Boolean).map(segment).join('/');

/**
 * Where a component's script is served, or null when there is nothing to
 * import (bundled with Vanilla Breeze, or not installed).
 * @param {ComponentDescriptor|null} descriptor
 * @param {string|null} siteId - null in fixture mode (`vp serve`)
 * @returns {string|null}
 */
export function componentScriptUrl(descriptor, siteId) {
  if (!descriptor || descriptor.bundled || !descriptor.package || !descriptor.scriptPath) return null;
  const rest = `${segments(descriptor.package)}/${segments(descriptor.scriptPath.replace(/^\.\//, ''))}`;
  return siteId ? `/sites/${encodeURIComponent(siteId)}/components/${rest}` : `/components/${rest}`;
}

/**
 * A loader bound to a site: `load(descriptor) -> Promise<'ready'|'failed'>`,
 * one import per package (the promise is cached). Never rejects.
 * @param {{ siteId: string|null, importer?: (url: string) => Promise<unknown> }} opts
 * @returns {(descriptor: ComponentDescriptor) => Promise<'ready'|'failed'>}
 */
export function createLoader({ siteId, importer = (url) => import(url) }) {
  const cache = new Map();
  return (descriptor) => {
    if (descriptor?.bundled) return Promise.resolve('ready');
    const key = descriptor?.package || '';
    if (cache.has(key)) return cache.get(key);
    const url = componentScriptUrl(descriptor, siteId);
    const promise = url
      ? Promise.resolve().then(() => importer(url)).then(() => 'ready', (err) => {
        console.error(`Component script failed to load: ${url}`, err);
        return 'failed';
      })
      : Promise.resolve('failed');
    cache.set(key, promise);
    return promise;
  };
}

/**
 * Attribute name/value pairs as the renderer writes them: sorted by name,
 * `true` as a bare attribute (''), `false` and unsafe names left out.
 * @param {Record<string, string|number|boolean>|null} attrs
 * @returns {Array<[string, string]>}
 */
export function attributeEntries(attrs) {
  return Object.keys(attrs || {}).filter(isSafeAttrName).sort()
    .filter(name => attrs[name] !== false && attrs[name] != null)
    .map(name => [name, attrs[name] === true ? '' : String(attrs[name])]);
}

// --- The page's loader and error guard ---

let guarded = false;

/** A component script URL: `<origin>/components/…` or `<origin>/sites/<id>/components/…`. */
const COMPONENT_URL = /https?:\/\/[^/\s]+(?:\/sites\/[^/\s]+)?\/components\//;

/** True when an error's file name or stack points into a component script. */
function fromComponent(text) {
  return typeof text === 'string' && COMPONENT_URL.test(text);
}

/**
 * Keep errors thrown by component scripts (in their callbacks, timers or
 * promises) from surfacing as editor failures: log them and stop there.
 */
function guardComponentErrors() {
  if (guarded || typeof window === 'undefined') return;
  guarded = true;
  window.addEventListener('error', (event) => {
    if (!fromComponent(event.filename) && !fromComponent(event.error?.stack)) return;
    event.preventDefault();
    console.error('Component error (the editor keeps working):', event.error || event.message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    if (!fromComponent(event.reason?.stack)) return;
    event.preventDefault();
    console.error('Component error (the editor keeps working):', event.reason);
  });
}

let pageLoader = null;

/**
 * Load a component's script once per package for this page's site.
 * @param {ComponentDescriptor} descriptor
 * @returns {Promise<'ready'|'failed'>}
 */
export function loadComponent(descriptor) {
  guardComponentErrors();
  pageLoader ||= createLoader({ siteId: SITE });
  return pageLoader(descriptor);
}

// --- DOM helpers ---

/**
 * Create the element for `tag` (a plain <div> when the tag is unsafe or the
 * element's constructor throws), with `attrs` set.
 * @param {string} tag
 * @param {Record<string, string|number|boolean>} attrs
 * @returns {HTMLElement}
 */
export function createComponentElement(tag, attrs) {
  let el;
  try {
    el = document.createElement(isSafeComponentTag(tag) ? tag : 'div');
  } catch (err) {
    console.error(`<${tag}> could not be created:`, err);
    el = document.createElement('div');
  }
  syncAttributes(el, {}, attrs);
  return el;
}

/**
 * Update `el` in place from `prev` attrs to `next` attrs.
 * @param {Element} el
 * @param {Record<string, string|number|boolean>|null} prev
 * @param {Record<string, string|number|boolean>|null} next
 */
export function syncAttributes(el, prev, next) {
  const wanted = new Map(attributeEntries(next));
  for (const [name] of attributeEntries(prev)) {
    if (!wanted.has(name)) el.removeAttribute(name);
  }
  for (const [name, value] of wanted) {
    if (el.getAttribute(name) === value) continue;
    try { el.setAttribute(name, value); } catch (err) { console.error(`Attribute ${name} not set:`, err); }
  }
}

/**
 * Put a text or code `value` in `el` as the renderer does for `wrap`:
 * 'text' (or none) a text child, 'template' a <template> holding the text,
 * 'script' a <script type="text/plain"> holding it.
 * @param {Element} el
 * @param {string|null} value
 * @param {string|null} wrap
 */
export function setComponentValue(el, value, wrap) {
  if (typeof value !== 'string') {
    el.replaceChildren();
    return;
  }
  if (wrap === 'template') {
    const tpl = document.createElement('template');
    tpl.content.append(document.createTextNode(value));
    el.replaceChildren(tpl);
  } else if (wrap === 'script') {
    const script = document.createElement('script');
    script.type = 'text/plain';
    script.textContent = value.replace(/<\/script/gi, '<\\/script');
    el.replaceChildren(script);
  } else {
    el.replaceChildren(document.createTextNode(value));
  }
}
