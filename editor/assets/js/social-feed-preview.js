/**
 * The editor's preview of `<social-feed>`: the feed as Cook draws it from the
 * site's feed snapshots, through `GET /social/feed` (no network). Display-only,
 * like the `<social-links>` preview: the leaf node view never reads the live
 * element's light DOM back, the save keeps only the node's attrs (the server
 * drops undeclared ones such as a runtime `style` or `data-upgraded`), and the
 * HTML renderer writes `<social-feed>` empty whatever a node holds. A filled
 * element would freeze the feed, because Cook fills only an empty one.
 *
 * @module editor/social-feed-preview
 */

import { EMPTY_COPY } from './social-links-preview.js';

export const SOCIAL_FEED_TAG = 'social-feed';

/** The no-accounts copy (exact; the same as the profile links). */
export const FEED_EMPTY_COPY = EMPTY_COPY;
/** The too-old-Cook copy (exact). */
export const FEED_OLD_COOK_COPY = "This site's Cook is too old to preview the social feed: update Cook";

const text = (v) => (typeof v === 'string' && v.trim() ? v : null);

/**
 * The route's query for a node's attrs (height is display-only, so not sent).
 * @param {Record<string, unknown>|null} attrs
 * @returns {{ accounts?: string, tags?: string, items?: string, 'hide-counts'?: 'true' }}
 */
export function socialFeedQuery(attrs) {
  const out = {};
  if (text(attrs?.accounts)) out.accounts = attrs.accounts;
  if (text(attrs?.tags)) out.tags = attrs.tags;
  if (typeof attrs?.items === 'number' || text(attrs?.items)) out.items = String(attrs.items);
  if (attrs?.['hide-counts'] === true || attrs?.['hide-counts'] === '' || attrs?.['hide-counts'] === 'true') out['hide-counts'] = 'true';
  return out;
}

/**
 * Leave the filled preview display-only. VB's element reads its accounts and
 * cursors from the state script, so with it present a reconnect (ProseMirror
 * moving the node view's DOM) would fetch from Bluesky, Mastodon or GitHub
 * from the editor; `data-infinite` would ask for more on scroll.
 * @param {Element} el
 */
function makeInert(el) {
  for (const s of el.querySelectorAll(':scope > script.social-feed-state')) s.remove();
  for (const feed of el.querySelectorAll(':scope > activity-feed[data-infinite]')) feed.removeAttribute('data-infinite');
}

/**
 * Draw a plan (`previewPlan` from social-links-preview) into the element, replacing what is there.
 * @param {Element} el
 * @param {{ kind: 'html', html: string }|{ kind: 'empty' }|{ kind: 'old' }|{ kind: 'none' }} plan
 * @param {string|null} siteId
 */
export function applyFeedPreview(el, plan, siteId) {
  el.toggleAttribute('data-preview-note', plan.kind === 'empty' || plan.kind === 'old');
  const doc = el.ownerDocument;
  if (plan.kind === 'html') {
    el.innerHTML = plan.html;
    makeInert(el);
  } else if (plan.kind === 'old') {
    el.replaceChildren(doc.createTextNode(FEED_OLD_COOK_COPY));
  } else if (plan.kind === 'empty') {
    const a = doc.createElement('a');
    a.textContent = FEED_EMPTY_COPY;
    if (siteId) a.setAttribute('href', `/app/site.html?site=${encodeURIComponent(siteId)}&section=social`);
    el.replaceChildren(a);
  } else {
    el.replaceChildren();
  }
}
