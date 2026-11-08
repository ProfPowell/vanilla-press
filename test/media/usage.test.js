import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mediaFileOf, mediaRefs, mediaUsage } from '../../src/media/usage.js';

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
