import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  altState, needsAlt, FILTERS, TYPES, filterMedia, headerCounts, tileModel, emptyText, DROP_TEXT,
  detailModel, ALT_PLACEHOLDER, ALT_HINT, altForCheckbox, createAltSaver, deleteDecision,
} from '../../src/media/library-view.js';

const item = (o) => ({
  id: 'x', filename: 'a.jpg', original_name: 'a.jpg', mime_type: 'image/jpeg', kind: 'image',
  alt: 'A', created: '2026-11-01T00:00:00Z', missing: false, usedIn: [], ...o,
});

const sample = () => [
  item({ id: '1', filename: 'old.jpg', original_name: 'Holiday.jpg', alt: 'Beach', created: '2026-01-01T00:00:00Z', usedIn: [{ id: 'd', title: 'T', status: 'draft' }] }),
  item({ id: '2', filename: 'new.png', original_name: 'new.png', mime_type: 'image/png', alt: null, created: '2026-03-01T00:00:00Z' }),
  item({ id: '3', filename: 'clip.mp4', original_name: 'clip.mp4', mime_type: 'video/mp4', kind: 'video', alt: null, created: '2026-02-01T00:00:00Z' }),
  item({ id: '4', filename: 'deco.svg', original_name: 'deco.svg', mime_type: 'image/svg+xml', alt: '', created: '2026-02-15T00:00:00Z' }),
  item({ id: '5', filename: 'gone.jpg', original_name: 'gone.jpg', alt: 'Gone', missing: true, created: '2026-01-15T00:00:00Z' }),
  item({ id: '6', filename: 'doc.pdf', original_name: 'Report.pdf', mime_type: 'application/pdf', kind: 'pdf', alt: null, created: '2026-01-20T00:00:00Z' }),
];
const ids = (xs) => xs.map((i) => i.id);
const all = { filter: 'all', type: 'all', query: '' };

test('altState has three states', () => {
  assert.equal(altState(null), 'missing');
  assert.equal(altState(undefined), 'missing');
  assert.equal(altState(''), 'decorative');
  assert.equal(altState('A cat'), 'written');
});

test('needsAlt is for images with never-written alt only', () => {
  assert.equal(needsAlt(item({ alt: null })), true);
  assert.equal(needsAlt(item({ alt: '' })), false);
  assert.equal(needsAlt(item({ kind: 'video', alt: null })), false);
});

test('FILTERS and TYPES', () => {
  assert.deepEqual(FILTERS, [['all', 'All'], ['needs-alt', 'Needs alt text'], ['unused', 'Unused'], ['missing', 'Missing file']]);
  assert.deepEqual(TYPES, [['all', 'All types'], ['image', 'Images'], ['video', 'Video'], ['audio', 'Audio'], ['pdf', 'PDF']]);
});

test('all: newest first', () => {
  assert.deepEqual(ids(filterMedia(sample(), all)), ['2', '4', '3', '6', '5', '1']);
});

test('ties on created sort by filename', () => {
  const same = [item({ id: 'b', filename: 'b.jpg', created: 'x' }), item({ id: 'a', filename: 'a.jpg', created: 'x' })];
  assert.deepEqual(ids(filterMedia(same, all)), ['a', 'b']);
});

test('needs-alt ignores videos, pdfs and decorative images', () => {
  assert.deepEqual(ids(filterMedia(sample(), { ...all, filter: 'needs-alt' })), ['2']);
});

test('unused keeps files no post uses', () => {
  assert.deepEqual(ids(filterMedia(sample(), { ...all, filter: 'unused' })), ['2', '4', '3', '6', '5']);
});

test('missing keeps missing files', () => {
  assert.deepEqual(ids(filterMedia(sample(), { ...all, filter: 'missing' })), ['5']);
});

test('type narrows by kind', () => {
  assert.deepEqual(ids(filterMedia(sample(), { ...all, type: 'video' })), ['3']);
  assert.deepEqual(ids(filterMedia(sample(), { ...all, type: 'pdf' })), ['6']);
});

test('filter and type combine', () => {
  assert.deepEqual(ids(filterMedia(sample(), { filter: 'unused', type: 'image', query: '' })), ['2', '4', '5']);
});

test('search hits filename, original name and alt, trimmed and case-insensitive', () => {
  assert.deepEqual(ids(filterMedia(sample(), { ...all, query: '  CLIP ' })), ['3']);
  assert.deepEqual(ids(filterMedia(sample(), { ...all, query: 'holiday' })), ['1']);
  assert.deepEqual(ids(filterMedia(sample(), { ...all, query: 'beach' })), ['1']);
  assert.deepEqual(ids(filterMedia(sample(), { ...all, query: 'zzz' })), []);
});

test('filterMedia does not reorder its input', () => {
  const s = sample();
  filterMedia(s, all);
  assert.deepEqual(ids(s), ['1', '2', '3', '4', '5', '6']);
});

test('headerCounts: singular, plural, zero missing', () => {
  assert.deepEqual(headerCounts([item({ alt: 'x' })]), { count: '1 file', missingAlt: null });
  assert.deepEqual(headerCounts(sample()), { count: '6 files', missingAlt: '1 missing alt text' });
  const three = [item({ alt: null }), item({ alt: null }), item({ alt: null })];
  assert.equal(headerCounts(three).missingAlt, '3 missing alt text');
  assert.deepEqual(headerCounts([]), { count: '0 files', missingAlt: null });
});

test('tileModel badges', () => {
  const s = sample();
  assert.deepEqual(tileModel(s[0]), { name: 'old.jpg', kind: 'image', thumb: true, typeLabel: 'JPEG image', badges: [] });
  assert.deepEqual(tileModel(s[1]).badges, ['No alt text']);
  assert.deepEqual(tileModel(s[2]), { name: 'clip.mp4', kind: 'video', thumb: false, typeLabel: 'MP4 video', badges: [] });
  assert.deepEqual(tileModel(s[3]).badges, []);
  const gone = tileModel(item({ missing: true, alt: null }));
  assert.deepEqual(gone.badges, ['No alt text', 'Missing file']);
  assert.equal(gone.thumb, false);
});

test('emptyText', () => {
  assert.equal(emptyText({ ...all, query: ' cat ' }), 'No files match "cat".');
  assert.equal(emptyText({ ...all, filter: 'needs-alt' }), 'Every image has alt text.');
  assert.equal(emptyText({ ...all, filter: 'unused' }), 'Every file is used in a post.');
  assert.equal(emptyText({ ...all, filter: 'missing' }), 'No missing files.');
  assert.equal(emptyText({ ...all, type: 'image' }), 'No images yet.');
  assert.equal(emptyText({ ...all, type: 'video' }), 'No video yet.');
  assert.equal(emptyText({ ...all, type: 'audio' }), 'No audio yet.');
  assert.equal(emptyText({ ...all, type: 'pdf' }), 'No PDFs yet.');
  assert.equal(emptyText(all), 'No media yet. Upload files or drop them here.');
});

test('DROP_TEXT', () => {
  assert.equal(DROP_TEXT, 'Drop files here, or paste from the clipboard. Files go to src/media and back up with your next save.');
});

// --- Detail panel ---
const detail = (o) => detailModel(item({ size: 1_258_291, width: 1200, height: 800, created: '2026-11-03T12:00:00Z', ...o }), { siteId: 'my site', locale: 'en-US' });

test('detailModel: an image with dimensions', () => {
  const m = detail({ filename: 'a.jpg', original_name: 'IMG_1.jpg', alt: null, usedIn: [{ id: 'd 1', title: '', status: 'draft' }, { id: 'p', title: 'Hello', status: 'published' }] });
  assert.equal(m.title, 'a.jpg');
  assert.equal(m.original, 'IMG_1.jpg');
  assert.equal(m.meta, 'JPEG image \u00b7 1.2 MB \u00b7 added Nov 3, 2026');
  assert.equal(m.dims, '1200 \u00d7 800 px');
  assert.equal(m.url, '/media/a.jpg');
  assert.equal(m.showAlt, true);
  assert.equal(m.altState, 'missing');
  assert.equal(m.canEdit, true);
  assert.deepEqual(m.usedIn, [
    { title: 'Untitled', href: '/editor/?site=my%20site#doc-d%201', statusText: 'Draft' },
    { title: 'Hello', href: '/editor/?site=my%20site#doc-p', statusText: 'Published' },
  ]);
});

test('detailModel: original is null when it equals the filename', () => {
  assert.equal(detail({ filename: 'a.jpg', original_name: 'a.jpg' }).original, null);
});

test('detailModel: a PDF has no dimensions, no alt, and cannot be edited', () => {
  const m = detail({ filename: 'r.pdf', mime_type: 'application/pdf', kind: 'pdf', alt: null, width: null, height: null });
  assert.equal(m.dims, null);
  assert.equal(m.showAlt, false);
  assert.equal(m.canEdit, false);
  assert.match(m.meta, /^PDF document \u00b7 1\.2 MB/);
});

test('detailModel: a GIF cannot be edited; a missing JPEG cannot be edited', () => {
  assert.equal(detail({ mime_type: 'image/gif' }).canEdit, false);
  assert.equal(detail({ missing: true }).canEdit, false);
});

test('alt copy', () => {
  assert.equal(ALT_PLACEHOLDER, "Describe what the image shows, for people who can't see it");
  assert.equal(ALT_HINT, 'Screen readers will announce only the file name. Leave empty only for decorative images, and mark it so:');
});

test('altForCheckbox: ticking stores "", unticking stores null', () => {
  assert.equal(altForCheckbox(true), '');
  assert.equal(altForCheckbox(false), null);
});

function fakeTimers() {
  let n = 0;
  const pending = new Map();
  return {
    setTimer: (fn) => { pending.set(++n, fn); return n; },
    clearTimer: (id) => { pending.delete(id); },
    fire: () => { const fns = [...pending.values()]; pending.clear(); fns.forEach((f) => f()); },
    size: () => pending.size,
  };
}

test('typing debounces to one save', async () => {
  const t = fakeTimers();
  const calls = [];
  const saver = createAltSaver({ save: async (id, alt) => { calls.push([id, alt]); }, setTimer: t.setTimer, clearTimer: t.clearTimer });
  saver.change('a', 'H');
  saver.change('a', 'He');
  saver.change('a', 'Hey');
  assert.equal(calls.length, 0);
  t.fire();
  await saver.flush();
  assert.deepEqual(calls, [['a', 'Hey']]);
});

test('switching items saves the pending alt to the first item', async () => {
  const t = fakeTimers();
  const calls = [];
  const saver = createAltSaver({ save: async (id, alt) => { calls.push([id, alt]); }, setTimer: t.setTimer, clearTimer: t.clearTimer });
  saver.change('a', 'for a');
  saver.change('b', 'for b');
  await Promise.resolve();
  assert.deepEqual(calls, [['a', 'for a']]);
  await saver.flush();
  assert.deepEqual(calls, [['a', 'for a'], ['b', 'for b']]);
  await saver.flush();
  assert.equal(calls.length, 2);
});

test('flush with nothing pending saves nothing; a null alt is saved as null', async () => {
  const calls = [];
  const saver = createAltSaver({ save: async (id, alt) => { calls.push([id, alt]); } });
  await saver.flush();
  saver.change('a', null);
  await saver.flush();
  assert.deepEqual(calls, [['a', null]]);
});

test('deleteDecision', () => {
  const used = (status, title) => ({ id: title, title, status });
  assert.deepEqual(deleteDecision(item({ filename: 'a.jpg', usedIn: [used('published', 'A'), used('draft', 'D'), used('published', 'B')] })),
    { allowed: false, message: 'Used by published posts: A, B. Remove it from them and Update first.' });
  assert.deepEqual(deleteDecision(item({ filename: 'a.jpg', usedIn: [used('draft', 'A'), used('draft', 'B')] })), {
    allowed: true, heading: 'Delete "a.jpg"?', confirm: 'Delete file',
    body: 'Used in drafts: A, B. They will show it as missing. The file is removed from src/media; git history keeps a copy.',
  });
  assert.deepEqual(deleteDecision(item({ filename: 'a.jpg', usedIn: [] })), {
    allowed: true, heading: 'Delete "a.jpg"?', confirm: 'Delete file',
    body: 'The file is removed from src/media; git history keeps a copy.',
  });
});
