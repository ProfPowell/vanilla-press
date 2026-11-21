/**
 * The site's sections and the access level each one sets, from `config/sections.json`
 * (an array of `{ id, label?, access? }`). A missing or broken file means no sections.
 *
 * @module sync/section-access
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { higherAccess } from '../access/levels.js';

/**
 * The sections a site defines.
 * @param {string|null} siteDir
 * @returns {Array<{ id: string, label: string, access: string|null }>}
 */
export function readSections(siteDir) {
  if (!siteDir) return [];
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(join(siteDir, 'config', 'sections.json'), 'utf8'));
  } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((s) => s && typeof s === 'object' && typeof s.id === 'string' && s.id)
    .map((s) => ({
      id: s.id,
      label: typeof s.label === 'string' && s.label ? s.label : s.id,
      // Absent or null: no level. Present but empty or not text: private (fail closed).
      access: s.access == null ? null : typeof s.access === 'string' && s.access ? s.access : 'private',
    }));
}

/**
 * The access level a section sets, or null (no file, unknown section, or no level).
 * An unrecognised level is returned as written: callers treat it as private; an
 * empty or non-text one is returned as `private`.
 * @param {string|null} siteDir
 * @param {string|null|undefined} sectionId
 * @returns {string|null}
 */
export function sectionAccess(siteDir, sectionId) {
  if (!sectionId) return null;
  return readSections(siteDir).find((s) => s.id === sectionId)?.access ?? null;
}

/**
 * A document's effective level: the higher of its own `access` and its
 * section's (an unrecognised level of either counts as private).
 * @param {string|null} siteDir
 * @param {{ access?: string, section?: string }|null|undefined} meta
 * @returns {'public'|'friends'|'private'}
 */
export function documentAccess(siteDir, meta) {
  return higherAccess(meta?.access, sectionAccess(siteDir, meta?.section));
}
