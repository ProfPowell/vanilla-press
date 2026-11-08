// Media types Vanilla Press accepts. Browser-safe: no node: imports.
// The first extension of each entry is the canonical one.
export const ACCEPTED = [
  { mime: 'image/jpeg', kind: 'image', label: 'JPEG image', exts: ['jpg', 'jpeg'] },
  { mime: 'image/png', kind: 'image', label: 'PNG image', exts: ['png'] },
  { mime: 'image/webp', kind: 'image', label: 'WebP image', exts: ['webp'] },
  { mime: 'image/avif', kind: 'image', label: 'AVIF image', exts: ['avif'] },
  { mime: 'image/gif', kind: 'image', label: 'GIF image', exts: ['gif'] },
  { mime: 'image/svg+xml', kind: 'image', label: 'SVG image', exts: ['svg'] },
  { mime: 'video/mp4', kind: 'video', label: 'MP4 video', exts: ['mp4', 'm4v'] },
  { mime: 'video/webm', kind: 'video', label: 'WebM video', exts: ['webm'] },
  { mime: 'audio/mpeg', kind: 'audio', label: 'MP3 audio', exts: ['mp3'] },
  { mime: 'audio/mp4', kind: 'audio', label: 'M4A audio', exts: ['m4a'] },
  { mime: 'audio/aac', kind: 'audio', label: 'AAC audio', exts: ['aac'] },
  { mime: 'audio/ogg', kind: 'audio', label: 'Ogg audio', exts: ['ogg', 'oga', 'opus'] },
  { mime: 'audio/wav', kind: 'audio', label: 'WAV audio', exts: ['wav'] },
  { mime: 'application/pdf', kind: 'pdf', label: 'PDF document', exts: ['pdf'] },
];

export function typeOf(mime) {
  return ACCEPTED.find((t) => t.mime === mime) || null;
}

export function kindOf(mime) {
  return typeOf(mime)?.kind ?? null;
}

export function typeLabel(mime) {
  return typeOf(mime)?.label ?? 'File';
}

// Raster formats the editor can re-encode.
export const EDITABLE = ['image/jpeg', 'image/png', 'image/webp'];

export function canEditImage(mime) {
  return EDITABLE.includes(mime);
}

export function exportFormat(mime) {
  return canEditImage(mime) ? mime.slice('image/'.length) : null;
}
