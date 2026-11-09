import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { paneTheme, siteThemes } from '../../editor/assets/js/pane-theme.js';

const H = {
  swiss: '/sites/s1/site/assets/vendor/vanilla-breeze/themes/swiss.css',
  '8bit': '/sites/s1/site/assets/vendor/vanilla-breeze/themes/8bit.css',
  night: '/sites/s1/site/assets/themes/night.css',
  'vp-site': '/sites/s1/site/assets/themes/vp-site.css',
};
const T = [
  { id: 'default', name: 'Default', href: null },
  { id: 'swiss', name: 'Swiss', href: H.swiss },
  { id: '8bit', name: '8bit', href: H['8bit'] },
  { id: 'night', name: 'Night Owl', href: H.night, custom: true, only: 'dark' },
  { id: 'vp-site', name: 'vp-site', href: H['vp-site'] },
];

describe('paneTheme', () => {
  const S = { name: 'swiss', mode: 'auto', adjust: 'vp-site', modes: { night: 'dark' } };

  it('no page theme: the site theme on the pane, no chip, no strip', () => {
    assert.deepEqual(paneTheme(S, {}, T), { pane: { ids: 'swiss vp-site', mode: null }, content: null, strip: null, chip: null, hrefs: [H.swiss, H['vp-site']] });
  });

  it('page scope: the page theme on the pane and the strip, adjustments dropped', () => {
    const m = paneTheme(S, { theme: '8bit' }, T);
    assert.equal(m.pane.ids, '8bit'); assert.equal(m.strip.text, 'Header in page theme'); assert.equal(m.chip, 'Page theme: 8bit');
    assert.deepEqual(m.strip, { ids: '8bit', mode: null, text: 'Header in page theme' });
    assert.equal(m.content, null);
    assert.deepEqual(m.hrefs, [H['8bit']]);
  });

  it('article scope: the site theme on the pane and strip, the page theme on the content', () => {
    const m = paneTheme(S, { theme: 'night', themeScope: 'article' }, T);
    assert.equal(m.pane.ids, 'swiss vp-site'); assert.deepEqual(m.content, { ids: 'night', mode: 'dark' }); assert.equal(m.strip.text, 'Header in site theme');
    assert.deepEqual(m.strip, { ids: 'swiss vp-site', mode: null, text: 'Header in site theme' });
    assert.equal(m.chip, 'Page theme: Night Owl');
    assert.deepEqual(m.hrefs, [H.swiss, H['vp-site'], H.night]);
  });

  it('no setting: nothing themed', () => { assert.equal(paneTheme(null, {}, T).pane.ids, ''); });

  it('no setting and no page theme: no attributes, links, chip or strip', () => {
    assert.deepEqual(paneTheme(null, {}, T), { pane: { ids: '', mode: null }, content: null, strip: null, chip: null, hrefs: [] });
    assert.deepEqual(paneTheme(undefined, undefined, undefined), { pane: { ids: '', mode: null }, content: null, strip: null, chip: null, hrefs: [] });
  });

  it('no setting but a page theme: shown as on the default setting publishing writes (R4)', () => {
    const m = paneTheme(null, { theme: '8bit', themeScope: 'article' }, T);
    assert.deepEqual(m.pane, { ids: 'default', mode: null });
    assert.deepEqual(m.content, { ids: '8bit', mode: null });
    assert.equal(m.chip, 'Page theme: 8bit');
  });

  it('a page theme not in the list: its id on the pane and in the chip, no stylesheet', () => {
    const m = paneTheme(S, { theme: 'mystery' }, T);
    assert.equal(m.pane.ids, 'mystery');
    assert.equal(m.chip, 'Page theme: mystery');
    assert.deepEqual(m.hrefs, []);
  });
});

describe('siteThemes', () => {
  it('adds the site-relative files the list lacks (the adjustments) under the site prefix', () => {
    const setting = { name: 'swiss', adjust: 'vp-site', files: { swiss: '/x/swiss.css', 'vp-site': '/assets/themes/vp-site.css', cdn: 'https://cdn.example/t.css' } };
    const list = siteThemes(setting, [{ id: 'swiss', name: 'Swiss', href: H.swiss }], 's1');
    assert.deepEqual(list, [
      { id: 'swiss', name: 'Swiss', href: H.swiss },
      { id: 'vp-site', name: 'vp-site', href: '/sites/s1/site/assets/themes/vp-site.css' },
      { id: 'cdn', name: 'cdn', href: 'https://cdn.example/t.css' },
    ]);
  });

  it('a theme in the list without an href gets the one from files', () => {
    const list = siteThemes({ name: 'a', files: { a: '/assets/themes/a.css' } }, [{ id: 'a', name: 'A', href: null }], 's 1');
    assert.deepEqual(list, [{ id: 'a', name: 'A', href: '/sites/s%201/site/assets/themes/a.css' }]);
  });

  it('no setting: the list as it is', () => {
    assert.deepEqual(siteThemes(null, T, 's1'), T);
    assert.deepEqual(siteThemes(null, null, 's1'), []);
  });
});

// The same cases through VP's paneTheme and Cook's pageThemePlan, so the two can't drift.
// `files` has an entry for every theme with a stylesheet (as theme.json does).
const FILES = { swiss: '/f/swiss.css', '8bit': '/f/8bit.css', night: '/f/night.css', 'vp-site': '/f/vp-site.css' };
const base = (extra) => ({ name: 'swiss', mode: 'auto', adjust: 'vp-site', files: FILES, modes: { night: 'dark' }, ...extra });
const CASES = [
  { name: 'site theme, reader\'s choice', setting: base(), fm: {}, html: ['swiss vp-site', null], scoped: null, links: ['swiss', 'vp-site'] },
  { name: 'site theme, dark', setting: base({ mode: 'dark' }), fm: {}, html: ['swiss vp-site', 'dark'], scoped: null, links: ['swiss', 'vp-site'] },
  { name: 'one-scheme site theme beats the site mode', setting: base({ name: 'night', mode: 'light' }), fm: {}, html: ['night vp-site', 'dark'], scoped: null, links: ['night', 'vp-site'] },
  { name: 'default, no adjust', setting: { name: 'default', mode: 'auto', adjust: null, files: {}, modes: {} }, fm: {}, html: ['default', null], scoped: null, links: [] },
  { name: 'default with adjust', setting: base({ name: 'default' }), fm: {}, html: ['default vp-site', null], scoped: null, links: ['vp-site'] },
  { name: 'page scope', setting: base(), fm: { theme: '8bit' }, html: ['8bit', null], scoped: null, links: ['8bit'] },
  { name: 'page scope, explicit', setting: base({ mode: 'light' }), fm: { theme: '8bit', themeScope: 'page' }, html: ['8bit', 'light'], scoped: null, links: ['8bit'] },
  { name: 'page scope, one-scheme page theme', setting: base({ mode: 'light' }), fm: { theme: 'night' }, html: ['night', 'dark'], scoped: null, links: ['night'] },
  { name: 'article scope', setting: base(), fm: { theme: 'night', themeScope: 'article' }, html: ['swiss vp-site', null], scoped: ['night', 'dark'], links: ['swiss', 'vp-site', 'night'] },
  { name: 'article scope, site mode forces the article', setting: base({ mode: 'light' }), fm: { theme: '8bit', themeScope: 'article' }, html: ['swiss vp-site', 'light'], scoped: ['8bit', 'light'], links: ['swiss', 'vp-site', '8bit'] },
  { name: 'article scope, page theme is the site theme', setting: base(), fm: { theme: 'swiss', themeScope: 'article' }, html: ['swiss vp-site', null], scoped: ['swiss', null], links: ['swiss', 'vp-site'] },
  { name: 'unsafe theme ignored', setting: base(), fm: { theme: 'Retro!' }, html: ['swiss vp-site', null], scoped: null, links: ['swiss', 'vp-site'] },
  { name: 'hostile theme ignored', setting: base(), fm: { theme: 'x" onload="y' }, html: ['swiss vp-site', null], scoped: null, links: ['swiss', 'vp-site'] },
  { name: 'unknown scope is page', setting: base(), fm: { theme: '8bit', themeScope: 'sidebar' }, html: ['8bit', null], scoped: null, links: ['8bit'] },
  { name: 'scope without a theme', setting: base(), fm: { themeScope: 'article' }, html: ['swiss vp-site', null], scoped: null, links: ['swiss', 'vp-site'] },
  { name: 'page theme with no stylesheet', setting: base(), fm: { theme: 'mystery' }, html: ['mystery', null], scoped: null, links: [] },
];
// paneTheme's hrefs come from the themes list: one per theme with a file.
const listFor = (setting) => Object.keys(setting.files).map((id) => ({ id, name: id, href: `/h/${id}.css` }));

describe('paneTheme follows the page theme plan (case table shared with Cook)', () => {
  for (const c of CASES) {
    it(c.name, () => {
      const m = paneTheme(c.setting, c.fm, listFor(c.setting));
      assert.deepEqual([m.pane.ids, m.pane.mode], c.html);
      assert.deepEqual(m.content && [m.content.ids, m.content.mode], c.scoped);
      assert.deepEqual(m.hrefs, c.links.map((id) => `/h/${id}.css`));
    });
  }
});

// Cook's own module, from a sibling checkout (../cook, or COOK_DIR), when there is one.
const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cookTheme = join(process.env.COOK_DIR || join(repo, '..', 'cook'), 'scripts', 'plugins', 'theme.js');
const hasCook = existsSync(cookTheme);

describe('Cook pageThemePlan gives the same answers', { skip: hasCook ? false : `no Cook checkout at ${cookTheme}` }, () => {
  for (const c of CASES) {
    it(c.name, async (t) => {
      const { pageThemePlan } = await import(pathToFileURL(cookTheme).href);
      // An older Cook checkout without the theme plan: nothing to compare against.
      if (typeof pageThemePlan !== 'function') return t.skip(`${cookTheme} has no pageThemePlan`);
      const plan = pageThemePlan(c.setting, c.fm, 'p.html');
      assert.deepEqual([plan.html.ids.join(' '), plan.html.mode], c.html);
      assert.deepEqual(plan.scoped && [plan.scoped.ids.join(' '), plan.scoped.mode], c.scoped);
      assert.deepEqual(plan.links.map((l) => l.id), c.links);
    });
  }
});
