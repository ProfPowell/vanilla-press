/**
 * Shared name-safety rules for generic component nodes. Used by the validator
 * and by the renderers, which must not trust their input.
 *
 * @module schema/component-names
 */

const TAG_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/;
const RESERVED_TAGS = new Set(['annotation-xml', 'color-profile', 'font-face', 'font-face-src', 'font-face-uri', 'font-face-format', 'font-face-name', 'missing-glyph']);
const ATTR_NAME_RE = /^[a-z][a-z0-9-]*$/;

/**
 * @param {unknown} tag
 * @returns {boolean} true if `tag` is a safe, non-reserved custom element name
 */
export function isSafeComponentTag(tag) {
  return typeof tag === 'string' && TAG_RE.test(tag) && !RESERVED_TAGS.has(tag);
}

/**
 * @param {unknown} name
 * @returns {boolean} true if `name` is a safe attribute name (no `on*` handlers)
 */
export function isSafeAttrName(name) {
  return typeof name === 'string' && ATTR_NAME_RE.test(name) && !name.startsWith('on');
}
