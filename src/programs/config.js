// Programs config: config/programs.json (areas and cards), the rules for area
// paths and card fields, and the folder state of each program. Agrees with
// Cook's scripts/plugins/programs.js on slugs and card fields.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PROGRAMS_FILE = 'config/programs.json';
export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RESERVED_AREAS = ['media', 'assets', 'layouts', 'includes'];
const AREA_KEYS = ['path', 'title', 'sandbox'];
export const CARD_KEYS = ['area', 'slug', 'title', 'description', 'date', 'tags', 'image', 'listed', 'sandbox', 'previewClass', 'order'];

export class ProgramError extends Error {
  constructor(status, message, body = {}) {
    super(message);
    this.name = 'ProgramError';
    this.status = status;
    this.body = body;
  }
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

export function readPrograms(siteDir) {
  const file = join(siteDir, PROGRAMS_FILE);
  if (!existsSync(file)) return { areas: [], programs: [] };
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new ProgramError(422, `${PROGRAMS_FILE} is not valid JSON: ${e.message}`);
  }
  if (!isObj(raw)) return { areas: [], programs: [] };
  return {
    areas: Array.isArray(raw.areas) ? raw.areas : [],
    programs: Array.isArray(raw.programs) ? raw.programs : [],
  };
}

// Known keys first, in the spec's order; anything else after, so a hand edit survives.
function ordered(obj, keys) {
  if (!isObj(obj)) return obj;
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  for (const k of Object.keys(obj)) if (!(k in out) && obj[k] !== undefined) out[k] = obj[k];
  return out;
}

export function writePrograms(siteDir, value) {
  const out = {
    areas: (value.areas || []).map((a) => ordered(a, AREA_KEYS)),
    programs: (value.programs || []).map((p) => ordered(p, CARD_KEYS)),
  };
  mkdirSync(join(siteDir, 'config'), { recursive: true });
  writeFileSync(join(siteDir, PROGRAMS_FILE), `${JSON.stringify(out, null, 2)}\n`);
}

export function checkSlug(s) {
  if (typeof s === 'string' && SLUG.test(s)) return null;
  return 'Use lowercase letters, digits and single hyphens (for example div-vaders).';
}

function srcEntryClash(siteDir, name) {
  const src = join(siteDir, 'src');
  for (const ext of ['html', 'md']) {
    if (existsSync(join(src, `${name}.${ext}`))) {
      return `"${name}" is already a page on this site (src/${name}.${ext}).`;
    }
  }
  const p = join(src, name);
  if (existsSync(p)) {
    return statSync(p).isDirectory()
      ? `"${name}" is already a folder on this site (src/${name}/).`
      : `"${name}" is already a file on this site (src/${name}).`;
  }
  return null;
}

/**
 * Why an area path can't be used, or null. At creation any existing src/ entry of
 * that name is a clash; a name that is already a configured area passes that
 * check (editing it). Reserved names and buildOnlyPaths always refuse.
 */
export function checkAreaPath(siteDir, path, { areas = [], buildOnlyPaths: buildOnly = [] } = {}) {
  const bad = checkSlug(path);
  if (bad) return bad;
  if (RESERVED_AREAS.includes(path)) return `"${path}" is reserved: choose another name.`;
  const set = new Set(buildOnly.map((p) => String(p).replace(/^\/+|\/+$/g, '')));
  if (set.has(path)) return `"${path}" is a build-only folder in this site's config: choose another name.`;
  if (areas.some((a) => a && a.path === path)) return null;
  return srcEntryClash(siteDir, path);
}

const titleFromSlug = (slug) => slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

function localDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function validDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

const absent = (v) => v === undefined || v === null;

/** Build a card from form input, applying defaults. Errors are plain sentences. */
export function cardFromInput(input, { area, slug }) {
  const i = isObj(input) ? input : {};
  const errors = [];

  let title = titleFromSlug(slug);
  if (!absent(i.title)) {
    if (typeof i.title !== 'string') errors.push('Title must be text.');
    else if (i.title.trim()) {
      title = i.title.trim();
      if (title.length > 120) errors.push('Title must be 120 characters or fewer.');
    }
  }

  let description = '';
  if (!absent(i.description)) {
    if (typeof i.description !== 'string') errors.push('Description must be text.');
    else {
      description = i.description.trim();
      if (description.length > 500) errors.push('Description must be 500 characters or fewer.');
    }
  }

  let date = localDate();
  if (!absent(i.date) && i.date !== '') {
    if (validDate(i.date)) date = i.date;
    else errors.push('Date must be YYYY-MM-DD.');
  }

  let tags = [];
  if (!absent(i.tags)) {
    if (!Array.isArray(i.tags) || i.tags.some((t) => typeof t !== 'string')) errors.push('Tags must be a list of text.');
    else {
      tags = [...new Set(i.tags.map((t) => t.trim()).filter(Boolean))];
      if (tags.length > 10) errors.push('Use 10 tags or fewer.');
      if (tags.some((t) => t.length > 30)) errors.push('Each tag must be 30 characters or fewer.');
    }
  }

  let image = '';
  if (!absent(i.image) && i.image !== '') {
    if (typeof i.image === 'string' && /^\/media\/[^/\s]+$/.test(i.image) && !i.image.includes('..')) image = i.image;
    else errors.push('Image must be a /media/ file.');
  }

  let listed = false;
  if (!absent(i.listed)) {
    if (typeof i.listed === 'boolean') listed = i.listed;
    else errors.push('Listed must be true or false.');
  }

  const card = { area, slug, title, description, date, tags, image, listed };

  if (!absent(i.sandbox)) {
    if (typeof i.sandbox === 'boolean') card.sandbox = i.sandbox;
    else errors.push('Sandbox must be true, false or left out.');
  }
  if (!absent(i.previewClass) && i.previewClass !== '') {
    if (typeof i.previewClass === 'string' && /^[a-z][a-z0-9-]*$/.test(i.previewClass)) card.previewClass = i.previewClass;
    else errors.push('Preview class must be a CSS class name (lowercase letters, digits, hyphens).');
  }
  if (!absent(i.order)) {
    if (Number.isInteger(i.order)) card.order = i.order;
    else errors.push('Order must be a whole number.');
  }
  return { card, errors };
}

/** Does this program run sandboxed: its own setting, else its area's. */
export function effectiveSandbox(config, area, slug) {
  const card = (config.programs || []).find((p) => p.area === area && p.slug === slug);
  if (card && typeof card.sandbox === 'boolean') return card.sandbox;
  const a = (config.areas || []).find((x) => x.path === area);
  return a?.sandbox === true;
}

function subfolders(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch {
    return [];
  }
}

/** Areas with counts, and every program (carded or stray) with its folder status. */
export function programsState(siteDir) {
  const { areas, programs } = readPrograms(siteDir);
  const valid = areas.filter((a) => isObj(a) && typeof a.path === 'string');
  const known = new Set(valid.map((a) => a.path));
  const status = (area, slug) => {
    const dir = join(siteDir, 'src', area, slug);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return 'missing-folder';
    return existsSync(join(dir, 'index.html')) ? 'ok' : 'no-index';
  };
  const out = [];
  for (const area of valid) {
    const cards = programs.filter((p) => isObj(p) && p.area === area.path && typeof p.slug === 'string');
    const carded = new Set(cards.map((p) => p.slug));
    for (const c of cards) {
      out.push({ ...c, url: `/${c.area}/${c.slug}/`, hasCard: true, status: status(c.area, c.slug) });
    }
    for (const slug of subfolders(join(siteDir, 'src', area.path))) {
      if (carded.has(slug) || !SLUG.test(slug)) continue;
      out.push({
        area: area.path, slug, title: titleFromSlug(slug), description: '', date: '', tags: [], image: '',
        listed: false, url: `/${area.path}/${slug}/`, hasCard: false, status: status(area.path, slug),
      });
    }
  }
  return {
    areas: valid.map((a) => ({ ...a, count: out.filter((p) => p.area === a.path).length })),
    programs: out.filter((p) => known.has(p.area)),
  };
}

/** The site's buildOnlyPaths from config/main.js ([] when absent or unreadable). */
export async function buildOnlyPaths(siteDir) {
  const file = join(siteDir, 'config', 'main.js');
  if (!existsSync(file)) return [];
  try {
    const mod = await import(`${pathToFileURL(file).href}?t=${Date.now()}-${Math.random()}`);
    const list = mod.default?.buildOnlyPaths;
    return Array.isArray(list) ? list.filter((p) => typeof p === 'string') : [];
  } catch {
    return [];
  }
}
