// Alt text of library images, by the URL a document uses.

import { mediaFileOf, linkedKey } from './usage.js';

/**
 * A lookup from an image URL (`/media/<file>` or a linked Unsplash URL) to the
 * alt text of its library row; null when there is no row or the alt is empty.
 * @param {import('better-sqlite3').Database} db
 * @returns {(src: unknown) => string|null}
 */
export function mediaAltLookup(db) {
  const byFile = db.prepare('SELECT alt FROM media WHERE filename = ?');
  const linked = db.prepare('SELECT url, alt FROM media WHERE url IS NOT NULL');
  return (src) => {
    let alt;
    const file = mediaFileOf(src);
    if (file) {
      alt = byFile.get(file)?.alt;
    } else {
      const key = linkedKey(src);
      if (key) alt = linked.all().find((r) => linkedKey(r.url) === key)?.alt;
    }
    return typeof alt === 'string' && alt.trim() !== '' ? alt : null;
  };
}
