import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountRow, moveAccount, addFormFor, toPutEntry, mergeChecks, replaceAccount, SERVICE_NAMES, COOK_TOO_OLD } from '../../app/assets/js/social-view.js';

const bsky = { service: 'bluesky', handle: 'tpowell.bsky.social', did: 'did:plc:x', profileUrl: 'https://bsky.app/profile/tpowell.bsky.social', valid: true };
const gh = { service: 'github', handle: 'ProfPowell', hidden: true, profileUrl: 'https://github.com/ProfPowell', valid: true };
const li = { service: 'linkedin', handle: 'your-name', profileUrl: 'https://www.linkedin.com/in/your-name', valid: true };
const link = { service: 'link', label: 'My <shop>', url: 'https://example.com/a', profileUrl: 'https://example.com/a', valid: true };
const mast = { service: 'mastodon', handle: '@me@example.social', profileUrl: 'https://example.social/@me', valid: true };

test('accountRow: name, handle, profile url and icon per service', () => {
  const r = accountRow(bsky, { status: 'ok', displayName: 'Tom' }, { index: 0, count: 2 });
  assert.equal(r.name, 'Bluesky');
  assert.equal(r.handle, 'tpowell.bsky.social');
  assert.equal(r.url, 'https://bsky.app/profile/tpowell.bsky.social');
  assert.equal(r.displayName, 'Tom');
  assert.equal(r.icon, 'B');
  assert.equal(accountRow(mast).url, 'https://example.social/@me');
  assert.equal(accountRow(gh).url, 'https://github.com/ProfPowell');
  assert.equal(accountRow(li).url, 'https://www.linkedin.com/in/your-name');
  assert.equal(accountRow({ service: 'youtube', handle: '@chan', profileUrl: 'https://www.youtube.com/@chan' }).url, 'https://www.youtube.com/@chan');
  const l = accountRow(link);
  assert.equal(l.name, 'My <shop>');
  assert.equal(l.url, 'https://example.com/a');
  assert.equal(l.handle, 'example.com');
});

test('accountRow: uses the url Cook computed; an invalid entry has no href and a note', () => {
  const ok = accountRow({ ...mast, profileUrl: 'https://cook.example/@me', valid: true });
  assert.equal(ok.url, 'https://cook.example/@me', 'Cook\'s url, not one built here');
  assert.equal(ok.skipped, false);
  const bad = accountRow({ service: 'link', label: 'x', url: 'javascript:alert(1)', profileUrl: null, valid: false });
  assert.equal(bad.url, '');
  assert.equal(bad.skipped, true);
  assert.equal(bad.skippedNote, 'Cook will skip this entry');
  assert.equal(accountRow({ service: 'link', label: 'x', url: 'javascript:alert(1)' }).url, '', 'no Cook url, no href');
});

test('accountRow: status words and tone', () => {
  assert.deepEqual(pick(accountRow(bsky, { status: 'ok' })), ['Checked', 'ok']);
  assert.deepEqual(pick(accountRow(bsky, { status: 'ok', mismatch: true })), ['This handle now points to a different account', 'warn']);
  assert.deepEqual(pick(accountRow(bsky, { status: 'unreachable' })), ['Not checked yet', 'warn']);
  assert.deepEqual(pick(accountRow(bsky, { status: 'not-found', message: 'No Bluesky account has that handle' })), ['No Bluesky account has that handle', 'warn']);
  assert.deepEqual(pick(accountRow(li, { status: 'unchecked' })), ["Not checked: open the link to make sure it's you", 'off']);
  assert.deepEqual(pick(accountRow(bsky)), ['Checking', 'off']);
  assert.deepEqual(pick(accountRow({ ...li, checked: 'never' })), ["Not checked: open the link to make sure it's you", 'off']);
});
function pick(r) { return [r.status, r.tone]; }

test('accountRow: hidden and move flags', () => {
  const r = accountRow(gh, null, { index: 1, count: 2 });
  assert.equal(r.hidden, true);
  assert.equal(r.canMoveUp, true);
  assert.equal(r.canMoveDown, false);
  const first = accountRow(bsky, null, { index: 0, count: 2 });
  assert.equal(first.hidden, false);
  assert.equal(first.canMoveUp, false);
  assert.equal(first.canMoveDown, true);
});

test('moveAccount: swaps, clamps, does not mutate', () => {
  const list = ['a', 'b', 'c'];
  assert.deepEqual(moveAccount(list, 0, 1), ['b', 'a', 'c']);
  assert.deepEqual(moveAccount(list, 2, -1), ['a', 'c', 'b']);
  assert.deepEqual(moveAccount(list, 0, -1), ['a', 'b', 'c']);
  assert.deepEqual(moveAccount(list, 2, 1), ['a', 'b', 'c']);
  assert.deepEqual(list, ['a', 'b', 'c']);
});

test('addFormFor: link has label and url, others one handle with a placeholder', () => {
  assert.deepEqual(addFormFor('link').fields.map((f) => f.name), ['label', 'url']);
  const ph = (id) => addFormFor(id).fields.map((f) => [f.name, f.placeholder]);
  assert.deepEqual(ph('bluesky'), [['handle', 'name.bsky.social']]);
  assert.deepEqual(ph('mastodon'), [['handle', '@user@instance']]);
  assert.deepEqual(ph('github'), [['handle', 'ProfPowell']]);
  assert.deepEqual(ph('linkedin'), [['handle', 'in/your-name']]);
  assert.deepEqual(ph('youtube'), [['handle', '@channel']]);
});

test('names and the old-Cook notice', () => {
  assert.equal(SERVICE_NAMES.github, 'GitHub');
  assert.equal(COOK_TOO_OLD, "This site's Cook is too old for Social; update cook-ssg to 2.10.0 or later");
});

test('toPutEntry: stored shape, always says hidden so a row can be shown again', () => {
  assert.deepEqual(toPutEntry({ service: 'github', handle: 'x', did: 'd', checked: 'yes', hidden: false }), { service: 'github', handle: 'x', hidden: false });
  assert.deepEqual(toPutEntry({ service: 'link', label: 'L', url: 'https://a.b', hidden: true }), { service: 'link', label: 'L', url: 'https://a.b', hidden: true });
});

test('mergeChecks: results belong to the list the recheck started from, matched by identity', () => {
  const snapshot = [bsky, gh];
  const results = [{ index: 0, status: 'ok', displayName: 'Tom' }, { index: 1, status: 'ok', displayName: 'Prof' }];
  // the list was reordered while the recheck ran
  const map = mergeChecks(snapshot, results);
  assert.equal(map.get(accountRow(bsky).id).displayName, 'Tom');
  assert.equal(map.get(accountRow(gh).id).displayName, 'Prof');
  const current = [gh, bsky];
  assert.deepEqual(current.map((a) => accountRow(a, map.get(accountRow(a).id)).displayName), ['Prof', 'Tom']);
});

test('mergeChecks: a result with no snapshot account is ignored', () => {
  assert.equal(mergeChecks([bsky], [{ index: 3, status: 'ok' }]).size, 0);
});

test('accountRow: a moved Bluesky handle offers the current handle', () => {
  const r = accountRow(bsky, { status: 'ok', mismatch: true, currentHandle: 'new.example.com' });
  assert.equal(r.status, 'This handle now points to a different account');
  assert.equal(r.tone, 'warn');
  assert.equal(r.currentHandle, 'new.example.com');
  assert.equal(r.useLabel, 'Use @new.example.com');
  const none = accountRow(bsky, { status: 'ok', mismatch: true });
  assert.equal(none.currentHandle, '');
  assert.equal(none.useLabel, '');
  assert.equal(accountRow(bsky, { status: 'ok' }).useLabel, '');
});

test('replaceAccount: swaps in place, keeps hidden, drops the old did', () => {
  const old = { ...bsky, hidden: true };
  const list = [gh, old, li];
  const out = replaceAccount(list, accountRow(old).id, { service: 'bluesky', handle: 'new.example.com' });
  assert.deepEqual(out.map((a) => a.handle), ['ProfPowell', 'new.example.com', 'your-name']);
  assert.equal(out[1].hidden, true);
  assert.equal('did' in out[1], false);
  assert.equal(list[1], old);
});

test('replaceAccount: a visible account stays visible; an unknown id appends', () => {
  const out = replaceAccount([bsky], accountRow(bsky).id, { service: 'bluesky', handle: 'n.example.com' });
  assert.equal(out[0].hidden, false);
  const added = replaceAccount([bsky], 'nope', { service: 'github', handle: 'x' });
  assert.equal(added.length, 2);
  assert.equal(added[1].handle, 'x');
});
