import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOpml } from '../../src/social/opml.js';
import { SocialError } from '../../src/social/config.js';

const wrap = (body) => `<?xml version="1.0" encoding="UTF-8"?><opml version="2.0"><head><title>x</title></head><body>${body}</body></opml>`;

test('flat outlines: title, feedUrl, siteUrl', () => {
  const r = parseOpml(wrap('<outline type="rss" text="A" xmlUrl="https://a.example/feed" htmlUrl="https://a.example/"/>'));
  assert.deepEqual(r, { entries: [{ title: 'A', feedUrl: 'https://a.example/feed', siteUrl: 'https://a.example/' }], skipped: 0 });
});

test('nested folders give the category; deep nesting uses the nearest folder', () => {
  const r = parseOpml(wrap(`
    <outline text="Tech"><outline text="A" xmlUrl="https://a.example/f"/>
      <outline text="Inner"><outline text="B" xmlUrl="https://b.example/f"/></outline></outline>
    <outline text="C" xmlUrl="https://c.example/f"/>`));
  assert.deepEqual(r.entries.map((e) => [e.title, e.category]), [['A', 'Tech'], ['B', 'Inner'], ['C', undefined]]);
  assert.equal(r.skipped, 0);
});

test('outlines without xmlUrl are skipped and counted; folders are not entries', () => {
  const r = parseOpml(wrap('<outline text="Folder"><outline text="Nothing"/><outline text="A" xmlUrl="https://a.example/f"/></outline><outline text="ftp" xmlUrl="ftp://x/f"/>'));
  assert.equal(r.entries.length, 1);
  assert.equal(r.skipped, 2);
});

test('missing text uses title, then the feed URL', () => {
  const r = parseOpml(wrap('<outline title="T" xmlUrl="https://a.example/f"/><outline xmlUrl="https://b.example/f"/>'));
  assert.deepEqual(r.entries.map((e) => e.title), ['T', 'https://b.example/f']);
});

test('entities are decoded; single quotes and attribute case are tolerated', () => {
  const r = parseOpml(wrap(`<outline TEXT='Fish &amp; Chips &quot;x&quot; &#65; &#x42;' xmlUrl="https://a.example/f?a=1&amp;b=2"/>`));
  assert.equal(r.entries[0].title, 'Fish & Chips "x" A B');
  assert.equal(r.entries[0].feedUrl, 'https://a.example/f?a=1&b=2');
});

test('duplicates are returned as found (the route merges)', () => {
  const r = parseOpml(wrap('<outline text="A" xmlUrl="https://a.example/f"/><outline text="A2" xmlUrl="https://a.example/f"/>'));
  assert.equal(r.entries.length, 2);
});

test('comments and a BOM do not matter', () => {
  const r = parseOpml(`﻿${wrap('<!-- <outline xmlUrl="https://no/f"/> --><outline text="A" xmlUrl="https://a.example/f"/>')}`);
  assert.equal(r.entries.length, 1);
});

test('invalid input is a plain 400', () => {
  for (const bad of ['', '   ', 'hello', '<html><body></body></html>', '<opml><body><outline xmlUrl="https://a/f"></body></opml>', '<opml><body>', null, 5]) {
    assert.throws(() => parseOpml(bad), (e) => e instanceof SocialError && e.status === 400 && /OPML/.test(e.message), String(bad));
  }
});
