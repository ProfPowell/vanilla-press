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

  it("importWebImage from the editor carries the open document's id, level and section", async () => {
    const bodies = [];
    globalThis.fetch = async (url, opts) => { bodies.push(JSON.parse(opts.body)); return new Response('{}', { status: 200 }); };
    await api.importWebImage({ source: 'pexels', id: '1' });
    api.setDocumentContext(() => ({ id: 'doc_a', access: 'friends', section: 'club' }));
    try {
      await api.importWebImage({ source: 'pexels', id: '2' });
    } finally {
      api.setDocumentContext(null);
    }
    assert.deepEqual(bodies[0], { source: 'pexels', id: '1' });
    assert.deepEqual(bodies[1], { source: 'pexels', id: '2', document: 'doc_a', documentAccess: 'friends', documentSection: 'club' });
  });

  it('updateDocument saves a document: PUT /documents/<id>', async () => {
    await api.updateDocument('x', { meta: {} });
    assert.deepEqual(calls, [{ url: '/api/documents/x', method: 'PUT' }]);
  });

  it('the Update action is a separate method: POST /documents/<id>/update', async () => {
    await api.updatePost('x');
    assert.deepEqual(calls, [{ url: '/api/documents/x/update', method: 'POST' }]);
  });

  it('socialLinks: GET /social/links with the query', async () => {
    await api.socialLinks({ services: 'github', variant: 'icon' });
    assert.deepEqual(calls, [{ url: '/api/social/links?services=github&variant=icon', method: 'GET' }]);
  });

  it('social and socialFeed: GET /social and GET /social/feed with the query', async () => {
    await api.social();
    await api.socialFeed({ accounts: 'github:carol-dev', items: '5', 'hide-counts': 'true' });
    assert.deepEqual(calls, [
      { url: '/api/social', method: 'GET' },
      { url: '/api/social/feed?accounts=github%3Acarol-dev&items=5&hide-counts=true', method: 'GET' },
    ]);
  });

  it('components: GET /components and PUT /components/<encoded pkg>', async () => {
    await api.listComponents();
    await api.setComponent('@profpowell/browser-window', true);
    assert.deepEqual(calls, [
      { url: '/api/components', method: 'GET' },
      { url: '/api/components/%40profpowell%2Fbrowser-window', method: 'PUT' },
    ]);
  });

  it('web images: search and import (the server pings Unsplash; the client has no ping)', async () => {
    globalThis.fetch = async (url, opts) => {
      calls.push({ url, method: opts.method, body: opts.body });
      return new Response(url.endsWith('/download') ? null : '{}', { status: url.endsWith('/download') ? 204 : 200 });
    };
    await api.searchWebImages('red barn', { page: 2, for: 'library' });
    await api.importWebImage({ source: 'pexels', id: '12', alt: 'A barn' });
    assert.equal('pingUnsplash' in api, false);
    assert.deepEqual(calls, [
      { url: '/api/web-images?q=red+barn&page=2&for=library', method: 'GET', body: undefined },
      { url: '/api/media/import', method: 'POST', body: '{"source":"pexels","id":"12","alt":"A barn"}' },
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
