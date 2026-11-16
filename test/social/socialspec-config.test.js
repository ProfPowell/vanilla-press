import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SOCIAL_FILE, SocialError, readSocial, writeSocial, writeSocialSection } from '../../src/social/config.js';
import { validateAbout, validateContact, validateFollowing } from '../../src/social/socialspec.js';

const site = () => mkdtempSync(join(tmpdir(), 'vp-ss-'));
const put = (dir, text) => { mkdirSync(join(dir, 'config'), { recursive: true }); writeFileSync(join(dir, SOCIAL_FILE), text); };
const read = (dir) => JSON.parse(readFileSync(join(dir, SOCIAL_FILE), 'utf8'));
const msg = (fn) => { try { fn(); } catch (e) { assert.ok(e instanceof SocialError); assert.equal(e.status, 400); return e.message; } assert.fail('did not throw'); };

test('readSocial defaults', () => {
  const r = readSocial(site());
  assert.equal(r.about, null);
  assert.equal(r.contact, null);
  assert.deepEqual(r.following, []);
  assert.deepEqual(r.accounts, []);
});

test('readSocial returns the sections', () => {
  const dir = site();
  put(dir, JSON.stringify({ about: { summary: 's' }, contact: { name: 'N' }, following: [{ title: 't' }] }));
  const r = readSocial(dir);
  assert.deepEqual(r.about, { summary: 's' });
  assert.deepEqual(r.contact, { name: 'N' });
  assert.deepEqual(r.following, [{ title: 't' }]);
});

test('each section write keeps accounts, other sections and hand keys', () => {
  const dir = site();
  const base = { accounts: [{ service: 'github', handle: 'a' }], hand: { z: 1 }, about: { summary: 'a' }, contact: { name: 'C' }, following: [{ title: 't', feedUrl: 'https://x.org/f' }] };
  put(dir, JSON.stringify(base));
  writeSocialSection(dir, 'about', { file: 'about.md', summary: 'new', extra: 1 });
  writeSocialSection(dir, 'contact', { email: 'a@b.co', name: 'N' });
  writeSocialSection(dir, 'following', [{ public: false, title: 'T', feedUrl: 'https://y.org/f' }]);
  const out = read(dir);
  assert.deepEqual(Object.keys(out), ['accounts', 'hand', 'about', 'contact', 'following']);
  assert.deepEqual(out.accounts, base.accounts);
  assert.deepEqual(out.hand, { z: 1 });
  assert.deepEqual(Object.keys(out.about), ['summary', 'file', 'extra']);
  assert.deepEqual(Object.keys(out.contact), ['name', 'email']);
  assert.deepEqual(Object.keys(out.following[0]), ['title', 'feedUrl', 'public']);
});

test('writing to a new file creates it with the section; accounts written later are added alongside', () => {
  const dir = site();
  writeSocialSection(dir, 'about', { summary: 'x' });
  assert.deepEqual(read(dir), { about: { summary: 'x' } });
  writeSocial(dir, [{ service: 'github', handle: 'a' }]);
  assert.ok('about' in read(dir) && read(dir).accounts.length === 1);
});

test('null removes the key; others stay', () => {
  const dir = site();
  put(dir, JSON.stringify({ accounts: [], about: { summary: 'a' }, contact: { name: 'N' } }));
  writeSocialSection(dir, 'about', null);
  assert.deepEqual(Object.keys(read(dir)), ['accounts', 'contact']);
});

test('bad JSON is 422, unknown section is 400', () => {
  const dir = site();
  put(dir, '{ nope');
  assert.throws(() => writeSocialSection(dir, 'about', { summary: 'x' }), (e) => e.status === 422);
  assert.throws(() => writeSocialSection(site(), 'accounts', []), (e) => e.status === 400);
});

test('validateAbout', () => {
  assert.equal(validateAbout(null), null);
  assert.deepEqual(validateAbout({ summary: 'Hi', body: '# Hello', file: 'content/about.md' }), { summary: 'Hi', body: '# Hello', file: 'content/about.md' });
  assert.equal(msg(() => validateAbout({ summary: 'x'.repeat(301) })), 'About: the summary must be 300 characters or fewer');
  assert.equal(msg(() => validateAbout({ summary: 5 })), 'About: the summary must be text');
  assert.equal(msg(() => validateAbout({ body: 5 })), 'About: the body must be text');
  assert.equal(msg(() => validateAbout({ file: 'src/a.md' })), 'About: the file must be a relative path outside src/, without ..');
  assert.equal(msg(() => validateAbout({ file: '/a.md' })), 'About: the file must be a relative path outside src/, without ..');
  assert.equal(msg(() => validateAbout({ file: '../a.md' })), 'About: the file must be a relative path outside src/, without ..');
  assert.equal(msg(() => validateAbout('x')), 'About must be an object');
});

test('validateContact', () => {
  assert.equal(validateContact(null), null);
  assert.equal(validateContact({}), null);
  assert.deepEqual(validateContact({ name: 'N', email: 'a@b.co', url: 'https://x.org', org: 'O', title: 'T' }), { name: 'N', email: 'a@b.co', url: 'https://x.org', org: 'O', title: 'T' });
  assert.equal(msg(() => validateContact({ email: 'a@b.co' })), 'Contact: a name is required');
  assert.equal(validateContact({ name: ' ' }), null); // blank means absent
  assert.equal(msg(() => validateContact({ name: ' ', email: 'a@b.co' })), 'Contact: a name is required');
  assert.equal(msg(() => validateContact({ name: 'N', email: 'nope' })), 'Contact: the email does not look like an email address');
  assert.equal(msg(() => validateContact({ name: 'N', url: 'http://x.org' })), 'Contact: the URL must start with https://');
  assert.equal(msg(() => validateContact({ name: 'N', org: 3 })), 'Contact: the organization must be text');
  assert.equal(msg(() => validateContact({ name: 'N', title: 3 })), 'Contact: the title must be text');
});

test('validateFollowing', () => {
  assert.deepEqual(validateFollowing([]), []);
  assert.deepEqual(validateFollowing([{ feedUrl: 'http://a.org/f' }]), [{ feedUrl: 'http://a.org/f', public: true }]);
  assert.equal(validateFollowing([{ title: 'T', feedUrl: 'https://a.org/f', siteUrl: 'https://a.org', category: 'c', public: false }])[0].public, false);
  assert.equal(msg(() => validateFollowing('x')), 'Following must be a list');
  assert.equal(msg(() => validateFollowing([1])), 'Following 1: each entry must be an object');
  assert.equal(msg(() => validateFollowing([{ feedUrl: 'https://a.org' }, { feedUrl: 'https://b.org' }, { feedUrl: 'ftp://x' }])), 'Following 3: the feed URL must start with https:// or http://');
  assert.equal(msg(() => validateFollowing([{}])), 'Following 1: a feed URL is required');
  assert.equal(msg(() => validateFollowing([{ feedUrl: 'https://a.org', siteUrl: 'a.org' }])), 'Following 1: the site URL must start with https:// or http://');
  assert.equal(msg(() => validateFollowing([{ feedUrl: 'https://a.org', public: 'yes' }])), 'Following 1: public must be true or false');
  assert.equal(msg(() => validateFollowing([{ feedUrl: 'https://a.org', title: 4 }])), 'Following 1: the title must be text');
  assert.equal(msg(() => validateFollowing([{ feedUrl: 'https://a.org', category: 4 }])), 'Following 1: the category must be text');
});

test('validators trim strings and treat empty strings as absent', () => {
  assert.deepEqual(validateFollowing([]), []);
  assert.deepEqual(validateFollowing([{ title: ' A ', feedUrl: ' https://a.test/f ', siteUrl: ' ', category: '' }]), [{ title: 'A', feedUrl: 'https://a.test/f', public: true }]);
  assert.deepEqual(validateContact({ name: ' N ', email: '', url: '  ', org: ' O ' }), { name: 'N', org: 'O' });
  assert.deepEqual(validateContact({ name: 'N', email: ' a@b.co ' }), { name: 'N', email: 'a@b.co' });
  assert.deepEqual(validateAbout({ summary: '  ', body: '  ' }), null);
  assert.deepEqual(validateAbout({ summary: ' Hi ', file: ' a.md ' }), { summary: 'Hi', file: 'a.md' });
});

test('isUrl-backed checks: absolute http(s) with a host only', () => {
  for (const u of ['https:/a.com/f', 'https://@', 'ftp://a.com', '/feed', 'https://']) {
    assert.match(msg(() => validateFollowing([{ feedUrl: u }])), /feed URL must start with/, u);
  }
  assert.equal(validateFollowing([{ feedUrl: 'http://a.com/f' }])[0].feedUrl, 'http://a.com/f');
});
