/**
 * Pure helpers for the Media screen's library (no DOM). Browser-safe.
 * @module media/library-view
 */
import { typeLabel, canEditImage } from './types.js';
import { formatBytes } from './limits.js';
import { mediaSrc } from './usage.js';
import { normalizeCredit } from './credit.js';

/** Alt text has three states: `null` never written, `""` decorative, text. */
export function altState(alt) {
  if (alt == null) return 'missing';
  return alt === '' ? 'decorative' : 'written';
}

export const needsAlt = (item) => item.kind === 'image' && altState(item.alt) === 'missing';

export const FILTERS = [['all', 'All'], ['needs-alt', 'Needs alt text'], ['unused', 'Unused'], ['missing', 'Missing file']];
export const TYPES = [['all', 'All types'], ['image', 'Images'], ['video', 'Video'], ['audio', 'Audio'], ['pdf', 'PDF']];

export const DROP_TEXT = 'Drop files here, or paste from the clipboard. Files go to src/media and back up with your next save.';

const newestFirst = (a, b) =>
  String(b.created || '').localeCompare(String(a.created || '')) || String(a.filename).localeCompare(String(b.filename));

/**
 * The tiles to show: one filter, one type and a search, newest first.
 * @param {Array<object>} items MediaItem[]
 * @param {{ filter: string, type: string, query: string }} opts
 */
export function filterMedia(items, { filter = 'all', type = 'all', query = '' } = {}) {
  const q = String(query || '').trim().toLowerCase();
  return (items || [])
    .filter((i) => filter === 'needs-alt' ? needsAlt(i)
      : filter === 'unused' ? (i.usedIn || []).length === 0
        : filter === 'missing' ? Boolean(i.missing) : true)
    .filter((i) => type === 'all' || i.kind === type)
    .filter((i) => !q || `${i.filename}\n${i.original_name || ''}\n${i.alt || ''}`.toLowerCase().includes(q))
    .sort(newestFirst);
}

/** @returns {{ count: string, missingAlt: string|null }} */
export function headerCounts(items) {
  const list = items || [];
  const n = list.length;
  const m = list.filter(needsAlt).length;
  return { count: `${n} ${n === 1 ? 'file' : 'files'}`, missingAlt: m ? `${m} missing alt text` : null };
}

/** What one tile shows. */
export function tileModel(item) {
  const badges = [];
  if (needsAlt(item)) badges.push('No alt text');
  if (item.missing) badges.push('Missing file');
  return {
    name: item.filename,
    kind: item.kind,
    thumb: item.kind === 'image' && !item.missing,
    typeLabel: typeLabel(item.mime_type),
    badges,
  };
}

const EMPTY_BY_TYPE = { image: 'No images yet.', video: 'No video yet.', audio: 'No audio yet.', pdf: 'No PDFs yet.' };

export function emptyText({ filter = 'all', type = 'all', query = '' } = {}) {
  const q = String(query || '').trim();
  if (q) return `No files match "${q}".`;
  if (filter === 'needs-alt') return 'Every image has alt text.';
  if (filter === 'unused') return 'Every file is used in a post.';
  if (filter === 'missing') return 'No missing files.';
  return EMPTY_BY_TYPE[type] || 'No media yet. Upload files or drop them here.';
}

// --- Detail panel ---

export const ALT_PLACEHOLDER = "Describe what the image shows, for people who can't see it";
export const ALT_HINT = 'Screen readers will announce only the file name. Leave empty only for decorative images, and mark it so:';

/** The Decorative checkbox's stored alt: ticked is `""`, unticked is `null` (never written). */
export const altForCheckbox = (checked) => (checked ? '' : null);

/** The web image services a library image can come from, by name (a hand-written credit is `manual`). */
const SOURCE_NAMES = { openverse: 'Openverse', pexels: 'Pexels', pixabay: 'Pixabay' };

/** The Credit fieldset's text fields, in order; `link` fields must be whole http(s) URLs. The Adapted checkbox follows. */
export const CREDIT_FIELDS = [
  { key: 'name', label: 'Creator' },
  { key: 'url', label: 'Creator link', link: true },
  { key: 'site', label: 'Site' },
  { key: 'siteUrl', label: 'Site link', link: true },
  { key: 'license', label: 'License' },
  { key: 'licenseUrl', label: 'License link', link: true },
];
export const CREDIT_NOTE = 'Changes apply to new uses of this image. Posts that already use it keep their credit.';
export const LINK_ERROR = 'Links must start with http:// or https://';
const LINKS_ALONE_ERROR = 'Add a creator, site or license for the links to go with.';

/**
 * The Credit fieldset's values for an item: every field a string, `adapted` a boolean.
 * @param {{ credit?: object|null }} item MediaItem
 * @returns {{ name: string, url: string, site: string, siteUrl: string, license: string, licenseUrl: string, adapted: boolean }}
 */
export function creditFormValues(item) {
  const credit = normalizeCredit(item?.credit) || {};
  const values = {};
  for (const { key } of CREDIT_FIELDS) values[key] = credit[key] || '';
  values.adapted = credit.adapted === true;
  return values;
}

/**
 * Whether `text` is a link a credit may keep: a whole http(s) URL with a host and no spaces.
 * @param {string} text trimmed
 */
function isWebLink(text) {
  if (/\s/.test(text)) return false;
  let url;
  try {
    url = new URL(text);
  } catch {
    return false;
  }
  return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '';
}

/**
 * The credit the fieldset's values say, for `PUT { credit }`: null when every
 * field is empty. A link that isn't a whole http(s) URL is refused (`errors`
 * names it) and the link already stored in `stored` is kept in its place; the
 * other fields still save. Links with no creator, site or license to show them
 * on are refused too, and then nothing is saved (`skip`).
 * @param {{ [key: string]: string|boolean }} values
 * @param {object|null} [stored] the credit stored now
 * @returns {{ credit: object|null, errors: { [key: string]: string }, skip: boolean }}
 */
export function creditFromForm(values, stored = null) {
  const text = (key) => (typeof values[key] === 'string' ? values[key].trim() : '');
  const kept = normalizeCredit(stored) || {};
  const errors = {};
  const raw = {};
  for (const { key, link } of CREDIT_FIELDS) {
    raw[key] = text(key);
    if (link && raw[key] && !isWebLink(raw[key])) {
      errors[key] = LINK_ERROR;
      raw[key] = kept[key] || '';
    }
  }
  raw.adapted = values.adapted === true;
  const credit = normalizeCredit(raw);
  if (!credit && CREDIT_FIELDS.some((f) => f.link && text(f.key))) {
    return { credit: null, errors: { ...errors, name: LINKS_ALONE_ERROR }, skip: true };
  }
  return { credit, errors, skip: false };
}

/**
 * What the detail panel shows for one item.
 * @param {object} item MediaItem
 * @param {{ siteId: string, locale?: string }} opts
 */
export function detailModel(item, { siteId, locale } = {}) {
  const added = item.created
    ? new Date(item.created).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' })
    : null;
  const meta = [typeLabel(item.mime_type), Number.isFinite(item.size) ? formatBytes(item.size) : null, added ? `added ${added}` : null]
    .filter(Boolean).join(' \u00b7 ');
  return {
    title: item.filename,
    original: item.original_name && item.original_name !== item.filename ? item.original_name : null,
    meta,
    dims: item.width > 0 && item.height > 0 ? `${item.width} \u00d7 ${item.height} px` : null,
    url: mediaSrc(item.filename),
    showAlt: item.kind === 'image',
    showCredit: item.kind === 'image',
    source: SOURCE_NAMES[item.source] ? `From ${SOURCE_NAMES[item.source]}` : null,
    altState: altState(item.alt),
    canEdit: canEditImage(item.mime_type) && !item.missing,
    usedIn: (item.usedIn || []).map((u) => ({
      title: u.title || u.path || 'Untitled',
      // A page Vanilla Press didn't write (u.path, no id) has no post to open.
      href: u.id ? `/editor/?site=${encodeURIComponent(siteId)}#doc-${encodeURIComponent(u.id)}` : null,
      statusText: !u.id ? 'Published page' : u.status !== 'published' ? 'Draft' : u.liveOnly ? 'Published (live version)' : 'Published',
    })),
  };
}

/**
 * Saves alt text (or any one value per item, such as a credit) after typing pauses. One item
 * is pending at a time: changing another item saves the first right away, and `flush()` saves whatever is pending.
 * @param {{ save: (id: string, alt: string|null) => Promise<any>, delay?: number, setTimer?: Function, clearTimer?: Function }} opts
 */
export function createAltSaver({ save, delay = 600, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let pending = null;
  let timer = null;
  let inflight = Promise.resolve();
  let active = 0; // saves started and not yet finished

  function start() {
    if (timer != null) { clearTimer(timer); timer = null; }
    if (!pending) return;
    const { id, alt } = pending;
    pending = null;
    // Start now when idle; otherwise queue behind the save in flight. A failed save doesn't block the next.
    const run = () => save(id, alt);
    inflight = active ? inflight.catch(() => {}).then(run) : run();
    active++;
    const mine = inflight;
    const done = () => { active--; };
    mine.then(done, done);
  }

  return {
    change(id, alt) {
      if (pending && pending.id !== id) start();
      pending = { id, alt };
      if (timer != null) clearTimer(timer);
      timer = setTimer(start, delay);
    },
    /** Hand the pending alt to the caller (the page is closing and must save it itself). Null when none. */
    take() {
      if (timer != null) { clearTimer(timer); timer = null; }
      const taken = pending;
      pending = null;
      return taken;
    },
    async flush() {
      start();
      const run = inflight;
      await run;
    },
  };
}

const titles = (list) => list.map((u) => u.title || 'Untitled').join(', ');

/**
 * The words for a delete the server refused (409): who still uses the file.
 * @param {Array<{ title?: string }>} posts - the refusal's `posts` list
 */
export function refusedDeleteMessage(posts) {
  return `Used by published posts: ${titles(posts)}. Remove it from them and Update first.`;
}

/**
 * Whether a file can be deleted, and the words for the confirmation or the refusal.
 * Published posts block it; drafts are named in the confirmation.
 */
export function deleteDecision(item) {
  const users = item.usedIn || [];
  const published = users.filter((u) => u.status === 'published');
  if (published.length) {
    return { allowed: false, message: refusedDeleteMessage(published) };
  }
  const drafts = users.filter((u) => u.status !== 'published');
  const tail = 'The file is removed from src/media; git history keeps a copy.';
  return {
    allowed: true,
    heading: `Delete "${item.filename}"?`,
    body: drafts.length ? `Used in drafts: ${titles(drafts)}. They will show it as missing. ${tail}` : tail,
    confirm: 'Delete file',
  };
}
