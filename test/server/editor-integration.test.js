/**
 * Editor integration tests — round-trip test fixtures through the API.
 *
 * Loads each test fixture via the API, fetches it back, and verifies
 * the blocks are semantically equal.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, readdirSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { migrate } from '../../src/store/migrate.js';
import { createRouter, sendJson } from '../../src/server/router.js';
import { mountApi } from '../../src/server/api.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '..', 'fixtures');
const TMP_DIR = join(__dirname, '..', '..', '_test_tmp_int');

let db, server, port;

async function api(path, options = {}) {
  const { method = 'GET', body } = options;
  let url = `http://localhost:${port}${path}`;
  const fetchOptions = { method };
  if (body !== undefined) {
    fetchOptions.headers = { 'Content-Type': 'application/json' };
    fetchOptions.body = JSON.stringify(body);
  }
  const res = await fetch(url, fetchOptions);
  return { status: res.status, data: await res.json() };
}

describe('Editor integration — fixture round-trip', () => {
  before(async () => {
    if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
    mkdirSync(TMP_DIR, { recursive: true });

    db = new Database(':memory:');
    migrate(db);

    const router = createRouter();
    mountApi(router, db, {
      rootDir: join(__dirname, '..', '..'),
      mediaDir: join(TMP_DIR, 'media'),
    });

    server = createServer(async (req, res) => {
      const handled = await router.handle(req, res);
      if (!handled) sendJson(res, 404, { error: 'Not found' });
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

  const fixtures = readdirSync(FIXTURES_DIR).filter(f => f.endsWith('.json'));

  for (const file of fixtures) {
    it(`round-trips ${file}`, async () => {
      const raw = readFileSync(join(FIXTURES_DIR, file), 'utf-8');
      const fixture = JSON.parse(raw);

      // Create via API
      const { status: createStatus, data: created } = await api('/api/documents', {
        method: 'POST',
        body: fixture,
      });
      assert.equal(createStatus, 201, `Failed to create ${file}`);
      assert.ok(created.id);

      // Fetch back
      const { status: getStatus, data: fetched } = await api(`/api/documents/${created.id}`);
      assert.equal(getStatus, 200);

      // Compare blocks (semantic equality — ignore timestamps)
      assert.deepStrictEqual(fetched.blocks, fixture.blocks,
        `Blocks mismatch for ${file}`);

      // Compare meta fields (ignoring updated/created which get server timestamps)
      assert.equal(fetched.meta.title, fixture.meta.title);
      assert.equal(fetched.meta.slug, fixture.meta.slug);
      assert.equal(fetched.meta.collection, fixture.meta.collection);
    });
  }

  it('creates and updates in sequence', async () => {
    // Create
    const { data: created } = await api('/api/documents', {
      method: 'POST',
      body: {
        meta: {
          title: 'Sequence Test',
          slug: 'sequence-test',
          collection: 'posts',
          status: 'draft',
        },
        blocks: [
          { type: 'paragraph', children: [{ type: 'text', value: 'Version 1' }] },
        ],
      },
    });

    // Update with new blocks
    const newBlocks = [
      { type: 'heading', attrs: { level: 2 }, children: [{ type: 'text', value: 'Updated' }] },
      { type: 'paragraph', children: [{ type: 'text', value: 'Version 2' }] },
    ];

    const { data: updated } = await api(`/api/documents/${created.id}`, {
      method: 'PUT',
      body: { meta: { title: 'Sequence Test Updated' }, blocks: newBlocks },
    });

    assert.equal(updated.meta.title, 'Sequence Test Updated');
    assert.deepStrictEqual(updated.blocks, newBlocks);

    // Fetch again to verify persistence
    const { data: fetched } = await api(`/api/documents/${created.id}`);
    assert.deepStrictEqual(fetched.blocks, newBlocks);
  });
});
