// Readable media file names. Browser-safe (uses globalThis.crypto).

const EXT_RE = /\.[A-Za-z0-9]{1,5}$/;

export function slugBase(name) {
  const base = String(name)
    .replace(EXT_RE, '')
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
  const base = sourceFilename
    .replace(EXT_RE, '')
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
