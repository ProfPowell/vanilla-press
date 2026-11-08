import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  draftFrom, isDirty, cardModels, schemeControl, pagesModel, vbNote, hueOf, schemeOf,
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
});
