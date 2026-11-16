import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SOCIAL_FILE, NEEDS_COOK, SocialError, readSocial, writeSocial } from '../../src/social/config.js';
import { importCookSocial } from '../../src/social/cook.js';
import * as fixture from './fixtures/cook-social.js';

const site = () => mkdtempSync(join(tmpdir(), 'vp-social-'));
const put = (dir, text) => { mkdirSync(join(dir, 'config'), { recursive: true }); writeFileSync(join(dir, SOCIAL_FILE), text); };
const file = (dir) => readFileSync(join(dir, SOCIAL_FILE), 'utf8');

test('constants', () => {
  assert.equal(SOCIAL_FILE, 'config/social.json');
  assert.equal(NEEDS_COOK, '2.10.0');
});

test('stand-in fixture exports the Cook social interface', () => {
  for (const k of ['SERVICES', 'parseHandle', 'profileUrl', 'normalizeAccounts', 'renderSocialLinks']) assert.ok(k in fixture, k);
  assert.deepEqual(fixture.parseHandle('bluesky', '@Tpowell.bsky.social'), { handle: 'tpowell.bsky.social' });
});

test('missing file reads as empty', () => {
  assert.deepEqual(readSocial(site()), { raw: {}, accounts: [], about: null, contact: null, following: [] });
});

test('round trip, new file has accounts first and a trailing newline', () => {
  const dir = site();
  const accounts = [{ service: 'github', handle: 'ProfPowell' }, { service: 'bluesky', handle: 'tpowell.bsky.social', did: 'did:plc:x', hidden: true }];
  writeSocial(dir, accounts);
  assert.deepEqual(readSocial(dir).accounts, accounts);
  assert.ok(file(dir).endsWith('}\n'));
  assert.equal(Object.keys(JSON.parse(file(dir)))[0], 'accounts');
});

test('other top-level keys survive with their order', () => {
  const dir = site();
  const extra = { about: { a: [1, { b: 2 }] }, contact: 'me', following: [1, 2], x: { y: null } };
  put(dir, JSON.stringify({ about: extra.about, accounts: [], contact: extra.contact, following: extra.following, x: extra.x }));
  writeSocial(dir, [{ service: 'github', handle: 'a' }]);
  const out = JSON.parse(file(dir));
  assert.deepEqual(Object.keys(out), ['about', 'accounts', 'contact', 'following', 'x']);
  for (const k of Object.keys(extra)) assert.deepEqual(out[k], extra[k]);
});

test('account keys are ordered, unknown keys survive', () => {
  const dir = site();
  writeSocial(dir, [{ zzz: 1, checked: 'yes', hidden: false, handle: 'h', service: 'github', custom: { a: 1 } }]);
  const [a] = JSON.parse(file(dir)).accounts;
  assert.deepEqual(Object.keys(a), ['service', 'handle', 'hidden', 'checked', 'zzz', 'custom']);
  assert.deepEqual(a.custom, { a: 1 });
});

test('bad JSON gives a 422 SocialError', () => {
  const dir = site();
  put(dir, '{ nope');
  assert.throws(() => readSocial(dir), (e) => e instanceof SocialError && e.status === 422);
});

test('non-array accounts reads as empty', () => {
  const dir = site();
  put(dir, '{"accounts":"x","about":1}');
  const r = readSocial(dir);
  assert.deepEqual(r.accounts, []);
  assert.equal(r.raw.about, 1);
});

test('importCookSocial returns null without cook-ssg', async () => {
  assert.equal(await importCookSocial(site()), null);
});
