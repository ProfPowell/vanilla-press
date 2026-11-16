import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startApp } from '../../src/app/server.js';
import { pathToFileURL } from 'node:url';
import * as standIn from './fixtures/cook-social.js';

// Opt-in contract run: COOK_SOCIAL_MODULE=<cook>/scripts/social/index.js runs the same
// routes against Cook's real module. Unset: only the stand-in; the real Cook is never imported.
const REAL = process.env.COOK_SOCIAL_MODULE;
const modules = [['stand-in', async () => standIn]];
if (REAL) modules.push(['real Cook module', () => import(pathToFileURL(REAL).href)]);

const CONNECTED = { isRepo: true, branch: 'main', hasRemote: true, hasUpstream: true };
const json = (status, data) => ({ status, ok: status >= 200 && status < 300, json: async () => data });
const BSKY = 'https://public.api.bsky.app/xrpc/';

for (const [label, loadModule] of modules) describe(`social routes (${label})`, () => {
  let root, app, site, id, cook, cookSocial;
  const commits = [];
  const pushes = [];
  const fakeGit = {
    cloneRepo: async () => {},
    changedFiles: async () => [],
    pullFastForward: async () => ({}),
    gitStatus: async () => CONNECTED,
    commitPaths: async (dir, paths, message) => { commits.push({ paths, message }); return 'abc123'; },
    push: async (dir) => { pushes.push(dir); return { pushed: true, rebased: false }; },
  };
  const defaults = { ...fakeGit };
  // Account answers by handle; anything else is "unreachable" via a 503.
  let answers;
  const fakeFetch = async (url) => {
    if (typeof url === 'string' && url.startsWith(BSKY)) {
      const u = new URL(url);
      if (u.pathname.endsWith('resolveHandle')) {
        const a = answers[`bsky:${u.searchParams.get('handle')}`];
        return a ?? json(503, {});
      }
      return json(200, { displayName: 'N', handle: 'new.example.com' });
    }
    if (url.startsWith('https://api.github.com/users/')) return answers[`gh:${url.split('/').pop()}`] ?? json(503, {});
    throw new Error(`unexpected fetch ${url}`);
  };

  async function api(path, { method = 'GET', body } = {}) {
    const opts = { method };
    if (body !== undefined) { opts.headers = { 'Content-Type': 'application/json' }; opts.body = JSON.stringify(body); }
    const res = await fetch(`${app.url}/api/sites/${id}${path}`, opts);
    const text = await res.text();
    let data = text;
    try { data = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, data };
  }
  const file = () => JSON.parse(readFileSync(join(site, 'config', 'social.json'), 'utf8'));
  const seed = (obj) => {
    mkdirSync(join(site, 'config'), { recursive: true });
    writeFileSync(join(site, 'config', 'social.json'), JSON.stringify(obj, null, 2));
  };

  before(async () => {
    root = mkdtempSync(join(tmpdir(), 'vp-social-routes-'));
    site = join(root, 'site');
    mkdirSync(join(site, 'src'), { recursive: true });
    writeFileSync(join(site, 'package.json'), JSON.stringify({ name: 'site', devDependencies: { 'cook-ssg': '^2.10.0' } }));
    cookSocial = await loadModule();
    cook = cookSocial;
    app = await startApp({
      port: 0, env: { VP_CONFIG_DIR: join(root, 'config') }, git: fakeGit, fetch: fakeFetch,
      cookSocial: () => cook,
    });
    const res = await fetch(`${app.url}/api/sites`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: site, name: 'Site' }),
    });
    id = (await res.json()).id;
  });
  after(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });
  beforeEach(() => {
    Object.assign(fakeGit, defaults);
    commits.length = 0;
    pushes.length = 0;
    cook = cookSocial;
    answers = {
      'bsky:tpowell.bsky.social': json(200, { did: 'did:plc:abc' }),
      'bsky:nobody.example.com': json(400, { error: 'InvalidRequest', message: 'Unable to resolve handle' }),
      'gh:ProfPowell': json(200, { name: 'Tom' }),
    };
    seed({ about: { name: 'Tom' }, accounts: [], following: [1] });
  });

  it('GET /social: accounts and cookReady', async () => {
    seed({ accounts: [{ service: 'github', handle: 'ProfPowell' }] });
    const r = await api('/social');
    assert.equal(r.status, 200);
    assert.deepEqual(r.data, { accounts: [{ service: 'github', handle: 'ProfPowell', profileUrl: 'https://github.com/ProfPowell', valid: true }], cookReady: true, needsCook: null, about: null, contact: null, following: [], socialSpecReady: true });
  });

  it('GET /social gives Cook\'s url and valid per account, however the file was hand-edited', async () => {
    seed({ accounts: [
      { service: 'mastodon', handle: 'tpowell@mastodon.social' },
      { service: 'link', label: 'Evil', url: 'javascript:alert(1)' },
      { service: 'github', handle: 'ProfPowell' },
      { service: 'nope', handle: 'x' },
    ] });
    const r = await api('/social');
    assert.deepEqual(r.data.accounts.map((a) => [a.valid, a.profileUrl]), [
      [true, 'https://mastodon.social/@tpowell'],
      [false, null],
      [true, 'https://github.com/ProfPowell'],
      [false, null],
    ]);
    assert.equal(file().accounts[0].profileUrl, undefined, 'the file is not annotated');
  });

  it('a site without Cook social: GET says needsCook, every other route is 409', async () => {
    cook = null;
    const g = await api('/social');
    assert.deepEqual(g.data, { accounts: [], cookReady: false, needsCook: '2.10.0', about: { name: 'Tom' }, contact: null, following: [1], socialSpecReady: false });
    for (const [path, method, body] of [
      ['/social/check', 'POST', { service: 'github', input: 'x' }],
      ['/social/recheck', 'GET'],
      ['/social/accounts', 'PUT', { accounts: [] }],
      ['/social/links', 'GET'],
    ]) {
      const r = await api(path, { method, body });
      assert.equal(r.status, 409, path);
      assert.equal(r.data.cookReady, false);
      assert.equal(r.data.needsCook, '2.10.0');
    }
    assert.equal(commits.length, 0);
  });

  it('POST /social/check parses then checks; a parse error is 400', async () => {
    const ok = await api('/social/check', { method: 'POST', body: { service: 'bluesky', input: '@TPowell.bsky.social' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.status, 'ok');
    assert.equal(ok.data.handle, 'tpowell.bsky.social');
    assert.equal(ok.data.did, 'did:plc:abc');
    const bad = await api('/social/check', { method: 'POST', body: { service: 'bluesky', input: 'not a handle' } });
    assert.equal(bad.status, 400);
    assert.equal(bad.data.error, 'Bluesky handles look like name.bsky.social');
  });

  it('PUT saves checked accounts: did stored, about/following kept, commit is only social.json', async () => {
    const r = await api('/social/accounts', { method: 'PUT', body: { accounts: [
      { service: 'bluesky', handle: '@tpowell.bsky.social' }, { service: 'github', handle: 'ProfPowell', hidden: true },
    ] } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.committed, true);
    assert.equal(r.data.note, undefined);
    const f = file();
    assert.deepEqual(f.accounts, [
      { service: 'bluesky', handle: 'tpowell.bsky.social', did: 'did:plc:abc', checked: 'yes' },
      { service: 'github', handle: 'ProfPowell', hidden: true, checked: 'yes' },
    ]);
    assert.deepEqual(r.data.accounts, f.accounts.map((a) => ({
      ...a, valid: true, profileUrl: a.service === 'github' ? 'https://github.com/ProfPowell' : 'https://bsky.app/profile/tpowell.bsky.social',
    })));
    assert.deepEqual(f.about, { name: 'Tom' });
    assert.deepEqual(f.following, [1]);
    assert.equal(commits.length, 1);
    assert.deepEqual(commits[0].paths, ['config/social.json']);
    assert.equal(commits[0].message, 'Social: accounts');
    assert.equal(pushes.length, 1);
  });

  it('PUT refuses a not-found account with 422 and writes nothing', async () => {
    const r = await api('/social/accounts', { method: 'PUT', body: { accounts: [{ service: 'bluesky', handle: 'nobody.example.com' }] } });
    assert.equal(r.status, 422);
    assert.equal(r.data.error, 'Unable to resolve handle');
    assert.deepEqual(file().accounts, []);
    assert.equal(commits.length, 0);
  });

  it('PUT with an unreachable service is 409, and saveUnchecked stores checked: "no"', async () => {
    const body = { accounts: [{ service: 'github', handle: 'Slowpoke' }] };
    const r = await api('/social/accounts', { method: 'PUT', body });
    assert.equal(r.status, 409);
    assert.equal(r.data.unreachable[0].handle, 'Slowpoke');
    assert.deepEqual(file().accounts, []);
    const s = await api('/social/accounts', { method: 'PUT', body: { ...body, saveUnchecked: true } });
    assert.equal(s.status, 200);
    assert.deepEqual(file().accounts, [{ service: 'github', handle: 'Slowpoke', checked: 'no' }]);
  });

  it('PUT stores LinkedIn, YouTube and link as checked: "never" without fetching', async () => {
    const r = await api('/social/accounts', { method: 'PUT', body: { accounts: [
      { service: 'linkedin', handle: 'tom' }, { service: 'youtube', handle: '@tom' },
      { service: 'link', label: 'Blog', url: 'https://blog.example' },
    ] } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.deepEqual(file().accounts.map((a) => a.checked), ['never', 'never', 'never']);
  });

  it('PUT does not re-check an account already in the file, and keeps its did', async () => {
    seed({ accounts: [{ service: 'bluesky', handle: 'tpowell.bsky.social', did: 'did:plc:abc', checked: 'yes' }] });
    answers = {}; // any check would be unreachable
    const r = await api('/social/accounts', { method: 'PUT', body: { accounts: [{ service: 'bluesky', handle: 'tpowell.bsky.social' }] } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.deepEqual(file().accounts, [{ service: 'bluesky', handle: 'tpowell.bsky.social', did: 'did:plc:abc', checked: 'yes' }]);
  });

  it('PUT with a bad entry is 400 naming it', async () => {
    const r = await api('/social/accounts', { method: 'PUT', body: { accounts: [{ service: 'github', handle: 'bad handle' }] } });
    assert.equal(r.status, 400);
    assert.equal(r.data.index, 0);
    const l = await api('/social/accounts', { method: 'PUT', body: { accounts: [{ service: 'link', label: 'x', url: 'http://insecure.example' }] } });
    assert.equal(l.status, 400);
  });

  it('PUT without a repo saves and says not committed', async () => {
    fakeGit.gitStatus = async () => ({ isRepo: false });
    const r = await api('/social/accounts', { method: 'PUT', body: { accounts: [{ service: 'github', handle: 'ProfPowell' }] } });
    assert.equal(r.status, 200);
    assert.equal(r.data.committed, false);
    assert.match(r.data.note, /not committed/);
    assert.equal(file().accounts.length, 1);
    assert.equal(commits.length, 0);
  });

  it('PUT when the push fails keeps the commit and notes it', async () => {
    fakeGit.push = async () => { throw new Error('rejected'); };
    const r = await api('/social/accounts', { method: 'PUT', body: { accounts: [{ service: 'github', handle: 'ProfPowell' }] } });
    assert.equal(r.status, 200);
    assert.equal(r.data.committed, false);
    assert.match(r.data.note, /not pushed to GitHub \(rejected\)/);
    assert.equal(commits.length, 1);
  });

  it('GET /social/recheck flags a Bluesky DID mismatch and does not write', async () => {
    const stored = { accounts: [
      { service: 'bluesky', handle: 'tpowell.bsky.social', did: 'did:plc:OLD' },
      { service: 'github', handle: 'ProfPowell' },
      { service: 'linkedin', handle: 'tom' },
    ] };
    seed(stored);
    const before = readFileSync(join(site, 'config', 'social.json'), 'utf8');
    const r = await api('/social/recheck');
    assert.equal(r.status, 200);
    const [b, g, l] = r.data.results;
    assert.equal(b.status, 'ok');
    assert.equal(b.mismatch, true);
    assert.equal(b.currentHandle, 'new.example.com');
    assert.equal(g.status, 'ok');
    assert.equal(g.mismatch, undefined);
    assert.equal(l.status, 'unchecked');
    assert.equal(readFileSync(join(site, 'config', 'social.json'), 'utf8'), before);
    assert.equal(commits.length, 0);
  });

  it('GET /social/links renders visible accounts and honours services and variant', async () => {
    seed({ accounts: [
      { service: 'github', handle: 'ProfPowell' },
      { service: 'mastodon', handle: '@tom@hachyderm.io' },
      { service: 'link', label: 'Blog', url: 'https://blog.example' },
    ] });
    const all = await api('/social/links');
    assert.equal(all.status, 200);
    assert.equal((all.data.html.match(/<li>/g) || []).length, 3);
    const some = await api('/social/links?services=github,%20link&variant=icon');
    assert.equal((some.data.html.match(/<li>/g) || []).length, 2);
    assert.ok(!some.data.html.includes('hachyderm'));
  });

  it('POST /social/check on a link is unchecked, parsed by Cook', async () => {
    const r = await api('/social/check', { method: 'POST', body: { service: 'link', input: 'https://blog.example' } });
    assert.equal(r.status, 200);
    assert.equal(r.data.status, 'unchecked');
    const bad = await api('/social/check', { method: 'POST', body: { service: 'link', input: 'http://blog.example' } });
    assert.equal(bad.status, 400);
  });

  it('GET /social/links returns Cook\'s escaped HTML for the visible accounts', async () => {
    seed({ accounts: [
      { service: 'link', label: '<img src=x onerror=alert(1)> & "q"', url: 'https://x.example/?a=1&b=2' },
      { service: 'github', handle: 'ProfPowell', hidden: true },
      { service: 'mastodon', handle: '@tom@hachyderm.io' },
    ] });
    const r = await api('/social/links?services=link,mastodon&variant=label');
    assert.equal(r.status, 200);
    assert.ok(!r.data.html.includes('<img'));
    assert.ok(r.data.html.includes('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;q&quot;'));
    assert.ok(r.data.html.includes('https://x.example/?a=1&amp;b=2'));
    assert.ok(r.data.html.includes('rel="me"'));
    assert.ok(!r.data.html.includes('github'));
  });
});
