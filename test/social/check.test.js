import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkAccount } from '../../src/social/check.js';

const json = (status, data) => ({ status, ok: status >= 200 && status < 300, json: async () => data });
const route = (table) => async (url) => {
  const hit = Object.entries(table).find(([k]) => url.startsWith(k));
  if (!hit) throw new Error(`unexpected ${url}`);
  const v = hit[1];
  if (v instanceof Error) throw v;
  return typeof v === 'function' ? v(url) : v;
};
const BSKY = 'https://public.api.bsky.app/xrpc/';

describe('checkAccount', () => {
  it('Bluesky ok: resolves the handle, then reads the profile', async () => {
    const seen = [];
    const fetch = async (url) => {
      seen.push(url);
      return url.includes('resolveHandle')
        ? json(200, { did: 'did:plc:abc' })
        : json(200, { displayName: 'Tom', avatar: 'https://cdn/a.jpg', handle: 'tpowell.bsky.social' });
    };
    const r = await checkAccount({ service: 'bluesky', handle: 'tpowell.bsky.social' }, { fetch });
    assert.deepEqual(r, { status: 'ok', handle: 'tpowell.bsky.social', did: 'did:plc:abc', displayName: 'Tom', avatar: 'https://cdn/a.jpg' });
    assert.equal(seen[0], `${BSKY}com.atproto.identity.resolveHandle?handle=tpowell.bsky.social`);
    assert.equal(seen[1], `${BSKY}app.bsky.actor.getProfile?actor=did%3Aplc%3Aabc`);
  });
  it('Bluesky ok even when the profile read fails', async () => {
    const fetch = route({ [`${BSKY}com.atproto.identity`]: json(200, { did: 'did:plc:abc' }), [`${BSKY}app.bsky`]: json(500, {}) });
    const r = await checkAccount({ service: 'bluesky', handle: 'a.example.com' }, { fetch });
    assert.equal(r.status, 'ok');
    assert.equal(r.did, 'did:plc:abc');
  });
  it('Bluesky not found: a 400 with the service message', async () => {
    const fetch = route({ [BSKY]: json(400, { error: 'InvalidRequest', message: 'Unable to resolve handle' }) });
    const r = await checkAccount({ service: 'bluesky', handle: 'nobody.example.com' }, { fetch });
    assert.deepEqual(r, { status: 'not-found', handle: 'nobody.example.com', message: 'Unable to resolve handle' });
  });
  it('Bluesky not found without a body: a plain sentence', async () => {
    const fetch = async () => ({ status: 400, ok: false, json: async () => { throw new Error('no body'); } });
    const r = await checkAccount({ service: 'bluesky', handle: 'x.example.com' }, { fetch });
    assert.equal(r.message, 'No Bluesky account has that handle');
  });
  it('Bluesky unreachable: 5xx and network error', async () => {
    for (const fetch of [route({ [BSKY]: json(503, {}) }), route({ [BSKY]: new Error('ECONNRESET') })]) {
      const r = await checkAccount({ service: 'bluesky', handle: 'x.example.com' }, { fetch });
      assert.deepEqual(r, { status: 'unreachable', handle: 'x.example.com', message: 'Not checked yet' });
    }
  });

  it('Mastodon ok, not found, unreachable', async () => {
    const url = 'https://hachyderm.io/api/v1/accounts/lookup?acct=tom';
    let seen;
    const ok = async (u) => { seen = u; return json(200, { display_name: 'Tom', avatar: 'https://h/a.png' }); };
    const a = { service: 'mastodon', handle: '@tom@hachyderm.io' };
    assert.deepEqual(await checkAccount(a, { fetch: ok }), { status: 'ok', handle: a.handle, displayName: 'Tom', avatar: 'https://h/a.png' });
    assert.equal(seen, url);
    const nf = await checkAccount(a, { fetch: route({ 'https://hachyderm.io': json(404, { error: 'Record not found' }) }) });
    assert.deepEqual(nf, { status: 'not-found', handle: a.handle, message: 'Record not found' });
    assert.equal((await checkAccount(a, { fetch: route({ 'https://hachyderm.io': json(502, {}) }) })).status, 'unreachable');
  });

  it('GitHub ok, not found, unreachable', async () => {
    const a = { service: 'github', handle: 'ProfPowell' };
    let seen;
    const ok = async (u) => { seen = u; return json(200, { name: 'Tom', avatar_url: 'https://g/a.png' }); };
    assert.deepEqual(await checkAccount(a, { fetch: ok }), { status: 'ok', handle: 'ProfPowell', displayName: 'Tom', avatar: 'https://g/a.png' });
    assert.equal(seen, 'https://api.github.com/users/ProfPowell');
    const nf = await checkAccount(a, { fetch: route({ 'https://api.github.com': json(404, { message: 'Not Found' }) }) });
    assert.deepEqual(nf, { status: 'not-found', handle: 'ProfPowell', message: 'Not Found' });
    assert.equal((await checkAccount(a, { fetch: route({ 'https://api.github.com': json(500, {}) }) })).status, 'unreachable');
    assert.equal((await checkAccount(a, { fetch: route({ 'https://api.github.com': json(403, {}) }) })).status, 'unreachable');
  });

  it('LinkedIn, YouTube and link are unchecked and never fetched', async () => {
    const fetch = async () => { throw new Error('must not fetch'); };
    for (const [service, handle] of [['linkedin', 'tom'], ['youtube', '@tom'], ['link', 'https://x.example']]) {
      const r = await checkAccount({ service, handle }, { fetch });
      assert.deepEqual(r, { status: 'unchecked', handle, message: "Not checked: open the link to make sure it's you" });
    }
  });

  it('a fetch that never answers is unreachable after timeoutMs', async () => {
    const fetch = () => new Promise(() => {});
    const t = Date.now();
    const r = await checkAccount({ service: 'github', handle: 'slow' }, { fetch, timeoutMs: 50 });
    assert.equal(r.status, 'unreachable');
    assert.ok(Date.now() - t < 2000);
  });
});
