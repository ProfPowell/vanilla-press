import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packageRows, toggleOutcome } from '../../app/assets/js/components-view.js';

const el = (label) => ({ tag: 'x-a', label, description: 'd' });

test('packageRows: single element uses its label, installed in site shows siteVersion', () => {
  const [r] = packageRows([{ package: 'p', bundled: false, enabled: true, siteVersion: '1.2.0', vpVersion: '1.0.0', source: 'site', elements: [el('Window')] }]);
  assert.deepEqual(r, { package: 'p', label: 'Window', version: '1.2.0', enabled: true, canToggle: true, note: '' });
});

test('packageRows: several elements use the package name; falls back to vpVersion', () => {
  const [r] = packageRows([{ package: 'multi', bundled: false, enabled: false, siteVersion: null, vpVersion: '0.9.0', source: 'vp', elements: [el('A'), el('B')] }]);
  assert.equal(r.label, 'multi');
  assert.equal(r.version, '0.9.0');
  assert.equal(r.canToggle, true);
});

test('packageRows: bundled cannot toggle and has a note; not installed note', () => {
  const rows = packageRows([
    { package: 'vb', bundled: true, enabled: true, siteVersion: null, vpVersion: '1.0.0', source: 'vp', elements: [el('X')] },
    { package: 'n', bundled: false, enabled: false, siteVersion: null, vpVersion: null, source: null, elements: [el('N')] },
  ]);
  assert.equal(rows[0].canToggle, false);
  assert.equal(rows[0].note, 'Part of Vanilla Breeze');
  assert.equal(rows[1].note, 'Not installed');
  assert.equal(rows[1].version, '');
});

test('toggleOutcome kinds', () => {
  assert.equal(toggleOutcome(200, {}).kind, 'ok');
  const posts = [{ id: '1', title: 'T', status: 'draft' }];
  const u = toggleOutcome(409, { error: 'In use', posts });
  assert.equal(u.kind, 'in-use');
  assert.deepEqual(u.posts, posts);
  assert.equal(u.text, 'In use');
  const d = toggleOutcome(409, { error: "package.json has changes that aren't committed. Commit or discard them, then try again." });
  assert.equal(d.kind, 'dirty');
  assert.match(d.text, /committed/);
  assert.equal(toggleOutcome(502, { error: 'npm failed' }).kind, 'npm');
  assert.equal(toggleOutcome(400, { error: 'bad' }).kind, 'error');
  assert.equal(toggleOutcome(404, null).kind, 'error');
});
