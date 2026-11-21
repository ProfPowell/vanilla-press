// Access levels in rank order (public < friends < private). Pure and browser-safe.

import { validAccess } from '../schema/content-schema.js';

/**
 * A level's rank: absent (null/undefined) is public; anything that is not a
 * level (an empty string included) is private (fail closed).
 * @param {unknown} level
 * @returns {number}
 */
export function accessRank(level) {
  if (level == null) return 0;
  const i = validAccess.indexOf(level);
  return i < 0 ? validAccess.length - 1 : i;
}

/**
 * The highest of the given levels, as a level name (none or all absent: public).
 * @param {...unknown} levels
 * @returns {string}
 */
export function higherAccess(...levels) {
  return validAccess[Math.max(0, ...levels.map(accessRank))];
}
