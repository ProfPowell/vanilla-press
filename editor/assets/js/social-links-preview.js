/**
 * The editor's preview of `<social-links>`: the site's real links, drawn by
 * Cook through `GET /social/links`. Display-only. The preview lives in the
 * live element's light DOM, which the leaf node view never reads back (the
 * node is an atom with no contentDOM), and the HTML renderer writes
 * `<social-links>` empty whatever a node holds. A filled element would freeze
 * the published links, because Cook leaves one that has children alone.
 *
 * @module editor/social-links-preview
 */

export const SOCIAL_LINKS_TAG = 'social-links';

/** The empty-state copy (exact). */
export const EMPTY_COPY = 'No accounts yet: add them in Social';
const OLD_COOK_COPY = "This site's Cook is too old to preview profile links: update Cook";

/**
 * The route's query for a node's attrs.
 * @param {Record<string, unknown>|null} attrs
 * @returns {{ services?: string, variant?: string }}
 */
export function socialPreviewQuery(attrs) {
  const out = {};
  if (typeof attrs?.services === 'string' && attrs.services.trim()) out.services = attrs.services;
  if (typeof attrs?.variant === 'string' && attrs.variant) out.variant = attrs.variant;
  return out;
}

/**
 * What to show for a route result or error.
 * @param {{ html?: string }|null} result
 * @param {Error & { status?: number }} [error]
 * @returns {{ kind: 'html', html: string }|{ kind: 'empty' }|{ kind: 'old' }|{ kind: 'none' }}
 */
export function previewPlan(result, error) {
  if (error) return error.status === 409 ? { kind: 'old' } : { kind: 'none' };
  if (typeof result?.html === 'string' && result.html) return { kind: 'html', html: result.html };
  return { kind: 'empty' };
}

/**
 * Draw a plan into the element (replacing what is there).
 * @param {Element} el
 * @param {ReturnType<typeof previewPlan>} plan
 * @param {string|null} siteId
 */
export function applyPreview(el, plan, siteId) {
  if (plan.kind === 'html') {
    el.innerHTML = plan.html;
  } else if (plan.kind === 'empty' || plan.kind === 'old') {
    const doc = el.ownerDocument;
    if (plan.kind === 'old') {
      el.replaceChildren(doc.createTextNode(OLD_COOK_COPY));
    } else {
      const a = doc.createElement('a');
      a.textContent = EMPTY_COPY;
      if (siteId) a.setAttribute('href', `/app/site.html?site=${encodeURIComponent(siteId)}&section=social`);
      el.replaceChildren(a);
    }
  } else {
    el.replaceChildren();
  }
}
