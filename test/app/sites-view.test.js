import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countPosts, syncText, backupText } from '../../app/assets/js/sites-view.js';

const doc = (collection, status) => ({ meta: { collection, status } });

test('countPosts: counts only the posts collection', () => {
  const docs = [doc('posts', 'published'), doc('posts', 'published'), doc('posts', 'draft'), doc('pages', 'published'), doc('pages', 'draft')];
  assert.deepEqual(countPosts(docs), { published: 2, drafts: 1 });
  assert.deepEqual(countPosts([]), { published: 0, drafts: 0 });
});

test('syncText: in sync, push, pull, both, not connected', () => {
  const g = (ahead, behind) => ({ connected: true, branch: 'main', ahead, behind });
  assert.deepEqual(syncText(g(0, 0)), { text: 'GitHub · main · in sync', tone: 'ok' });
  assert.deepEqual(syncText(g(2, 0)), { text: 'GitHub · main · 2 to push', tone: 'warn' });
  assert.deepEqual(syncText(g(0, 1)), { text: 'GitHub · main · 1 to pull', tone: 'warn' });
  assert.deepEqual(syncText(g(2, 1)), { text: 'GitHub · main · 2 to push · 1 to pull', tone: 'warn' });
  assert.deepEqual(syncText({ connected: false, branch: null, ahead: null, behind: null }), { text: 'Not connected to GitHub', tone: 'off' });
  assert.deepEqual(syncText(undefined), { text: 'Not connected to GitHub', tone: 'off' });
});

test('syncText: connected without an upstream (null counts) reads as in sync', () => {
  assert.equal(syncText({ connected: true, branch: 'main', ahead: null, behind: null }).text, 'GitHub · main · in sync');
});

test('backupText: today shows a time, another day a date, null says not yet', () => {
  const now = new Date(2026, 10, 7, 15, 0);
  const t = (y, m, d, hh, mm) => new Date(y, m, d, hh, mm).toISOString();
  const expectTime = new Date(2026, 10, 7, 8, 48).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  assert.equal(backupText(t(2026, 10, 7, 8, 48), now), `Backed up ${expectTime}`);
  assert.equal(backupText(t(2026, 10, 3, 8, 48), now), 'Backed up Nov 3');
  assert.equal(backupText(null, now), 'Not backed up yet');
});
