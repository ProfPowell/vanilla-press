import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startApp } from '../../src/app/server.js';
import * as standIn from './fixtures/cook-social.js';

// Same opt-in contract run as routes.test.js.
const REAL = process.env.COOK_SOCIAL_MODULE;
const modules = [['stand-in', async () => standIn]];
if (REAL) modules.push(['real Cook module', () => import(pathToFileURL(REAL).href)]);

const CONNECTED = { isRepo: true, branch: 'main', hasRemote: true, hasUpstream: true };
const OLD = "This site's Cook is too old for this; update cook-ssg to 2.11.0 or later";
const wrap = (body) => `<?xml version="1.0"?><opml version="2.0"><head><title>x</title></head><body>${body}</body></opml>`;

for (const [label, loadModule] of modules) describe(`SocialSpec routes (${label})`, () => {
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

  async function raw(path, { method = 'GET', body } = {}) {
    const opts = { method };
    if (body !== undefined) { opts.headers = { 'Content-Type': 'application/json' }; opts.body = JSON.stringify(body); }
    const res = await fetch(`${app.url}/api/sites/${id}${path}`, opts);
    return { res, text: await res.text() };
  }
  async function api(path, o) {
    const { res, text } = await raw(path, o);
    let data = text;
    try { data = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, data };
  }
  const file = () => JSON.parse(readFileSync(join(site, 'config', 'social.json'), 'utf8'));
  const seed = (obj) => {
    mkdirSync(join(site, 'config'), { recursive: true });
    writeFileSync(join(site, 'config', 'social.json'), JSON.stringify(obj, null, 2));
  };
  const ACCOUNTS = [{ service: 'github', handle: 'ProfPowell', checked: 'yes' }];
  const HAND = { custom: { keep: 'me' }, accounts: ACCOUNTS };

  before(async () => {
    root = mkdtempSync(join(tmpdir(), 'vp-socialspec-routes-'));
    site = join(root, 'site');
    mkdirSync(join(site, 'src'), { recursive: true });
    writeFileSync(join(site, 'package.json'), JSON.stringify({ name: 'site', devDependencies: { 'cook-ssg': '^2.11.0' } }));
    cookSocial = await loadModule();
    cook = cookSocial;
    app = await startApp({ port: 0, env: { VP_CONFIG_DIR: join(root, 'config') }, git: fakeGit, cookSocial: () => cook });
    const res = await fetch(`${app.url}/api/sites`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: site, name: 'Tom & Co' }),
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
    seed({ ...HAND });
  });

  it('GET /social adds the sections and socialSpecReady', async () => {
    seed({ ...HAND, about: { summary: 's' }, contact: { name: 'N' }, following: [{ feedUrl: 'https://a.example/f' }] });
    const r = await api('/social');
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.about, { summary: 's' });
    assert.deepEqual(r.data.contact, { name: 'N' });
    assert.deepEqual(r.data.following, [{ feedUrl: 'https://a.example/f' }]);
    assert.equal(r.data.socialSpecReady, true);
  });

  it('GET /social: socialSpecReady is false for a Cook without renderOpml, and the 2.10.0 routes still work', async () => {
    const { renderOpml, ...old } = cookSocial;
    cook = old;
    const r = await api('/social');
    assert.equal(r.data.socialSpecReady, false);
    assert.equal(r.data.cookReady, true);
    const links = await api('/social/links');
    assert.equal(links.status, 200);
  });

  const PUTS = [
    ['about', { about: { summary: 'Hi', body: 'Hello **there**' } }, { summary: 'Hi', body: 'Hello **there**' }],
    ['contact', { contact: { name: 'Tom', email: 'tom@example.com' } }, { name: 'Tom', email: 'tom@example.com' }],
    ['following', { following: [{ title: 'A', feedUrl: 'https://a.example/f' }] }, [{ title: 'A', feedUrl: 'https://a.example/f', public: true }]],
  ];
  for (const [key, body, stored] of PUTS) {
    it(`PUT /social/${key} saves, commits exactly social.json as "Social: ${key}", and keeps accounts and hand keys`, async () => {
      const others = Object.fromEntries(PUTS.filter(([k]) => k !== key).map(([k, , v]) => [k, v]));
      seed({ ...HAND, ...others });
      const r = await api(`/social/${key}`, { method: 'PUT', body });
      assert.equal(r.status, 200, JSON.stringify(r.data));
      assert.equal(r.data.committed, true);
      assert.deepEqual(r.data[key], stored);
      const f = file();
      assert.deepEqual(f[key], stored);
      assert.deepEqual(f.accounts, ACCOUNTS);
      assert.deepEqual(f.custom, { keep: 'me' });
      for (const [k, v] of Object.entries(others)) assert.deepEqual(f[k], v, `${k} survives`);
      assert.deepEqual(commits, [{ paths: ['config/social.json'], message: `Social: ${key}` }]);
      assert.equal(pushes.length, 1);
    });

    it(`PUT /social/${key}: 409 when the Cook is too old (and nothing is written)`, async () => {
      const { renderOpml, ...old } = cookSocial;
      for (const c of [old, null]) {
        cook = c;
        const r = await api(`/social/${key}`, { method: 'PUT', body });
        assert.equal(r.status, 409);
        assert.deepEqual(r.data, { error: OLD, needsCook: '2.11.0' });
      }
      assert.equal(commits.length, 0);
      assert.equal(file()[key], undefined);
    });
  }

  it('PUT validation errors are 400 with a plain message and write nothing', async () => {
    const cases = [
      ['about', { about: { summary: 5 } }],
      ['contact', { contact: { name: 'T', email: 'not-an-email' } }],
      ['following', { following: [{ title: 'A', feedUrl: 'ftp://a/f' }] }],
      ['following', { following: 'nope' }],
    ];
    for (const [key, body] of cases) {
      const r = await api(`/social/${key}`, { method: 'PUT', body });
      assert.equal(r.status, 400, key);
      assert.equal(typeof r.data.error, 'string');
    }
    assert.equal(commits.length, 0);
    assert.deepEqual(file(), HAND);
  });

  it('PUT with nothing removes the section (about, contact, following) and keeps the rest', async () => {
    seed({ ...HAND, about: { summary: 's' }, contact: { name: 'N' }, following: [{ feedUrl: 'https://a.example/f', public: true }] });
    for (const [key, body] of [['about', { about: null }], ['contact', { contact: {} }], ['following', { following: [] }]]) {
      const r = await api(`/social/${key}`, { method: 'PUT', body });
      assert.equal(r.status, 200, key);
    }
    assert.deepEqual(file(), HAND);
  });

  it('a PUT without a repo or with a failing push still saves, with committed: false and a note', async () => {
    fakeGit.gitStatus = async () => ({ isRepo: false });
    const a = await api('/social/about', { method: 'PUT', body: { about: { summary: 'x' } } });
    assert.equal(a.status, 200);
    assert.equal(a.data.committed, false);
    assert.match(a.data.note, /not committed/);
    assert.equal(file().about.summary, 'x');
    fakeGit.gitStatus = defaults.gitStatus;
    fakeGit.push = async () => { throw new Error('offline'); };
    const b = await api('/social/contact', { method: 'PUT', body: { contact: { name: 'T' } } });
    assert.equal(b.data.committed, false);
    assert.match(b.data.note, /not pushed/);
    assert.equal(file().contact.name, 'T');
  });

  describe('OPML import', () => {
    const imp = (opml) => api('/social/following/import', { method: 'POST', body: { opml } });

    it('merges by feedUrl: existing keep their fields, new are appended public, nested folders give categories', async () => {
      seed({ ...HAND, about: { summary: 's' }, following: [
        { title: 'Mine', feedUrl: 'https://a.example/f', category: 'Keep', public: false, extra: 1 },
      ] });
      const r = await imp(wrap(`
        <outline text="Tech"><outline text="A renamed" xmlUrl="https://a.example/f"/>
          <outline text="B" xmlUrl="https://b.example/f" htmlUrl="https://b.example/"/></outline>
        <outline text="B again" xmlUrl="https://b.example/f"/>
        <outline xmlUrl="https://c.example/f"/>
        <outline text="No feed"/>`));
      assert.equal(r.status, 200, JSON.stringify(r.data));
      assert.deepEqual([r.data.added, r.data.skipped, r.data.unchanged], [2, 1, 2]);
      assert.deepEqual(file().following, [
        { title: 'Mine', feedUrl: 'https://a.example/f', category: 'Keep', public: false, extra: 1 },
        { title: 'B', feedUrl: 'https://b.example/f', siteUrl: 'https://b.example/', category: 'Tech', public: true },
        { title: 'https://c.example/f', feedUrl: 'https://c.example/f', public: true },
      ]);
      assert.deepEqual(r.data.following, file().following);
      assert.deepEqual(commits, [{ paths: ['config/social.json'], message: 'Social: following' }]);
      const f = file();
      assert.deepEqual(f.accounts, ACCOUNTS);
      assert.deepEqual(f.custom, { keep: 'me' });
      assert.deepEqual(f.about, { summary: 's' });
    });

    it('a bad hand-edited stored entry does not block an import, and stored entries stay byte-identical', async () => {
      const stored = [1, { title: 7, feedUrl: 'ftp://old/f' }, { title: 'NoPublic', feedUrl: 'https://n.example/f' }];
      seed({ ...HAND, following: stored });
      const r = await imp(wrap('<outline text="B" xmlUrl="https://b.example/f"/>'));
      assert.equal(r.status, 200, JSON.stringify(r.data));
      assert.equal(r.data.added, 1);
      const f = file().following;
      assert.deepEqual(f.slice(0, 3), stored);
      assert.equal('public' in f[2], false);
      assert.deepEqual(f[3], { title: 'B', feedUrl: 'https://b.example/f', public: true });
    });

    it('an import over 2 MB is 413 with a plain message', async () => {
      const r = await imp(wrap('<outline text="A" xmlUrl="https://a.example/f"/>' + ' '.repeat(2 * 1024 * 1024)));
      assert.equal(r.status, 413);
      assert.match(r.data.error, /too large/i);
      assert.equal(commits.length, 0);
    });

    it('a file with nothing new changes and commits nothing', async () => {
      seed({ ...HAND, following: [{ title: 'A', feedUrl: 'https://a.example/f', public: true }] });
      const r = await imp(wrap('<outline text="A" xmlUrl="https://a.example/f"/>'));
      assert.equal(r.status, 200);
      assert.equal(r.data.added, 0);
      assert.equal(commits.length, 0);
    });

    it('invalid XML and a missing body are 400; an old Cook is 409', async () => {
      for (const opml of ['<html></html>', '', undefined]) {
        const r = await imp(opml);
        assert.equal(r.status, 400);
        assert.match(r.data.error, /OPML/);
      }
      cook = null;
      const r = await imp(wrap(''));
      assert.equal(r.status, 409);
      assert.deepEqual(r.data, { error: OLD, needsCook: '2.11.0' });
      assert.equal(commits.length, 0);
    });
  });

  describe('OPML export', () => {
    it('downloads Cook\'s OPML with the site name in the title, and it round-trips through import', async () => {
      const following = [
        { title: 'A & "B" <c>', feedUrl: 'https://a.example/f?x=1&y=2', siteUrl: 'https://a.example/', public: true },
        { title: 'Hidden', feedUrl: 'https://h.example/f', public: false },
      ];
      seed({ ...HAND, following });
      const { res, text } = await raw('/social/following.opml');
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), 'text/x-opml; charset=utf-8');
      assert.equal(res.headers.get('content-disposition'), 'attachment; filename="following.opml"');
      assert.match(text, /<title>Tom &amp; Co follows<\/title>/);
      assert.ok(!text.includes('h.example'));
      seed({ ...HAND });
      const r = await api('/social/following/import', { method: 'POST', body: { opml: text } });
      assert.equal(r.status, 200);
      assert.deepEqual(file().following, [{ title: 'A & "B" <c>', feedUrl: 'https://a.example/f?x=1&y=2', siteUrl: 'https://a.example/', public: true }]);
    });

    it('is 404 with nothing public, and 409 with an old Cook', async () => {
      assert.equal((await api('/social/following.opml')).status, 404);
      cook = null;
      const r = await api('/social/following.opml');
      assert.equal(r.status, 409);
      assert.equal(r.data.needsCook, '2.11.0');
    });
  });

  describe('About preview', () => {
    const preview = (text) => api('/social/about/preview', { method: 'POST', body: { body: text } });
    it('is a 409 when the site has no Cook install to take marked from', async () => {
      const r = await preview('# Hi');
      assert.equal(r.status, 409);
    });
    it('renders with the marked installed beside the site\'s cook-ssg', async () => {
      mkdirSync(join(site, 'node_modules', 'cook-ssg'), { recursive: true });
      writeFileSync(join(site, 'node_modules', 'cook-ssg', 'package.json'), '{"name":"cook-ssg","version":"2.11.0"}');
      symlinkSync(resolve('node_modules', 'marked'), join(site, 'node_modules', 'marked'));
      const r = await preview('# Hi\n\nSome *text*');
      assert.equal(r.status, 200);
      assert.match(r.data.html, /<h1[^>]*>Hi<\/h1>/);
      assert.match(r.data.html, /<em>text<\/em>/);
      assert.deepEqual((await preview('')).data, { html: '' });
      assert.equal((await api('/social/about/preview', { method: 'POST', body: { body: 5 } })).status, 400);
      assert.equal(commits.length, 0);
    });
  });
});
