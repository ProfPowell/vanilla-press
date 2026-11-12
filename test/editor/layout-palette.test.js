/**
 * Layout editor: the `/` palette offers only the blocks the schema (and the
 * rules its content expressions can't hold) allow at the caret, and the
 * rules guard refuses any change that breaks them (a drag, a paste).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, TextSelection, NodeSelection } from 'prosemirror-state';
import { layoutSchema } from '../../editor/assets/js/layout-editor/schema.js';
import { treeToDoc } from '../../editor/assets/js/layout-editor/convert.js';
import {
  paletteItems, insertEntry, layoutViolations, layoutRulesPlugin,
} from '../../editor/assets/js/layout-editor/palette.js';

const text = (tag, inline, extra = {}) => ({ type: 'text', tag, attrs: [], inline, ...extra });
const region = (tag, body, attrs = []) => ({ type: 'container', tag, attrs, body });

const baseTree = (mainBody, more = []) => ({
  kind: 'base',
  info: { format: 1, label: 'Base', slots: { aside: { label: 'Sidebar' } } },
  parent: null, vars: [], pageLayout: '${pageLayout}', htmlAttrs: [['lang', 'en']], head: [],
  body: [
    { type: 'include', path: '/includes/header.html', attrs: [] },
    region('main', mainBody, [['id', 'main']]),
    region('aside', [{ type: 'slot', name: 'aside', attrs: [] }], [['aria-label', 'Sidebar']]),
    ...more,
  ],
  slots: [],
});

const fragmentTree = (body) => ({
  kind: 'fragment', info: null, parent: null, vars: [], pageLayout: null, htmlAttrs: [], head: [], body, slots: [],
});

/** A state with the caret inside the first text node holding `needle`. */
function stateAt(tree, needle) {
  const { doc } = treeToDoc(tree, layoutSchema);
  let at = null;
  doc.descendants((node, pos) => {
    if (at === null && node.isText && node.text.includes(needle)) at = pos + node.text.indexOf(needle) + 1;
  });
  assert.ok(at !== null, `found ${needle}`);
  return EditorState.create({ doc, selection: TextSelection.create(doc, at), plugins: [layoutRulesPlugin()] });
}

/** A state with the first node of `type` selected. */
function stateSelecting(tree, type, nth = 0) {
  const { doc } = treeToDoc(tree, layoutSchema);
  const found = [];
  doc.descendants((node, pos) => { if (node.type.name === type) found.push(pos); });
  return EditorState.create({ doc, selection: NodeSelection.create(doc, found[nth]), plugins: [layoutRulesPlugin()] });
}

const ids = (state) => paletteItems(state).map(e => e.id);
const cats = (state) => new Set(paletteItems(state).map(e => e.category));

describe('layout palette: what the caret allows', () => {
  it('inside main of a base offers text and container blocks but not region', () => {
    const state = stateAt(baseTree([text('p', [{ text: 'Hello' }]), { type: 'content', attrs: [] }]), 'Hello');
    const got = ids(state);
    for (const id of ['p', 'h2', 'blockquote', 'section', 'layout-grid', 'ul', 'include']) assert.ok(got.includes(id), id);
    assert.ok(cats(state).has('text'));
    assert.ok(cats(state).has('container'));
    assert.ok(!cats(state).has('region'));
    assert.ok(!got.some(id => id.startsWith('region-')));
  });

  it('never offers a second content block', () => {
    const state = stateAt(baseTree([text('p', [{ text: 'Hello' }]), { type: 'content', attrs: [] }]), 'Hello');
    assert.ok(!ids(state).includes('content'));
  });

  it('offers the content block in main when there is none', () => {
    const state = stateAt(baseTree([text('p', [{ text: 'Hello' }])]), 'Hello');
    assert.ok(ids(state).includes('content'));
  });

  it('inside a menu offers only menu_item', () => {
    const state = stateAt(fragmentTree([
      { type: 'menu', tag: 'ul', attrs: [], items: [{ attrs: [], inline: [{ text: 'Home' }] }] },
    ]), 'Home');
    const items = paletteItems(state);
    assert.ok(items.length > 0);
    assert.deepEqual([...new Set(items.map(e => e.create(layoutSchema).type.name))], ['menu_item']);
  });

  it('a slot goes only into an empty element', () => {
    const notEmpty = stateAt(baseTree([text('p', [{ text: 'Hello' }]), { type: 'content', attrs: [] }]), 'Hello');
    assert.ok(!ids(notEmpty).includes('slot'));
    const empty = stateSelecting(fragmentTree([{ type: 'container', tag: 'section', attrs: [], body: [] }]), 'container');
    assert.ok(ids(empty).includes('slot'));
  });

  it('beside a region offers regions, but not a second main or a third nav', () => {
    const state = stateSelecting(baseTree([{ type: 'content', attrs: [] }]), 'include');
    const got = ids(state);
    assert.ok(got.includes('region-header'));
    assert.ok(got.includes('region-nav'));
    assert.ok(!got.includes('region-main'));
    assert.ok(!got.includes('p'));
    const twoNavs = stateSelecting(baseTree([{ type: 'content', attrs: [] }], [region('nav', []), region('nav', [])]), 'include');
    assert.ok(!ids(twoNavs).includes('region-nav'));
  });

  it('a fragment gets at most one header, nav or footer wrapper', () => {
    const tree = fragmentTree([
      { type: 'container', tag: 'footer', attrs: [], body: [text('p', [{ text: 'Foot' }])] },
      text('p', [{ text: 'Loose' }]),
    ]);
    const top = stateAt(tree, 'Loose');
    const got = ids(top);
    assert.ok(!got.includes('header') && !got.includes('nav') && !got.includes('footer'));
    assert.ok(got.includes('section'));
    // Nested inside the footer, a header container is not a wrapper
    assert.ok(ids(stateAt(tree, 'Foot')).includes('header'));
  });

  it('inserting an entry puts it after the caret block and keeps the doc valid', () => {
    const state = stateAt(baseTree([text('p', [{ text: 'Hello' }]), { type: 'content', attrs: [] }]), 'Hello');
    const entry = paletteItems(state).find(e => e.id === 'h2');
    const tr = insertEntry(state, entry);
    const main = tr.doc.firstChild.child(1);
    assert.equal(main.child(1).type.name, 'text_block');
    assert.equal(main.child(1).attrs.tag, 'h2');
    assert.equal(tr.selection.$from.parent.attrs.tag, 'h2');
  });
});

describe('layout rules guard', () => {
  it('counts a second content block, a slot not alone and a nested link', () => {
    const { doc } = treeToDoc(baseTree([{ type: 'content', attrs: [] }]), layoutSchema);
    assert.deepEqual(layoutViolations(doc), []);
    const s = layoutSchema;
    const linked = s.text('x', [s.marks.a.create({ key: '1' }), s.marks.a.create({ key: '1/2' })]);
    const bad = s.nodes.doc.create(null, s.nodes.fragment_body.create(null, [
      s.nodes.content.create(), s.nodes.content.create(),
      s.nodes.container.create({ tag: 'section' }, [s.nodes.slot_ref.create({ name: 'x' }), s.nodes.text_block.create()]),
      s.nodes.text_block.create(null, linked),
    ]));
    assert.ok(layoutViolations(bad).length >= 4);
  });

  it('refuses a change that adds a violation (a drop of a second main)', () => {
    const state = stateSelecting(baseTree([{ type: 'content', attrs: [] }]), 'include');
    const main = layoutSchema.nodes.region.create({ tag: 'main' });
    const after = state.apply(state.tr.insert(state.selection.to, main));
    assert.equal(after.doc.eq(state.doc), true);
  });
});
