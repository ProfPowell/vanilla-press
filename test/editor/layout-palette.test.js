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
  paletteItems, insertEntry, layoutViolations, layoutRulesPlugin, addsViolation, fillEntries,
} from '../../editor/assets/js/layout-editor/palette.js';
import { docToTree } from '../../editor/assets/js/layout-editor/convert.js';

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

  it('inside a menu offers only menu_item (and an inline component in its text)', () => {
    const state = stateAt(fragmentTree([
      { type: 'menu', tag: 'ul', attrs: [], items: [{ attrs: [], inline: [{ text: 'Home' }] }] },
    ]), 'Home');
    assert.ok(ids(state).includes('inline-component'));
    const items = paletteItems(state).filter(e => !e.inline);
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

describe('layout palette: components', () => {
  it('offers a Component where blocks go and inserts it selected, for the inspector to name', () => {
    const state = stateAt(baseTree([text('p', [{ text: 'Hello' }]), { type: 'content', attrs: [] }]), 'Hello');
    const entry = paletteItems(state).find(e => e.id === 'component');
    assert.ok(entry);
    const tr = insertEntry(state, entry);
    assert.equal(tr.selection.node.type.name, 'component');
    assert.equal(tr.doc.firstChild.child(1).child(1).type.name, 'component');
  });

  it('offers an inline component inside text, inserted at the caret', () => {
    const state = stateAt(fragmentTree([text('p', [{ text: 'Hello' }])]), 'Hello');
    const entry = paletteItems(state).find(e => e.id === 'inline-component');
    assert.ok(entry);
    const tr = insertEntry(state, entry);
    const p = tr.doc.firstChild.child(0);
    assert.equal(p.childCount, 3);
    assert.equal(p.child(1).type.name, 'inline_component');
    assert.equal(tr.selection.node.type.name, 'inline_component');
  });

  it('no inline component with a block selected', () => {
    const state = stateSelecting(fragmentTree([{ type: 'container', tag: 'section', attrs: [], body: [] }]), 'container');
    assert.ok(!ids(state).includes('inline-component'));
    assert.ok(ids(state).includes('component'));
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

  it('a comment beside a slot is allowed (as Cook allows <aside><!-- n -->${slot:a}</aside>)', () => {
    const s = layoutSchema;
    const doc = s.nodes.doc.create(null, s.nodes.fragment_body.create(null, [
      s.nodes.container.create({ tag: 'section' }, [s.nodes.comment.create({ text: ' n ' }), s.nodes.slot_ref.create({ name: 'a' })]),
    ]));
    assert.deepEqual(layoutViolations(doc), []);
  });

  it('refuses a change that swaps one breach for another', () => {
    assert.equal(addsViolation(['a'], ['b']), true);
    assert.equal(addsViolation(['a', 'a'], ['a']), false);
    assert.equal(addsViolation(['a'], ['a', 'a']), true);
    // A doc with a second content block: deleting it while adding a third nav is refused
    const tree = baseTree([{ type: 'content', attrs: [] }, { type: 'content', attrs: [] }], [region('nav', []), region('nav', [])]);
    const state = stateSelecting(tree, 'include');
    const before = layoutViolations(state.doc);
    assert.equal(before.length, 1);
    let contentPos = null;
    state.doc.descendants((node, pos) => { if (contentPos === null && node.type.name === 'content') contentPos = pos; });
    const tr = state.tr.insert(state.selection.to, layoutSchema.nodes.region.create({ tag: 'nav' }));
    tr.delete(tr.mapping.map(contentPos), tr.mapping.map(contentPos) + 1);
    assert.equal(layoutViolations(tr.doc).length, 1);
    assert.equal(state.apply(tr).doc.eq(state.doc), true);
  });
});

describe('a child fills its parent\'s regions', () => {
  it('offers each unfilled parent region by its label; inserting one adds <template slot>', () => {
    const tree = {
      kind: 'child', info: { format: 1, label: 'Kid', slots: {} }, parent: 'base', vars: [], pageLayout: 'stack',
      htmlAttrs: [], head: [], body: [{ type: 'content', attrs: [] }], slots: [],
    };
    const { doc, meta } = treeToDoc(tree, layoutSchema);
    let pos = null;
    doc.descendants((node, p) => { if (node.type.name === 'content') pos = p; });
    const state = EditorState.create({ doc, selection: NodeSelection.create(doc, pos) });
    const slots = [{ name: 'nav', label: 'Section menu' }, { name: 'aside', label: 'Sidebar' }, { name: 'head', label: 'Head' }];
    const extra = fillEntries(slots, doc, 'base');
    assert.deepEqual(extra.map(e => [e.id, e.label, e.category]), [['fill-nav', 'Section menu', 'region'], ['fill-aside', 'Sidebar', 'region'], ['fill-head', 'Head', 'region']]);
    const items = paletteItems(state, extra);
    const sidebar = items.find(e => e.id === 'fill-aside');
    assert.ok(sidebar, items.map(e => e.id).join());
    assert.equal(items.some(e => e.id === 'region-aside'), false, 'base regions are not offered in a child');
    const tr = insertEntry(state, sidebar);
    assert.ok(tr);
    const after = docToTree(tr.doc, meta);
    assert.deepEqual(after.slots.map(p => p.name), ['aside']);
    assert.deepEqual(fillEntries(slots, tr.doc).map(e => e.id), ['fill-nav', 'fill-head']);
  });

  it('offers a Head fill when the parent has a head region and the child has no head piece (I3)', () => {
    const tree = {
      kind: 'child', info: { format: 1, label: 'Kid', slots: {} }, parent: 'base', vars: [], pageLayout: 'stack',
      htmlAttrs: [], head: [], body: [{ type: 'content', attrs: [] }], slots: [],
    };
    const { doc, meta } = treeToDoc(tree, layoutSchema);
    let pos = null;
    doc.descendants((node, p) => { if (node.type.name === 'content') pos = p; });
    const state = EditorState.create({ doc, selection: NodeSelection.create(doc, pos) });
    const head = fillEntries([{ name: 'head', label: 'Head' }], doc, 'base');
    assert.deepEqual(head.map(e => [e.id, e.label]), [['fill-head', 'Head']]);
    const entry = paletteItems(state, head).find(e => e.id === 'fill-head');
    assert.ok(entry, 'it fits after the body');
    const tr = insertEntry(state, entry);
    assert.deepEqual(docToTree(tr.doc, meta).slots, [{ name: 'head', attrs: [], body: [] }]);
    assert.deepEqual(fillEntries([{ name: 'head', label: 'Head' }], tr.doc), []);
    assert.deepEqual(fillEntries([{ name: 'aside' }], doc).map(e => e.id), ['fill-aside'], 'no head region, no Head fill');
  });
});
