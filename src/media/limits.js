// Upload limits and messages. Browser-safe.
import { ACCEPTED } from './types.js';

export const MAX_BYTES = 26_214_400; // 25 MiB, Cloudflare Pages' per-file limit
export const LARGE_BYTES = 5_242_880; // 5 MiB

export function formatBytes(n) {
  if (n < 1024) return `${n} bytes`;
  if (n < 1048576) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

export const ACCEPT_ATTR = ACCEPTED.flatMap((t) => t.exts.map((e) => `.${e}`)).join(',');

export function tooLargeMessage(name, size) {
  return `${name} is ${formatBytes(size)}. Files over 25 MB can't be published (Cloudflare Pages won't serve them). Make it smaller and try again.`;
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
