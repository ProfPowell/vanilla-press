/**
 * Shared utilities for renderers.
 *
 * @module renderers/shared
 */

/**
 * Escape a string for use in HTML text content.
 * @param {string} str
 * @returns {string}
 */
export function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Escape a string for use in an HTML attribute value.
 * @param {string} str
 * @returns {string}
 */
export function escapeAttr(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Format an ISO date string for display.
 * @param {string} isoDate - ISO 8601 date string
 * @returns {string} Formatted date
 */
export function formatDate(isoDate) {
  if (!isoDate) return '';
  const date = new Date(isoDate);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Estimate token count for a string (rough approximation for English text).
 * @param {string} str
 * @returns {number}
 */
export function estimateTokens(str) {
  return Math.ceil((str || '').length / 4);
}
