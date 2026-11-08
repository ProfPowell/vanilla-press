import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSetting, slugId, themeFiles, modesFor, settingIds, migrateVpJson, themeUsers, MODES, ADJUST_ID, CUSTOM_URL_DIR, SAFE_ID } from '../../src/themes/theme-setting.js';

describe('theme-setting', () => {
  it('constants', () => {
    assert.deepEqual(MODES, ['auto', 'light', 'dark']);
    assert.equal(ADJUST_ID, 'vp-site');
    assert.equal(CUSTOM_URL_DIR, '/assets/themes');
    assert.ok(SAFE_ID.test('a-1') && !SAFE_ID.test('A'));
  });
  it('slugId makes unique slugs', () => {
    assert.equal(slugId('Retro Mine', ['8bit', 'swiss']), 'retro-mine');
    assert.equal(slugId('Retro Mine', ['retro-mine']), 'retro-mine-2');
    assert.equal(slugId('Retro Mine', ['retro-mine', 'retro-mine-2']), 'retro-mine-3');
    assert.equal(slugId('!!!', []), 'theme');
  });
  it('themeFiles maps VB non-built-ins, custom and adjust', () => {
    assert.deepEqual(themeFiles({ vbUrl: '/assets/vendor/vanilla-breeze/vanilla-breeze.css', vbIds: ['default', 'classic', 'swiss', '8bit'],
      builtIns: ['default', 'classic'], custom: [{ id: 'retro-mine' }], adjust: 'vp-site' }), {
      swiss: '/assets/vendor/vanilla-breeze/themes/swiss.css', '8bit': '/assets/vendor/vanilla-breeze/themes/8bit.css',
      'retro-mine': '/assets/themes/retro-mine.css', 'vp-site': '/assets/themes/vp-site.css' });
  });
  it('themeFiles without a site VB skips VB themes', () => {
    assert.deepEqual(themeFiles({ vbUrl: null, vbIds: ['swiss'], builtIns: [], custom: [], adjust: null }), {});
  });
  it('modesFor reads custom[].only', () => {
    assert.deepEqual(modesFor([{ id: 'a', only: 'dark' }, { id: 'b' }, { id: 'c', only: 'x' }]), { a: 'dark' });
  });
  it('settingIds always starts with the name, default included', () => {
    assert.equal(settingIds({ name: 'swiss', adjust: 'vp-site' }), 'swiss vp-site');
    assert.equal(settingIds({ name: 'swiss' }), 'swiss');
    assert.equal(settingIds({ name: 'default', adjust: 'vp-site' }), 'default vp-site');
    assert.equal(settingIds({ name: 'default' }), 'default');
    assert.equal(settingIds(null), '');
  });
  it('normalizeSetting validates and drops unsafe entries', () => {
    assert.equal(normalizeSetting(null), null);
    assert.equal(normalizeSetting({ name: 'Bad!' }), null);
    assert.equal(normalizeSetting([]), null);
    const s = normalizeSetting({
      name: 'swiss', mode: 'sepia', adjust: 'vp-site', vb: '/assets/vb/vanilla-breeze.css',
      files: { swiss: '/a/swiss.css', Bad: '/x.css', evil: '//evil.com/x.css', q: '/a"b.css' },
      modes: { swiss: 'dark', other: 'blue' },
      custom: [{ id: 'mine', name: 'Mine', base: 'swiss', only: 'light' }, { id: 'Bad' }, 5],
      adjustments: { hue: 200 },
    });
    assert.equal(s.mode, 'auto');
    assert.equal(s.adjust, 'vp-site');
    assert.equal(s.vb, '/assets/vb/vanilla-breeze.css');
    assert.deepEqual({ ...s.files }, { swiss: '/a/swiss.css' });
    assert.deepEqual({ ...s.modes }, { swiss: 'dark' });
    assert.deepEqual(s.custom, [{ id: 'mine', name: 'Mine', base: 'swiss', only: 'light' }]);
    assert.deepEqual(s.adjustments, { hue: 200 });
    const min = normalizeSetting({ name: 'default' });
    assert.equal(min.adjust, null);
    assert.equal(min.vb, null);
    assert.equal(min.adjustments, null);
    assert.equal(Object.getPrototypeOf(min.files), null);
  });
  it('migrateVpJson: a theme moves to a setting; default is dropped (R1)', () => {
    assert.deepEqual(migrateVpJson({ theme: 'swiss' }), { setting: { name: 'swiss', mode: 'auto', files: {} }, vp: {} });
    assert.deepEqual(migrateVpJson({ theme: 'default', other: 1 }), { setting: null, vp: { other: 1 } });
    assert.deepEqual(migrateVpJson({ other: 1 }), { setting: null, vp: { other: 1 } });
  });
  it('themeUsers names the site theme and posts', () => {
    assert.deepEqual(themeUsers({ name: 'retro-mine' }, [{ id: 'a', meta: { title: 'A', theme: 'retro-mine' } }, { id: 'b', meta: { title: 'B' } }], 'retro-mine'),
      ['the site theme', 'A']);
    assert.deepEqual(themeUsers(null, [{ id: 'a', meta: { title: 'A', theme: 'x' } }], 'x'), ['A']);
  });
});
