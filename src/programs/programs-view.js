/**
 * The Programs screen's rules, without the DOM: filters, the header line, tiles, the
 * sandbox choice, the Update preview, and the post "Write a post about it" creates.
 * Browser-safe; tested in Node.
 * @module programs/programs-view
 */
import { formatBytes } from '../media/limits.js';

/** The filter buttons: [value, label]. */
export const FILTERS = [
  ['all', 'All'], ['listed', 'Listed'], ['unlisted', 'Unlisted'], ['no-card', 'No card'], ['sandboxed', 'Sandboxed'],
];

/** The exact iframe attribute of a sandboxed program (the live site's header, as an attribute). */
export const SANDBOX_ATTR = 'allow-scripts allow-forms allow-popups allow-pointer-lock allow-modals';

/**
 * The programs, each with `sandboxed`: its card's setting, else its area's default.
 * @param {{ areas: Array<{ path: string, sandbox?: boolean }>, programs: Object[] }} state
 * @returns {Object[]}
 */
export function withEffectiveSandbox({ areas, programs }) {
  const byPath = new Map(areas.map((a) => [a.path, a.sandbox === true]));
  return programs.map((p) => ({
    ...p,
    sandboxed: typeof p.sandbox === 'boolean' ? p.sandbox : byPath.get(p.area) === true,
  }));
}

/**
 * @param {Object[]} programs - with `sandboxed` (withEffectiveSandbox)
 * @param {{ area?: string, filter?: string, q?: string }} view - `area` is a path or 'all'
 */
export function filterPrograms(programs, { area = 'all', filter = 'all', q = '' } = {}) {
  const query = q.trim().toLowerCase();
  const keep = {
    all: () => true,
    listed: (p) => p.listed === true,
    unlisted: (p) => p.listed !== true,
    'no-card': (p) => !p.hasCard,
    sandboxed: (p) => p.sandboxed === true,
  }[filter] || (() => true);
  return programs.filter((p) => (area === 'all' || p.area === area)
    && keep(p)
    && (!query || p.title.toLowerCase().includes(query) || p.slug.includes(query)));
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** "N programs in M areas · K unlisted". */
export function headerText({ areas, programs }) {
  const unlisted = programs.filter((p) => p.listed !== true).length;
  return `${plural(programs.length, 'program', 'programs')} in ${plural(areas.length, 'area', 'areas')} · ${unlisted} unlisted`;
}

/** A tile: title, URL path and badges. */
export function tileModel(program) {
  const badges = [];
  if (program.listed !== true) badges.push('Unlisted');
  if (program.sandboxed === true) badges.push('Sandboxed');
  if (program.status === 'missing-folder') badges.push('Missing folder');
  if (program.status === 'no-index') badges.push('Not a program (no index.html)');
  if (!program.hasCard) badges.push('No card');
  return { title: program.title, path: `/${program.area}/${program.slug}/`, badges };
}

/** @param {number} total - programs before filtering */
export function emptyText(total) {
  return total ? 'No programs match.' : 'No programs yet. Add an area, then Add program.';
}

/**
 * The sandbox radio group's choices.
 * @param {boolean} areaDefault - the area's sandbox default
 * @returns {Array<{ value: 'default'|'on'|'off', label: string, hint: string }>}
 */
export function sandboxChoiceText(areaDefault) {
  return [
    { value: 'default', label: `Area default (${areaDefault ? 'on' : 'off'})`, hint: `Follows its area: ${areaDefault ? 'sandboxed' : 'not sandboxed'}.` },
    { value: 'on', label: 'On', hint: "The program can't use the site's storage or cookies, and its own saved data won't work." },
    { value: 'off', label: 'Off', hint: 'The program runs like any page of the site: its saved data works.' },
  ];
}

/** The radio value for a program's own setting. */
export function sandboxChoice(program) {
  if (program.sandbox === true) return 'on';
  if (program.sandbox === false) return 'off';
  return 'default';
}

/** The card's `sandbox` for a radio value: null means the area default. */
export function sandboxFromChoice(value) {
  return value === 'on' ? true : value === 'off' ? false : null;
}

/** One line on what Update from source would change. */
export function previewText({ added, changed, removed, total }) {
  if (!added.length && !changed.length && !removed.length) return 'No changes: the source folder matches the live copy.';
  return `${changed.length} changed, ${added.length} added, ${removed.length} removed (${formatBytes(total)} in all).`;
}

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The post "Write a post about it" starts: its fields, and its body as HTML. */
export function postFromProgram(program) {
  const href = `/${program.area}/${program.slug}/`;
  return {
    title: program.title,
    description: program.description || '',
    image: program.image || null,
    html: `<p>Try it: <a href="${href}">${escapeHtml(program.title)}</a></p>`,
  };
}

/**
 * The draft document to create (POST /documents): postFromProgram as the editor's blocks,
 * with the program's slug, numbered when a post already has it.
 * @param {Object} program
 * @param {string[]} takenSlugs - the site's post slugs
 */
export function postDocument(program, takenSlugs) {
  const post = postFromProgram(program);
  const taken = new Set(takenSlugs);
  let slug = program.slug;
  for (let n = 2; taken.has(slug); n++) slug = `${program.slug}-${n}`;
  const meta = { title: post.title, slug, collection: 'posts', status: 'draft' };
  if (post.description) meta.description = post.description;
  if (post.image) meta.image = post.image;
  return {
    meta,
    blocks: [{ type: 'paragraph', children: [
      { type: 'text', value: 'Try it: ' },
      { type: 'link', attrs: { href: `/${program.area}/${program.slug}/` }, children: [{ type: 'text', value: post.title }] },
    ] }],
  };
}

/** A slug suggested by a folder's name (or path): '' when nothing usable is left. */
export function slugFromFolder(path) {
  const name = path.split(/[\\/]/).filter(Boolean).pop() || '';
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
