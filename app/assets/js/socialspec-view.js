/**
 * Pure view model for the About, Contact and Following panels (no DOM).
 * @module socialspec-view
 */

export const SOCIALSPEC_TOO_OLD = "This site's Cook is too old for this; update cook-ssg to 2.11.0 or later";
export const EMAIL_HELPER = 'This address is public. Use one you are happy to see scraped.';
export const PREVIEW_UNAVAILABLE = "Preview isn't available until the site's packages are installed. Install them, then try again.";

/** Edits are allowed only once GET /social has succeeded and the site's Cook supports the section. */
export const editable = ({ loaded = false, ready = false } = {}) => loaded === true && ready === true;

const text = (v) => (typeof v === 'string' ? v : '');

// --- About ---

/** @returns {{ summary: string, body: string }} */
export function aboutForm(about) {
  return { summary: text(about?.summary), body: text(about?.body) };
}

/** The PUT value: null (remove) when nothing is left; `file` and other keys of the stored about are kept. */
export function toAboutPut(form, original) {
  const summary = text(form.summary).trim();
  const body = text(form.body);
  const out = {};
  if (summary) out.summary = summary;
  if (body.trim()) out.body = body;
  for (const [k, v] of Object.entries(original || {})) if (k !== 'summary' && k !== 'body') out[k] = v;
  return Object.keys(out).length ? out : null;
}

// --- Contact ---

const CONTACT_FIELDS = ['name', 'email', 'url', 'org', 'title'];

export function contactForm(contact) {
  const form = Object.fromEntries(CONTACT_FIELDS.map((k) => [k, text(contact?.[k])]));
  // Several addresses show one per line.
  if (Array.isArray(contact?.email)) form.email = contact.email.filter((e) => typeof e === 'string').join('\n');
  return form;
}

/** The PUT value: null (remove) when nothing is left. Keys of the stored contact that are not form fields are kept. */
export function toContactPut(form, original) {
  const out = {};
  for (const [k, v] of Object.entries(original || {})) if (!CONTACT_FIELDS.includes(k)) out[k] = v;
  for (const k of CONTACT_FIELDS) {
    const v = text(form[k]).trim();
    if (!v) continue;
    if (k === 'email') {
      // Commas or new lines separate addresses; one stays a string, several become a list.
      const list = v.split(/[,\n]/).map((e) => e.trim()).filter(Boolean);
      if (list.length) out.email = list.length === 1 ? list[0] : list;
    } else out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

// --- Following ---

const FOLLOW_FIELDS = ['title', 'feedUrl', 'siteUrl', 'category', 'public'];
let nextKey = 1;
/** An empty new row. `key` is only for keeping rows apart in the page. */
export function blankRow() {
  return { key: nextKey++, title: '', feedUrl: '', siteUrl: '', category: '', public: true };
}

export function followingRows(list) {
  return (Array.isArray(list) ? list : []).map((e) => ({
    key: nextKey++,
    title: text(e?.title),
    feedUrl: text(e?.feedUrl),
    siteUrl: text(e?.siteUrl),
    category: text(e?.category),
    public: e?.public !== false,
    orig: e && typeof e === 'object' && !Array.isArray(e) ? e : null, // the stored entry, so Save keeps its other keys
  }));
}

/** The PUT list: blank rows dropped, optional fields omitted when empty, other keys of a row's stored entry kept. */
export function toFollowingPut(rows) {
  const out = [];
  for (const r of rows) {
    const title = text(r.title).trim();
    const feedUrl = text(r.feedUrl).trim();
    const siteUrl = text(r.siteUrl).trim();
    const category = text(r.category).trim();
    if (!title && !feedUrl && !siteUrl && !category) continue;
    const entry = {};
    for (const [k, v] of Object.entries(r.orig || {})) if (!FOLLOW_FIELDS.includes(k)) entry[k] = v;
    Object.assign(entry, {
      ...(title ? { title } : {}),
      feedUrl,
      ...(siteUrl ? { siteUrl } : {}),
      ...(category ? { category } : {}),
      public: r.public !== false,
    });
    out.push(entry);
  }
  return out;
}

/** A copy of the list with the row at `index` moved by `delta` (clamped at the ends). */
export function moveRow(list, index, delta) {
  const to = index + delta;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return list.slice();
  const next = list.slice();
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

/**
 * After an OPML import while the list has unsaved edits: keep the in-page rows as they are and
 * append the entries the import added (always private until ticked) (in `result` but not in the previously stored list and not
 * already a row).
 */
export function mergeImported(currentRows, previousStored, result) {
  const seen = new Set([...currentRows.map((r) => r.feedUrl.trim()), ...previousStored.map((e) => e.feedUrl)]);
  const fresh = (Array.isArray(result) ? result : []).filter((e) => !seen.has(e.feedUrl));
  return [...currentRows, ...followingRows(fresh).map((r) => ({ ...r, public: false }))];
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** One sentence for an OPML import's `{ added, skipped, unchanged }`. */
export function importSummary({ added = 0, skipped = 0, unchanged = 0 }) {
  const skip = `skipped ${skipped} without a feed address`;
  const same = `${unchanged} already in your list`;
  if (added === 0) {
    const parts = [unchanged ? same : '', skipped ? skip : ''].filter(Boolean);
    return parts.length ? `Nothing new to add: ${parts.join(', ')}.` : 'Nothing new to add.';
  }
  const priv = `(private: tick Public to publish ${added === 1 ? 'it' : 'them'})`;
  const parts = [`Added ${plural(added, 'feed', 'feeds')} ${priv}`, skipped ? skip : '', unchanged ? same : ''].filter(Boolean);
  return `${parts.join(', ')}.`;
}

// --- Preview ---

/**
 * The srcdoc for the About preview. The HTML is the owner's Markdown rendered on the server and
 * may carry raw HTML, so it goes only into a sandboxed iframe (no allow-scripts); the CSP meta is
 * a second wall: nothing loads but inline styles and https images.
 */
export function previewDocument(html) {
  return `<!doctype html><html><head><meta charset="utf-8">`
    + `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src https: data:">`
    + `<base target="_blank">`
    + `<style>body{font:16px/1.6 system-ui,sans-serif;margin:1rem;color:#222;background:#fff}img{max-width:100%}pre{overflow:auto}</style>`
    + `</head><body>${html || ''}</body></html>`;
}
