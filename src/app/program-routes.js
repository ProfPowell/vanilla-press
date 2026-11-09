/**
 * The Programs screen's routes on a site's router: the state, areas, cards, add
 * from a folder and remove. Programs go live: every write runs in the backup's
 * git queue, then the write lock (like Apply), and is committed and pushed at
 * once with a `Programs:` message (no CI skip), so the site rebuilds. Without a
 * repo, or when the commit or push fails, the change stays on disk and the
 * response says `committed: false` with a note. Every response is JSON.
 *
 * Upload and Update from source (Task 8) mount here too.
 *
 * @module app/program-routes
 */

import { existsSync, rmdirSync } from 'node:fs';
import { mkdir, realpath, rename, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { sendJson } from '../server/router.js';
import {
  PROGRAMS_FILE, CARD_KEYS, SLUG, ProgramError, readPrograms, writePrograms, checkSlug, checkAreaPath, cardFromInput,
  programsState, buildOnlyPaths,
} from '../programs/config.js';
import { LIMITS, stageFromFolder, installStaged } from '../programs/import.js';
import { programUsage } from '../programs/usage.js';
import { BACKUP_PATHS, THEME_PATHS, programMessage } from './site-git.js';
import { themeConflictResolver } from './site-theme.js';
import { readSiteUrl } from './publish.js';
import { GitNotConnectedError } from '../git/git.js';
import { getAllDocuments, getProgramSource, setProgramSource, deleteProgramSource } from '../store/content.js';
import { render } from '../renderers/html.js';
import { outputPaths } from '../sync/paths.js';
import { getCollectionsConfig } from '../sync/site-files.js';

const NOT_COMMITTED = (why) => `Saved on this computer, but not committed (${why}), so it isn't live yet.`;
const NOT_PUSHED = (why) => `Committed on this computer, but not pushed to GitHub (${why}), so it isn't live yet. The next backup or Publish pushes it.`;

/** `/programs/areas/<x>` is the area route, so no area may be called `areas` (R7). */
const ROUTE_RESERVED = 'areas';
const RESERVED_AREA = `"${ROUTE_RESERVED}" is reserved in Vanilla Press: choose another name.`;

/**
 * A commit that did not happen: thrown out of backup.exclusive (its name is not Git*), so
 * the pending drafts it took are given back to the backup, then answered as committed: false.
 */
class NotCommitted extends Error {
  constructor(note, send) {
    super(note);
    this.name = 'ProgramNotCommitted';
    this.note = note;
    this.send = send;
  }
}

/** Is `child` inside `parent` (or the same folder)? */
const within = (parent, child) => {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
};

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const titleFromSlug = (slug) => slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
const same = (area, slug) => (p) => isObj(p) && p.area === area && p.slug === slug;

/**
 * An area's title and sandbox default from input, over its current values.
 * @param {Object} input
 * @param {{ path: string, title?: string, sandbox?: boolean }} current
 * @returns {{ title: string, sandbox: boolean }}
 */
function areaFields(input, current) {
  const errors = [];
  let title = typeof current.title === 'string' && current.title ? current.title : titleFromSlug(current.path);
  if (input.title !== undefined && input.title !== null) {
    if (typeof input.title !== 'string' || !input.title.trim()) errors.push('Title must be text.');
    else if (input.title.trim().length > 120) errors.push('Title must be 120 characters or fewer.');
    else title = input.title.trim();
  }
  let sandbox = current.sandbox === true;
  if (input.sandbox !== undefined && input.sandbox !== null) {
    if (typeof input.sandbox === 'boolean') sandbox = input.sandbox;
    else errors.push('Sandbox must be true or false.');
  }
  if (errors.length) throw new ProgramError(422, errors.join(' '), { errors });
  return { title, sandbox };
}

/**
 * @param {{ add: Function }} router
 * @param {string} prefix - `/api/sites/<id>`
 * @param {{ site: { id: string }, ws: object, db: object, backup: object, writes: Function,
 *   deps: { commitPaths: Function, push: Function, gitStatus: Function },
 *   liveRefs?: (siteHost: string|null) => Promise<Map<string, Array<{ path: string, vpId: string|null }>>>,
 *   programsUrl: string|(() => string|null) }} context - liveRefs: the committed pages'
 *   program links (createLivePrograms); programsUrl: the program server's origin, or a
 *   getter for it (it binds after the app server)
 */
export function mountProgramRoutes(router, prefix, {
  site, ws, db, backup, writes, deps, liveRefs, programsUrl,
}) {
  const siteDir = ws.siteDir;
  const runUrl = () => (typeof programsUrl === 'function' ? programsUrl() : programsUrl);

  /** Run a handler, sending a ProgramError as its status and body. */
  const handle = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof ProgramError) return sendJson(res, err.status, { error: err.message, ...err.body });
      console.error('Programs error:', err);
      sendJson(res, 500, { error: err.message });
    }
  };
  const body = (req) => (isObj(req.body) ? req.body : {});

  /** A program as GET lists it, with its source folder. */
  function programOut(area, slug) {
    const p = programsState(siteDir).programs.find(same(area, slug));
    return p ? { ...p, source: getProgramSource(db, area, slug) } : null;
  }
  const areaOut = (path) => programsState(siteDir).areas.find((a) => a.path === path) || null;
  const countIn = (path) => areaOut(path)?.count ?? 0;

  /** An area named in a URL or body: slug-shaped and configured, else 404. */
  function findArea(config, path) {
    if (typeof path !== 'string' || !SLUG.test(path)) throw new ProgramError(404, `There is no area /${path}/.`);
    const i = config.areas.findIndex((a) => isObj(a) && a.path === path);
    if (i < 0) throw new ProgramError(404, `There is no area /${path}/.`);
    return i;
  }

  /**
   * The folder of /<area>/<slug>/, refusing (404) anything but a slug-shaped area and slug
   * whose folder is a direct child of src/<area>/ (a card's slug is never trusted as a path).
   */
  function programDir(area, slug) {
    const missing = () => new ProgramError(404, `There is no program /${area}/${slug}/.`);
    if (typeof area !== 'string' || typeof slug !== 'string' || !SLUG.test(area) || !SLUG.test(slug)) throw missing();
    const areaDir = resolve(siteDir, 'src', area);
    const dir = resolve(areaDir, slug);
    if (dirname(dir) !== areaDir) throw missing();
    return dir;
  }

  /**
   * Commit and push at once (Programs go live). The commit carries config/programs.json and
   * every configured area's folder (R6), so a card and its folder always go live together,
   * plus `extra` (an area folder being moved or removed). The pending drafts exclusive()
   * took go in too, as with Publish and Apply. A commit that did not happen throws
   * NotCommitted (the drafts go back to the backup); a failed push is a note.
   */
  async function goLive(extra, what, send) {
    let status;
    try {
      status = await deps.gitStatus(siteDir);
    } catch (err) {
      throw new NotCommitted(NOT_COMMITTED(err.message), send);
    }
    if (!status.isRepo) {
      return { status: 'saved', committed: false, note: NOT_COMMITTED('this site folder is not a git repository'), send };
    }
    const areas = programsState(siteDir).areas.map((a) => `src/${a.path}`);
    const paths = [...new Set([...BACKUP_PATHS, PROGRAMS_FILE, ...areas, ...extra])];
    try {
      await deps.commitPaths(siteDir, paths, programMessage(what));
    } catch (err) {
      throw new NotCommitted(NOT_COMMITTED(err.message), send);
    }
    try {
      const pushed = await deps.push(siteDir, { yieldUntracked: [...THEME_PATHS], resolveConflicts: themeConflictResolver(ws) });
      return { ...pushed, status: 'pushed', committed: true, send };
    } catch (err) {
      return { ...(err instanceof GitNotConnectedError ? { status: 'saved' } : {}), committed: false, note: NOT_PUSHED(err.message), send };
    }
  }

  /**
   * A write route: in the backup's git queue, then the write lock, make the change and
   * take it live. `run` resolves to `{ send, paths, what }`: the JSON to send, any folder
   * to commit beyond the configured areas, and the commit message text. A ProgramError
   * from `run` is sent as is, with nothing committed.
   */
  const write = (status, run) => handle(async (req, res) => {
    let out;
    try {
      out = await backup.exclusive(() => writes(async () => {
        const { send, paths = [], what } = await run(req);
        return goLive(paths, what, send);
      }));
    } catch (err) {
      if (!(err instanceof NotCommitted)) throw err;
      out = { send: err.send, committed: false, note: err.note };
    }
    sendJson(res, status, { ...out.send, committed: out.committed, ...(out.note ? { note: out.note } : {}) });
  });

  /**
   * A function answering the saved posts and committed pages that use /<area>/<slug>/.
   * `strict`: a git failure in the committed-page scan is a 502 (Remove must not guess);
   * otherwise it is logged and only saved posts count.
   */
  async function usage({ strict }) {
    const siteUrl = await readSiteUrl(siteDir);
    let siteHost = null;
    try { siteHost = siteUrl ? new URL(siteUrl).host : null; } catch { /* not a URL: relative links only */ }
    const collectionsConfig = getCollectionsConfig(db);
    const docs = getAllDocuments(db).map((doc) => ({
      id: doc.id,
      title: doc.meta?.title ?? '',
      // The page it publishes to (a draft's too), as committed pages are named.
      path: outputPaths({ ...doc, meta: { ...doc.meta, status: 'published' } }, collectionsConfig).html,
      html: render(doc, { scope: 'content', bare: true }),
      image: doc.meta?.image ?? null,
    }));
    let live = new Map();
    if (liveRefs) {
      try {
        live = await liveRefs(siteHost);
      } catch (err) {
        if (strict) throw new ProgramError(502, `Could not check where this program is used (${err.message}). Nothing was removed.`);
        console.error('live program scan failed:', err);
      }
    }
    return (area, slug) => programUsage({ docs, live, area, slug, siteHost });
  }

  router.add('GET', `${prefix}/programs`, handle(async (req, res) => {
    const { areas, programs } = programsState(siteDir);
    const usedIn = programs.length ? await usage({ strict: false }) : null;
    const base = runUrl();
    sendJson(res, 200, {
      areas,
      programs: programs.map((p) => ({ ...p, source: getProgramSource(db, p.area, p.slug), usedIn: usedIn(p.area, p.slug) })),
      runBase: base ? `${base}/${site.id}` : null,
      limits: LIMITS,
    });
  }));

  // --- Areas (before the program routes: /programs/areas/x is not a program) ---

  router.add('POST', `${prefix}/programs/areas`, write(201, async (req) => {
    const { path, title, sandbox } = body(req);
    const config = readPrograms(siteDir);
    if (path === ROUTE_RESERVED) throw new ProgramError(422, RESERVED_AREA);
    if (config.areas.some((a) => isObj(a) && a.path === path)) throw new ProgramError(409, `/${path}/ is already an area.`);
    const bad = checkAreaPath(siteDir, path, { areas: config.areas, buildOnlyPaths: await buildOnlyPaths(siteDir) });
    if (bad) throw new ProgramError(422, bad);
    const area = { path, ...areaFields({ title, sandbox }, { path }) };
    writePrograms(siteDir, { ...config, areas: [...config.areas, area] });
    return { send: { area: areaOut(path) }, what: `add area ${path}` };
  }));

  router.add('PATCH', `${prefix}/programs/areas/:path`, write(200, async (req) => {
    const old = req.params.path;
    const input = body(req);
    const config = readPrograms(siteDir);
    const i = findArea(config, old);
    const fields = areaFields(input, config.areas[i]);
    let path = old;
    if (input.path !== undefined && input.path !== old) {
      if (countIn(old) > 0) {
        throw new ProgramError(409, `/${old}/ has programs: an area's path can change only while it is empty.`);
      }
      if (input.path === ROUTE_RESERVED) throw new ProgramError(422, RESERVED_AREA);
      if (config.areas.some((a) => isObj(a) && a.path === input.path)) throw new ProgramError(409, `/${input.path}/ is already an area.`);
      const bad = checkAreaPath(siteDir, input.path, { buildOnlyPaths: await buildOnlyPaths(siteDir) });
      if (bad) throw new ProgramError(422, bad);
      path = input.path;
    }
    config.areas[i] = { ...config.areas[i], path, ...fields };
    writePrograms(siteDir, config);
    if (path !== old) {
      try { rmdirSync(join(siteDir, 'src', old)); } catch { /* absent, or holds other files: left as it is */ }
    }
    return { send: { area: areaOut(path) }, paths: [`src/${old}`], what: path === old ? `edit area ${old}` : `move area ${old} to ${path}` };
  }));

  router.add('DELETE', `${prefix}/programs/areas/:path`, write(200, async (req) => {
    const path = req.params.path;
    const config = readPrograms(siteDir);
    const i = findArea(config, path);
    if (countIn(path) > 0) throw new ProgramError(409, `/${path}/ has programs: an area can be deleted only while it is empty.`);
    config.areas.splice(i, 1);
    writePrograms(siteDir, config);
    try { rmdirSync(join(siteDir, 'src', path)); } catch { /* absent, or holds other files: left as it is */ }
    return { send: { ok: true }, paths: [`src/${path}`], what: `remove area ${path}` };
  }));

  // --- Programs ---

  router.add('POST', `${prefix}/programs`, write(201, async (req) => {
    const { area, source, slug } = body(req);
    const config = readPrograms(siteDir);
    findArea(config, area);
    const bad = checkSlug(slug);
    if (bad) throw new ProgramError(422, bad);
    if (typeof source !== 'string' || !isAbsolute(source)) throw new ProgramError(422, 'Choose a folder on this computer.');
    const target = programDir(area, slug);
    const [realSource, realSite] = await Promise.all([realpath(source).catch(() => null), realpath(siteDir)]);
    if (realSource && (within(realSite, realSource) || within(realSource, realSite))) {
      throw new ProgramError(422, `${source} overlaps this site's own folder. Choose a program folder outside the site. Nothing was copied.`);
    }
    if (config.programs.some(same(area, slug)) || existsSync(target)) {
      throw new ProgramError(409, `"${slug}" is already taken in /${area}/. Choose another slug.`);
    }
    const { tmpDir, scan } = await stageFromFolder(siteDir, source);
    try {
      await installStaged(siteDir, tmpDir, area, slug);
    } finally {
      await rm(tmpDir, { recursive: true, force: true }); // gone after a rename; a failed install leaves no stage
    }
    const { card } = cardFromInput({}, { area, slug }); // the defaults: unlisted
    try {
      writePrograms(siteDir, { ...config, programs: [...config.programs, card] });
    } catch (err) {
      await rm(target, { recursive: true, force: true }); // nothing half-installed
      throw err;
    }
    setProgramSource(db, area, slug, source);
    return {
      send: { program: programOut(area, slug), skipped: scan.skipped, large: scan.large },
      what: `add ${slug}`,
    };
  }));

  router.add('PATCH', `${prefix}/programs/:area/:slug`, write(200, async (req) => {
    const { area, slug } = req.params;
    programDir(area, slug);
    const config = readPrograms(siteDir);
    findArea(config, area);
    const found = programsState(siteDir).programs.find(same(area, slug));
    if (!found) throw new ProgramError(404, `There is no program /${area}/${slug}/.`);
    const input = body(req);
    if (input.listed === true && found.status !== 'ok') {
      throw new ProgramError(422, found.status === 'no-index'
        ? 'Not a program (no index.html): it can\'t be listed.'
        : 'Its folder is missing: it can\'t be listed.');
    }
    const i = config.programs.findIndex(same(area, slug));
    const existing = i >= 0 ? config.programs[i] : {}; // a stray folder gets its card
    const known = Object.fromEntries(CARD_KEYS.filter((k) => k in existing).map((k) => [k, existing[k]]));
    const { area: _a, slug: _s, ...changes } = input;
    const { card, errors } = cardFromInput({ ...known, ...changes }, { area, slug });
    if (errors.length) throw new ProgramError(422, errors.join(' '), { errors });
    const extras = Object.fromEntries(Object.entries(existing).filter(([k]) => !CARD_KEYS.includes(k)));
    const next = { ...card, ...extras };
    if (i >= 0) config.programs[i] = next;
    else config.programs.push(next);
    writePrograms(siteDir, config);
    return { send: { program: programOut(area, slug) }, what: `edit ${slug}` };
  }));

  router.add('DELETE', `${prefix}/programs/:area/:slug`, write(200, async (req) => {
    const { area, slug } = req.params;
    const target = programDir(area, slug);
    const config = readPrograms(siteDir);
    findArea(config, area);
    if (!programsState(siteDir).programs.some(same(area, slug))) throw new ProgramError(404, `There is no program /${area}/${slug}/.`);
    const uses = (await usage({ strict: true }))(area, slug);
    if (uses.length) {
      const where = uses.length === 1 ? `"${uses[0].title}"` : `${uses.length} posts and pages`;
      throw new ProgramError(409, `/${area}/${slug}/ is used in ${where}. Remove those links first.`, { usedIn: uses });
    }
    // Park the folder first, so a failed config write can put it back.
    let parked = null;
    if (existsSync(target)) {
      parked = join(siteDir, '.vp', 'tmp', `${randomBytes(8).toString('hex')}-removed`);
      await mkdir(dirname(parked), { recursive: true });
      await rename(target, parked);
    }
    try {
      writePrograms(siteDir, { ...config, programs: config.programs.filter((p) => !same(area, slug)(p)) });
    } catch (err) {
      if (parked) await rename(parked, target);
      throw err;
    }
    if (parked) await rm(parked, { recursive: true, force: true }).catch(() => {}); // leftovers go with clearTmp
    deleteProgramSource(db, area, slug);
    return { send: { ok: true }, what: `remove ${slug}` };
  }));
}
