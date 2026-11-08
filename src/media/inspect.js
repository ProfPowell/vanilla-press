// Content-based file type detection and image dimensions. Browser-safe.
import { typeOf } from './types.js';
import { storedExt } from './names.js';

const ascii = (b, at, len) => String.fromCharCode(...b.subarray(at, at + len));
const be32 = (b, at) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
const le16 = (b, at) => b[at] | (b[at + 1] << 8);
const extOf = (name) => (name.lastIndexOf('.') >= 0 ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '');
const startsWith = (b, sig) => b.length >= sig.length && sig.every((v, i) => b[i] === v);

const NOT_SUPPORTED_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1']);

function ftypBrands(b) {
  const size = Math.min(be32(b, 0) || b.length, b.length);
  const brands = [ascii(b, 8, 4)];
  for (let at = 16; at + 4 <= size; at += 4) brands.push(ascii(b, at, 4));
  return brands;
}

function looksLikeSvg(b) {
  let s = new TextDecoder('utf-8').decode(b.subarray(0, 4096)).replace(/^﻿/, '');
  for (;;) {
    s = s.replace(/^\s+/, '');
    if (s.startsWith('<?')) { const i = s.indexOf('?>'); if (i < 0) return false; s = s.slice(i + 2); }
    else if (s.startsWith('<!--')) { const i = s.indexOf('-->'); if (i < 0) return false; s = s.slice(i + 3); }
    else if (/^<!doctype/i.test(s)) {
      const m = /^<!doctype[^[>]*(\[[\s\S]*?\])?\s*>/i.exec(s);
      if (!m) return false;
      s = s.slice(m[0].length);
    } else break;
  }
  return /^<svg[\s>/]/.test(s);
}

export function sniffType(bytes, filename = '') {
  const b = bytes;
  const ext = extOf(filename);
  const found = (mime) => typeOf(mime);
  if (startsWith(b, [0xff, 0xd8, 0xff])) return found('image/jpeg');
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return found('image/png');
  if (b.length >= 6 && (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a')) return found('image/gif');
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF') {
    const form = ascii(b, 8, 4);
    if (form === 'WEBP') return found('image/webp');
    if (form === 'WAVE') return found('audio/wav');
    return null;
  }
  if (b.length >= 5 && ascii(b, 0, 5) === '%PDF-') return found('application/pdf');
  if (b.length >= 4 && ascii(b, 0, 4) === 'OggS') return found('audio/ogg');
  if (startsWith(b, [0x1a, 0x45, 0xdf, 0xa3])) return found('video/webm');
  if (b.length >= 3 && ascii(b, 0, 3) === 'ID3') return found('audio/mpeg');
  if (b.length >= 2 && b[0] === 0xff && (b[1] & 0xf6) === 0xf0) return found('audio/aac');
  if (b.length >= 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && ((b[1] >> 1) & 3) !== 0) return found('audio/mpeg');
  if (b.length >= 12 && ascii(b, 4, 4) === 'ftyp') {
    const brands = ftypBrands(b);
    if (brands.some((x) => x === 'avif' || x === 'avis')) return found('image/avif');
    if (brands[0] === 'M4A ' || brands[0] === 'M4B ') return found('audio/mp4');
    if (NOT_SUPPORTED_BRANDS.has(brands[0].toLowerCase())) return null;
    if (ext === 'm4a' || ext === 'aac') return found('audio/mp4');
    return found('video/mp4');
  }
  if (looksLikeSvg(b)) return found('image/svg+xml');
  return null;
}

function pngSize(b) {
  if (b.length < 24 || ascii(b, 12, 4) !== 'IHDR') return null;
  return { width: be32(b, 16), height: be32(b, 20) };
}

function gifSize(b) {
  if (b.length < 10) return null;
  return { width: le16(b, 6), height: le16(b, 8) };
}

function jpegSize(b) {
  let at = 2;
  while (at + 4 <= b.length) {
    if (b[at] !== 0xff) { at++; continue; }
    const marker = b[at + 1];
    if (marker === 0xff) { at++; continue; }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { at += 2; continue; }
    const len = (b[at + 2] << 8) | b[at + 3];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (at + 9 > b.length) return null;
      return { height: (b[at + 5] << 8) | b[at + 6], width: (b[at + 7] << 8) | b[at + 8] };
    }
    at += 2 + len;
  }
  return null;
}

function webpSize(b) {
  if (b.length < 25 || ascii(b, 8, 4) !== 'WEBP') return null;
  const chunk = ascii(b, 12, 4);
  if (chunk === 'VP8 ') {
    if (b.length < 30) return null;
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    if (b[20] !== 0x2f) return null;
    return {
      width: 1 + (b[21] | ((b[22] & 0x3f) << 8)),
      height: 1 + ((b[22] >> 6) | (b[23] << 2) | ((b[24] & 0x0f) << 10)),
    };
  }
  if (chunk === 'VP8X') {
    if (b.length < 30) return null;
    return {
      width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)),
      height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)),
    };
  }
  return null;
}

function avifSize(b) {
  let best = null;
  for (let at = 0; at + 16 <= b.length; at++) {
    if (b[at] === 0x69 && ascii(b, at, 4) === 'ispe') {
      const width = be32(b, at + 8);
      const height = be32(b, at + 12);
      if (width > 0 && height > 0 && (!best || width * height > best.width * best.height)) best = { width, height };
    }
  }
  return best;
}

function svgSize(b) {
  const text = new TextDecoder('utf-8').decode(b.subarray(0, 8192));
  const tag = /<svg\b([^>]*)>/.exec(text);
  if (!tag) return null;
  const attr = (name) => {
    const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(tag[1]);
    return m ? (m[1] ?? m[2]) : null;
  };
  const px = (v) => {
    const m = v === null ? null : /^\s*(\d+(?:\.\d+)?)\s*(?:px)?\s*$/.exec(v);
    return m ? Math.round(Number(m[1])) : null;
  };
  const width = px(attr('width'));
  const height = px(attr('height'));
  if (width > 0 && height > 0) return { width, height };
  const vb = attr('viewBox');
  const nums = vb ? vb.trim().split(/[\s,]+/).map(Number) : [];
  if (nums.length === 4 && nums.every(Number.isFinite) && nums[2] > 0 && nums[3] > 0) {
    return { width: Math.round(nums[2]), height: Math.round(nums[3]) };
  }
  return null;
}

const SIZERS = {
  'image/png': pngSize,
  'image/gif': gifSize,
  'image/jpeg': jpegSize,
  'image/webp': webpSize,
  'image/avif': avifSize,
  'image/svg+xml': svgSize,
};

export function imageSize(bytes, mime) {
  try {
    const size = SIZERS[mime]?.(bytes) ?? null;
    return size && size.width > 0 && size.height > 0 ? size : null;
  } catch {
    return null;
  }
}

export function inspectFile(bytes, filename) {
  const entry = sniffType(bytes, filename);
  if (!entry) return null;
  const size = entry.kind === 'image' ? imageSize(bytes, entry.mime) : null;
  return {
    mime: entry.mime,
    kind: entry.kind,
    ext: storedExt(filename, entry),
    width: size ? size.width : null,
    height: size ? size.height : null,
  };
}
