/**
 * API integration tests for Vanilla Press dev server.
 *
 * Uses in-memory SQLite and a real HTTP server to test the full API stack.
 */

import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import Database from 'better-sqlite3';
import { migrate } from '../../src/store/migrate.js';
import { createRouter, sendJson } from '../../src/server/router.js';
import { mountApi } from '../../src/server/api.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP_DIR = join(__dirname, '..', '..', '_test_tmp');
const MEDIA_DIR = join(TMP_DIR, 'media');

let db, server, port;

/**
 * Make an API request to the test server.
 */
async function api(path, options = {}) {
  const { method = 'GET', body, query, form } = options;

  let url = `http://localhost:${port}${path}`;
  if (query) {
    const params = new URLSearchParams(query);
    url += `?${params}`;
  }

  const fetchOptions = { method };
  if (form) {
    fetchOptions.body = form;
  } else if (body !== undefined) {
    fetchOptions.headers = { 'Content-Type': 'application/json' };
    fetchOptions.body = JSON.stringify(body);
  }

  const res = await fetch(url, fetchOptions);
  const data = await res.json();
  return { status: res.status, data };
}

describe('API', () => {
  before(async () => {
    // Setup
    if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
    mkdirSync(MEDIA_DIR, { recursive: true });

    db = new Database(':memory:');
    migrate(db);

    const router = createRouter();
    mountApi(router, db, {
      rootDir: join(__dirname, '..', '..'),
      mediaDir: MEDIA_DIR,
    });

    server = createServer(async (req, res) => {
      const handled = await router.handle(req, res);
      if (!handled) {
        sendJson(res, 404, { error: 'Not found' });
      }
    });

    await new Promise((resolve) => {
      server.listen(0, () => {
        port = server.address().port;
        resolve();
      });
    });
  });

  after(() => {
    server.close();
    db.close();
    if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
  });

  describe('CRUD lifecycle', () => {
    let docId;

    it('creates a document', async () => {
      const { status, data } = await api('/api/documents', {
        method: 'POST',
        body: {
          meta: {
            title: 'Test Post',
            slug: 'test-post',
            collection: 'posts',
            status: 'draft',
          },
          blocks: [
            { type: 'paragraph', children: [{ type: 'text', value: 'Hello world' }] },
          ],
        },
      });

      assert.equal(status, 201);
      assert.ok(data.id);
      assert.equal(data.meta.title, 'Test Post');
      assert.equal(data.meta.slug, 'test-post');
      assert.equal(data.meta.status, 'draft');
      docId = data.id;
    });

    it('reads the created document', async () => {
      const { status, data } = await api(`/api/documents/${docId}`);

      assert.equal(status, 200);
      assert.equal(data.id, docId);
      assert.equal(data.meta.title, 'Test Post');
      assert.equal(data.blocks.length, 1);
      assert.equal(data.blocks[0].type, 'paragraph');
    });

    it('updates a document', async () => {
      const { status, data } = await api(`/api/documents/${docId}`, {
        method: 'PUT',
        body: {
          meta: { title: 'Updated Post' },
          blocks: [
            { type: 'paragraph', children: [{ type: 'text', value: 'Updated content' }] },
            { type: 'heading', attrs: { level: 2 }, children: [{ type: 'text', value: 'New section' }] },
          ],
        },
      });

      assert.equal(status, 200);
      assert.equal(data.meta.title, 'Updated Post');
      assert.equal(data.blocks.length, 2);
    });

    it('PUT meta.image then null clears it', async () => {
      const set = await api(`/api/documents/${docId}`, { method: 'PUT', body: { meta: { image: '/media/a.jpg' } } });
      assert.equal(set.status, 200);
      assert.equal(set.data.meta.image, '/media/a.jpg');
      assert.equal((await api(`/api/documents/${docId}`)).data.meta.image, '/media/a.jpg');
      const cleared = await api(`/api/documents/${docId}`, { method: 'PUT', body: { meta: { image: null } } });
      assert.equal(cleared.status, 200);
      assert.equal(cleared.data.meta.image, undefined);
      assert.equal((await api(`/api/documents/${docId}`)).data.meta.image, undefined);
    });

    it('lists documents', async () => {
      const { status, data } = await api('/api/documents');

      assert.equal(status, 200);
      assert.ok(Array.isArray(data));
      assert.ok(data.length >= 1);
    });

    it('lists documents filtered by collection', async () => {
      const { status, data } = await api('/api/documents', {
        query: { collection: 'posts', status: 'draft' },
      });

      assert.equal(status, 200);
      assert.ok(data.some(d => d.id === docId));
    });

    it('deletes a document', async () => {
      const { status, data } = await api(`/api/documents/${docId}`, {
        method: 'DELETE',
      });

      assert.equal(status, 200);
      assert.equal(data.ok, true);

      // Verify it's gone
      const { status: getStatus } = await api(`/api/documents/${docId}`);
      assert.equal(getStatus, 404);
    });
  });

  describe('collections', () => {
    before(async () => {
      // Seed some documents in different collections
      await api('/api/documents', {
        method: 'POST',
        body: {
          meta: { title: 'Post A', slug: 'post-a', collection: 'posts', status: 'published', published: '2024-01-01' },
          blocks: [{ type: 'paragraph', children: [{ type: 'text', value: 'Post A' }] }],
        },
      });
      await api('/api/documents', {
        method: 'POST',
        body: {
          meta: { title: 'Page A', slug: 'page-a', collection: 'pages', status: 'published', published: '2024-01-02' },
          blocks: [{ type: 'paragraph', children: [{ type: 'text', value: 'Page A' }] }],
        },
      });
    });

    it('lists collection names', async () => {
      const { status, data } = await api('/api/collections');

      assert.equal(status, 200);
      assert.ok(Array.isArray(data));
      assert.ok(data.includes('posts'));
      assert.ok(data.includes('pages'));
    });
  });

  describe('search', () => {
    it('requires query parameter', async () => {
      const { status, data } = await api('/api/search');

      assert.equal(status, 400);
      assert.ok(data.error);
    });

    it('finds documents by content', async () => {
      const { status, data } = await api('/api/search', {
        query: { q: 'Post' },
      });

      assert.equal(status, 200);
      assert.ok(Array.isArray(data));
      assert.ok(data.length >= 1);
    });
  });

  describe('validation', () => {
    it('rejects documents without required meta', async () => {
      const { status, data } = await api('/api/documents', {
        method: 'POST',
        body: {
          meta: { title: 'No slug or collection' },
          blocks: [],
        },
      });

      assert.equal(status, 400);
      assert.ok(data.error);
      assert.ok(data.errors);
      assert.ok(data.errors.length > 0);
    });

    it('rejects updates with invalid status', async () => {
      // Create a valid doc first
      const { data: created } = await api('/api/documents', {
        method: 'POST',
        body: {
          meta: { title: 'Valid', slug: 'valid-test', collection: 'posts', status: 'draft' },
          blocks: [{ type: 'paragraph', children: [{ type: 'text', value: 'x' }] }],
        },
      });

      const { status, data } = await api(`/api/documents/${created.id}`, {
        method: 'PUT',
        body: {
          meta: { status: 'bogus' },
        },
      });

      assert.equal(status, 400);
      assert.ok(data.errors.some(e => e.includes('status')));
    });
  });

  describe('media', () => {
    const jpeg = (w, h, pad = 0) => Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, h >> 8, h & 255, w >> 8, w & 255, 1, 1, 0x11, 0]),
      Buffer.alloc(pad),
    ]);
    const png = (w, h, pad = 0) => {
      const head = Buffer.alloc(8 + 4 + 4 + 13);
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head);
      head.writeUInt32BE(13, 8);
      head.write('IHDR', 12);
      head.writeUInt32BE(w, 16);
      head.writeUInt32BE(h, 20);
      return Buffer.concat([head, Buffer.alloc(pad)]);
    };
    const upload = (bytes, name, fields = {}) => {
      const form = new FormData();
      form.append('file', new Blob([bytes]), name);
      for (const [k, v] of Object.entries(fields)) form.append(k, v);
      return api('/api/media', { method: 'POST', form });
    };
    const sha = (f) => createHash('sha1').update(readFileSync(join(MEDIA_DIR, f))).digest('hex');
    const files = () => readdirSync(MEDIA_DIR).sort();

    it('lists media (initially empty)', async () => {
      const { status, data } = await api('/api/media');

      assert.equal(status, 200);
      assert.ok(Array.isArray(data));
    });

    it('upload names the file from its original name', async () => {
      const { status, data } = await upload(jpeg(40, 30), 'Garden Path.JPG');
      assert.equal(status, 201);
      assert.match(data.filename, /^garden-path-[0-9a-f]{6}\.jpg$/);
      assert.equal(data.original_name, 'Garden Path.JPG');
      assert.equal(data.mime_type, 'image/jpeg');
      assert.equal(data.kind, 'image');
      assert.equal(data.width, 40);
      assert.equal(data.height, 30);
      assert.equal(data.alt, null);
      assert.equal(data.missing, false);
      assert.deepEqual(data.usedIn, []);
      assert.equal(data.src, `/media/${data.filename}`);
      assert.equal(data.large, false);
      assert.ok(existsSync(join(MEDIA_DIR, data.filename)));
    });

    it('upload with alt "" stores decorative', async () => {
      const { data } = await upload(jpeg(2, 2), 'deco.jpg', { alt: '' });
      assert.equal(data.alt, '');
    });

    it('a PNG named .jpg is stored as png', async () => {
      const { data } = await upload(png(3, 4), 'sneaky.jpg');
      assert.match(data.filename, /^sneaky-[0-9a-f]{6}\.png$/);
      assert.equal(data.mime_type, 'image/png');
    });

    it('unsupported content is refused', async () => {
      const before = files();
      const { status, data } = await upload(Buffer.from('just some text'), 'a.jpg');
      assert.equal(status, 415);
      assert.ok(data.error.includes('a.jpg'));
      assert.deepEqual(files(), before);
    });

    it('files over 25 MB are refused', async () => {
      const before = files();
      const { status, data } = await upload(jpeg(1, 1, 26_214_400 - 21 + 1), 'huge.jpg');
      assert.equal(status, 413);
      assert.ok(data.error.includes('25 MB'));
      assert.deepEqual(files(), before);
    });

    it('a declared size far past the limit is refused before reading (Content-Length)', async () => {
      const { status, data } = await upload(Buffer.alloc(28_000_000), 'enormous.jpg');
      assert.equal(status, 413);
      assert.match(data.error, /^This file is 26\.7 MB\./);
      assert.ok(data.error.includes('25 MB'));
    });

    /** POST a chunked multipart body (no Content-Length) of `chunks` x 1 MiB of file data. */
    const chunkedUpload = (chunks) => new Promise((resolve, reject) => {
      const boundary = 'xBOUNDARYx';
      let answer;
      const r = request({
        host: '127.0.0.1', port, path: '/api/media', method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Transfer-Encoding': 'chunked' },
      }, (res) => {
        let text = '';
        res.on('data', (c) => { text += c; });
        res.on('end', () => {
          answer = { status: res.statusCode, data: JSON.parse(text) };
          r.destroy(); // enough: stop sending the rest
          resolve(answer);
        });
      });
      r.on('error', (err) => { if (!answer) reject(err); });
      (async () => {
        r.write(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="stream.jpg"\r\n\r\n`);
        for (let i = 0; i < chunks && !answer; i++) {
          // Honour backpressure: the server stops reading once it has answered.
          if (!r.write(Buffer.alloc(1_048_576))) await new Promise((ok) => r.once('drain', ok).once('close', ok));
        }
        if (!answer) r.end(`\r\n--${boundary}--\r\n`);
      })().catch(() => {});
    });

    it('a chunked body past the limit is cut off by the body limit', async () => {
      const before = files();
      const { status, data } = await chunkedUpload(30);
      assert.equal(status, 413);
      assert.match(data.error, /^This file is 26\.[01] MB\./);
      assert.deepEqual(files(), before);
    });

    it('large files carry a note', async () => {
      const { status, data } = await upload(png(1, 1, 5_242_881 - 29), 'big.png');
      assert.equal(status, 201);
      assert.equal(data.size, 5_242_881);
      assert.equal(data.large, true);
    });

    it('two uploads with the same name get different files', async () => {
      const a = await upload(jpeg(1, 1), 'same.jpg');
      const b = await upload(jpeg(1, 1), 'same.jpg');
      assert.notEqual(a.data.filename, b.data.filename);
      assert.ok(existsSync(join(MEDIA_DIR, a.data.filename)) && existsSync(join(MEDIA_DIR, b.data.filename)));
    });

    it('alt edit keeps three states', async () => {
      const { data: item } = await upload(jpeg(1, 1), 'alt.jpg');
      const put = (alt) => api(`/api/media/${item.id}`, { method: 'PUT', body: { alt } });
      assert.equal((await put('A cat')).data.alt, 'A cat');
      assert.equal((await put('')).data.alt, '');
      const cleared = await put(null);
      assert.equal(cleared.status, 200);
      assert.equal(cleared.data.alt, null);
      const bad = await put(3);
      assert.equal(bad.status, 400);
      assert.equal(bad.data.error, 'alt must be text or null');
      assert.equal((await api('/api/media/nope', { method: 'PUT', body: { alt: 'x' } })).status, 404);
    });

    it('edited copy', async () => {
      const { data: src } = await upload(jpeg(8, 6, 50), 'Garden Path.JPG', { alt: 'A path' });
      const before = sha(src.filename);
      const { status, data } = await upload(jpeg(4, 3), 'whatever.jpg', { edited_from: src.filename, alt: 'ignored' });
      assert.equal(status, 201);
      assert.match(data.filename, /^garden-path-edited-[0-9a-f]{6}\.jpg$/);
      assert.equal(data.alt, 'A path');
      assert.equal(data.original_name, 'Garden Path.JPG');
      assert.equal(data.edited_from, src.filename);
      const list = (await api('/api/media')).data;
      assert.equal(list.find((m) => m.id === src.id).edited_from, null);
      assert.equal(sha(src.filename), before);
      const again = await upload(jpeg(4, 3), 'x.jpg', { edited_from: data.filename });
      assert.match(again.data.filename, /^garden-path-edited-[0-9a-f]{6}\.jpg$/);

      const gone = await upload(jpeg(1, 1), 'x.jpg', { edited_from: 'nothing-here.jpg' });
      assert.equal(gone.status, 400);
      assert.equal(gone.data.error, 'The image being edited is no longer in the library.');
    });

    /** A document using `src` in a figure, with the given status. */
    const docUsing = async (title, status, block) => {
      const { data } = await api('/api/documents', {
        method: 'POST',
        body: { meta: { title, slug: title.toLowerCase().replace(/\W+/g, '-'), collection: 'posts', status }, blocks: [block] },
      });
      return data;
    };
    const figure = (src) => ({ type: 'figure', attrs: { src, alt: 'x' } });

    it('list marks missing files and usage', async () => {
      const { data: item } = await upload(jpeg(1, 1), 'listed.jpg');
      const doc = await docUsing('Lists media', 'published', figure(item.src));
      let found = (await api('/api/media')).data.find((m) => m.id === item.id);
      assert.deepEqual(found.usedIn, [{ id: doc.id, title: 'Lists media', status: 'published' }]);
      assert.equal(found.missing, false);
      rmSync(join(MEDIA_DIR, item.filename));
      found = (await api('/api/media')).data.find((m) => m.id === item.id);
      assert.equal(found.missing, true);
      const all = (await api('/api/media')).data;
      const created = all.map((m) => m.created);
      assert.deepEqual(created, [...created].sort().reverse());
      await api(`/api/documents/${doc.id}`, { method: 'DELETE' });
    });

    it('delete is refused while a published post uses the file', async () => {
      const { data: item } = await upload(jpeg(1, 1), 'guarded.jpg');
      const doc = await docUsing('Guard figure', 'published', figure(item.src));
      const { status, data } = await api(`/api/media/${item.id}`, { method: 'DELETE' });
      assert.equal(status, 409);
      assert.equal(data.error, 'Used by published posts. Remove it from them and Update first.');
      assert.deepEqual(data.posts, [{ id: doc.id, title: 'Guard figure' }]);
      assert.ok(existsSync(join(MEDIA_DIR, item.filename)));
      assert.equal((await api('/api/media')).data.some((m) => m.id === item.id), true);
      await api(`/api/documents/${doc.id}`, { method: 'DELETE' });
    });

    it('delete is refused while a published post links the file', async () => {
      const { data: item } = await upload(jpeg(1, 1), 'linked.jpg');
      const link = { type: 'paragraph', children: [{ type: 'link', attrs: { href: item.src }, children: [{ type: 'text', value: 'file' }] }] };
      const doc = await docUsing('Guard link', 'published', link);
      const { status, data } = await api(`/api/media/${item.id}`, { method: 'DELETE' });
      assert.equal(status, 409);
      assert.deepEqual(data.posts, [{ id: doc.id, title: 'Guard link' }]);
      assert.ok(existsSync(join(MEDIA_DIR, item.filename)));
      await api(`/api/documents/${doc.id}`, { method: 'DELETE' });
    });

    it('delete is refused while a published card links the file', async () => {
      const { data: item } = await upload(jpeg(1, 1), 'carded.jpg');
      const card = { type: 'card', attrs: { href: item.src }, children: [{ type: 'paragraph', children: [{ type: 'text', value: 'x' }] }] };
      const doc = await docUsing('Guard card', 'published', card);
      const { status } = await api(`/api/media/${item.id}`, { method: 'DELETE' });
      assert.equal(status, 409);
      await api(`/api/documents/${doc.id}`, { method: 'DELETE' });
    });

    it('a failed insert leaves no file behind', async () => {
      const before = files();
      db.exec("CREATE TRIGGER fail_media BEFORE INSERT ON media BEGIN SELECT RAISE(ABORT, 'boom'); END");
      const errors = mock.method(console, 'error', () => {});
      try {
        const { status } = await upload(jpeg(1, 1), 'doomed.jpg');
        assert.equal(status, 500);
      } finally {
        errors.mock.restore();
        db.exec('DROP TRIGGER fail_media');
      }
      assert.deepEqual(files(), before);
    });

    it('delete of a draft-only file removes it', async () => {
      const { data: item } = await upload(jpeg(1, 1), 'drafty.jpg');
      const doc = await docUsing('Draft user', 'draft', figure(item.src));
      const { status, data } = await api(`/api/media/${item.id}`, { method: 'DELETE' });
      assert.equal(status, 200);
      assert.deepEqual(data, { ok: true, drafts: [{ id: doc.id, title: 'Draft user' }] });
      assert.ok(!existsSync(join(MEDIA_DIR, item.filename)));
      assert.equal((await api('/api/media')).data.some((m) => m.id === item.id), false);
      assert.equal((await api(`/api/media/${item.id}`, { method: 'DELETE' })).status, 404);
    });

    it('delete of a missing file removes the entry', async () => {
      const { data: item } = await upload(jpeg(1, 1), 'vanished.jpg');
      rmSync(join(MEDIA_DIR, item.filename));
      const { status, data } = await api(`/api/media/${item.id}`, { method: 'DELETE' });
      assert.equal(status, 200);
      assert.deepEqual(data, { ok: true, drafts: [] });
      assert.equal((await api('/api/media')).data.some((m) => m.id === item.id), false);
    });
  });

  describe('config', () => {
    it('returns null for unset key', async () => {
      const { status, data } = await api('/api/config/nonexistent');

      assert.equal(status, 200);
      assert.equal(data.key, 'nonexistent');
      assert.equal(data.value, null);
    });

    it('sets and gets a config value', async () => {
      const { status: putStatus, data: putData } = await api('/api/config/theme', {
        method: 'PUT',
        body: { value: 'ocean' },
      });

      assert.equal(putStatus, 200);
      assert.equal(putData.key, 'theme');
      assert.equal(putData.value, 'ocean');

      const { status: getStatus, data: getData } = await api('/api/config/theme');

      assert.equal(getStatus, 200);
      assert.equal(getData.value, 'ocean');
    });

    it('overwrites an existing config value', async () => {
      await api('/api/config/theme', {
        method: 'PUT',
        body: { value: 'ocean' },
      });

      await api('/api/config/theme', {
        method: 'PUT',
        body: { value: 'mono' },
      });

      const { data } = await api('/api/config/theme');
      assert.equal(data.value, 'mono');
    });

    it('lists all config values', async () => {
      await api('/api/config/site_title', {
        method: 'PUT',
        body: { value: 'My Site' },
      });

      const { status, data } = await api('/api/config');

      assert.equal(status, 200);
      assert.equal(typeof data, 'object');
      assert.ok('site_title' in data);
      assert.equal(data.site_title, 'My Site');
    });

    it('rejects PUT without value field', async () => {
      const { status, data } = await api('/api/config/bad', {
        method: 'PUT',
        body: {},
      });

      assert.equal(status, 400);
      assert.ok(data.error);
    });
  });

  describe('error handling', () => {
    it('returns 404 for non-existent document', async () => {
      const { status, data } = await api('/api/documents/nonexistent');

      assert.equal(status, 404);
      assert.ok(data.error);
    });

    it('returns 400 for PUT without body', async () => {
      // Create a doc first
      const { data: created } = await api('/api/documents', {
        method: 'POST',
        body: {
          meta: { title: 'Temp', slug: 'temp-err', collection: 'posts', status: 'draft' },
          blocks: [{ type: 'paragraph', children: [{ type: 'text', value: 'x' }] }],
        },
      });

      // PUT without JSON content-type
      const res = await fetch(`http://localhost:${port}/api/documents/${created.id}`, {
        method: 'PUT',
      });
      const data = await res.json();

      assert.equal(res.status, 400);
      assert.ok(data.error);
    });
  });
});
