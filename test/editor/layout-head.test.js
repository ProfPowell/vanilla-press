/**
 * The layout editor's Head dialog (base only): `meta.head` items listed in
 * order with add, edit, reorder and remove; the `${slot:head}` item at most
 * once, shown as `Region: Head`; script and style bodies in a textarea.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const COOK = '/Users/tpowell/src/cook';
const HAVE_COOK = existsSync(path.join(COOK, 'scripts', 'layouts.js'));
const cook = HAVE_COOK ? await import(path.join(COOK, 'scripts', 'layouts.js')) : null;
const BASE = path.join(COOK, 'starters', 'vanilla-breeze', 'src', 'layouts', 'base.html');
const NAMES = { fields: ['siteTitle'] };
/** The starter base's tree (its head ends with ${slot:head}); the tree serves as the editor's meta. */
const starterBase = () => {
  const parsed = cook.parseLayout(readFileSync(BASE, 'utf8'), NAMES);
  assert.ok(parsed.ok, JSON.stringify(parsed.problems));
  return parsed.tree;
};
const checks = (tree) => {
  const result = cook.checkLayout(cook.serializeLayout(tree), NAMES);
  assert.ok(result.ok, JSON.stringify(result.problems));
};

const GLOBALS = ['window', 'document', 'Node', 'HTMLElement', 'Event'];
const saved = {};
let win;
let mod;

before(async () => {
  win = parseHTML('<!doctype html><html><body><div data-root></div></body></html>');
  for (const k of GLOBALS) { saved[k] = globalThis[k]; globalThis[k] = k === 'window' ? win : win[k]; }
  mod = await import('../../editor/assets/js/layout-editor/head-dialog.js');
});
after(() => { for (const k of GLOBALS) globalThis[k] = saved[k]; });

const baseMeta = () => ({
  kind: 'base',
  info: { format: 1, label: 'Base', slots: {} },
  head: [
    { tag: 'meta', attrs: [['charset', 'utf-8']] },
    { tag: 'title', attrs: [], text: '${title}' },
  ],
});

describe('head items (model)', () => {
  it('adds meta[name=theme-color] and the head region; the region only once', () => {
    const meta = baseMeta();
    assert.equal(mod.addHeadItem(meta, { tag: 'meta', attrs: [['name', 'theme-color'], ['content', '${themeColor}']] }), true);
    assert.deepEqual(meta.head[2], { tag: 'meta', attrs: [['name', 'theme-color'], ['content', '${themeColor}']] });
    assert.equal(mod.canAddHeadRegion(meta), true);
    assert.equal(mod.addHeadItem(meta, { slot: 'head' }), true);
    assert.deepEqual(meta.head.at(-1), { slot: 'head' });
    assert.equal(meta.info.slots.head.label, 'Head');
    assert.equal(mod.canAddHeadRegion(meta), false);
    assert.equal(mod.addHeadItem(meta, { slot: 'head' }), false);
    assert.equal(meta.head.filter(i => i.slot === 'head').length, 1);
  });

  it('moves and removes items, and refuses tags outside HeadItem', () => {
    const meta = baseMeta();
    mod.moveHeadItem(meta, 1, -1);
    assert.equal(meta.head[0].tag, 'title');
    mod.moveHeadItem(meta, 0, -1); // already first: unchanged
    assert.equal(meta.head[0].tag, 'title');
    mod.removeHeadItem(meta, 0);
    assert.deepEqual(meta.head.map(i => i.tag), ['meta']);
    assert.equal(mod.addHeadItem(meta, { tag: 'div', attrs: [] }), false);
    assert.deepEqual(mod.HEAD_TAGS, ['title', 'meta', 'link', 'script', 'style', 'base']);
  });

  it('summaries: tags with their attributes, the region as Region: Head', () => {
    const meta = baseMeta();
    assert.equal(mod.headItemSummary({ tag: 'meta', attrs: [['name', 'theme-color'], ['content', '#fff']] }, meta), '<meta name="theme-color" content="#fff">');
    assert.equal(mod.headItemSummary({ tag: 'title', attrs: [], text: '${title}' }, meta), '<title>${title}</title>');
    assert.equal(mod.headItemSummary({ slot: 'head' }, meta), 'Region: Head');
  });
});

describe('head items on the starter base (Cook checks the result)', { skip: !HAVE_COOK && 'needs the linked Cook' }, () => {
  it('a new item goes before ${slot:head}, which stays last', () => {
    const tree = starterBase();
    assert.deepEqual(tree.head.at(-1), { slot: 'head' });
    assert.equal(mod.addHeadItem(tree, { tag: 'meta', attrs: [['name', 'theme-color'], ['content', '#123456']] }), true);
    assert.deepEqual(tree.head.at(-1), { slot: 'head' });
    assert.equal(tree.head.at(-2).attrs[0][1], 'theme-color');
    checks(tree);
  });

  it('the region can\'t move, and nothing moves below it', () => {
    const tree = starterBase();
    const last = tree.head.length - 1;
    assert.equal(mod.canMoveHeadItem(tree, last, -1), false);
    assert.equal(mod.canMoveHeadItem(tree, last - 1, 1), false);
    assert.equal(mod.moveHeadItem(tree, last - 1, 1), false);
    assert.equal(mod.moveHeadItem(tree, last, -1), false);
    assert.equal(mod.canMoveHeadItem(tree, last - 1, -1), true);
    assert.deepEqual(tree.head.at(-1), { slot: 'head' });
    checks(tree);
  });

  it('removing the region drops its info entry', () => {
    const tree = starterBase();
    assert.equal(mod.removeHeadItem(tree, tree.head.length - 1), true);
    assert.equal(tree.info.slots.head, undefined);
    assert.ok(tree.info.slots.aside);
    checks(tree);
    assert.equal(mod.addHeadItem(tree, { slot: 'head' }), true);
    assert.equal(tree.info.slots.head.label, 'Head');
    checks(tree);
  });

  it('DOM: the region\'s ↑ and the ↓ above it are disabled; removing it names the layouts built on this one', () => {
    const tree = starterBase();
    const root = win.document.querySelector('[data-root]');
    root.replaceChildren();
    const dialog = mod.createHeadDialog({ root, getMeta: () => tree, getChildren: () => ['post', 'page'] });
    dialog.open();
    const items = () => [...root.querySelectorAll('[data-head-item]')];
    const last = items().at(-1);
    assert.match(last.textContent, /Region: Head/);
    assert.equal(last.querySelector('[data-head-up]').disabled, true);
    assert.equal(items().at(-2).querySelector('[data-head-down]').disabled, true);
    assert.equal(items().at(-2).querySelector('[data-head-up]').disabled, false);
    last.querySelector('[data-head-remove]').click();
    assert.equal(tree.head.some(i => i.slot === 'head'), false);
    assert.match(root.querySelector('[data-head-message]').textContent, /post, page/);
    checks(tree);
    dialog.destroy();
  });
});

describe('head dialog (DOM)', () => {
  function setup(meta = baseMeta()) {
    const root = win.document.querySelector('[data-root]');
    root.replaceChildren();
    let changes = 0;
    const dialog = mod.createHeadDialog({
      root, getMeta: () => meta, getContext: () => ({ documentFields: ['title', 'description'], siteFields: ['siteTitle'] }),
      onChange: () => { changes++; },
    });
    dialog.open();
    return { root, meta, dialog, changes: () => changes };
  }
  const input = (el, value) => { el.value = value; el.dispatchEvent(new win.Event('input', { bubbles: true })); };
  const choose = (select, value) => {
    // Only set the chosen one: linkedom's selected setter clears the selected option on any set
    [...select.querySelectorAll('option')].find(o => o.value === value).selected = true;
    select.dispatchEvent(new win.Event('change', { bubbles: true }));
  };

  it('adding meta[name=theme-color] through the form updates meta.head', () => {
    const { root, meta, dialog, changes } = setup();
    choose(root.querySelector('[data-head-new]'), 'meta');
    root.querySelector('[data-head-add]').click();
    assert.equal(meta.head.length, 3);
    root.querySelector('[data-head-attr-add]').click();
    root.querySelector('[data-head-attr-add]').click();
    const names = root.querySelectorAll('[data-head-attr-name]');
    const values = root.querySelectorAll('[data-head-attr-value]');
    input(names[0], 'name');
    input(values[0], 'theme-color');
    input(names[1], 'content');
    input(values[1], '${themeColor}');
    assert.deepEqual(meta.head[2], { tag: 'meta', attrs: [['name', 'theme-color'], ['content', '${themeColor}']] });
    assert.ok(changes() >= 1);
    assert.match(root.querySelector('[data-head-list]').textContent, /theme-color/);
    dialog.destroy();
  });

  it('the head region is added once and shown as Region: Head', () => {
    const { root, meta, dialog } = setup();
    const region = () => [...root.querySelector('[data-head-new]').querySelectorAll('option')].find(o => o.value === 'region');
    assert.equal(region().textContent, 'Region: Head');
    choose(root.querySelector('[data-head-new]'), 'region');
    root.querySelector('[data-head-add]').click();
    assert.deepEqual(meta.head.at(-1), { slot: 'head' });
    assert.match(root.querySelector('[data-head-list]').textContent, /Region: Head/);
    assert.equal(region().disabled, true);
    root.querySelector('[data-head-add]').click();
    assert.equal(meta.head.filter(i => i.slot === 'head').length, 1);
    dialog.destroy();
  });

  it('script and style bodies are edited in a textarea; reorder and remove from the list', () => {
    const { root, meta, dialog } = setup();
    choose(root.querySelector('[data-head-new]'), 'style');
    root.querySelector('[data-head-add]').click();
    const body = root.querySelector('textarea[data-head-text]');
    assert.ok(body, 'a textarea for the style body');
    input(body, 'a>b{color:red}');
    assert.equal(meta.head[2].text, 'a>b{color:red}');
    const items = () => [...root.querySelectorAll('[data-head-item]')];
    items()[2].querySelector('[data-head-up]').click();
    assert.equal(meta.head[1].tag, 'style');
    items()[1].querySelector('[data-head-remove]').click();
    assert.deepEqual(meta.head.map(i => i.tag), ['meta', 'title']);
    dialog.destroy();
  });

  it('editing only the attributes keeps a body byte for byte (CRLF)', () => {
    const meta = baseMeta();
    meta.head.push({ tag: 'script', attrs: [['type', 'module']], text: '\r\n  a();\r\n' });
    const { root, dialog } = setup(meta);
    root.querySelectorAll('[data-head-item]')[2].querySelector('[data-head-edit]').click();
    // A textarea's value normalizes CRLF; the body must not be read back from it
    root.querySelector('textarea[data-head-text]').value = '\n  a();\n';
    input(root.querySelector('[data-head-attr-value]'), 'text/javascript');
    assert.deepEqual(meta.head[2], { tag: 'script', attrs: [['type', 'text/javascript']], text: '\r\n  a();\r\n' });
    input(root.querySelector('textarea[data-head-text]'), 'b();');
    assert.equal(meta.head[2].text, 'b();');
    dialog.destroy();
  });

  it('refuses event-handler and malformed attribute names', () => {
    const { root, meta, dialog } = setup();
    choose(root.querySelector('[data-head-new]'), 'link');
    root.querySelector('[data-head-add]').click();
    root.querySelector('[data-head-attr-add]').click();
    input(root.querySelector('[data-head-attr-name]'), 'onload');
    input(root.querySelector('[data-head-attr-value]'), 'x()');
    assert.deepEqual(meta.head[2].attrs, []);
    assert.match(root.querySelector('[data-head-message]').textContent, /onload/);
    dialog.destroy();
  });
});
