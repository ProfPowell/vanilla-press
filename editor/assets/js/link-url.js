/**
 * Link address handling shared by the format toolbar and the Markdown input rules.
 *
 * @module editor/link-url
 */

/**
 * Turn what was typed in the link field into an href, or null when there is
 * nothing usable. Web addresses without a scheme get https://; relative paths,
 * anchors, mailto: and tel: stay as typed; other schemes (javascript:, data:) are refused.
 * @param {string} text
 * @returns {string|null}
 */
export function normalizeLinkUrl(text) {
  const t = String(text ?? '').trim();
  if (!t || /\s/.test(t)) return null;
  if (/^(\/|#|\?|\.\.?\/)/.test(t)) return t;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(t);
  if (scheme) return /^(https?|mailto|tel)$/i.test(scheme[1]) ? t : null;
  return `https://${t}`;
}
