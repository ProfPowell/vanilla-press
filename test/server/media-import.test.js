/**
 * Credited media: import from a cached web image result, the credit and source
 * fields on upload, and credit edits.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { migrate } from '../../src/store/migrate.js';
import { createRouter, sendJson } from '../../src/server/router.js';
import { mountApi } from '../../src/server/api.js';
import { MAX_BYTES } from '../../src/media/limits.js';

const jpeg = (w, h, pad = 0) => Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, h >> 8, h & 255, w >> 8, w & 255, 1, 1, 0x11, 0]),
  Buffer.alloc(pad),
]);

const PEXELS_CREDIT = { name: 'Jane', url: 'https://www.pexels.com/@jane', site: 'Pexels', siteUrl: 'https://www.pexels.com/photo/123/' };

/** A fake `webImages`: results by `source|id`, and what `image` answers for each. */
function fakeWebImages() {
  const results = new Map();
  const images = new Map();
  return {
    results,
    images,
    get: (source, id) => results.get(`${source}|${id}`) ?? null,
    async image(source, id) {
      const answer = images.get(`${source}|${id}`);
      if (!results.has(`${source}|${id}`) || !answer) {
        throw Object.assign(new Error('Search again — this result has expired'), { status: 404 });
      }
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
}

describe('media import and credits', () => {
  let root, mediaDir, db, server, base, webImages;

  before(async () => {
    root = mkdtempSync(join(tmpdir(), 'vp-media-import-'));
    mediaDir = join(root, 'media');
    db = new Database(':memory:');
    migrate(db);
    webImages = fakeWebImages();
    const router = createRouter();
    mountApi(router, db, { rootDir: root, mediaDir, webImages });
    server = createServer(async (req, res) => {
      if (!(await router.handle(req, res))) sendJson(res, 404, { error: 'Not found' });
    });
    await new Promise((resolve) => server.listen(0, resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => {
    server.close();
    db.close();
    rmSync(root, { recursive: true, force: true });
  });
  beforeEach(() => {
    webImages.results.clear();
    webImages.images.clear();
  });

  const call = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
      body: body instanceof FormData ? body : JSON.stringify(body),
    });
    return { status: res.status, data: await res.json() };
  };
  const files = () => (existsSync(mediaDir) ? readdirSync(mediaDir).sort() : []);
  const offer = (item, image) => {
    webImages.results.set(`${item.source}|${item.id}`, item);
    if (image) webImages.images.set(`${item.source}|${item.id}`, image);
  };
  const pexels = (o = {}) => ({
    source: 'pexels', id: '123', mode: 'copy', thumb: 't', url: 'https://images.pexels.com/123.jpg',
    width: 40, height: 30, description: 'A red fox', credit: PEXELS_CREDIT, ...o,
  });

  describe('POST /api/media/import', () => {
    it('stores the bytes with the source and the credit', async () => {
      offer(pexels(), { data: jpeg(40, 30), contentType: 'image/jpeg' });
      const { status, data } = await call('POST', '/api/media/import', { source: 'pexels', id: '123' });
      assert.equal(status, 201);
      assert.match(data.filename, /^pexels-123-[0-9a-f]{6}\.jpg$/);
      assert.equal(data.source, 'pexels');
      assert.deepEqual(data.credit, PEXELS_CREDIT);
      assert.equal(data.alt, 'A red fox');
      assert.equal(data.mime_type, 'image/jpeg');
      assert.equal(data.width, 40);
      assert.ok(existsSync(join(mediaDir, data.filename)));
      const row = db.prepare('SELECT source, credit FROM media WHERE id = ?').get(data.id);
      assert.equal(row.source, 'pexels');
      assert.deepEqual(JSON.parse(row.credit), PEXELS_CREDIT);
      assert.deepEqual((await call('GET', '/api/media')).data.find((m) => m.id === data.id).credit, PEXELS_CREDIT);
    });

    it('a given alt wins over the description, and "" stays decorative', async () => {
      offer(pexels(), { data: jpeg(2, 2), contentType: 'image/jpeg' });
      assert.equal((await call('POST', '/api/media/import', { source: 'pexels', id: '123', alt: 'Mine' })).data.alt, 'Mine');
      assert.equal((await call('POST', '/api/media/import', { source: 'pexels', id: '123', alt: '' })).data.alt, '');
    });

    it('an Openverse credit with no license keeps no license key', async () => {
      const credit = { name: 'Ann', site: 'Openverse', siteUrl: 'https://openverse.org/image/ov-1' };
      offer({ ...pexels(), source: 'openverse', id: 'ov-1', credit }, { data: jpeg(2, 2), contentType: 'image/jpeg' });
      const { data } = await call('POST', '/api/media/import', { source: 'openverse', id: 'ov-1' });
      assert.deepEqual(data.credit, credit);
    });

    it('an unknown result is 404 with the exact message', async () => {
      const before = files();
      const { status, data } = await call('POST', '/api/media/import', { source: 'pexels', id: 'gone' });
      assert.equal(status, 404);
      assert.equal(data.error, 'Search again — this result has expired');
      assert.deepEqual(files(), before);
    });

    it('a link-only source is 400', async () => {
      offer({ ...pexels(), source: 'unsplash', id: 'u1', mode: 'link' }, { data: jpeg(2, 2), contentType: 'image/jpeg' });
      const before = files();
      const { status } = await call('POST', '/api/media/import', { source: 'unsplash', id: 'u1' });
      assert.equal(status, 400);
      assert.deepEqual(files(), before);
    });

    it('an image the search refuses as too large is 413, and nothing is stored', async () => {
      offer(pexels(), Object.assign(new Error('Pexels sent an image larger than 25.0 MB'), { status: 413 }));
      const before = files();
      const count = db.prepare('SELECT COUNT(*) AS n FROM media').get().n;
      const { status, data } = await call('POST', '/api/media/import', { source: 'pexels', id: '123' });
      assert.equal(status, 413);
      assert.equal(data.error, 'Pexels sent an image larger than 25.0 MB');
      assert.deepEqual(files(), before);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM media').get().n, count);
    });

    it('bytes over MAX_BYTES are 413, and no file is left behind', async () => {
      offer(pexels(), { data: jpeg(1, 1, MAX_BYTES), contentType: 'image/jpeg' });
      const before = files();
      const { status } = await call('POST', '/api/media/import', { source: 'pexels', id: '123' });
      assert.equal(status, 413);
      assert.deepEqual(files(), before);
    });

    it('a timeout is 504', async () => {
      offer(pexels(), Object.assign(new Error("Pexels didn't answer in time"), { status: 504 }));
      assert.equal((await call('POST', '/api/media/import', { source: 'pexels', id: '123' })).status, 504);
    });

    it('content that is not an image is 415', async () => {
      offer(pexels(), { data: Buffer.from('<html>nope</html>'), contentType: 'image/jpeg' });
      const before = files();
      assert.equal((await call('POST', '/api/media/import', { source: 'pexels', id: '123' })).status, 415);
      assert.deepEqual(files(), before);
    });

    it('remote text never shapes the file name', async () => {
      offer(pexels({ id: '../../etc/x', description: '../../evil/name.svg' }), { data: jpeg(2, 2), contentType: 'image/jpeg' });
      const { status, data } = await call('POST', '/api/media/import', { source: 'pexels', id: '../../etc/x' });
      assert.equal(status, 201);
      assert.match(data.filename, /^pexels-etc-x-[0-9a-f]{6}\.jpg$/);
      assert.equal(data.original_name, data.filename.replace(/-[0-9a-f]{6}\.jpg$/, '.jpg'));
      assert.ok(existsSync(join(mediaDir, data.filename)));
    });

    it('a bad body is 400', async () => {
      assert.equal((await call('POST', '/api/media/import', { source: 'pexels' })).status, 400);
      assert.equal((await call('POST', '/api/media/import', { source: 'pexels', id: '123', alt: 5 })).status, 400);
    });
  });

  describe('POST /api/media with a credit', () => {
    const upload = (fields) => {
      const form = new FormData();
      form.append('file', new Blob([jpeg(4, 3)]), 'fox.jpg');
      for (const [k, v] of Object.entries(fields)) form.append(k, v);
      return call('POST', '/api/media', form);
    };

    it('stores the credit and the source; adapted survives', async () => {
      const credit = { ...PEXELS_CREDIT, adapted: true };
      const { status, data } = await upload({ credit: JSON.stringify(credit), source: 'pexels' });
      assert.equal(status, 201);
      assert.deepEqual(data.credit, credit);
      assert.equal(data.source, 'pexels');
    });

    it('a credit with no source is manual; no credit is none', async () => {
      assert.equal((await upload({ credit: JSON.stringify({ name: 'Me' }) })).data.source, 'manual');
      const { data } = await upload({});
      assert.equal(data.source, null);
      assert.equal(data.credit, null);
    });

    it('a bad credit or source is 400', async () => {
      const before = files();
      assert.equal((await upload({ credit: 'not json' })).status, 400);
      assert.equal((await upload({ credit: JSON.stringify({ name: 'x', url: 'javascript:1' }) })).status, 400);
      assert.equal((await upload({ credit: JSON.stringify({ name: 'x' }), source: 'unsplash' })).status, 400);
      assert.deepEqual(files(), before);
    });

    it('an edited copy keeps the credit, marked adapted', async () => {
      const { data: src } = await upload({ credit: JSON.stringify(PEXELS_CREDIT), source: 'pexels' });
      const form = new FormData();
      form.append('file', new Blob([jpeg(2, 2)]), 'x.jpg');
      form.append('edited_from', src.filename);
      const { status, data } = await call('POST', '/api/media', form);
      assert.equal(status, 201);
      assert.deepEqual(data.credit, { ...PEXELS_CREDIT, adapted: true });
      assert.equal(data.source, 'pexels');
    });
  });

  describe('PUT /api/media/:id', () => {
    const uploaded = async (fields = {}) => {
      const form = new FormData();
      form.append('file', new Blob([jpeg(2, 2)]), 'p.jpg');
      for (const [k, v] of Object.entries(fields)) form.append(k, v);
      return (await call('POST', '/api/media', form)).data;
    };

    it('a credit updates it and leaves alt alone', async () => {
      const item = await uploaded({ alt: 'A path' });
      const { status, data } = await call('PUT', `/api/media/${item.id}`, { credit: { name: ' Me ', adapted: true } });
      assert.equal(status, 200);
      assert.deepEqual(data.credit, { name: 'Me', adapted: true });
      assert.equal(data.source, 'manual');
      assert.equal(data.alt, 'A path');
      assert.deepEqual((await call('GET', '/api/media')).data.find((m) => m.id === item.id).credit, { name: 'Me', adapted: true });
    });

    it('credit null clears it: manual, unless the image came from the web', async () => {
      const own = await uploaded({ credit: JSON.stringify({ name: 'Me' }) });
      let res = await call('PUT', `/api/media/${own.id}`, { credit: null });
      assert.equal(res.data.credit, null);
      assert.equal(res.data.source, 'manual');
      const web = await uploaded({ credit: JSON.stringify(PEXELS_CREDIT), source: 'pexels' });
      res = await call('PUT', `/api/media/${web.id}`, { credit: null });
      assert.equal(res.data.credit, null);
      assert.equal(res.data.source, 'pexels');
    });

    it('alt and credit together', async () => {
      const item = await uploaded();
      const { data } = await call('PUT', `/api/media/${item.id}`, { alt: 'Both', credit: { name: 'Me' } });
      assert.equal(data.alt, 'Both');
      assert.deepEqual(data.credit, { name: 'Me' });
    });

    it('neither alt nor credit is 400; a bad credit is 400', async () => {
      const item = await uploaded();
      assert.equal((await call('PUT', `/api/media/${item.id}`, {})).status, 400);
      assert.equal((await call('PUT', `/api/media/${item.id}`, { credit: 'Jane' })).status, 400);
      assert.equal((await call('PUT', `/api/media/${item.id}`, { credit: {} })).status, 400);
    });
  });
});

describe('media import without web images', () => {
  it('is 503 when the API has no webImages', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vp-media-import-none-'));
    const db = new Database(':memory:');
    migrate(db);
    const router = createRouter();
    mountApi(router, db, { rootDir: root, mediaDir: join(root, 'media') });
    const server = createServer(async (req, res) => {
      if (!(await router.handle(req, res))) sendJson(res, 404, { error: 'Not found' });
    });
    await new Promise((resolve) => server.listen(0, resolve));
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/media/import`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'pexels', id: '1' }),
      });
      assert.equal(res.status, 503);
    } finally {
      server.close();
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
