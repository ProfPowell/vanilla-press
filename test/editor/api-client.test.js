import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { api } from '../../editor/assets/js/api-client.js';

const jsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'editor', 'assets', 'js');

describe('editor api client', () => {
  let calls, realFetch;
  beforeEach(() => {
    calls = [];
    realFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => { calls.push({ url, method: opts.method }); return new Response('{}', { status: 200 }); };
  });
  afterEach(() => { globalThis.fetch = realFetch; });

  it('updateDocument saves a document: PUT /documents/<id>', async () => {
    await api.updateDocument('x', { meta: {} });
    assert.deepEqual(calls, [{ url: '/api/documents/x', method: 'PUT' }]);
  });

  it('the Update action is a separate method: POST /documents/<id>/update', async () => {
    await api.updatePost('x');
    assert.deepEqual(calls, [{ url: '/api/documents/x/update', method: 'POST' }]);
  });

  it('components: GET /components and PUT /components/<encoded pkg>', async () => {
    await api.listComponents();
    await api.setComponent('@profpowell/browser-window', true);
    assert.deepEqual(calls, [
      { url: '/api/components', method: 'GET' },
      { url: '/api/components/%40profpowell%2Fbrowser-window', method: 'PUT' },
    ]);
  });

  it('the api object literal has no duplicate method names', () => {
    const src = readFileSync(join(jsDir, 'api-client.js'), 'utf8');
    const body = src.slice(src.indexOf('export const api = {'));
    const names = [...body.matchAll(/^ {2}(?:async )?([A-Za-z_$][\w$]*)\s*\(/gm)].map((m) => m[1]);
    assert.ok(names.length > 10);
    assert.deepEqual(names.filter((n, i) => names.indexOf(n) !== i), []);
  });
});
