/**
 * The Layouts section's model: listing in, rows and wording out. Pure, no DOM: tested in Node.
 * Copy is fixed by the layout editor's spec.
 *
 * @module app/layouts-view
 */

export const NAME_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
export const OLD_COOK_TEXT = "This site's Cook is too old to edit layouts; update cook-ssg";
export const BLANK_START = 'Blank base';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export const usedByText = (n) => `Used by ${plural(n, 'page', 'pages')}`;
export const baseForText = (names) => `Base for: ${names.join(', ')}`;

/** Where a layout or include lives, relative to the site. */
export const fileNameOf = (kind, name) => `src/${kind === 'layout' ? 'layouts' : 'includes'}/${name}.html`;

function statusText(entry) {
  if (entry.status === 'editable') return 'Editable';
  if (entry.status === 'plain') return 'Plain layout: add a layout info block to edit it here';
  const first = entry.problems?.[0]?.message ?? 'it has problems';
  return `Can't be edited here: ${first}`;
}

/** Why a file can't be deleted, naming what uses it; '' when nothing does. */
export function blockedText(usedBy = [], baseFor = []) {
  const parts = [];
  if (usedBy.length) parts.push(`${usedByText(usedBy.length)} (${usedBy.join(', ')})`);
  if (baseFor.length) parts.push(baseForText(baseFor));
  return parts.length ? `In use, so it can't be deleted. ${parts.join('. ')}` : '';
}

function row(entry) {
  const usedBy = entry.usedBy || [];
  const baseFor = entry.baseFor || [];
  const relations = [];
  if (entry.parent) relations.push(`Built on ${entry.parent}`);
  if (baseFor.length) relations.push(baseForText(baseFor));
  return {
    name: entry.name,
    kind: entry.kind,
    label: entry.label || entry.name,
    fileName: fileNameOf(entry.kind, entry.name),
    statusText: statusText(entry),
    problems: (entry.problems || []).map((p) => (p.line ? `Line ${p.line}: ${p.message}` : p.message)),
    usedText: usedBy.length ? usedByText(usedBy.length) : '',
    relationText: relations.join(' · '),
    unpublished: !!entry.unpublished,
    canOpen: entry.status === 'editable',
    canDelete: !usedBy.length && !baseFor.length,
    deleteBlockedText: blockedText(usedBy, baseFor),
  };
}

/**
 * Rows for the screen: layouts, then includes.
 * @param {{ layouts?: object[], includes?: object[] }} listing - GET /layout-files
 */
export function layoutRows(listing) {
  return [...(listing?.layouts || []), ...(listing?.includes || [])].map(row);
}

/** Deleted files not yet published: `{ kind, name, fileName, text }` each. */
export function deletedRows(listing) {
  return (listing?.deleted || []).map((d) => ({
    kind: d.kind, name: d.name, fileName: fileNameOf(d.kind, d.name), text: `${d.name} — deleted, Not published`,
  }));
}

/** The files Publish layout sends: every unpublished file and deleted file, by name. */
export function publishFiles(listing) {
  return [
    ...[...(listing?.layouts || []), ...(listing?.includes || [])].filter((e) => e.unpublished).map((e) => ({ kind: e.kind, name: e.name })),
    ...(listing?.deleted || []).map((d) => ({ kind: d.kind, name: d.name })),
  ];
}

/** The Publish dialog's note on a file VP didn't write (its last change was made elsewhere). */
export const CHANGED_OUTSIDE = 'Changed outside Vanilla Press';

/**
 * What the Publish dialog lists: each file with its usage, and whether to ask for confirmation.
 * `vpWrote`: the file is as VP last wrote it, so it starts ticked; the others start unticked.
 * @returns {{ items: Array<{ kind: string, name: string, label: string, text: string, vpWrote: boolean }>, needsConfirm: boolean }}
 */
export function publishSummary(listing) {
  const items = [];
  let needsConfirm = false;
  for (const e of [...(listing?.layouts || []), ...(listing?.includes || [])]) {
    if (!e.unpublished) continue;
    const usedBy = e.usedBy || [];
    const baseFor = e.baseFor || [];
    if (usedBy.length || baseFor.length) needsConfirm = true;
    const bits = [];
    if (usedBy.length) bits.push(usedByText(usedBy.length));
    if (baseFor.length) bits.push(baseForText(baseFor));
    items.push({ kind: e.kind, name: e.name, label: e.label || e.name, text: bits.join(' · '), vpWrote: !!e.vpWrote });
  }
  for (const d of listing?.deleted || []) items.push({ kind: d.kind, name: d.name, label: d.name, text: 'Deleted', vpWrote: !!d.vpWrote });
  return { items, needsConfirm };
}

/** A file name from a label: letters, digits, `_ . -`, starting with a letter, digit or `_`. */
export function nameFromLabel(label) {
  return String(label || '').trim().toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-').replace(/^[^a-z0-9_]+/, '').replace(/-+$/, '');
}

/** The New layout dialog's start choices; `value` is `child:<name>`, `copy:<name>` or `blank`. */
export function startOptions(listing, { kind = 'layout' } = {}) {
  const layouts = listing?.layouts || [];
  const out = [];
  if (kind === 'layout') for (const l of layouts.filter((x) => x.status === 'editable')) out.push({ value: `child:${l.name}`, text: `Built on ${l.label || l.name}` });
  for (const e of kind === 'layout' ? layouts : listing?.includes || []) {
    if (e.status === 'editable') out.push({ value: `copy:${e.name}`, text: `Copy of ${e.label || e.name}` });
  }
  out.push({ value: 'blank', text: BLANK_START });
  return out;
}

/** `child:post` becomes `{ type: 'child', from: 'post' }`; `blank` becomes `{ type: 'blank' }`. */
export function startFromValue(value) {
  if (value === 'blank') return { type: 'blank' };
  const i = value.indexOf(':');
  return { type: value.slice(0, i), from: value.slice(i + 1) };
}

/** A problem with the dialog's label and name, or ''. */
export function newLayoutProblem(label, name) {
  if (!String(label || '').trim()) return 'Give the layout a label.';
  if (!NAME_PATTERN.test(name || '')) return 'The name can use letters, digits, _, . and -, and must start with a letter, digit or _.';
  return '';
}
