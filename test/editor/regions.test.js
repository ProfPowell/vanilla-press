import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { EditorState, TextSelection, NodeSelection } from 'prosemirror-state';
import { schema } from '../../editor/assets/js/schema.js';
import { toBlockAst, toRegionsAst, fromBlockAst } from '../../editor/assets/js/ast.js';
import { regionPlan, regionGuard, applyRegionPlan, regionNames } from '../../editor/assets/js/regions.js';
import { movableBlockAt, moveBlock } from '../../editor/assets/js/block-handles.js';
import { trailingParagraphPlugin } from '../../editor/assets/js/block-nav.js';

const para = (value) => ({ type: 'paragraph', children: [{ type: 'text', value }] });

/** A minimal view: dispatch applies the transaction (filters included). */
function fakeView(state) {
  const view = {
    state,
    dispatch(tr) { view.state = view.state.apply(tr); },
    focus() {},
  };
  return view;
}

/** The position just inside the first textblock whose text is `s`. */
function posOf(doc, s) {
  let found = null;
  doc.descendants((n, pos) => {
    if (found == null && n.isTextblock && n.textContent === s) found = pos + 1;
    return found == null;
  });
  assert.notEqual(found, null, `no textblock "${s}"`);
  return found;
}

const POST = [{ name: 'aside', label: 'Sidebar' }];
const PAGE = [];

describe('regionPlan', () => {
  it('lists the layout\'s slots first (shown), then stored regions it does not offer (not shown)', () => {
    const stored = { footer: [para('F')], aside: [para('A')], extra: [para('X')] };
    const plan = regionPlan([{ name: 'aside', label: 'Sidebar' }, { name: 'hero', label: '' }], stored);
    assert.deepEqual(plan, [
      { name: 'aside', label: 'Sidebar', shown: true, blocks: [para('A')] },
      { name: 'hero', label: 'hero', shown: true, blocks: [] },
      { name: 'footer', label: 'footer', shown: false, blocks: [para('F')] },
      { name: 'extra', label: 'extra', shown: false, blocks: [para('X')] },
    ]);
  });

  it('drops an empty stored region the layout does not offer', () => {
    assert.deepEqual(regionPlan([], { aside: [] }), []);
    assert.deepEqual(regionPlan(undefined, undefined), []);
  });
});

describe('regionGuard', () => {
  const doc = fromBlockAst([para('Body')], schema, {
    title: 'T', regions: [{ name: 'aside', label: 'Sidebar', shown: true, blocks: [para('Side')] }],
  });
  const state = EditorState.create({ doc, plugins: [regionGuard()] });
  const regionPos = doc.content.size - doc.lastChild.nodeSize;

  it('rejects deleting a region through a user transaction', () => {
    const tr = state.tr.delete(regionPos, doc.content.size);
    const next = state.apply(tr);
    assert.deepEqual(regionNames(next.doc), ['aside']);
    assert.equal(next.doc.lastChild.textContent, 'Side');
  });

  it('rejects a select-all delete that would take the regions with it', () => {
    const tr = state.tr.delete(doc.firstChild.nodeSize, doc.content.size);
    assert.deepEqual(regionNames(state.apply(tr).doc), ['aside']);
  });

  it('allows a vp-regions transaction', () => {
    const tr = state.tr.delete(regionPos, doc.content.size).setMeta('vp-regions', true);
    assert.deepEqual(regionNames(state.apply(tr).doc), []);
  });

  it('allows typing inside a region', () => {
    const at = posOf(doc, 'Side') + 4;
    const next = state.apply(state.tr.insertText('bar', at));
    assert.equal(next.doc.lastChild.textContent, 'Sidebar');
  });
});

describe('switching layouts keeps region content (Review Focus 2)', () => {
  it('post → page → post: the aside stays, shown false then true, and is saved both times', () => {
    const plan = regionPlan(POST, { aside: [para('Aside text')] });
    const doc = fromBlockAst([para('Body')], schema, { title: 'T', regions: plan });
    const view = fakeView(EditorState.create({ doc, plugins: [regionGuard(), trailingParagraphPlugin()] }));
    const expected = { aside: [para('Aside text')] };
    assert.deepEqual(toRegionsAst(view.state.doc), expected);

    // To `page` (no slots)
    applyRegionPlan(view, regionPlan(PAGE, toRegionsAst(view.state.doc)));
    view.state.doc.check();
    assert.deepEqual(regionNames(view.state.doc), ['aside']);
    assert.equal(view.state.doc.lastChild.attrs.shown, false);
    assert.equal(view.state.doc.lastChild.attrs.label, 'aside');
    assert.deepEqual(toRegionsAst(view.state.doc), expected, 'the save payload holds the aside');
    assert.deepEqual(toBlockAst(view.state.doc), [para('Body')]);

    // Back to `post`
    applyRegionPlan(view, regionPlan(POST, toRegionsAst(view.state.doc)));
    view.state.doc.check();
    assert.deepEqual(regionNames(view.state.doc), ['aside']);
    assert.equal(view.state.doc.lastChild.attrs.shown, true);
    assert.equal(view.state.doc.lastChild.attrs.label, 'Sidebar');
    assert.deepEqual(toRegionsAst(view.state.doc), expected, 'the save payload holds the aside again');
    assert.deepEqual(toBlockAst(view.state.doc), [para('Body')]);
  });

  it('adds an empty region for a new slot and drops an empty one the layout no longer offers', () => {
    const doc = fromBlockAst([para('Body')], schema, { regions: regionPlan(POST, {}) });
    const view = fakeView(EditorState.create({ doc, plugins: [regionGuard()] }));
    applyRegionPlan(view, regionPlan([{ name: 'hero', label: 'Hero' }], toRegionsAst(view.state.doc)));
    assert.deepEqual(regionNames(view.state.doc), ['hero']);
    assert.equal(view.state.doc.lastChild.textContent, '');
    view.state.doc.check();
  });

  it('keeps the body untouched and the cursor in the body', () => {
    const doc = fromBlockAst([para('Body')], schema, { regions: regionPlan(POST, { aside: [para('A')] }) });
    const state = EditorState.create({ doc, plugins: [regionGuard()], selection: TextSelection.create(doc, posOf(doc, 'Body') + 2) });
    const view = fakeView(state);
    applyRegionPlan(view, regionPlan([{ name: 'hero', label: 'Hero' }], toRegionsAst(view.state.doc)));
    assert.deepEqual(regionNames(view.state.doc), ['hero', 'aside']);
    assert.equal(view.state.selection.from, posOf(view.state.doc, 'Body') + 2);
  });
});

describe('editing inside a region', () => {
  const doc = fromBlockAst([para('Body one'), para('Body two')], schema, {
    title: 'T', regions: regionPlan(POST, { aside: [para('Side one'), para('Side two')] }),
  });

  it('a region block moves within its region, never out of it', () => {
    const state = EditorState.create({ doc, plugins: [regionGuard()], selection: TextSelection.create(doc, posOf(doc, 'Side one')) });
    let next = null;
    assert.ok(moveBlock(1)(state, (tr) => { next = state.apply(tr); }));
    assert.deepEqual(toRegionsAst(next.doc), { aside: [para('Side two'), para('Side one')] });
    // At the region's top: no move up into the body
    const top = EditorState.create({ doc, plugins: [regionGuard()], selection: TextSelection.create(doc, posOf(doc, 'Side one')) });
    assert.equal(moveBlock(-1)(top, () => {}), false);
  });

  it('the last body block does not move down past a region', () => {
    const state = EditorState.create({ doc, plugins: [regionGuard()], selection: TextSelection.create(doc, posOf(doc, 'Body two')) });
    assert.equal(moveBlock(1)(state, () => {}), false);
  });

  it('a region itself is never a movable block; its lone block is', () => {
    const lone = fromBlockAst([para('Body')], schema, { regions: regionPlan(POST, { aside: [para('Only')] }) });
    const block = movableBlockAt(lone.resolve(posOf(lone, 'Only')));
    assert.ok(block);
    assert.equal(lone.nodeAt(block.pos).type.name, 'paragraph');
    assert.equal(schema.nodes.region.spec.selectable, false);
    assert.equal(schema.nodes.region.spec.draggable, false);
  });

  it('the trailing paragraph goes at the end of the body, not after the regions', () => {
    const withRule = fromBlockAst([para('Body'), { type: 'hr' }], schema, { regions: regionPlan(POST, { aside: [para('A')] }) });
    const state = EditorState.create({ doc: withRule, plugins: [regionGuard(), trailingParagraphPlugin()] });
    const next = state.apply(state.tr.setMeta('x', 1));
    next.doc.check();
    const names = [];
    next.doc.forEach((n) => names.push(n.type.name));
    assert.deepEqual(names, ['title', 'paragraph', 'hr', 'paragraph', 'region']);
  });
});

describe('the block palette inside a region', () => {
  const win = parseHTML('<!doctype html><html><body></body></html>');
  const GLOBALS = ['document', 'HTMLElement', 'customElements', 'CustomEvent', 'Event', 'Node'];
  const saved = {};
  let palette;

  before(async () => {
    for (const k of GLOBALS) { saved[k] = globalThis[k]; globalThis[k] = win[k]; }
    const { BlockPalette } = await import('../../editor/assets/js/components/block-palette.js');
    palette = new BlockPalette();
  });
  after(() => { for (const k of GLOBALS) globalThis[k] = saved[k]; });

  const heading = { id: 'heading2', create: () => schema.nodes.heading.create({ level: 2 }) };

  it('the `/` entry replaces the region\'s empty line with the block, inside the region', () => {
    const doc = fromBlockAst([para('Body')], schema, { regions: regionPlan(POST, {}) });
    const view = fakeView(EditorState.create({ doc, plugins: [regionGuard()] }));
    const regionStart = doc.content.size - doc.lastChild.nodeSize;
    palette.view = view;
    palette.triggerPos = regionStart + 2; // in the region's empty paragraph
    palette.insertAfter = null;
    palette.insertBlock(heading);
    view.state.doc.check();
    const region = view.state.doc.lastChild;
    assert.equal(region.type.name, 'region');
    assert.equal(region.firstChild.type.name, 'heading');
  });

  it('the `+` entry inserts after a region block, inside the region', () => {
    const doc = fromBlockAst([para('Body')], schema, { regions: regionPlan(POST, { aside: [para('Side')] }) });
    const view = fakeView(EditorState.create({ doc, plugins: [regionGuard()] }));
    const side = posOf(doc, 'Side') - 1;
    palette.view = view;
    palette.triggerPos = side + 1;
    palette.insertAfter = side + doc.nodeAt(side).nodeSize;
    palette.insertBlock(heading);
    const region = view.state.doc.lastChild;
    assert.deepEqual(region.content.content.map((n) => n.type.name), ['paragraph', 'heading']);
    assert.ok(view.state.selection.$from.parent.type.name === 'heading');
  });

  it('a selected region block can be deleted, the region keeps a line to type in', () => {
    const doc = fromBlockAst([para('Body')], schema, { regions: regionPlan(POST, { aside: [{ type: 'hr' }] }) });
    const state = EditorState.create({ doc, plugins: [regionGuard()] });
    const hrPos = doc.content.size - doc.lastChild.nodeSize + 1;
    const sel = NodeSelection.create(doc, hrPos);
    const next = state.apply(state.tr.setSelection(sel).deleteSelection());
    next.doc.check();
    assert.deepEqual(regionNames(next.doc), ['aside']);
  });
});
