/**
 * API integration tests for Vanilla Press dev server.
 *
 * Uses in-memory SQLite and a real HTTP server to test the full API stack.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import Database from 'better-sqlite3';
import { migrate } from '../../src/store/migrate.js';
import { createRouter, sendJson } from '../../src/server/router.js';
import { mountApi } from '../../src/server/api.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, rmSync, existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP_DIR = join(__dirname, '..', '..', '_test_tmp');
const MEDIA_DIR = join(TMP_DIR, 'media');

let db, server, port;

/**
 * Make an API request to the test server.
 */
async function api(path, options = {}) {
  const { method = 'GET', body, query } = options;

  let url = `http://localhost:${port}${path}`;
  if (query) {
    const params = new URLSearchParams(query);
    url += `?${params}`;
  }

  const fetchOptions = { method };
  if (body !== undefined) {
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
    it('lists media (initially empty)', async () => {
      const { status, data } = await api('/api/media');

      assert.equal(status, 200);
      assert.ok(Array.isArray(data));
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
