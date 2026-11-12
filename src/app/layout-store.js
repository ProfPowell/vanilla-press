/**
 * @file layout-store.js
 * @description The layout editor's file operations: list, read, save, create,
 * duplicate and delete a site's layouts and include fragments. Parsing,
 * serializing and checking all come from the site's own Cook
 * (`cook-ssg/layouts`, see `importCook`), so they always match the Cook that
 * builds the site. Only a validated layout or include name ever reaches a
 * path; saving never overwrites a file changed on disk since it was read.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, rmdirSync, readdirSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LAYOUT_NAME } from '../schema/validate.js';
import { writeFileAtomic } from '../sync/atomic-write.js';
import { changedFiles } from '../git/git.js';
import { importCook as defaultImportCook } from './site-layouts.js';

export const OLD_COOK_EDIT_MESSAGE = "This site's Cook is too old to edit layouts; update cook-ssg";
export const CHANGED_ON_DISK = 'This layout changed on disk since you opened it';

export class LayoutError extends Error {
  /** @param {number} status @param {string} message @param {object} [body] */
  constructor(status, message, body = {}) {
    super(message);
    this.name = 'LayoutError';
    this.status = status;
    this.body = body;
  }
}

const sha1 = (text) => createHash('sha1').update(text).digest('hex');

function check(kind, name) {
  if (kind !== 'layout' && kind !== 'include') throw new LayoutError(400, 'kind must be layout or include');
  if (typeof name !== 'string' || !LAYOUT_NAME.test(name)) {
    throw new LayoutError(400, 'name may use letters, digits, _, - and . (no slash or leading dot)');
  }
}

const dirOf = (siteDir, kind) => join(siteDir, 'src', kind === 'layout' ? 'layouts' : 'includes');

/** The Cook API, or a 409 when the site's Cook can't edit layouts. */
async function loadCook(siteDir, importCook) {
  const cook = await importCook(siteDir);
  for (const fn of ['parseLayout', 'serializeLayout', 'layoutUsage', 'listLayouts', 'checkLayout', 'loadSiteNames']) {
    if (typeof cook?.[fn] !== 'function') throw new LayoutError(409, OLD_COOK_EDIT_MESSAGE);
  }
  return cook;
}

/** Statuses and entries for both kinds, with the site names the checker needs. */
async function inspect(siteDir, cook) {
  const names = await cook.loadSiteNames(siteDir);
  const { layouts, includes } = await cook.listLayouts(siteDir, { fields: names.fields, lists: names.lists });
  return { names, layouts, includes };
}

function statusOf(entry, isInclude) {
  if (isInclude) return entry.ok ? 'editable' : (entry.problems.length ? 'problems' : 'plain');
  if (entry.kind === 'plain') return 'plain';
  return entry.ok && entry.editable ? 'editable' : 'problems';
}

function problemsOf(entry, isInclude) {
  const own = entry.problems || [];
  if (isInclude || entry.kind === 'plain' || own.length || (entry.ok && entry.editable)) return own;
  // Editable is false with no problem of its own: something it builds on isn't correct.
  return [{ line: 1, message: `a layout it is built on can't be edited here (${entry.chain.slice(1).join(' → ')})` }];
}

// The forms Cook's replace-include.js accepts: include="…", data-include="…" and <include-file src="…">
const INCLUDE_ATTR = /\binclude="([^"]+)"/gi;
const INCLUDE_FILE = /<include-file\b[^>]*\bsrc="([^"]+)"/gi;

/** Site-relative paths of the .html/.md files that may hold includes: pages, layouts and includes. */
async function includeScanFiles(siteDir) {
  const src = join(siteDir, 'src');
  let areas = [];
  try {
    const raw = JSON.parse(await readFile(join(siteDir, 'config', 'programs.json'), 'utf8'));
    areas = (raw.areas || []).map((a) => a?.path).filter((p) => typeof p === 'string');
  } catch { /* no programs */ }
  const found = [];
  const walk = async (rel, inside) => {
    let entries;
    try { entries = await readdir(join(src, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!rel && e.name === 'components') continue;
        if (rel && !rel.includes('/') && areas.includes(rel)) continue; // a program folder
        await walk(childRel);
      } else if (e.isFile() && /\.(html|md)$/.test(e.name)) found.push(`src/${childRel}`);
    }
  };
  await walk('', false);
  return found.sort();
}

/** Which files include each include: `{ name: [site-relative paths] }`. */
async function includeUsage(siteDir) {
  const usage = {};
  for (const file of await includeScanFiles(siteDir)) {
    let source;
    try { source = await readFile(join(siteDir, file), 'utf8'); } catch { continue; }
    for (const re of [INCLUDE_ATTR, INCLUDE_FILE]) {
      re.lastIndex = 0;
      for (const [, target] of source.matchAll(re)) {
        const m = /^\/?includes\/(.+)\.html$/.exec(target.trim());
        if (!m || file === `src/includes/${m[1]}.html`) continue;
        const list = (usage[m[1]] ??= []);
        if (!list.includes(file)) list.push(file);
      }
    }
  }
  return usage;
}

async function unpublishedFiles(siteDir) {
  try {
    return new Set(await changedFiles(siteDir, ['src/layouts', 'src/includes']));
  } catch {
    return new Set(); // not a git repository
  }
}

/**
 * @param {string} siteDir
 * @param {{ importCook?: Function }} [opts]
 */
export async function listLayoutFiles(siteDir, { importCook = defaultImportCook } = {}) {
  let cook;
  try {
    cook = await loadCook(siteDir, importCook);
  } catch (err) {
    if (err instanceof LayoutError) return { supported: false, message: err.message, layouts: [], includes: [] };
    throw err;
  }
  const { layouts, includes } = await inspect(siteDir, cook);
  const usage = await cook.layoutUsage(siteDir);
  const dirty = await unpublishedFiles(siteDir);
  const incUsage = await includeUsage(siteDir);
  const unpublished = (kind, file) => dirty.has(`src/${kind === 'layout' ? 'layouts' : 'includes'}/${file}`);

  return {
    supported: true,
    message: null,
    layouts: layouts.map((e) => ({
      name: e.name, kind: 'layout', label: e.label || e.name, status: statusOf(e, false),
      problems: problemsOf(e, false), parent: e.parent ?? null,
      baseFor: usage.layouts[e.name] ?? [], usedBy: usage.pages[e.name] ?? [],
      unpublished: unpublished('layout', e.file),
    })),
    // An include in a sub-folder has a name with a slash: not addressable, so not listed.
    includes: includes.filter((e) => LAYOUT_NAME.test(e.name)).map((e) => ({
      name: e.name, kind: 'include', label: e.name, status: statusOf(e, true),
      problems: problemsOf(e, true), parent: null, baseFor: [], usedBy: incUsage[e.name] ?? [],
      unpublished: unpublished('include', e.file),
    })),
  };
}

/** The listing entry for a name, or a 404. */
async function findEntry(siteDir, cook, kind, name) {
  const all = await inspect(siteDir, cook);
  const entry = (kind === 'layout' ? all.layouts : all.includes).find((e) => e.name === name);
  if (!entry) throw new LayoutError(404, `No ${kind} named ${name}`);
  return { ...all, entry };
}

const fileOf = (siteDir, kind, entry) => join(dirOf(siteDir, kind), entry.file);

/** Parse an entry that is editable; a 409 with the problems otherwise. */
function parseEditable(cook, kind, entry, html, names) {
  const isInclude = kind === 'include';
  const status = statusOf(entry, isInclude);
  if (status !== 'editable') {
    throw new LayoutError(409, 'not editable', { problems: problemsOf(entry, isInclude) });
  }
  const parsed = cook.parseLayout(html, { fragment: isInclude, fields: names.fields, lists: names.lists });
  if (!parsed.ok || !parsed.tree) throw new LayoutError(409, 'not editable', { problems: parsed.problems });
  return parsed.tree;
}

export async function readLayoutFile(siteDir, kind, name, { importCook = defaultImportCook } = {}) {
  check(kind, name);
  const cook = await loadCook(siteDir, importCook);
  const { entry, names } = await findEntry(siteDir, cook, kind, name);
  const html = readFileSync(fileOf(siteDir, kind, entry), 'utf8');
  const tree = parseEditable(cook, kind, entry, html, names);
  return { tree, hash: sha1(html), problems: [] };
}

/** Serialize a tree and check it as the site's Cook would; the source or a 422. */
async function serializeChecked(cook, siteDir, kind, tree, names, parents, { name, parentOf = {} } = {}) {
  let source, result;
  try {
    source = cook.serializeLayout(tree);
    result = cook.checkLayout(source, { fields: names.fields, lists: names.lists, fragment: kind === 'include' });
  } catch (err) {
    // A tree the serializer or checker can't make sense of
    throw new LayoutError(422, "This layout can't be saved", { problems: [{ line: 1, message: String(err?.message ?? err) }] });
  }
  const problems = [...result.problems];
  if (kind === 'layout' && tree.parent && !parents.includes(tree.parent)) {
    problems.push({ line: 1, message: `parent layout "${tree.parent}" not found` });
  }
  if (kind === 'layout' && name && tree.parent) {
    const chain = [name];
    for (let at = tree.parent; at; at = at === name ? null : parentOf[at]) {
      chain.push(at);
      if (at === name || chain.length > 100) {
        problems.push({ line: 1, message: `Layout cycle: ${chain.join(' → ')}` });
        break;
      }
    }
  }
  if (!result.ok || problems.length) throw new LayoutError(422, "This layout can't be saved", { problems });
  return source;
}

/**
 * @param {string} siteDir
 * @param {'layout'|'include'} kind
 * @param {string} name
 * @param {{ tree: object, hash: string|null }} input - hash null: the file must not exist yet
 */
export async function saveLayoutFile(siteDir, kind, name, input, { importCook = defaultImportCook } = {}) {
  check(kind, name);
  const { tree, hash } = input || {};
  if (!tree || typeof tree !== 'object' || Array.isArray(tree)) throw new LayoutError(400, 'tree is required');
  if (hash !== null && typeof hash !== 'string') throw new LayoutError(400, 'hash must be a string or null');
  const cook = await loadCook(siteDir, importCook);
  const all = await inspect(siteDir, cook);
  const list = kind === 'layout' ? all.layouts : all.includes;
  const entry = list.find((e) => e.name === name);

  const parentOf = Object.fromEntries(all.layouts.map((e) => [e.name, e.parent]));
  const source = await serializeChecked(cook, siteDir, kind, tree, all.names, all.layouts.map((e) => e.name), { name, parentOf });

  // Re-read now, as late as possible: a hand edit since the file was opened wins.
  let target;
  if (hash === null) {
    target = join(dirOf(siteDir, kind), `${name}.html`);
    if (entry || existsSync(target)) throw new LayoutError(409, CHANGED_ON_DISK);
  } else {
    if (!entry) throw new LayoutError(404, `No ${kind} named ${name}`);
    target = fileOf(siteDir, kind, entry);
    let current;
    try { current = readFileSync(target, 'utf8'); } catch { throw new LayoutError(409, CHANGED_ON_DISK); }
    if (sha1(current) !== hash) throw new LayoutError(409, CHANGED_ON_DISK);
  }
  writeFileAtomic(target, source);
  return { hash: sha1(source) };
}

const text = (v) => typeof v === 'string' && v.trim() !== '';

function blankBase(label) {
  return {
    kind: 'base',
    info: { format: 1, label, slots: {} },
    parent: null,
    vars: [],
    pageLayout: 'stack',
    htmlAttrs: [],
    head: [
      { tag: 'meta', attrs: [['charset', 'utf-8']] },
      { tag: 'meta', attrs: [['name', 'viewport'], ['content', 'width=device-width, initial-scale=1']] },
      { tag: 'title', attrs: [], text: '${title}' },
    ],
    body: [
      { type: 'container', tag: 'header', attrs: [], body: [{ type: 'text', tag: 'p', attrs: [], inline: [{ field: 'title' }] }] },
      { type: 'container', tag: 'main', attrs: [], body: [{ type: 'content', attrs: [] }] },
      { type: 'container', tag: 'footer', attrs: [], body: [{ type: 'text', tag: 'p', attrs: [], inline: [{ field: 'title' }] }] },
    ],
    slots: [],
  };
}

/**
 * @param {string} siteDir
 * @param {{ kind: string, name: string, label: string, start: { type: 'child'|'copy'|'blank', from?: string } }} input
 * @returns {Promise<{ name: string, hash: string }>}
 */
export async function createLayoutFile(siteDir, input, { importCook = defaultImportCook } = {}) {
  const { kind, name, label, start } = input || {};
  check(kind, name);
  if (!text(label)) throw new LayoutError(400, 'label is required');
  const type = start?.type;
  if (!['child', 'copy', 'blank'].includes(type)) throw new LayoutError(400, 'start.type must be child, copy or blank');
  if (type !== 'blank' && !LAYOUT_NAME.test(start.from ?? '')) throw new LayoutError(400, 'start.from must be a layout name');
  if (kind === 'include' && type === 'child') throw new LayoutError(400, 'An include cannot be built on another');

  const cook = await loadCook(siteDir, importCook);
  const all = await inspect(siteDir, cook);
  const list = kind === 'layout' ? all.layouts : all.includes;
  const target = join(dirOf(siteDir, kind), `${name}.html`);
  if (list.some((e) => e.name === name) || existsSync(target) || existsSync(join(dirOf(siteDir, kind), name, 'index.html'))) {
    throw new LayoutError(409, `A ${kind} named ${name} already exists`);
  }

  let tree;
  if (type === 'blank') {
    tree = kind === 'layout'
      ? blankBase(label.trim())
      : { kind: 'fragment', body: [{ type: 'text', tag: 'p', attrs: [], inline: [{ text: label.trim() }] }] };
  } else {
    const parent = list.find((e) => e.name === start.from);
    if (!parent) throw new LayoutError(404, `No ${kind} named ${start.from}`);
    const parentTree = parseEditable(cook, kind, parent,
      readFileSync(fileOf(siteDir, kind, parent), 'utf8'), all.names);
    if (type === 'copy') {
      tree = structuredClone(parentTree);
      if (kind === 'layout') tree.info = { ...tree.info, label: label.trim() };
    } else {
      tree = {
        kind: 'child',
        info: { format: 1, label: label.trim(), slots: {} },
        parent: start.from,
        vars: [],
        pageLayout: parentTree.pageLayout === '${pageLayout}' ? 'stack' : null,
        htmlAttrs: [],
        head: [],
        body: [{ type: 'content', attrs: [] }],
        slots: [],
      };
    }
  }

  const source = await serializeChecked(cook, siteDir, kind, tree, all.names, all.layouts.map((e) => e.name));
  writeFileAtomic(target, source);
  return { name, hash: sha1(source) };
}

export async function deleteLayoutFile(siteDir, kind, name, { importCook = defaultImportCook } = {}) {
  check(kind, name);
  const cook = await loadCook(siteDir, importCook);
  const { entry } = await findEntry(siteDir, cook, kind, name);
  if (kind === 'include') {
    const usedBy = (await includeUsage(siteDir))[name] ?? [];
    if (usedBy.length) throw new LayoutError(409, 'in use', { usedBy, baseFor: [] });
  } else {
    const usage = await cook.layoutUsage(siteDir);
    const usedBy = usage.pages[name] ?? [];
    const baseFor = usage.layouts[name] ?? [];
    if (usedBy.length || baseFor.length) throw new LayoutError(409, 'in use', { usedBy, baseFor });
  }
  const file = fileOf(siteDir, kind, entry);
  rmSync(file);
  const dir = join(file, '..');
  if (kind === 'layout' && entry.file.includes('/') && readdirSync(dir).length === 0) rmdirSync(dir);
}
