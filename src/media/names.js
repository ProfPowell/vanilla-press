// Readable media file names. Browser-safe (uses globalThis.crypto).
import { ACCEPTED } from './types.js';

const KNOWN_EXTS = new Set(ACCEPTED.flatMap((t) => t.exts));

// Only a real (accepted) extension is dropped: "Notes v1.2" keeps its "2".
function withoutExt(name) {
  const dot = name.lastIndexOf('.');
  return dot >= 0 && KNOWN_EXTS.has(name.slice(dot + 1).toLowerCase()) ? name.slice(0, dot) : name;
}

export function slugBase(name) {
  const base = withoutExt(String(name))
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return base || 'file';
}

export function shortId() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(3));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// The original's extension (lowercased) when it belongs to the sniffed type,
// else the type's canonical one.
export function storedExt(name, entry) {
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
  return entry.exts.includes(ext) ? ext : entry.exts[0];
}

export function mediaFilename(originalName, ext, id) {
  return `${slugBase(originalName)}-${id}.${ext}`;
}

export function editedFilename(sourceFilename, ext, id) {
  const base = withoutExt(sourceFilename)
    .replace(/-[0-9a-f]{6}$/, '')
    .replace(/-edited$/, '');
  return `${base}-edited-${id}.${ext}`;
}

export function uniqueFilename(make, taken, tries = 20) {
  for (let i = 0; i < tries; i++) {
    const name = make(shortId());
    if (!taken(name)) return name;
  }
  throw new Error('Could not find a free file name');
}
