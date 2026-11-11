import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startApp } from '../../src/app/server.js';

describe('service routes', () => {
  let root, app;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), 'vp-service-routes-'));
    app = await startApp({ port: 0, env: { VP_CONFIG_DIR: join(root, 'config') } });
  });
  after(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  const put = (id, body) => fetch(`${app.url}/api/services/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });

  it('GET lists the groups', async () => {
    const res = await fetch(`${app.url}/api/services`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.deepEqual(data.groups.map((g) => g.id), ['image-search', 'sound-video', 'ai']);
    assert.equal(data.groups[0].services.find((s) => s.id === 'openverse').ready, true);
  });

  it('PUT an unknown id is 404', async () => {
    assert.equal((await put('nope', { enabled: true })).status, 404);
  });

  it('PUT a bad body is 400', async () => {
    assert.equal((await put('pexels', { key: 5 })).status, 400);
    assert.equal((await put('pexels', { enabled: 'yes' })).status, 400);
  });

  it('PUT saves a key and never returns it', async () => {
    const res = await put('pexels', { key: ' SECRET-XYZ ' });
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.equal(text.includes('SECRET-XYZ'), false);
    const data = JSON.parse(text);
    assert.equal(data.hasKey, true);
    assert.equal(data.ready, true);
    const list = await (await fetch(`${app.url}/api/services`)).text();
    assert.equal(list.includes('SECRET-XYZ'), false);
  });
});

describe('web image search route', () => {
  let root, app, calls;
  const fakeFetch = async (url) => {
    calls.push(url);
    if (new URL(url).hostname === 'api.openverse.org') {
      return Response.json({ page: 1, page_count: 1, results: [{
        id: 'ov-1', title: 'Fox', url: 'https://example.org/fox.jpg', thumbnail: 'https://example.org/fox-thumb.jpg',
        width: 800, height: 600, creator: 'Jane', creator_url: 'https://example.org/jane', source: 'flickr',
        foreign_landing_url: 'https://example.org/fox', license: 'cc0', license_version: '1.0',
        license_url: 'https://creativecommons.org/publicdomain/zero/1.0/',
      }] });
    }
    return new Response('', { status: 401 });
  };
  before(async () => {
    calls = [];
    root = mkdtempSync(join(tmpdir(), 'vp-web-images-'));
    app = await startApp({ port: 0, env: { VP_CONFIG_DIR: join(root, 'config') }, fetch: fakeFetch });
  });
  after(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('an empty q is 400', async () => {
    assert.equal((await fetch(`${app.url}/api/web-images?q=%20`)).status, 400);
    assert.equal((await fetch(`${app.url}/api/web-images`)).status, 400);
  });

  it('an unknown for is 400', async () => {
    assert.equal((await fetch(`${app.url}/api/web-images?q=fox&for=everything`)).status, 400);
  });

  it('searches the ready sources and reports a rejected key by label only', async () => {
    await fetch(`${app.url}/api/services/pexels`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'SECRET-PX' }),
    });
    const res = await fetch(`${app.url}/api/web-images?q=fox&page=1&for=library`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.equal(text.includes('SECRET-PX'), false);
    const data = JSON.parse(text);
    assert.deepEqual(data.results.map((r) => `${r.source}:${r.id}`), ['openverse:ov-1']);
    assert.deepEqual(data.errors, [{ source: 'pexels', label: 'Pexels', message: "Pexels didn't accept the key" }]);
    assert.equal(data.hasMore, false);
    assert.equal(calls.some((u) => u.includes('unsplash')), false);
  });
});
