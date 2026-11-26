/**
 * Collections ("catalog") data model. Pure and browser-safe: no node: imports.
 *
 * @module catalogs/model
 */

import { higherAccess } from '../access/levels.js';
import { validAccess } from '../schema/content-schema.js';

const FIELD_TYPES = ['text', 'number', 'money', 'date', 'bool', 'url', 'choice'];
const ID_PREFIXES = ['cat', 'item', 'f', 'l', 'c'];

/** Thrown by removeChoice when items still use the choice (or a descendant). */
export class ChoiceInUseError extends Error {
  constructor(count) {
    super(`Choice is used by ${count} item${count === 1 ? '' : 's'}`);
    this.name = 'ChoiceInUseError';
    this.count = count;
  }
}

/**
 * A new id: prefix + '_' + 10 random base36 characters.
 * @param {'cat'|'item'|'f'|'l'|'c'} prefix
 * @returns {string}
 */
export function newId(prefix) {
  if (!ID_PREFIXES.includes(prefix)) throw new Error(`Unknown id prefix: ${prefix}`);
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += (b % 36).toString(36);
  return `${prefix}_${s}`;
}

/**
 * Lowercase, accents stripped, non-alphanumerics collapsed to single hyphens.
 * @param {string} title
 * @returns {string}
 */
export function slugify(title) {
  const s = String(title ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'item';
}

/**
 * base, or base-2, base-3 ... the first not in `taken`.
 * @param {string} base
 * @param {Set<string>} taken
 * @returns {string}
 */
export function uniqueSlug(base, taken) {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/**
 * An item's effective level: the higher of its collection's level and its own.
 * @param {{access?: string}} catalog
 * @param {{access?: string}} item
 * @returns {string}
 */
export function effectiveLevel(catalog, item) {
  return higherAccess(catalog?.access, item?.access);
}

/**
 * @param {unknown} design
 * @returns {string[]} error messages (empty when valid)
 */
export function validateDesign(design) {
  if (!design || typeof design !== 'object') return ['Design must be an object'];
  const errors = [];
  const ids = new Set();
  const claim = (id, what) => {
    if (typeof id !== 'string' || !id) errors.push(`${what} needs an id`);
    else if (ids.has(id)) errors.push(`Duplicate id: ${id}`);
    else ids.add(id);
  };
  if (!Array.isArray(design.fields)) errors.push('Design needs a fields array');
  for (const f of design.fields ?? []) {
    claim(f?.id, 'Field');
    const name = f?.label || f?.id || 'Field';
    if (!f?.label) errors.push(`Field ${f?.id ?? ''} needs a label`);
    if (!FIELD_TYPES.includes(f?.type)) errors.push(`${name}: unknown type "${f?.type}"`);
    if (!validAccess.includes(f?.level)) errors.push(`${name}: unknown level "${f?.level}"`);
    if (f?.type === 'choice' && !(Array.isArray(f.options) && f.options.length)) {
      errors.push(`${name}: a choice field needs options`);
    }
  }
  const walk = (choices, listLabel) => {
    if (!Array.isArray(choices)) { errors.push(`${listLabel}: choices must be an array`); return; }
    for (const c of choices) {
      claim(c?.id, 'Choice');
      if (!c?.label) errors.push(`${listLabel}: a choice needs a label`);
      walk(c?.children ?? [], listLabel);
    }
  };
  if (!Array.isArray(design.lists)) errors.push('Design needs a lists array');
  for (const l of design.lists ?? []) {
    claim(l?.id, 'List');
    if (!l?.label) errors.push(`List ${l?.id ?? ''} needs a label`);
    walk(l?.choices ?? [], l?.label || l?.id);
  }
  const g = design.grading;
  if (g != null) {
    if (!validAccess.includes(g.level)) errors.push(`Grading: unknown level "${g.level}"`);
    if (!Array.isArray(g.agencies)) errors.push('Grading needs an agencies array');
  }
  if (design.sort != null && !Array.isArray(design.sort)) errors.push('Sort must be an array');
  return errors;
}

/**
 * @param {Object} item
 * @param {Object} design
 * @returns {string[]} error messages (empty when valid)
 */
export function validateItem(item, design) {
  const errors = [];
  if (!item || typeof item.title !== 'string' || !item.title.trim()) errors.push('Title is required');
  if (item?.rating != null && !(Number.isInteger(item.rating) && item.rating >= 1 && item.rating <= 5)) {
    errors.push('Rating must be a whole number from 1 to 5');
  }
  const byId = new Map((design?.fields ?? []).map((f) => [f.id, f]));
  for (const [id, v] of Object.entries(item?.fields ?? {})) {
    const f = byId.get(id);
    if (!f) { errors.push(`Unknown field: ${id}`); continue; }
    if (v == null || v === '') continue;
    const bad = (why) => errors.push(`${f.label}: ${why}`);
    switch (f.type) {
      case 'text': if (typeof v !== 'string') bad('must be text'); break;
      case 'number': if (typeof v !== 'number' || !Number.isFinite(v)) bad('must be a number'); break;
      case 'money': if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) bad('must be an amount of money'); break;
      case 'bool': if (typeof v !== 'boolean') bad('must be yes or no'); break;
      case 'date':
        if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) bad('must be a date (YYYY-MM-DD)');
        break;
      case 'url': {
        let ok = false;
        try { ok = typeof v === 'string' && /^https?:$/.test(new URL(v).protocol); } catch { /* not a URL */ }
        if (!ok) bad('must be an http(s) link');
        break;
      }
      case 'choice': if (!(f.options ?? []).includes(v)) bad('must be one of the options'); break;
    }
  }
  if (item?.grade != null) {
    if (!design?.grading) errors.push('This collection does not use grading');
    else if (!design.grading.agencies.includes(item.grade.agency)) errors.push(`Unknown grading agency: ${item.grade.agency}`);
  }
  return errors;
}

function walkChoices(choices, trail, fn) {
  for (const c of choices ?? []) {
    const path = [...trail, c];
    const r = fn(c, path);
    if (r !== undefined) return r;
    const inner = walkChoices(c.children, path, fn);
    if (inner !== undefined) return inner;
  }
  return undefined;
}

function findPath(design, listId, choiceId) {
  const list = design?.lists?.find((l) => l.id === listId);
  if (!list) return null;
  return walkChoices(list.choices, [], (c, path) => (c.id === choiceId ? path : undefined)) ?? null;
}

/**
 * @returns {{choice: Object, path: string[]}|null} path = labels from the root
 */
export function findChoice(design, listId, choiceId) {
  const trail = findPath(design, listId, choiceId);
  return trail ? { choice: trail[trail.length - 1], path: trail.map((c) => c.label) } : null;
}

/** Ids from the choice up to its root, self first ([] when not found). */
export function ancestorIds(design, listId, choiceId) {
  const trail = findPath(design, listId, choiceId);
  return trail ? trail.map((c) => c.id).reverse() : [];
}

function mapList(design, listId, fn) {
  return { ...design, lists: design.lists.map((l) => (l.id === listId ? { ...l, choices: fn(l.choices) } : l)) };
}

function mapChoice(choices, id, fn) {
  return choices.map((c) => (c.id === id ? fn(c) : { ...c, children: mapChoice(c.children ?? [], id, fn) }));
}

/**
 * Add a choice at the top of a list (parentId null) or under a parent.
 * @returns {{design: Object, id: string}}
 */
export function addChoice(design, listId, parentId, label) {
  const id = newId('c');
  const choice = { id, label, children: [] };
  const next = mapList(design, listId, (choices) => (
    parentId == null
      ? [...choices, choice]
      : mapChoice(choices, parentId, (p) => ({ ...p, children: [...(p.children ?? []), choice] }))
  ));
  return { design: next, id };
}

export function renameChoice(design, listId, choiceId, label) {
  return mapList(design, listId, (choices) => mapChoice(choices, choiceId, (c) => ({ ...c, label })));
}

/**
 * Remove a choice and its descendants; refuses while any item uses one of them.
 * @throws {ChoiceInUseError}
 */
export function removeChoice(design, listId, choiceId, items) {
  const trail = findPath(design, listId, choiceId);
  if (!trail) return design;
  const doomed = new Set();
  walkChoices([trail[trail.length - 1]], [], (c) => { doomed.add(c.id); });
  const count = (items ?? []).filter((it) => (it.categories?.[listId] ?? []).some((id) => doomed.has(id))).length;
  if (count) throw new ChoiceInUseError(count);
  const strip = (choices) => choices.filter((c) => c.id !== choiceId).map((c) => ({ ...c, children: strip(c.children ?? []) }));
  return mapList(design, listId, strip);
}
