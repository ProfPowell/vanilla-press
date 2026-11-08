import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mediaFileOf, mediaRefs, mediaUsage, liveMediaRefs, mediaSrc } from '../../src/media/usage.js';

const p = (...children) => ({ type: 'paragraph', children });

test('mediaRefs finds figure, embed, component src and poster, and meta.image', () => {
  const doc = {
    meta: { image: '/media/hero-aaaaaa.jpg' },
    blocks: [
      { type: 'figure', attrs: { src: '/media/fig-bbbbbb.png' } },
      { type: 'embed', attrs: { type: 'audio', url: '/media/song-cccccc.mp3' } },
      { type: 'component', attrs: { tag: 'video-player', src: '/media/clip-dddddd.mp4', poster: '/media/poster-eeeeee.jpg' } },
      { type: 'callout', attrs: { variant: 'note' }, children: [
        p({ type: 'component', attrs: { src: '/media/inline-ffffff.png' } }),
      ] },
    ],
  };
  assert.deepEqual([...mediaRefs(doc)].sort(), [
    'clip-dddddd.mp4', 'fig-bbbbbb.png', 'hero-aaaaaa.jpg', 'inline-ffffff.png', 'poster-eeeeee.jpg', 'song-cccccc.mp3',
  ]);
});

test('mediaRefs counts a link to a media file', () => {
  const doc = { meta: {}, blocks: [p({ type: 'link', attrs: { href: '/media/report-1a2b3c.pdf' }, children: [{ type: 'text', value: 'Report' }] })] };
  assert.deepEqual([...mediaRefs(doc)], ['report-1a2b3c.pdf']);
});

test('mediaRefs ignores external and nested urls', () => {
  const doc = {
    meta: { image: 'https://example.com/media/a.jpg' },
    blocks: [
      { type: 'figure', attrs: { src: '/media/a/b.jpg' } },
      { type: 'figure', attrs: { src: 'https://example.com/media/x.jpg' } },
      { type: 'figure', attrs: { src: '/media/' } },
    ],
  };
  assert.equal(mediaRefs(doc).size, 0);
});

test('mediaFileOf decodes percent-encoding and ignores query and hash', () => {
  assert.equal(mediaFileOf('/media/caf%C3%A9-1a2b3c.jpg'), 'café-1a2b3c.jpg');
  assert.equal(mediaFileOf('/media/a.jpg?v=2#top'), 'a.jpg');
  assert.equal(mediaFileOf('/media/%E0%A4%A'), null);
  assert.equal(mediaFileOf(null), null);
});

test('mediaUsage maps files to posts with status', () => {
  const docs = [
    { id: 'd1', meta: { title: 'One', status: 'published' }, blocks: [{ type: 'figure', attrs: { src: '/media/a.jpg' } }] },
    { id: 'd2', meta: { title: 'Two', status: 'draft', image: '/media/a.jpg' }, blocks: [] },
  ];
  const usage = mediaUsage(docs);
  assert.deepEqual(usage.get('a.jpg'), [
    { id: 'd1', title: 'One', status: 'published' },
    { id: 'd2', title: 'Two', status: 'draft' },
  ]);
  assert.equal(usage.get('b.jpg'), undefined);
});

test('mediaRefs counts a card href to a media file', () => {
  const doc = { meta: {}, blocks: [{ type: 'card', attrs: { href: '/media/brochure-1a2b3c.pdf' }, children: [p({ type: 'text', value: 'x' })] }] };
  assert.deepEqual([...mediaRefs(doc)], ['brochure-1a2b3c.pdf']);
});

test('mediaSrc encodes the filename and mediaFileOf round-trips it', () => {
  assert.equal(mediaSrc('garden-3f9a2c.jpg'), '/media/garden-3f9a2c.jpg');
  for (const name of ['a#1.jpg', '100%.jpg', 'a?b.png', 'sp ace.jpg', 'garden-3f9a2c.jpg']) {
    assert.equal(mediaFileOf(mediaSrc(name)), name, name);
  }
  assert.equal(mediaSrc('a#1.jpg'), '/media/a%231.jpg');
});

test('liveMediaRefs finds /media/ files in src, href, poster, content and srcset', () => {
  const html = `---
title: "Hi"
image: "/media/hero-aaaaaa.jpg"
vp_id: "doc_1"
---
<img src="/media/fig-bbbbbb.png" alt="x">
<a href='/media/report.pdf?dl=1#p2'>r</a>
<video poster=/media/poster.jpg src="/media/clip.mp4"></video>
<meta property="og:image" content="/media/og.jpg">
<img srcset="/media/s-1x.jpg 1x, /media/s-2x.jpg 2x" src="https://cdn.example.com/media/ext.jpg">
<img data-src="/media/lazy-only.jpg">
<a href="/media/a%231.jpg">enc</a>
<a href="/media/q.jpg?a=1&amp;b=2">amp</a>
<p>/media/in-text.jpg</p>
<a href="/media/sub/dir.jpg">nested</a>`;
  assert.deepEqual([...liveMediaRefs(html)].sort(), [
    'a#1.jpg', 'clip.mp4', 'fig-bbbbbb.png', 'hero-aaaaaa.jpg', 'og.jpg', 'poster.jpg', 'q.jpg', 'report.pdf', 's-1x.jpg', 's-2x.jpg',
  ]);
});

test('liveMediaRefs on text with no refs, or not a string, is empty', () => {
  assert.equal(liveMediaRefs('<h1>Home</h1>').size, 0);
  assert.equal(liveMediaRefs(null).size, 0);
});
