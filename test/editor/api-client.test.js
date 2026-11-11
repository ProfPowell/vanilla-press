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

  it('web images: search, import and the Unsplash ping', async () => {
    globalThis.fetch = async (url, opts) => {
      calls.push({ url, method: opts.method, body: opts.body });
      return new Response(url.endsWith('/download') ? null : '{}', { status: url.endsWith('/download') ? 204 : 200 });
    };
    await api.searchWebImages('red barn', { page: 2, for: 'library' });
    await api.importWebImage({ source: 'pexels', id: '12', alt: 'A barn' });
    await api.pingUnsplash('a/b');
    assert.deepEqual(calls, [
      { url: '/api/web-images?q=red+barn&page=2&for=library', method: 'GET', body: undefined },
      { url: '/api/media/import', method: 'POST', body: '{"source":"pexels","id":"12","alt":"A barn"}' },
      { url: '/api/web-images/unsplash/a%2Fb/download', method: 'POST', body: undefined },
    ]);
  });

  it('a failed web search throws with the server\'s message', async () => {
    globalThis.fetch = async () => new Response('{"error":"Type something to search for"}', { status: 400 });
    await assert.rejects(api.searchWebImages(' '), { message: 'Type something to search for', status: 400 });
  });

  it('the api object literal has no duplicate method names', () => {
    const src = readFileSync(join(jsDir, 'api-client.js'), 'utf8');
    const body = src.slice(src.indexOf('export const api = {'));
    const names = [...body.matchAll(/^ {2}(?:async )?([A-Za-z_$][\w$]*)\s*\(/gm)].map((m) => m[1]);
    assert.ok(names.length > 10);
    assert.deepEqual(names.filter((n, i) => names.indexOf(n) !== i), []);
  });
});
