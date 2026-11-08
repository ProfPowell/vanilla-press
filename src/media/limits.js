// Upload limits and messages. Browser-safe.
import { ACCEPTED } from './types.js';

export const MAX_BYTES = 26_214_400; // 25 MiB, Cloudflare Pages' per-file limit
export const LARGE_BYTES = 5_242_880; // 5 MiB

export function formatBytes(n) {
  if (n < 1024) return `${n} bytes`;
  if (Math.round(n / 1024) < 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

export const ACCEPT_ATTR = ACCEPTED.flatMap((t) => t.exts.map((e) => `.${e}`)).join(',');

export function tooLargeMessage(name, size) {
  // Just over the limit "25.0 MB" would read as under it: show more digits.
  const shown = size > MAX_BYTES && formatBytes(size) === '25.0 MB' ? `${(size / 1048576).toFixed(3)} MB` : formatBytes(size);
  return `${name} is too large (${shown}); the limit is 25 MB. Cloudflare Pages won't serve larger files. Make it smaller and try again.`;
}

export function unsupportedMessage(name) {
  return `${name} isn't a file type Vanilla Press accepts. Use JPEG, PNG, WebP, AVIF, GIF, SVG, MP4, WebM, MP3, M4A, AAC, Ogg, WAV or PDF.`;
}

export const LARGE_NOTE = 'Large file: everything is committed to git, so the repository grows by its size.';

// Quick client-side check by name and size. The server's content check stays authoritative.
export function checkBeforeUpload({ name, size }) {
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
  if (!ACCEPTED.some((t) => t.exts.includes(ext))) return { ok: false, error: unsupportedMessage(name) };
  if (size > MAX_BYTES) return { ok: false, error: tooLargeMessage(name, size) };
  return { ok: true, large: size > LARGE_BYTES };
}
