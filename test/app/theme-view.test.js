import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  draftFrom, isDirty, cardModels, schemeControl, pagesModel, vbNote, hueOf, schemeOf, previewSrcdoc, escapeHtml,
  applyBody, deleteRefusalText, applyOutcome, libraryNotice, importTooBig, LIVE_POLL_MS, LIVE_POLL_FOR_MS,
  baselineOf, applyFailureView, liveStep, LIVE_STOPPED_TEXT, tokenReads,
} from '../../app/assets/js/theme-view.js';

const theme = (id, tier, extra = {}) => ({
  id, name: id.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' '), tier, ...extra,
});
const CORE = ['default', 'classic', 'minimal', 'modern'].map((id) => theme(id, 'core'));
const COLOR = ['amber', 'coral', 'emerald', 'forest', 'indigo'].map((id) => theme(id, 'color'));
const SHOWCASE = ['8bit', 'art-deco', 'bauhaus', 'swiss', 'win9x'].map((id) => theme(id, 'showcase'));
const COMMUNITY = ['catppuccin-frappe', 'catppuccin-latte', 'catppuccin-macchiato', 'catppuccin-mocha', 'dracula', 'nord']
  .map((id) => theme(id, 'community'));
const FILLER = Array.from({ length: 38 }, (_, i) => theme(`extra-${i + 1}`, 'community'));
const CUSTOM = [
  { id: 'retro-mine', name: 'Retro mine', tier: 'custom', custom: true, base: '8bit', only: 'dark' },
  { id: 'paper', name: 'Paper', tier: 'custom', custom: true, base: 'default' },
];
const THEMES_60 = [...CORE, ...COLOR, ...SHOWCASE, ...COMMUNITY, ...FILLER, ...CUSTOM];

describe('theme-view', () => {
  it('the fixture has 60 themes', () => assert.equal(THEMES_60.length, 60));

  it('cards: current first, then custom, 8 then "All N themes"', () => {
    const m = cardModels(THEMES_60, { current: 'swiss', query: '', expanded: false });
    assert.equal(m.cards.length, 8);
    assert.equal(m.cards[0].id, 'swiss'); assert.equal(m.cards[0].pressed, true);
    assert.equal(m.cards[1].tierText, 'Custom');
    assert.deepEqual(m.cards.map((c) => c.id), ['swiss', 'retro-mine', 'paper', 'default', 'classic', 'minimal', 'modern', 'amber']);
    assert.equal(m.cards.filter((c) => c.pressed).length, 1);
    assert.equal(m.total, 60);
    assert.equal(m.toggleText, 'All 60 themes');
  });

  it('cards: expanded shows every theme once and offers "Fewer themes"', () => {
    const m = cardModels(THEMES_60, { current: 'swiss', query: '', expanded: true });
    assert.equal(m.cards.length, 60);
    assert.equal(new Set(m.cards.map((c) => c.id)).size, 60);
    assert.equal(m.toggleText, 'Fewer themes');
  });

  it('cards: tier text, custom flag and single scheme', () => {
    const m = cardModels(THEMES_60, { current: 'retro-mine', query: '', expanded: true });
    const by = Object.fromEntries(m.cards.map((c) => [c.id, c]));
    assert.equal(by.default.tierText, 'Core');
    assert.equal(by.amber.tierText, 'Color');
    assert.equal(by['8bit'].tierText, 'Showcase');
    assert.equal(by.nord.tierText, 'Community');
    assert.deepEqual([by['retro-mine'].custom, by['retro-mine'].only, by['retro-mine'].tierText], [true, 'dark', 'Custom']);
    assert.deepEqual([by.paper.custom, by.paper.only], [true, null]);
    assert.equal(by.default.custom, false);
    assert.equal(m.cards[0].id, 'retro-mine');
  });

  it('cards: a current theme that is not in the list is not invented', () => {
    const m = cardModels(THEMES_60, { current: 'gone', query: '', expanded: false });
    assert.equal(m.cards[0].id, 'retro-mine');
    assert.equal(m.cards.some((c) => c.pressed), false);
  });

  it('cards: no toggle when every theme fits', () => {
    const m = cardModels(CORE, { current: 'default', query: '', expanded: false });
    assert.equal(m.cards.length, 4);
    assert.equal(m.toggleText, null);
  });

  it('search filters every theme by name', () => {
    assert.deepEqual(cardModels(THEMES_60, { current: 'default', query: 'cat', expanded: false }).cards.map((c) => c.id),
      ['catppuccin-frappe', 'catppuccin-latte', 'catppuccin-macchiato', 'catppuccin-mocha']);
  });

  it('search is case-insensitive, covers themes past the first 8, and has no toggle', () => {
    const m = cardModels(THEMES_60, { current: 'default', query: '  EXTRA-3', expanded: false });
    assert.deepEqual(m.cards.map((c) => c.id), ['extra-3', 'extra-30', 'extra-31', 'extra-32', 'extra-33', 'extra-34', 'extra-35', 'extra-36', 'extra-37', 'extra-38']);
    assert.equal(m.toggleText, null);
    assert.equal(m.total, 60);
    assert.deepEqual(cardModels(THEMES_60, { current: 'default', query: 'retro', expanded: false }).cards.map((c) => c.id), ['retro-mine']);
  });

  it('draftFrom: defaults, and the adjustments of a setting', () => {
    assert.deepEqual(draftFrom(null), {
      name: 'default', mode: 'auto', adjustments: { hue: null, headingFont: null, bodyFont: null, corners: 'theme' },
    });
    assert.deepEqual(draftFrom({
      name: 'swiss', mode: 'dark',
      adjustments: { hue: 120, headingFont: 'serif', bodyFont: 'mono', corners: 'round', colors: { light: {} } },
    }), { name: 'swiss', mode: 'dark', adjustments: { hue: 120, headingFont: 'serif', bodyFont: 'mono', corners: 'round' } });
  });

  it('draftFrom: unknown values fall back', () => {
    assert.deepEqual(draftFrom({ name: 'swiss', mode: 'sepia', adjustments: { hue: 'red', headingFont: 'comic', corners: 'wobbly' } }), {
      name: 'swiss', mode: 'auto', adjustments: { hue: null, headingFont: null, bodyFont: null, corners: 'theme' },
    });
  });

  it('dirty when any field differs', () => {
    const a = draftFrom({ name: 'swiss', mode: 'auto' });
    assert.equal(isDirty(a, a), false);
    assert.equal(isDirty(a, draftFrom({ name: 'swiss', mode: 'auto' })), false);
    assert.equal(isDirty(a, { ...a, adjustments: { ...a.adjustments, hue: 30 } }), true);
    assert.equal(isDirty(a, { ...a, name: '8bit' }), true);
    assert.equal(isDirty(a, { ...a, mode: 'light' }), true);
    assert.equal(isDirty(a, { ...a, adjustments: { ...a.adjustments, headingFont: 'serif' } }), true);
    assert.equal(isDirty(a, { ...a, adjustments: { ...a.adjustments, bodyFont: 'mono' } }), true);
    assert.equal(isDirty(a, { ...a, adjustments: { ...a.adjustments, corners: 'square' } }), true);
  });

  it('a light-only theme disables the scheme control with a reason', () => {
    assert.deepEqual(schemeControl({ name: 'Night', only: 'light' }), { disabled: true, note: 'Night is light only, so the color scheme is fixed.' });
    assert.deepEqual(schemeControl({ name: 'Ink', only: 'dark' }), { disabled: true, note: 'Ink is dark only, so the color scheme is fixed.' });
    assert.deepEqual(schemeControl({ name: 'Swiss' }), { disabled: false, note: null });
    assert.deepEqual(schemeControl(undefined), { disabled: false, note: null });
  });

  it('schemeOf: a single-scheme theme wins, then the chosen scheme, then the reader\'s', () => {
    assert.equal(schemeOf({ only: 'dark' }, 'light', false), 'dark');
    assert.equal(schemeOf({}, 'light', true), 'light');
    assert.equal(schemeOf({}, 'auto', true), 'dark');
    assert.equal(schemeOf(null, 'auto', false), 'light');
  });

  it('pages: the empty text, and links to the editor', () => {
    assert.equal(pagesModel([], 'mc').empty, true);
    assert.equal(pagesModel([{ id: 'doc_1', title: 'Arcade', theme: '8bit' }], 'mc').items[0].href, '/editor/?site=mc#doc-doc_1');
  });

  it('pages: theme names from the theme list, ids otherwise; untitled posts', () => {
    const m = pagesModel([{ id: 'a b', title: '', theme: '8bit' }, { id: 'c', title: 'Gone', theme: 'gone' }], 'my site', THEMES_60);
    assert.equal(m.empty, false);
    assert.deepEqual(m.items, [
      { title: 'Untitled', themeName: '8bit', href: '/editor/?site=my%20site#doc-a%20b' },
      { title: 'Gone', themeName: 'gone', href: '/editor/?site=my%20site#doc-c' },
    ]);
    assert.equal(pagesModel(undefined, 'mc').empty, true);
  });

  it('vbNote: only when previews use VP\'s own Vanilla Breeze', () => {
    assert.equal(vbNote({ source: 'vp', url: null }), "This site has no copy of Vanilla Breeze under src/, so these previews use Vanilla Press's own.");
    assert.equal(vbNote({ source: 'site', url: '/x' }), null);
    assert.equal(vbNote(undefined), null);
  });

  it('hueOf: the hue of a computed oklch color', () => {
    assert.equal(hueOf('oklch(0.5 0.2 260)'), 260);
    assert.equal(hueOf('oklch(0.7 0.2 145.5 / 0.5)'), 145.5);
    assert.equal(hueOf('oklch(0.5 0 none)'), 0);
    assert.equal(hueOf('rgb(0, 0, 0)'), null);
    assert.equal(hueOf(''), null);
  });

  it('escapeHtml escapes markup and quotes', () => {
    assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
    assert.equal(escapeHtml(null), '');
  });

  it('previewSrcdoc: a whole page with the theme on <html>, its stylesheets and the adjustments', () => {
    const doc = previewSrcdoc({
      vbHref: '/sites/mc/site/assets/vendor/vanilla-breeze/vanilla-breeze.css',
      themeHref: '/sites/mc/site/assets/vendor/vanilla-breeze/themes/8bit.css',
      layoutHref: '/app/assets/theme-preview-frame.css',
      dataTheme: '8bit vp-site', mode: 'dark',
      adjustCss: '[data-theme~="vp-site"] { --hue-primary: 120; }',
      siteName: 'My <site>', post: { title: 'A "post"', dateText: 'Nov 3, 2026', html: '<p>Hello <b>there</b></p>' },
    });
    assert.match(doc, /^<!doctype html>/);
    assert.match(doc, /<html lang="en" data-theme="8bit vp-site" data-mode="dark">/);
    assert.match(doc, /<link rel="stylesheet" href="\/sites\/mc\/site\/assets\/vendor\/vanilla-breeze\/vanilla-breeze.css">/);
    assert.match(doc, /<link id="vp-theme-css" rel="stylesheet" href="\/sites\/mc\/site\/assets\/vendor\/vanilla-breeze\/themes\/8bit.css">/);
    assert.match(doc, /<link rel="stylesheet" href="\/app\/assets\/theme-preview-frame.css">/);
    assert.match(doc, /<style id="vp-site-preview">\[data-theme~="vp-site"\] \{ --hue-primary: 120; \}<\/style>/);
    assert.ok(doc.includes('My &lt;site&gt;'));
    assert.ok(doc.includes('<h1>A &quot;post&quot;</h1>'));
    assert.ok(doc.includes('Nov 3, 2026'));
    assert.ok(doc.includes('<p>Hello <b>there</b></p>'), 'the post HTML is the page body, as the site renders it');
    assert.ok(doc.includes('class="button"'));
    assert.ok(doc.indexOf('vp-site-preview') > doc.indexOf('vp-theme-css'), 'adjustments after the theme');
  });

  it('previewSrcdoc: no theme stylesheet, sample text, and no way out of the <style> or attributes', () => {
    const doc = previewSrcdoc({
      vbHref: '/assets/vb/vanilla-breeze.css', themeHref: null, layoutHref: '/x.css',
      dataTheme: 'default vp-site" onload="x', mode: 'light',
      adjustCss: 'a{}</style><script>x()</script>', siteName: '', post: null,
      sample: { title: 'Sample', paragraphs: ['One <i>', 'Two'] },
    });
    assert.match(doc, /<link id="vp-theme-css" rel="stylesheet">/);
    assert.ok(doc.includes('data-theme="default vp-site&quot; onload=&quot;x"'));
    assert.ok(!doc.includes('</style><script>'));
    assert.ok(doc.includes('<\\/style>'));
    assert.ok(doc.includes('<h1>Sample</h1>') && doc.includes('<p>One &lt;i&gt;</p>') && doc.includes('<p>Two</p>'));
  });

  it('applyBody sends colors only when the hue is set', () => {
    assert.equal(applyBody(draftFrom({ name: 'swiss', mode: 'auto' }), null).adjustments.colors, null);
    const colors = { light: { '--color-primary': 'oklch(0.5 0.2 25)' }, dark: { '--color-primary': 'oklch(0.7 0.2 25)' } };
    assert.equal(applyBody(draftFrom({ name: 'swiss', mode: 'auto' }), colors).adjustments.colors, null);
    const d = draftFrom({ name: 'swiss', mode: 'dark', adjustments: { hue: 25, headingFont: 'serif', corners: 'round' } });
    assert.deepEqual(applyBody(d, colors), {
      name: 'swiss', mode: 'dark',
      adjustments: { hue: 25, headingFont: 'serif', bodyFont: null, corners: 'round', colors },
    });
  });

  it('deleteRefusalText names every user', () => {
    assert.equal(deleteRefusalText('Retro Mine', ['the site theme', 'Old Games']), 'Retro Mine is used by the site theme and Old Games. Pick another theme for them first.');
    assert.equal(deleteRefusalText('X', ['A']), 'X is used by A. Pick another theme for them first.');
    assert.equal(deleteRefusalText('X', ['A', 'B', 'C']), 'X is used by A, B and C. Pick another theme for them first.');
  });

  it('applyOutcome: saved, pushed with a site URL (poll), pushed without one', () => {
    assert.deepEqual(applyOutcome({ status: 'saved', url: 'https://x.test/' }),
      { text: 'Applied on this computer. Connect GitHub to put it live.', liveUrl: null });
    assert.deepEqual(applyOutcome({ status: 'pushed', url: 'https://x.test/' }), { text: 'Applying…', liveUrl: 'https://x.test/' });
    assert.deepEqual(applyOutcome({ status: 'pushed', url: null }),
      { text: 'Applied and pushed (set siteUrl to check when it is live)', liveUrl: null });
    assert.equal(LIVE_POLL_MS, 10_000);
    assert.equal(LIVE_POLL_FOR_MS, 300_000);
  });

  it('libraryNotice: what a library change kept, left out and whether it was committed', () => {
    assert.equal(libraryNotice('import', { committed: true, dropped: ['body', '--b'] }), 'Imported. Not kept: body, --b');
    assert.equal(libraryNotice('import', { committed: true, dropped: [] }), 'Imported.');
    assert.equal(libraryNotice('save', { committed: true, skipped: ['--A'] }), 'Saved as a new theme. Not kept: --A');
    assert.equal(libraryNotice('rename', { committed: true }), 'Renamed.');
    assert.equal(libraryNotice('delete', { committed: false, note: 'Saved on this computer, but not committed (x).' }),
      'Deleted. Saved on this computer, but not committed (x).');
    assert.equal(libraryNotice('save', { committed: false, note: 'N.', skipped: ['--a'] }), 'Saved as a new theme. Not kept: --a. N.');
  });

  it('importTooBig counts bytes against the 256 KB limit', () => {
    assert.equal(importTooBig('a'.repeat(256 * 1024)), false);
    assert.equal(importTooBig('a'.repeat(256 * 1024 + 1)), true);
    assert.equal(importTooBig('é'.repeat(128 * 1024 + 1)), true);
  });

  it('baselineOf drops the literal colors (what isDirty compares)', () => {
    const d = draftFrom({ name: 'swiss', mode: 'dark', adjustments: { hue: 200, corners: 'round' } });
    const withColors = { ...d, adjustments: { ...d.adjustments, colors: { light: {}, dark: {} } } };
    assert.deepEqual(baselineOf(withColors), d);
    assert.equal(isDirty(baselineOf(withColors), d), false);
  });

  it('applyFailureView: one live region per failure, baseline and reload as on disk', () => {
    const build = applyFailureView({ status: 422, data: { error: 'Build failed', log: 'x' } });
    assert.deepEqual(build, {
      state: '', report: { message: 'Build failed. Nothing was pushed, and the live site still has the previous theme.', log: 'x' },
      baseline: false, reload: false,
    });
    const files = applyFailureView({ status: 409, data: { error: 'GitHub has changes that conflict with yours.', files: ['a.md'] } });
    assert.deepEqual(files, {
      state: '', report: { message: "Applied on this computer, but couldn't push: GitHub has changes that conflict with yours. Conflicting files:", files: ['a.md'] },
      baseline: true, reload: true,
    });
    assert.deepEqual(applyFailureView({ status: 502, data: { error: 'no network' } }),
      { state: "Applied on this computer, but couldn't push: no network", report: null, baseline: true, reload: true });
    assert.deepEqual(applyFailureView({ status: 409, data: { error: 'The theme was changed on another computer. Review it and apply again.' } }),
      { state: 'The theme was changed on another computer. Review it and apply again.', report: null, baseline: false, reload: true });
    assert.deepEqual(applyFailureView({ status: 422, data: { error: 'This site has no copy of Vanilla Breeze under src/…' } }),
      { state: 'This site has no copy of Vanilla Breeze under src/…', report: null, baseline: false, reload: false });
    assert.deepEqual(applyFailureView(new Error('Cannot reach the Vanilla Press app. Is it still running?')),
      { state: 'Cannot reach the Vanilla Press app. Is it still running?', report: null, baseline: false, reload: false });
  });

  it('liveStep: live, keep polling, or time out after 5 min', () => {
    assert.deepEqual(liveStep({ live: true, url: 'https://a.test/' }, 'https://x.test/', 0, 1000), { done: 'live', url: 'https://a.test/' });
    assert.deepEqual(liveStep({ live: true, url: null }, 'https://x.test/', 0, 1000), { done: 'live', url: 'https://x.test/' });
    assert.deepEqual(liveStep({ live: false }, 'https://x.test/', 0, 299_999), { done: null });
    assert.deepEqual(liveStep(null, 'https://x.test/', 0, 1000), { done: null }, 'a failed check tries again');
    assert.deepEqual(liveStep({ live: false }, 'https://x.test/', 0, 300_000), { done: 'timeout', text: 'Still deploying, check Cloudflare' });
    assert.equal(LIVE_STOPPED_TEXT, 'Applied and pushed');
  });

  it('tokenReads: both schemes, or a one-scheme theme read in its scheme as the one (light) block', () => {
    assert.deepEqual(tokenReads({ id: '8bit' }), [['light', 'light'], ['dark', 'dark']]);
    assert.deepEqual(tokenReads({ id: 'night', only: 'dark' }), [['light', 'dark']]);
    assert.deepEqual(tokenReads({ id: 'paper', only: 'light' }), [['light', 'light']]);
  });
});
