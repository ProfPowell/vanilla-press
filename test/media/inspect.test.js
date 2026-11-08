import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sniffType, imageSize, inspectFile } from '../../src/media/inspect.js';
import { ACCEPTED } from '../../src/media/types.js';

const ascii = (s) => [...s].map((c) => c.charCodeAt(0));
const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le16 = (n) => [n & 255, (n >> 8) & 255];
const le32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
const flat = (p) => (Array.isArray(p) || ArrayBuffer.isView(p) ? [...p].flatMap(flat) : [p]);
const u8 = (...parts) => Uint8Array.from(parts.flatMap(flat));

function ftyp(major, compat = []) {
  const brands = [major, ...compat];
  return u8(be32(16 + compat.length * 4), ascii('ftyp'), ascii(major.padEnd(4)), be32(0), compat.map((b) => ascii(b.padEnd(4))));
}
const png = (w, h) => u8([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], be32(13), ascii('IHDR'), be32(w), be32(h), [8, 6, 0, 0, 0]);
const gif = (w, h) => u8(ascii('GIF89a'), le16(w), le16(h), [0, 0, 0]);
const jpeg = (w, h) => u8([0xff, 0xd8], [0xff, 0xe0, 0, 4, 0, 0], [0xff, 0xc0, 0, 11, 8], [h >> 8, h & 255, w >> 8, w & 255], [1, 1, 0x11, 0]);
const riff = (form, rest) => u8(ascii('RIFF'), le32(4 + rest.length), ascii(form), rest);
const webpX = (w, h) => riff('WEBP', u8(ascii('VP8X'), le32(10), [0, 0, 0, 0], le32(w - 1).slice(0, 3), le32(h - 1).slice(0, 3)));
const avif = (w, h) => u8(ftyp('avif', ['mif1']), be32(20), ascii('ispe'), be32(0), be32(w), be32(h));

const headers = {
  'image/jpeg': u8([0xff, 0xd8, 0xff, 0xe0, 0, 0]),
  'image/png': png(1, 1),
  'image/webp': webpX(1, 1),
  'image/avif': avif(1, 1),
  'image/gif': gif(1, 1),
  'image/svg+xml': new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'),
  'video/mp4': ftyp('mp42'),
  'video/webm': u8([0x1a, 0x45, 0xdf, 0xa3, 0, 0]),
  'audio/mpeg': u8(ascii('ID3'), [4, 0, 0, 0, 0, 0, 0]),
  'audio/mp4': ftyp('M4A '),
  'audio/aac': u8([0xff, 0xf1, 0x50, 0x80]),
  'audio/ogg': u8(ascii('OggS'), [0, 2]),
  'audio/wav': riff('WAVE', u8(ascii('fmt '))),
  'application/pdf': u8(ascii('%PDF-1.4\n')),
};

test('sniffType recognises every accepted type', () => {
  for (const t of ACCEPTED) {
    assert.equal(sniffType(headers[t.mime], `x.${t.exts[0]}`)?.mime, t.mime, t.mime);
  }
});

test('sniffType: MP3 frame sync, ADTS, and generic isom by extension', () => {
  assert.equal(sniffType(u8([0xff, 0xfb, 0x90, 0x00]), 'a.mp3').mime, 'audio/mpeg');
  assert.equal(sniffType(u8([0xff, 0xf9, 0x50, 0x80]), 'a.aac').mime, 'audio/aac');
  assert.equal(sniffType(ftyp('isom'), 'song.m4a').mime, 'audio/mp4');
  assert.equal(sniffType(ftyp('isom'), 'clip.mp4').mime, 'video/mp4');
  assert.equal(sniffType(ftyp('mp42', ['avis']), 'a.avif').mime, 'image/avif');
});

test('sniffType: MP3 frame sync rejects the reserved version bits', () => {
  assert.equal(sniffType(u8([0xff, 0xfb, 0x90, 0x00]), 'a.mp3').mime, 'audio/mpeg'); // MPEG-1 layer III
  assert.equal(sniffType(u8([0xff, 0xf3, 0x90, 0x00]), 'a.mp3').mime, 'audio/mpeg'); // MPEG-2 layer III
  assert.equal(sniffType(u8([0xff, 0xeb, 0x90, 0x00]), 'a.mp3'), null); // version 01 is reserved
});

test('sniffType: SVG after BOM, declaration, comments and doctype', () => {
  const svg = '﻿<?xml version="1.0"?>\n<!-- hi -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd">\n<svg width="1"/>';
  assert.equal(sniffType(new TextEncoder().encode(svg), 'a.svg').mime, 'image/svg+xml');
  assert.equal(sniffType(new TextEncoder().encode('<html><svg/></html>'), 'a.svg'), null);
});

test('HEIC is refused by content', () => {
  assert.equal(sniffType(ftyp('heic', ['mif1']), 'x.heic'), null);
  assert.equal(sniffType(new TextEncoder().encode('just some text'), 'photo.jpg'), null);
  assert.equal(sniffType(new Uint8Array(0), 'a.png'), null);
});

test('imageSize reads PNG, GIF, JPEG, WebP, AVIF and SVG', () => {
  assert.deepEqual(imageSize(png(3, 2), 'image/png'), { width: 3, height: 2 });
  assert.deepEqual(imageSize(gif(5, 4), 'image/gif'), { width: 5, height: 4 });
  assert.deepEqual(imageSize(jpeg(7, 9), 'image/jpeg'), { width: 7, height: 9 });
  assert.deepEqual(imageSize(webpX(640, 480), 'image/webp'), { width: 640, height: 480 });
  assert.deepEqual(imageSize(avif(1200, 800), 'image/avif'), { width: 1200, height: 800 });
  const svg = (s) => imageSize(new TextEncoder().encode(s), 'image/svg+xml');
  assert.deepEqual(svg('<svg width="120" height="80px"/>'), { width: 120, height: 80 });
  assert.deepEqual(svg('<svg viewBox="0 0 300 150"/>'), { width: 300, height: 150 });
  assert.deepEqual(svg('<svg stroke-width="9" viewBox="0 0 300 150"/>'), { width: 300, height: 150 });
  assert.equal(svg('<svg width="50%" height="50%"/>'), null);
});

test('imageSize reads WebP VP8 and VP8L', () => {
  const vp8 = riff('WEBP', u8(ascii('VP8 '), le32(10), [0, 0, 0], [0x9d, 0x01, 0x2a], le16(33), le16(22)));
  assert.deepEqual(imageSize(vp8, 'image/webp'), { width: 33, height: 22 });
  const w = 40 - 1, h = 30 - 1;
  const bits = [w & 255, ((w >> 8) & 0x3f) | ((h & 3) << 6), (h >> 2) & 255, (h >> 10) & 15];
  const vp8l = riff('WEBP', u8(ascii('VP8L'), le32(5), [0x2f], bits));
  assert.deepEqual(imageSize(vp8l, 'image/webp'), { width: 40, height: 30 });
});

test('imageSize: AVIF reads the real ispe boxes and ignores look-alikes in other data', () => {
  const box = (type, ...payload) => { const body = u8(payload); return u8(be32(8 + body.length), ascii(type), body); };
  const ispe = (w, h) => box('ispe', be32(0), be32(w), be32(h));
  const real = u8(ftyp('avif', ['mif1']), box('meta', be32(0), box('iprp', box('ipco', ispe(1200, 800), ispe(120, 80)))));
  const decoy = u8(box('mdat', ascii('ispe'), be32(0), be32(9000), be32(9000)));
  assert.deepEqual(imageSize(u8(real, decoy), 'image/avif'), { width: 1200, height: 800 });
  assert.equal(imageSize(u8(ftyp('avif'), decoy), 'image/avif'), null);
  // a box claiming a huge size ends the walk instead of looping
  assert.equal(imageSize(u8(ftyp('avif'), be32(0xffffffff), ascii('free')), 'image/avif'), null);
});

test('imageSize returns null for truncated, unknown or mismatched input', () => {
  assert.equal(imageSize(png(3, 2).slice(0, 20), 'image/png'), null);
  assert.equal(imageSize(jpeg(7, 9).slice(0, 8), 'image/jpeg'), null);
  assert.equal(imageSize(new Uint8Array(4), 'image/webp'), null);
  assert.equal(imageSize(new Uint8Array(4), 'image/avif'), null);
  assert.equal(imageSize(png(3, 2), 'video/mp4'), null);
});

test('inspectFile combines type, stored extension and size', () => {
  assert.deepEqual(inspectFile(png(3, 2), 'Pic.JPG'), { mime: 'image/png', kind: 'image', ext: 'png', width: 3, height: 2 });
  assert.deepEqual(inspectFile(headers['application/pdf'], 'a.pdf'), { mime: 'application/pdf', kind: 'pdf', ext: 'pdf', width: null, height: null });
  assert.equal(inspectFile(new TextEncoder().encode('text'), 'a.jpg'), null);
});
