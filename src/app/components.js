/**
 * Per-site component operations: which packages a site has on, turning one
 * on or off (npm install/uninstall in the site, then a commit of only its
 * package files), and which posts use a component.
 *
 * @module app/components
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CATALOG } from '../components/catalog.js';
import { describeComponents, componentIndex } from '../components/describe.js';
import { durationText } from './site-process.js';
import { allBlockLists } from '../schema/blocks.js';

/** The files a component change edits; nothing else is staged. */
export const PACKAGE_FILES = ['package.json', 'package-lock.json'];
/** The first cook-ssg with the package-components plugin. */
const COOK_PACKAGES_VERSION = [2, 5, 0];
const NPM_TIMEOUT_MS = 5 * 60_000;
const NPM_LOG_LINES = 20;

export const DIRTY_MESSAGE = "package.json has changes that aren't committed. Commit or discard them, then try again.";

/** A refused component change: `status` and the JSON `body` to send. */
export class ComponentError extends Error {
  constructor(status, body) {
    super(body.error);
    this.name = 'ComponentError';
    this.status = status;
    this.body = body;
  }
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Whether the site's installed cook-ssg (node_modules) is 2.5.0 or later.
 * A prerelease of 2.5.0 does not count.
 * @param {string|null} siteDir
 * @returns {boolean}
 */
export function cookSupportsPackages(siteDir) {
  if (!siteDir) return false;
  const version = readJson(join(siteDir, 'node_modules', 'cook-ssg', 'package.json'))?.version;
  const m = typeof version === 'string' && version.match(/^(\d+)\.(\d+)\.(\d+)(-)?/);
  if (!m) return false;
  const parts = [Number(m[1]), Number(m[2]), Number(m[3])];
  for (let i = 0; i < 3; i++) {
    if (parts[i] !== COOK_PACKAGES_VERSION[i]) return parts[i] > COOK_PACKAGES_VERSION[i];
  }
  return !m[4];
}

/**
 * `GET /components`: every catalog package's state for a site.
 * @param {{ siteDir: string|null, vpRoot: string, catalog?: Object[] }} roots
 * @returns {{ cookSupportsPackages: boolean, packages: import('../components/describe.js').PackageState[] }}
 */
export function componentsState({ siteDir, vpRoot, catalog = CATALOG }) {
  return {
    cookSupportsPackages: cookSupportsPackages(siteDir),
    packages: describeComponents({ siteDir, vpRoot, catalog }),
  };
}

/**
 * The descriptors of the components that are on for a site, by tag.
 * @param {{ siteDir: string|null, vpRoot: string, catalog?: Object[] }} roots
 * @returns {Map<string, import('../components/describe.js').ComponentDescriptor>}
 */
export function enabledComponents({ siteDir, vpRoot, catalog = CATALOG }) {
  return componentIndex(describeComponents({ siteDir, vpRoot, catalog }));
}

/**
 * The descriptors of every catalog component (on or off), by tag: what a
 * document save normalizes and validates against (Ruling R12), so a post
 * keeps a component the site has turned off. Publish checks the enabled ones.
 * @param {{ siteDir: string|null, vpRoot: string, catalog?: Object[] }} roots
 * @returns {Map<string, import('../components/describe.js').ComponentDescriptor>}
 */
export function catalogComponents({ siteDir, vpRoot, catalog = CATALOG }) {
  return componentIndex(describeComponents({ siteDir, vpRoot, catalog }), { enabledOnly: false });
}

/**
 * Every component tag in a document (its blocks and every region) or in a list
 * of blocks, at any depth (inline children included).
 * @param {Object[]|{ blocks?: Object[], regions?: Object }} input
 * @returns {Set<string>}
 */
export function componentTags(input) {
  const tags = new Set();
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'component' && typeof node.tag === 'string') tags.add(node.tag);
    if (Array.isArray(node.children)) node.children.forEach(visit);
  };
  const lists = Array.isArray(input) ? [input] : allBlockLists(input || {});
  for (const list of lists) list.forEach(visit);
  return tags;
}

/**
 * The documents (any status) that use any of `tags`, by title.
 * @param {import('better-sqlite3').Database} db
 * @param {string[]} tags
 * @returns {{ id: string, title: string, status: string }[]}
 */
export function postsUsing(db, tags) {
  const wanted = new Set(tags);
  const rows = db.prepare('SELECT id, title, status, blocks, regions FROM documents ORDER BY title, id').all();
  const out = [];
  for (const row of rows) {
    let doc;
    try { doc = { blocks: JSON.parse(row.blocks), regions: row.regions ? JSON.parse(row.regions) : undefined }; } catch { continue; }
    if ([...componentTags(doc)].some((t) => wanted.has(t))) {
      out.push({ id: row.id, title: row.title, status: row.status });
    }
  }
  return out;
}

/** The dependency range VP itself uses for `pkg` (R1), or null. */
function vpRange(vpRoot, pkg) {
  const pkgJson = readJson(join(vpRoot, 'package.json')) || {};
  return pkgJson.dependencies?.[pkg] ?? pkgJson.devDependencies?.[pkg] ?? null;
}

/** The last lines of npm's output. */
function tail(log) {
  return String(log || '').trimEnd().split('\n').slice(-NPM_LOG_LINES).join('\n');
}

/**
 * Turn a catalog package on or off for a site. Refuses (ComponentError) a package
 * not in the catalog (404), a bundled one or a body that is not a boolean (400),
 * turning off a package that a post uses (409 with `posts`), and uncommitted
 * changes to package.json or the lock (409). Otherwise runs
 * `npm install <pkg>@<VP's range> --save` (or `npm uninstall <pkg>`); when npm
 * fails both files are put back byte for byte (502 with npm's last lines).
 * On success commits only the package files, `Components: turn on|off <pkg> [CI Skip]`,
 * and flushes the backup, which pushes it. When that commit fails, both files are put
 * back (npm then re-syncs node_modules, best effort) and a 502 says to retry.
 *
 * The change runs in the backup's git queue, then the site's `writes` queue
 * (the order a publish takes them), so no save, backup or publish runs meanwhile.
 * Already in the requested state with the package files committed: nothing runs.
 * @param {{
 *   ws: { siteDir: string },
 *   db: import('better-sqlite3').Database,
 *   pkg: string,
 *   enabled: boolean,
 *   deps: {
 *     runNpm: Function, gitStatus: Function, hasHead: Function, changedSinceHead: Function,
 *     commitPaths: Function,
 *     backup: { commitOther: Function, flush: Function },
 *     writes: (fn: Function) => Promise<any>,
 *     vpRoot: string, catalog?: Object[],
 *   },
 * }} options
 * @returns {Promise<import('../components/describe.js').PackageState>} the package's new state
 * @throws {ComponentError}
 */
export async function setComponent({ ws, db, pkg, enabled, deps }) {
  const catalog = deps.catalog || CATALOG;
  const entry = catalog.find((e) => e.package === pkg);
  if (!entry) throw new ComponentError(404, { error: `Unknown component package: ${pkg}` });
  if (entry.bundled) throw new ComponentError(400, { error: `${pkg} comes with Vanilla Breeze and is always on.` });
  if (typeof enabled !== 'boolean') throw new ComponentError(400, { error: '"enabled" must be true or false' });

  const { siteDir } = ws;
  const roots = { siteDir, vpRoot: deps.vpRoot, catalog };
  const stateOf = () => describeComponents(roots).find((s) => s.package === pkg);

  const change = async () => {
    const status = await deps.gitStatus(siteDir);
    const tracked = status.isRepo && await deps.hasHead(siteDir);
    const dirty = tracked ? await deps.changedSinceHead(siteDir, PACKAGE_FILES) : [];
    // Already in the requested state, and committed: nothing to do. An uncommitted
    // change to the package files falls through to the dirty guard below.
    if (stateOf().enabled === enabled && dirty.length === 0) return null;

    if (!enabled) {
      const posts = postsUsing(db, entry.elements.map((el) => el.tag));
      if (posts.length > 0) {
        throw new ComponentError(409, {
          error: `${pkg} is used in ${posts.length === 1 ? 'a post' : `${posts.length} posts`}. Remove it from them, then turn it off.`,
          posts,
        });
      }
    }

    if (dirty.length > 0) throw new ComponentError(409, { error: DIRTY_MESSAGE, files: dirty });

    const snapshot = PACKAGE_FILES.map((f) => {
      const file = join(siteDir, f);
      return { file, bytes: existsSync(file) ? readFileSync(file) : null };
    });
    const restore = () => {
      for (const { file, bytes } of snapshot) {
        if (bytes === null) rmSync(file, { force: true });
        else writeFileSync(file, bytes);
      }
    };

    const range = vpRange(deps.vpRoot, pkg);
    const args = enabled ? ['install', range ? `${pkg}@${range}` : pkg, '--save'] : ['uninstall', pkg];
    let result;
    try {
      result = await deps.runNpm(siteDir, args, {}, { timeoutMs: NPM_TIMEOUT_MS });
    } catch (err) {
      result = { ok: false, log: err.message };
    }
    if (!result?.ok) {
      restore();
      const error = result?.timedOut
        ? `npm ${args[0]} ${pkg} took too long (over ${durationText(NPM_TIMEOUT_MS)}) and was stopped`
        : `npm ${args[0]} ${pkg} failed`;
      throw new ComponentError(502, { error, log: tail(result?.log) });
    }

    if (!status.isRepo) return null;
    try {
      return await deps.commitPaths(siteDir, PACKAGE_FILES, `Components: turn ${enabled ? 'on' : 'off'} ${pkg} [CI Skip]`);
    } catch (err) {
      // Undo npm's edit so the files match HEAD again (a later toggle then works),
      // then let npm bring node_modules back in line with them (best effort).
      restore();
      try {
        await deps.runNpm(siteDir, ['install'], {}, { timeoutMs: NPM_TIMEOUT_MS });
      } catch { /* node_modules may keep the package; package.json decides what is on */ }
      restore();
      throw new ComponentError(502, {
        error: `Couldn't commit turning ${enabled ? 'on' : 'off'} ${pkg}, so the change was undone. `
          + `Git said: ${String(err?.message || err).trim()} `
          + 'Another program may be using the site\'s git repository. Close other git tools and try again.',
      });
    }
  };

  const sha = await deps.backup.commitOther(() => deps.writes(change));
  if (sha) await deps.backup.flush();
  return stateOf();
}
