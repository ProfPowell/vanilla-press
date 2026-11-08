/**
 * Pure helpers for the Media screen's library (no DOM). Browser-safe.
 * @module media/library-view
 */
import { typeLabel } from './types.js';

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
