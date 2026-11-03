/**
 * Combines the catalog's editor hints with each package's custom-elements
 * manifest, per site, into descriptors the editor and validator consume.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CATALOG } from './catalog.js';
import { readManifest } from './manifest.js';

/** @typedef {import('./catalog.js').ElementHint} ElementHint */
/** @typedef {import('./manifest.js').AttrDef} AttrDef */
/**
 * `scriptPath` is the package's entry inside the package (e.g.
 * 'dist/browser-window.js'); null when bundled or not installed.
 * `loadsOnLiveSite`/`liveSiteNote`: as on its PackageState.
 * @typedef {ElementHint & { package: string, attributes: AttrDef[], bundled: boolean,
 *   scriptPath: string|null, loadsOnLiveSite: boolean, liveSiteNote: string|null }} ComponentDescriptor
 */
/**
 * `loadsOnLiveSite` is false for a non-bundled package whose installed copy has no
 * custom-elements.json: Cook's package-components (2.5.0) only loads packages with a
 * manifest (Ruling R14). `liveSiteNote` then says why, else it is null.
 * @typedef {{ package: string, bundled: boolean, enabled: boolean, siteVersion: string|null,
 *   vpVersion: string|null, source: 'site'|'vp'|null, loadsOnLiveSite: boolean,
 *   liveSiteNote: string|null, elements: ComponentDescriptor[] }} PackageState
 */

/** Why a package without a manifest won't load on the live site (R14). */
export const noManifestNote = (pkg) =>
  `Won't load on the live site until ${pkg} ships custom-elements.json in its npm package`;

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function installedAt(root, pkg) {
  if (!root) return null;
  const dir = join(root, 'node_modules', pkg);
  return existsSync(join(dir, 'package.json')) ? dir : null;
}

/**
 * Where a package is installed: the site's copy first, else VP's.
 * @param {string} pkg
 * @param {{ siteDir: string|null, vpRoot: string }} roots
 * @returns {{ dir: string, source: 'site'|'vp' } | null}
 */
export function packageDir(pkg, { siteDir, vpRoot }) {
  const site = installedAt(siteDir, pkg);
  if (site) return { dir: site, source: 'site' };
  const vp = installedAt(vpRoot, pkg);
  if (vp) return { dir: vp, source: 'vp' };
  return null;
}

/**
 * Entry path inside a package, in the order Cook resolves it: exports['.'].import,
 * .default, exports['.'] as a string, then module, then main. Leading './' stripped.
 * @param {object} pkgJson
 * @returns {string|null}
 */
function entryPath(pkgJson) {
  const dot = pkgJson.exports?.['.'];
  const candidates = [
    dot && typeof dot === 'object' ? dot.import : undefined,
    dot && typeof dot === 'object' ? dot.default : undefined,
    typeof dot === 'string' ? dot : undefined,
    pkgJson.module,
    pkgJson.main,
  ];
  const hit = candidates.find((c) => typeof c === 'string' && c);
  return hit ? hit.replace(/^\.\//, '') : null;
}

/**
 * Describe every catalog package for a site.
 * @param {object} opts
 * @param {string|null} opts.siteDir  null in fixture mode: every package counts as enabled
 * @param {string} opts.vpRoot
 * @param {import('./catalog.js').CatalogEntry[]} [opts.catalog]  defaults to the real catalog
 * @returns {PackageState[]}
 */
export function describeComponents({ siteDir, vpRoot, catalog = CATALOG }) {
  const siteDeps = siteDir ? readJson(join(siteDir, 'package.json'))?.dependencies ?? {} : null;
  return catalog.map((entry) => {
    const bundled = Boolean(entry.bundled);
    const enabled = bundled || siteDeps === null || Object.hasOwn(siteDeps, entry.package);
    const siteInstall = installedAt(siteDir, entry.package);
    const vpInstall = installedAt(vpRoot, entry.package);
    const found = siteInstall ? { dir: siteInstall, source: 'site' } : vpInstall ? { dir: vpInstall, source: 'vp' } : null;
    const manifest = found ? readManifest(found.dir) : new Map();
    const pkgJson = found ? readJson(join(found.dir, 'package.json')) : null;
    const scriptPath = !bundled && pkgJson ? entryPath(pkgJson) : null;
    const loadsOnLiveSite = bundled || !found || manifest.size > 0;
    const liveSiteNote = loadsOnLiveSite ? null : noManifestNote(entry.package);
    return {
      package: entry.package,
      bundled,
      enabled,
      siteVersion: siteInstall ? readJson(join(siteInstall, 'package.json'))?.version ?? null : null,
      vpVersion: vpInstall ? readJson(join(vpInstall, 'package.json'))?.version ?? null : null,
      source: found ? found.source : null,
      loadsOnLiveSite,
      liveSiteNote,
      elements: entry.elements.map((el) => ({
        ...el,
        package: entry.package,
        bundled,
        // The manifest wins; a catalog hint stands in when it declares nothing (R13)
        attributes: manifest.get(el.tag)?.attributes?.length ? manifest.get(el.tag).attributes : (el.attributes ?? []),
        scriptPath,
        loadsOnLiveSite,
        liveSiteNote,
      })),
    };
  });
}

/**
 * Tag lookup across packages.
 * @param {PackageState[]} states
 * @param {{ enabledOnly?: boolean }} [opts]
 * @returns {Map<string, ComponentDescriptor>}
 */
export function componentIndex(states, { enabledOnly = true } = {}) {
  const index = new Map();
  for (const s of states) {
    if (enabledOnly && !s.enabled) continue;
    for (const el of s.elements) index.set(el.tag, el);
  }
  return index;
}
