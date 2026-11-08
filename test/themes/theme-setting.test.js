import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSetting, slugId, themeFiles, modesFor, settingIds, migrateVpJson, themeUsers, mergeSettings, MODES, ADJUST_ID, CUSTOM_URL_DIR, SAFE_ID } from '../../src/themes/theme-setting.js';

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

  it('mergeSettings: 3-way; the applied state is one unit and GitHub wins when both changed it', () => {
    const base = { name: 'default', mode: 'auto', files: {}, custom: [{ id: 'a', name: 'A', base: 'default' }] };
    // Only this computer applied: its applied state; GitHub's library change is kept.
    const upLib = { ...base, files: { b: '/assets/themes/b.css' }, custom: [...base.custom, { id: 'b', name: 'B', base: 'default' }] };
    const localApply = { ...base, name: 'swiss', mode: 'dark', adjust: 'vp-site', adjustments: { hue: 1 },
      files: { swiss: '/x/swiss.css', 'vp-site': '/assets/themes/vp-site.css' } };
    assert.deepEqual(mergeSettings(base, upLib, localApply), {
      name: 'swiss', mode: 'dark', adjust: 'vp-site',
      files: { b: '/assets/themes/b.css', swiss: '/x/swiss.css', 'vp-site': '/assets/themes/vp-site.css' },
      custom: [{ id: 'a', name: 'A', base: 'default' }, { id: 'b', name: 'B', base: 'default' }],
      adjustments: { hue: 1 },
    });
    // Both applied: GitHub's applied state; this computer's library changes (rename a, add c) kept.
    const upApply = { ...base, name: '8bit', files: { '8bit': '/x/8bit.css' } };
    const local = { ...localApply, custom: [{ id: 'a', name: 'A2', base: 'default' }, { id: 'c', name: 'C', base: 'default', only: 'dark' }],
      modes: { c: 'dark' }, files: { ...localApply.files, c: '/assets/themes/c.css' } };
    const m = mergeSettings(base, upApply, local);
    assert.equal(m.name, '8bit');
    assert.equal(m.mode, 'auto');
    assert.equal('adjust' in m, false);
    assert.equal('adjustments' in m, false);
    assert.deepEqual(m.custom, [{ id: 'a', name: 'A2', base: 'default' }, { id: 'c', name: 'C', base: 'default', only: 'dark' }]);
    assert.deepEqual(m.modes, { c: 'dark' });
    assert.equal(m.files['8bit'], '/x/8bit.css');
    assert.equal(m.files.c, '/assets/themes/c.css');
    // A delete here of an entry GitHub left alone goes through; no base (both added): GitHub's applied state.
    assert.deepEqual(mergeSettings(base, base, { ...base, custom: [] }).custom, undefined);
    assert.equal(mergeSettings(null, upApply, localApply).name, '8bit');
    // A hand-edited non-array custom never throws.
    assert.deepEqual(mergeSettings({ ...base, custom: {} }, { ...upApply, custom: 'x' }, { ...localApply, custom: { a: 1 } }).custom, undefined);
  });
});
