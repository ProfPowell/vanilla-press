/**
 * The post slug and how it follows the title (plan ruling P2): only while
 * the post is not published and the slug hasn't been edited by hand.
 *
 * @module editor/slug
 */

/**
 * The slug a title gives: lowercase ASCII letters and digits joined by '-'.
 * @param {string} title
 * @returns {string}
 */
export function slugify(title) {
  return String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Whether the stored slug was set by hand: it is not what the title gives.
 * Computed from the stored meta, so it survives a reload.
 * @param {{ title?: string, slug?: string }} meta
 * @returns {boolean}
 */
export function slugIsHandEdited(meta) {
  return !!meta.slug && meta.slug !== slugify(meta.title || '');
}

/**
 * Whether `slug` is the placeholder a new post gets (`untitled` or
 * `untitled-<stamp>`): it follows the first title typed, though it is not
 * what an empty title gives.
 * @param {string} slug
 * @returns {boolean}
 */
export function isPlaceholderSlug(slug) {
  return /^untitled(-[a-z0-9]+)?$/.test(String(slug || ''));
}

/**
 * The slug after the title changes to `newTitle`. A published post keeps its
 * slug (its live URL), as does a hand-edited one; otherwise the slug follows
 * the title, and an empty title keeps the current slug.
 * @param {{ status?: string, slug?: string }} meta - the meta before the edit
 * @param {string} newTitle
 * @param {{ handEdited: boolean }} options
 * @returns {string}
 */
export function slugAfterTitleEdit(meta, newTitle, { handEdited }) {
  if (meta.status === 'published' || handEdited) return meta.slug;
  return slugify(newTitle) || meta.slug;
}
