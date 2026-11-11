import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createImageSearch } from '../../src/services/image-search.js';
import { updateService } from '../../src/services/store.js';
import { MAX_BYTES } from '../../src/media/limits.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/image-sources');
const fixture = (name) => JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8'));
const HOUR = 60 * 60 * 1000;

const HOSTS = {
  'api.openverse.org': 'openverse',
  'api.pexels.com': 'pexels',
  'pixabay.com': 'pixabay',
  'api.unsplash.com': 'unsplash',
};

/** A fake fetch that answers each API with its fixture and any other URL with image bytes
 * (override with `image`), and records every call. */
function fakeFetch(overrides = {}) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const { hostname, pathname } = new URL(url);
    const api = HOSTS[hostname];
    const source = api === 'pixabay' && !pathname.startsWith('/api/') ? undefined : api;
    calls.push({ url, source, headers: init.headers || {} });
    const override = overrides[source ?? 'image'];
    if (override) return override(url, init);
    if (!source) return new Response(Buffer.from('IMAGEBYTES'), { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
    return Response.json(fixture(source));
  };
  fn.calls = calls;
  fn.callsTo = (source) => calls.filter((c) => c.source === source);
  return fn;
}

describe('image search', () => {
  let dir, env, clock;
  const now = () => clock;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vp-image-search-'));
    env = { VP_CONFIG_DIR: dir };
    clock = 1_000_000;
    updateService('pexels', { key: 'PX-SECRET' }, env);
    updateService('pixabay', { key: 'PB-SECRET' }, env);
    updateService('unsplash', { key: 'US-SECRET' }, env);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('merges every ready source, round-robin', async () => {
    const fetch = fakeFetch();
    const search = createImageSearch({ env, fetch, now });
    const { results, errors, hasMore } = await search.search('fox', { page: 1, for: 'picker' });
    assert.deepEqual(errors, []);
    assert.equal(hasMore, true);
    assert.deepEqual(results.map((r) => r.source), [
      'openverse', 'pexels', 'pixabay', 'unsplash',
      'openverse', 'pexels', 'pixabay', 'unsplash',
    ]);
    assert.deepEqual(fetch.callsTo('pexels')[0].headers, { Authorization: 'PX-SECRET' });
  });

  it('skips sources that are not ready without calling fetch', async () => {
    updateService('pexels', { key: '' }, env);
    updateService('openverse', { enabled: false }, env);
    const fetch = fakeFetch();
    const search = createImageSearch({ env, fetch, now });
    const { results, errors } = await search.search('fox', { page: 1 });
    assert.deepEqual(errors, []);
    assert.equal(fetch.callsTo('pexels').length, 0);
    assert.equal(fetch.callsTo('openverse').length, 0);
    assert.deepEqual([...new Set(results.map((r) => r.source))], ['pixabay', 'unsplash']);
  });

  it('a 401 becomes an error entry naming the source; others still come back', async () => {
    const fetch = fakeFetch({ pexels: async () => new Response('{"error":"bad key PX-SECRET"}', { status: 401 }) });
    const search = createImageSearch({ env, fetch, now });
    const out = await search.search('fox', { page: 1 });
    assert.deepEqual(out.errors, [{ source: 'pexels', label: 'Pexels', message: "Pexels didn't accept the key" }]);
    assert.deepEqual([...new Set(out.results.map((r) => r.source))], ['openverse', 'pixabay', 'unsplash']);
    assert.equal(JSON.stringify(out).includes('SECRET'), false);
  });

  it('a source that never answers times out', async () => {
    const fetch = fakeFetch({ pexels: () => new Promise(() => {}) });
    const search = createImageSearch({ env, fetch, now, timeoutMs: 20 });
    const out = await search.search('fox', { page: 1 });
    assert.deepEqual(out.errors, [{ source: 'pexels', label: 'Pexels', message: "Pexels didn't answer in time" }]);
    assert.equal(out.results.filter((r) => r.source === 'openverse').length, 2);
  });

  it('a network failure never leaks the key', async () => {
    const fetch = fakeFetch({ pixabay: async (url) => { throw new TypeError(`fetch failed ${url}`); } });
    const search = createImageSearch({ env, fetch, now });
    const out = await search.search('fox', { page: 1 });
    assert.equal(out.errors.length, 1);
    assert.equal(out.errors[0].source, 'pixabay');
    assert.equal(JSON.stringify(out).includes('PB-SECRET'), false);
  });

  it('caches Pixabay for 24 hours and the others for 1 hour', async () => {
    const fetch = fakeFetch();
    const search = createImageSearch({ env, fetch, now });
    await search.search('fox', { page: 1 });
    clock += HOUR + 1;
    await search.search('fox', { page: 1 });
    assert.equal(fetch.callsTo('pixabay').length, 1);
    assert.equal(fetch.callsTo('pexels').length, 2);
    clock += 23 * HOUR;
    await search.search('fox', { page: 1 });
    assert.equal(fetch.callsTo('pixabay').length, 2);
  });

  it('caches by query and page', async () => {
    const fetch = fakeFetch();
    const search = createImageSearch({ env, fetch, now });
    await search.search('fox', { page: 1 });
    await search.search('fox', { page: 1 });
    assert.equal(fetch.callsTo('pexels').length, 1);
    await search.search('fox', { page: 2 });
    await search.search('owl', { page: 1 });
    assert.equal(fetch.callsTo('pexels').length, 3);
  });

  it('does not cache a failure', async () => {
    let fail = true;
    const fetch = fakeFetch({ pexels: async () => (fail ? new Response('', { status: 500 }) : Response.json(fixture('pexels'))) });
    const search = createImageSearch({ env, fetch, now });
    assert.equal((await search.search('fox', { page: 1 })).errors.length, 1);
    fail = false;
    assert.equal((await search.search('fox', { page: 1 })).errors.length, 0);
  });

  it("for: 'library' drops Unsplash", async () => {
    const fetch = fakeFetch();
    const search = createImageSearch({ env, fetch, now });
    const { results } = await search.search('fox', { page: 1, for: 'library' });
    assert.equal(results.some((r) => r.source === 'unsplash'), false);
    assert.equal(fetch.callsTo('unsplash').length, 0);
  });

  it('get returns an earlier result, null for an unknown or expired one', async () => {
    const fetch = fakeFetch();
    const search = createImageSearch({ env, fetch, now });
    await search.search('fox', { page: 1 });
    assert.equal(search.get('pexels', '2014422').url,
      'https://images.pexels.com/photos/2014422/pexels-photo-2014422.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940');
    assert.equal(search.get('pexels', 'nope'), null);
    assert.equal(search.get('nope', '2014422'), null);
    clock += HOUR + 1;
    assert.equal(search.get('pexels', '2014422'), null);
    assert.notEqual(search.get('pixabay', '195893'), null);
  });

  it('image fetches only the cached result URL', async () => {
    const fetch = fakeFetch();
    const search = createImageSearch({ env, fetch, now });
    await search.search('fox', { page: 1 });
    const before = fetch.calls.length;
    const { data, contentType } = await search.image('pixabay', '195893');
    assert.equal(fetch.calls[before].url, 'https://pixabay.com/get/ed6a99fd0a76647_1280.jpg');
    assert.equal(data.toString(), 'IMAGEBYTES');
    assert.equal(contentType, 'image/jpeg');
    await assert.rejects(search.image('pixabay', 'nope'), (err) => err.status === 404);
  });

  it('the deadline covers the body: a body that never finishes times out', async () => {
    const stalled = async () => new Response(new ReadableStream({ start() {} }), { status: 200 });
    const fetch = fakeFetch({ pexels: stalled });
    const search = createImageSearch({ env, fetch, now, timeoutMs: 50 });
    const out = await search.search('fox', { page: 1 });
    assert.deepEqual(out.errors, [{ source: 'pexels', label: 'Pexels', message: "Pexels didn't answer in time" }]);
    assert.equal(out.results.length, 6);
  });

  it('image() rejects when the image body never finishes', async () => {
    const slow = createImageSearch({ env, now, timeoutMs: 50, imageTimeoutMs: 50,
      fetch: fakeFetch({ image: async () => new Response(new ReadableStream({ start() {} })) }) });
    await slow.search('fox', { page: 1 });
    await assert.rejects(slow.image('pixabay', '195893'), (err) => err.status === 504 && /didn't answer in time/.test(err.message));
  });

  it("Pixabay's 400 for a bad key reads as a key error", async () => {
    const fetch = fakeFetch({ pixabay: async () => new Response('[ERROR 400] Invalid or missing API key', { status: 400 }) });
    const search = createImageSearch({ env, fetch, now });
    const out = await search.search('fox', { page: 1 });
    assert.deepEqual(out.errors, [{ source: 'pixabay', label: 'Pixabay', message: "Pixabay didn't accept the key" }]);
  });

  it('a 400 for another reason is not a key error', async () => {
    const fetch = fakeFetch({ pixabay: async () => new Response('[ERROR 400] "q" exceeds the maximum length', { status: 400 }) });
    const search = createImageSearch({ env, fetch, now });
    const out = await search.search('fox', { page: 1 });
    assert.deepEqual(out.errors, [{ source: 'pixabay', label: 'Pixabay', message: "Pixabay couldn't search right now" }]);
  });

  it('403 is a key error for every source', async () => {
    const forbidden = async () => new Response('', { status: 403 });
    const fetch = fakeFetch({ pexels: forbidden, pixabay: forbidden, unsplash: forbidden });
    const search = createImageSearch({ env, fetch, now });
    const out = await search.search('fox', { page: 1 });
    assert.deepEqual(out.errors.map((e) => e.message), [
      "Pexels didn't accept the key", "Pixabay didn't accept the key", "Unsplash didn't accept the key",
    ]);
  });

  it('image() stops a streamed body once it passes the cap (413)', async () => {
    let pulled = 0;
    const endless = async () => new Response(new ReadableStream({
      pull(controller) { pulled += 1; controller.enqueue(new Uint8Array(1024)); },
    }), { headers: { 'Content-Type': 'image/jpeg' } });
    const search = createImageSearch({ env, now, maxBytes: 4096, fetch: fakeFetch({ image: endless }) });
    await search.search('fox', { page: 1 });
    await assert.rejects(search.image('pixabay', '195893'), (err) => err.status === 413);
    assert.ok(pulled < 20, `read ${pulled} chunks`);
  });

  it('image() refuses a declared Content-Length over MAX_BYTES (413)', async () => {
    const huge = async () => new Response(new ReadableStream({ start() {} }), {
      headers: { 'Content-Type': 'image/jpeg', 'Content-Length': String(MAX_BYTES + 1) },
    });
    const search = createImageSearch({ env, now, fetch: fakeFetch({ image: huge }) });
    await search.search('fox', { page: 1 });
    await assert.rejects(search.image('pixabay', '195893'), (err) => err.status === 413);
  });

  it('image() accepts a body exactly at the cap', async () => {
    const exact = async () => new Response(new Uint8Array(4096), { headers: { 'Content-Type': 'image/png' } });
    const search = createImageSearch({ env, now, maxBytes: 4096, fetch: fakeFetch({ image: exact }) });
    await search.search('fox', { page: 1 });
    const { data, contentType } = await search.image('pixabay', '195893');
    assert.equal(data.length, 4096);
    assert.equal(contentType, 'image/png');
  });
});

