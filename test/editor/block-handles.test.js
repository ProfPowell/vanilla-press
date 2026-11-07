import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, TextSelection, NodeSelection } from 'prosemirror-state';
import { schema } from '../../editor/assets/js/schema.js';
import { toBlockAst } from '../../editor/assets/js/ast.js';
import { movableBlockAt, moveBlock, blockHandlesPlugin, itemDropRefused } from '../../editor/assets/js/block-handles.js';

const { node, text } = { node: schema.node.bind(schema), text: schema.text.bind(schema) };
const p = (s) => node('paragraph', null, s ? [text(s)] : []);
const li = (s) => node('list_item', null, [p(s)]);
const docOf = (...blocks) => node('doc', null, [node('title', null, [text('Title')]), ...blocks]);

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

/** A state with the cursor `offset` characters into the textblock reading `s`. */
function stateAt(doc, s, offset = 0, plugins = []) {
  return EditorState.create({ doc, plugins, selection: TextSelection.create(doc, posOf(doc, s) + offset) });
}

/** Run a command; the next state, or null when it didn't apply. */
function run(state, command) {
  let next = null;
  const applied = command(state, (tr) => { next = state.apply(tr); });
  return applied ? next : null;
}

const texts = (n) => { const out = []; n.forEach((c) => out.push(c.textContent)); return out; };

describe('moveBlock', () => {
  it('moveBlock moves a top-level paragraph down', () => {
    const state = stateAt(docOf(p('One'), p('Two'), p('Three')), 'One', 2);
    const next = run(state, moveBlock(1));
    assert.ok(next);
    next.doc.check();
    assert.deepEqual(texts(next.doc), ['Title', 'Two', 'One', 'Three']);
    assert.equal(next.selection.$from.parent.textContent, 'One', 'the cursor follows the block');
    assert.equal(next.selection.$from.parentOffset, 2);
    assert.ok(next.selection.empty);

    const up = run(next, moveBlock(-1));
    assert.deepEqual(texts(up.doc), ['Title', 'One', 'Two', 'Three']);
    assert.equal(up.selection.$from.parent.textContent, 'One');
  });

  it('moveBlock moves a list item within its list', () => {
    const doc = docOf(node('bullet_list', null, [li('A'), li('B'), li('C')]), p('After'));
    const next = run(stateAt(doc, 'A', 1), moveBlock(1));
    assert.ok(next);
    next.doc.check();
    const list = next.doc.child(1);
    assert.equal(list.type.name, 'bullet_list');
    assert.deepEqual(texts(list), ['B', 'A', 'C'], 'the item stays inside the list');
    assert.equal(next.doc.child(2).textContent, 'After');
    assert.equal(next.selection.$from.parent.textContent, 'A');
    assert.equal(next.selection.$from.parentOffset, 1);

    const last = run(next, moveBlock(1));
    assert.deepEqual(texts(last.doc.child(1)), ['B', 'C', 'A']);
    assert.equal(run(last, moveBlock(1)), null, 'the last item does not move down');
    assert.equal(moveBlock(1)(last), false);
  });

  it('moveBlock moves a tab within its tabs', () => {
    const tab = (label, s) => node('tab', { label }, [p(s)]);
    const doc = docOf(p('Before'), node('tabs', null, [tab('A', 'Tab A'), tab('B', 'Tab B'), tab('C', 'Tab C')]), p('After'));
    const found = movableBlockAt(doc.resolve(posOf(doc, 'Tab B')));
    assert.equal(doc.nodeAt(found.pos).type.name, 'tab');
    const up = run(stateAt(doc, 'Tab B', 2), moveBlock(-1));
    up.doc.check();
    assert.equal(up.doc.child(2).type.name, 'tabs', 'the tab stays in its tabs');
    assert.deepEqual(texts(up.doc.child(2)), ['Tab B', 'Tab A', 'Tab C']);
    assert.equal(up.selection.$from.parent.textContent, 'Tab B');
    assert.equal(moveBlock(-1)(up), false, 'the first tab does not move up');
    const last = stateAt(doc, 'Tab C');
    assert.equal(moveBlock(1)(last), false, 'the last tab does not move down');
  });

  it('moveBlock moves a step within its steps', () => {
    const step = (title, s) => node('step', { title }, [p(s)]);
    const doc = docOf(node('steps', null, [step('1', 'Step one'), step('2', 'Step two')]), p('After'));
    const down = run(stateAt(doc, 'Step one'), moveBlock(1));
    down.doc.check();
    assert.deepEqual(texts(down.doc.child(1)), ['Step two', 'Step one']);
    assert.deepEqual([0, 1].map((i) => down.doc.child(1).child(i).attrs.title), ['2', '1']);
    assert.equal(down.selection.$from.parent.textContent, 'Step one');
    assert.equal(moveBlock(1)(down), false, 'the last step does not move out');
  });

  it('moveBlock never moves above the title', () => {
    const state = stateAt(docOf(p('First'), p('Second')), 'First');
    assert.equal(moveBlock(-1)(state), false);
    assert.equal(run(state, moveBlock(-1)), null);

    const inTitle = EditorState.create({ doc: state.doc, selection: TextSelection.create(state.doc, 2) });
    assert.equal(moveBlock(1)(inTitle), false, 'the title itself never moves');
    assert.equal(moveBlock(-1)(inTitle), false);
  });

  it('moveBlock moves a selected node and keeps it selected', () => {
    const doc = docOf(p('One'), node('hr'), p('Two'));
    const hrPos = doc.child(0).nodeSize + doc.child(1).nodeSize;
    const state = EditorState.create({ doc, selection: NodeSelection.create(doc, hrPos) });
    const next = run(state, moveBlock(-1));
    next.doc.check();
    assert.deepEqual(next.doc.content.content.map((n) => n.type.name), ['title', 'hr', 'paragraph', 'paragraph']);
    assert.ok(next.selection instanceof NodeSelection);
    assert.equal(next.selection.node.type.name, 'hr');
    assert.equal(run(next, moveBlock(-1)), null, 'not above the title');
  });
});

describe('movableBlockAt', () => {
  it('movableBlockAt inside a callout picks the callout\'s child', () => {
    const doc = docOf(p('Before'), node('callout', { variant: 'note' }, [p('Inside one'), p('Inside two')]));
    const $pos = doc.resolve(posOf(doc, 'Inside two') + 3);
    const found = movableBlockAt($pos);
    assert.ok(found);
    assert.equal(doc.nodeAt(found.pos).textContent, 'Inside two');
    assert.equal(found.depth, $pos.depth);

    const next = run(stateAt(doc, 'Inside two'), moveBlock(-1));
    assert.equal(next.doc.child(2).type.name, 'callout');
    assert.deepEqual(texts(next.doc.child(2)), ['Inside two', 'Inside one']);
  });

  it('a lone child moves with its container; the title is never movable', () => {
    const doc = docOf(p('Before'), node('callout', { variant: 'note' }, [p('Alone')]));
    const found = movableBlockAt(doc.resolve(posOf(doc, 'Alone')));
    assert.equal(doc.nodeAt(found.pos).type.name, 'callout');
    assert.equal(movableBlockAt(doc.resolve(2)), null);
  });

  it('a list item\'s first line moves the item, even with a nested list', () => {
    const nested = node('list_item', null, [p('Parent'), node('bullet_list', null, [li('Child')])]);
    const doc = docOf(node('bullet_list', null, [nested, li('Next')]));
    const found = movableBlockAt(doc.resolve(posOf(doc, 'Parent')));
    assert.equal(doc.nodeAt(found.pos).type.name, 'list_item');
    assert.equal(doc.nodeAt(found.pos).firstChild.textContent, 'Parent');
  });

  it('a table cell moves the whole table', () => {
    const cell = (s) => node('table_cell', null, [text(s)]);
    const table = node('table', null, [node('table_row', null, [cell('a'), cell('b')])]);
    const doc = docOf(p('Before'), table);
    const found = movableBlockAt(doc.resolve(posOf(doc, 'b')));
    assert.equal(doc.nodeAt(found.pos).type.name, 'table');
  });
});

describe('dragging an item by its grip', () => {
  const tab = (label, s) => node('tab', { label }, [p(s)]);
  const doc = docOf(p('Before'), node('tabs', null, [tab('A', 'Tab A'), tab('B', 'Tab B')]), p('After'));
  const tabA = NodeSelection.create(doc, doc.child(0).nodeSize + doc.child(1).nodeSize + 1);
  const refused = (pos) => itemDropRefused(doc, pos, tabA.content(), tabA.node);

  it('drops a tab among its tabs', () => {
    assert.equal(refused(posOf(doc, 'Tab B') + 2), false);
  });

  it('never drops a tab out of its tabs', () => {
    assert.equal(refused(posOf(doc, 'After') + 2), true, 'not into a body paragraph');
    assert.equal(refused(posOf(doc, 'Before')), true);
    assert.equal(refused(2), true, 'not onto the title');
  });
});

describe('block order in the stored AST', () => {
  it('toBlockAst after a move reflects the new order', () => {
    const state = stateAt(docOf(p('One'), node('heading', { level: 2 }, [text('Two')]), p('Three')), 'Three');
    const next = run(state, moveBlock(-1));
    const ast = toBlockAst(next.doc);
    assert.deepEqual(ast.map((b) => b.type), ['paragraph', 'paragraph', 'heading']);
    assert.deepEqual(ast.map((b) => b.children[0].value), ['One', 'Three', 'Two']);
  });
});

describe('the empty-line placeholder', () => {
  const placeholders = (state) => {
    const plugin = state.plugins[0];
    const set = plugin.props.decorations.call(plugin, state);
    return (set ? set.find() : [])
      .filter((d) => d.type.attrs?.['data-placeholder'])
      .map((d) => ({ from: d.from, text: d.type.attrs['data-placeholder'] }));
  };

  it('shows "Type / for blocks" only on the empty paragraph that holds the cursor', () => {
    const doc = docOf(p('Text'), p(''), p(''));
    const second = doc.child(0).nodeSize + doc.child(1).nodeSize;
    const state = EditorState.create({ doc, plugins: [blockHandlesPlugin()], selection: TextSelection.create(doc, second + 1) });
    assert.deepEqual(placeholders(state), [{ from: second, text: 'Type / for blocks' }]);

    const onText = state.apply(state.tr.setSelection(TextSelection.create(doc, posOf(doc, 'Text'))));
    assert.deepEqual(placeholders(onText), []);
    const inTitle = state.apply(state.tr.setSelection(TextSelection.create(doc, 1)));
    assert.deepEqual(placeholders(inTitle), []);
  });

  it('is never stored', () => {
    const doc = docOf(p(''));
    const state = EditorState.create({ doc, plugins: [blockHandlesPlugin()], selection: TextSelection.create(doc, doc.child(0).nodeSize + 1) });
    assert.equal(placeholders(state).length, 1);
    assert.deepEqual(toBlockAst(state.doc), [{ type: 'paragraph', children: [] }]);
  });
});
