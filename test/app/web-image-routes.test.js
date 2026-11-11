/**
 * The same-origin image proxy and the Unsplash download ping: both work only
 * from a result this server's own search cached, never from a client's URL.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRouter, sendJson } from '../../src/server/router.js';
import { mountServiceRoutes } from '../../src/app/service-routes.js';
import { createImageSearch } from '../../src/services/image-search.js';
import { updateService } from '../../src/services/store.js';
import Database from 'better-sqlite3';
import { migrate } from '../../src/store/migrate.js';
import { mountApi } from '../../src/server/api.js';
import { MAX_BYTES } from '../../src/media/limits.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 3, 0, 4, 1, 1, 0x11, 0]);
const KEY = 'SECRET-UNSPLASH-KEY';
const DOWNLOAD = 'https://api.unsplash.com/photos/u1/download?ixid=abc';

describe('web image routes', () => {
  let root, env, server, base, calls, imageAnswer, pingAnswer, db;

  const fakeFetch = async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers || {} });
    const { hostname, pathname } = new URL(url);
    if (hostname === 'api.openverse.org') {
      return Response.json({ page: 1, page_count: 1, results: [{
        id: 'ov-1', title: 'Fox', url: 'https://example.org/fox.jpg', thumbnail: 'https://example.org/t.jpg',
        width: 4, height: 3, creator: 'Jane', creator_url: 'https://example.org/jane', source: 'flickr',
        foreign_landing_url: 'https://example.org/fox', license: 'cc0', license_version: '1.0',
        license_url: 'https://creativecommons.org/publicdomain/zero/1.0/',
      }] });
    }
    if (hostname === 'api.unsplash.com' && pathname === '/search/photos') {
      return Response.json({ total_pages: 1, results: [{
        id: 'u1', width: 4000, height: 3000, alt_description: 'A hill',
        urls: { small: 'https://images.unsplash.com/s', raw: 'https://images.unsplash.com/raw' },
        links: { html: 'https://unsplash.com/photos/u1', download_location: DOWNLOAD },
        user: { name: 'Sam', links: { html: 'https://unsplash.com/@sam' } },
      }] });
    }
    if (String(url) === DOWNLOAD) return pingAnswer();
    if (String(url) === 'https://example.org/fox.jpg') return imageAnswer();
    return new Response('', { status: 404 });
  };

  before(async () => {
    root = mkdtempSync(join(tmpdir(), 'vp-web-image-routes-'));
    env = { VP_CONFIG_DIR: join(root, 'config') };
    updateService('unsplash', { key: KEY }, env);
    const router = createRouter();
    const imageSearch = createImageSearch({ env, fetch: fakeFetch });
    mountServiceRoutes(router, { env, fetch: fakeFetch, imageSearch });
    // The site's import reads the same search, as in the app
    db = new Database(':memory:');
    migrate(db);
    mountApi(router, db, { rootDir: root, mediaDir: join(root, 'media'), webImages: imageSearch });
    server = createServer(async (req, res) => {
      if (!(await router.handle(req, res))) sendJson(res, 404, { error: 'Not found' });
    });
    await new Promise((resolve) => server.listen(0, resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    calls = [];
    const search = await fetch(`${base}/api/web-images?q=fox`);
    assert.equal(search.status, 200);
  });
  after(() => {
    server.close();
    db.close();
    rmSync(root, { recursive: true, force: true });
  });
  beforeEach(() => {
    calls = [];
    imageAnswer = () => new Response(JPEG, { headers: { 'Content-Type': 'image/jpeg' } });
    pingAnswer = () => new Response('{}', { status: 200 });
  });

  describe('GET /api/web-images/:source/:id/image', () => {
    it('streams a cached result\'s bytes with its type', async () => {
      const res = await fetch(`${base}/api/web-images/openverse/ov-1/image`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), 'image/jpeg');
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
      assert.deepEqual(Buffer.from(await res.arrayBuffer()), JPEG);
      assert.deepEqual(calls.map((c) => c.url), ['https://example.org/fox.jpg']);
    });

    it('serves the type the bytes are, not the type the remote claims', async () => {
      imageAnswer = () => new Response(JPEG, { headers: { 'Content-Type': 'text/html' } });
      const res = await fetch(`${base}/api/web-images/openverse/ov-1/image`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), 'image/jpeg');
    });

    it('refuses bytes that are not an image', async () => {
      imageAnswer = () => new Response('<script>alert(1)</script>', { headers: { 'Content-Type': 'image/jpeg' } });
      const res = await fetch(`${base}/api/web-images/openverse/ov-1/image`);
      assert.equal(res.status, 415);
    });

    it('an unknown result is 404 with the message, and nothing is fetched', async () => {
      const res = await fetch(`${base}/api/web-images/openverse/nope/image`);
      assert.equal(res.status, 404);
      assert.deepEqual(await res.json(), { error: 'Search again — this result has expired' });
      assert.deepEqual(calls, []);
    });

    it('a link-only result is 400', async () => {
      const res = await fetch(`${base}/api/web-images/unsplash/u1/image`);
      assert.equal(res.status, 400);
      assert.deepEqual(calls, []);
    });

    it('a 30 MB original streams through the proxy (60 MiB cap), and import still refuses it', async () => {
      const big = Buffer.concat([JPEG, Buffer.alloc(30 * 1000 * 1000)]);
      assert.ok(big.length > MAX_BYTES);
      imageAnswer = () => new Response(big, { headers: { 'Content-Type': 'image/jpeg' } });
      const res = await fetch(`${base}/api/web-images/openverse/ov-1/image`);
      assert.equal(res.status, 200);
      assert.equal(Number(res.headers.get('content-length')), big.length);
      assert.equal((await res.arrayBuffer()).byteLength, big.length);
      const imported = await fetch(`${base}/api/media/import`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'openverse', id: 'ov-1' }),
      });
      assert.equal(imported.status, 413);
      assert.match((await imported.json()).error, /larger than 25/);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM media').get().n, 0);
    });

    it('the proxy refuses more than 60 MiB', async () => {
      imageAnswer = () => new Response(new ReadableStream({ start() {} }), {
        headers: { 'Content-Type': 'image/jpeg', 'Content-Length': String(62_914_560 + 1) },
      });
      assert.equal((await fetch(`${base}/api/web-images/openverse/ov-1/image`)).status, 413);
    });

    it('a failed download is 502', async () => {
      imageAnswer = () => new Response('', { status: 500 });
      assert.equal((await fetch(`${base}/api/web-images/openverse/ov-1/image`)).status, 502);
    });

    it('never fetches a URL the client supplies', async () => {
      const evil = encodeURIComponent('https://evil.example/x.jpg');
      assert.equal((await fetch(`${base}/api/web-images/openverse/nope/image?url=${evil}`)).status, 404);
      assert.equal((await fetch(`${base}/api/web-images/${evil}/image`)).status, 404);
      assert.equal(calls.some((c) => c.url.includes('evil')), false);
    });
  });

  describe('POST /api/web-images/unsplash/:id/download', () => {
    it('pings the download location with the key, and answers 204 without it', async () => {
      const res = await fetch(`${base}/api/web-images/unsplash/u1/download`, { method: 'POST' });
      assert.equal(res.status, 204);
      assert.equal(await res.text(), '');
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, DOWNLOAD);
      assert.equal(calls[0].headers.Authorization, `Client-ID ${KEY}`);
    });

    it('an unknown result is 404', async () => {
      const res = await fetch(`${base}/api/web-images/unsplash/nope/download`, { method: 'POST' });
      assert.equal(res.status, 404);
      assert.deepEqual(calls, []);
    });

    it('a failed ping is 502 and never shows the key', async () => {
      pingAnswer = () => new Response(`bad key ${KEY}`, { status: 401 });
      const res = await fetch(`${base}/api/web-images/unsplash/u1/download`, { method: 'POST' });
      assert.equal(res.status, 502);
      assert.equal((await res.text()).includes(KEY), false);
      pingAnswer = () => { throw new Error(`network down ${KEY}`); };
      const thrown = await fetch(`${base}/api/web-images/unsplash/u1/download`, { method: 'POST' });
      assert.equal(thrown.status, 502);
      assert.equal((await thrown.text()).includes(KEY), false);
    });
  });

  describe('POST /api/media/import of an Unsplash result', () => {
    const importU1 = () => fetch(`${base}/api/media/import`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'unsplash', id: 'u1' }),
    });

    it('pings the download location exactly once and adds a linked item; the key never shows', async () => {
      const res = await importU1();
      assert.equal(res.status, 201);
      const text = await res.text();
      assert.equal(text.includes(KEY), false);
      const item = JSON.parse(text);
      assert.equal(item.linked, true);
      assert.equal(item.filename, 'unsplash-u1');
      assert.match(item.src, /^https:\/\/images\.unsplash\.com\/raw\?/);
      assert.deepEqual(calls.map((c) => c.url), [DOWNLOAD]);
      assert.equal(calls[0].headers.Authorization, `Client-ID ${KEY}`);
      calls = [];
      const again = await importU1();
      assert.equal(again.status, 200);
      assert.equal((await again.json()).id, item.id);
      assert.deepEqual(calls.map((c) => c.url), [DOWNLOAD]);
      db.prepare('DELETE FROM media').run();
    });

    it('a failed ping is 502, adds nothing and never shows the key', async () => {
      pingAnswer = () => new Response(`bad key ${KEY}`, { status: 401 });
      const res = await importU1();
      assert.equal(res.status, 502);
      assert.equal((await res.text()).includes(KEY), false);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM media').get().n, 0);
    });
  });

  it('no route takes a URL', () => {
    const router = createRouter();
    mountServiceRoutes(router, { env, fetch: fakeFetch });
    for (const { pattern } of router.routes()) assert.equal(/url/i.test(pattern), false, pattern);
  });
});
