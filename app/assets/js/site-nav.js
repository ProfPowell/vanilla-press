/**
 * The site page's rail: which sections exist and how they are addressed.
 * Pure, no DOM: tested in Node.
 *
 * @module app/site-nav
 */

/** Sections that work today, in rail order. */
export const SECTIONS = ['posts', 'media', 'components', 'theme'];

/** Sections shown disabled under "Coming later". */
export const LATER = ['Programs', 'Analytics', 'Social'];

/**
 * The section named by `?section=`, or `posts` when missing or unknown.
 * @param {string} search - e.g. `location.search`
 * @returns {string}
 */
export function sectionFromSearch(search) {
  const section = new URLSearchParams(search || '').get('section');
  return SECTIONS.includes(section) ? section : 'posts';
}

/**
 * The address of a section of a site. Posts is the default, so it has no `section`.
 * @param {string} siteId
 * @param {string} section
 * @returns {string}
 */
export function sectionHref(siteId, section) {
  const base = `site.html?site=${encodeURIComponent(siteId)}`;
  return section === 'posts' ? base : `${base}&section=${section}`;
}
