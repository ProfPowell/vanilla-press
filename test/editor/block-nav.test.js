import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, TextSelection, NodeSelection } from 'prosemirror-state';
import { history, undo, redo } from 'prosemirror-history';
import { schema } from '../../editor/assets/js/schema.js';
import { toBlockAst, fromBlockAst } from '../../editor/assets/js/ast.js';
import {
  isMediaBlock, trailingParagraphPlugin,
  navDown, navUp, navRight, navLeft, enterAfterMedia, typeAfterMedia,
} from '../../editor/assets/js/block-nav.js';

const p = (t) => ({ type: 'paragraph', children: t ? [{ type: 'text', value: t }] : [] });
const figure = (caption) => ({
  type: 'figure', attrs: { src: '/media/x.png', alt: 'x' },
  children: caption ? [{ type: 'figcaption', children: [{ type: 'text', value: caption }] }] : [],
});
const embed = () => ({ type: 'embed', attrs: { url: '/media/x.mp4', type: 'video' } });

/** A state for `blocks`, with the trailing-paragraph plugin (run once, as on load). */
function stateFor(blocks, { plugins = [trailingParagraphPlugin()] } = {}) {
  const doc = fromBlockAst(blocks, schema, { title: 'T' });
  const state = EditorState.create({ doc, plugins });
  return state.apply(state.tr); // lets appendTransaction run
}

/** Run a command; returns { ok, state }. */
function run(cmd, state) {
  let next = state;
  const ok = cmd(state, (tr) => { next = state.apply(tr); });
  return { ok, state: next };
}

/** Top-level block names after the title. */
const names = (state) => {
  const out = [];
  state.doc.forEach((n, _o, i) => { if (i > 0) out.push(n.type.name === 'paragraph' ? `p(${n.textContent})` : n.type.name); });
  return out;
};

/** Offset of the `i`th top-level child (title is 0). */
const offsetOf = (state, i) => { let at; state.doc.forEach((_n, off, idx) => { if (idx === i) at = off; }); return at; };

/** A cursor at the end of the `i`th top-level child's text. */
function cursorAtEnd(state, i) {
  const node = state.doc.child(i);
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, offsetOf(state, i) + 1 + node.content.size)));
}
function cursorAtStart(state, i) {
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, offsetOf(state, i) + 1)));
}
function selectNode(state, i) {
  return state.apply(state.tr.setSelection(NodeSelection.create(state.doc, offsetOf(state, i))));
}

/** The node the selection selects, or the name of the textblock it sits in. */
function where(state) {
  const sel = state.selection;
  if (sel instanceof NodeSelection) return { node: sel.node.type.name, index: state.doc.resolve(sel.from).index(0) };
  return { text: sel.$from.parent.type.name, index: sel.$from.index(0), offset: sel.$from.parentOffset, empty: sel.empty };
}

describe('isMediaBlock', () => {
  it('is true for figure, embed and hr, false for text blocks and containers', () => {
    const n = schema.nodes;
    assert.equal(isMediaBlock(n.figure.create({ src: '/media/x.png' })), true);
    assert.equal(isMediaBlock(n.embed.create()), true);
    assert.equal(isMediaBlock(n.hr.create()), true);
    assert.equal(isMediaBlock(n.component_leaf.create({ tag: 'x-y' })), true);
    assert.equal(isMediaBlock(n.paragraph.create()), false);
    assert.equal(isMediaBlock(n.callout.create(null, n.paragraph.create())), false);
    assert.equal(isMediaBlock(n.code_block.create()), false);
    assert.equal(isMediaBlock(n.component_blocks.create({ tag: 'x-y' }, n.paragraph.create())), false);
  });
});

describe('arrow keys past media', () => {
  it('navDown from the end of a paragraph selects the embed, then enters the trailing paragraph', () => {
    let state = cursorAtEnd(stateFor([p('First'), embed()]), 1);
    assert.deepEqual(names(state), ['p(First)', 'embed', 'p()']);
    let r = run(navDown, state);
    assert.equal(r.ok, true);
    assert.deepEqual(where(r.state), { node: 'embed', index: 2 });
    r = run(navDown, r.state);
    assert.equal(r.ok, true);
    assert.deepEqual(where(r.state), { text: 'paragraph', index: 3, offset: 0, empty: true });
  });

  it('navDown from a selected figure enters its caption, then the next block', () => {
    let state = selectNode(stateFor([p('First'), figure('Cap'), p('After')]), 2);
    let r = run(navDown, state);
    assert.equal(r.ok, true);
    assert.deepEqual(where(r.state), { text: 'figcaption', index: 2, offset: 0, empty: true });
    // From the end of the caption on to the next block
    r = run(navDown, cursorAtEndOfCaption(r.state));
    assert.equal(r.ok, true);
    assert.deepEqual(where(r.state), { text: 'paragraph', index: 3, offset: 0, empty: true });
  });

  it('with a view, navDown on the last visual line of the caption moves on from anywhere in it', () => {
    const state = selectNode(stateFor([figure('Cap'), p('After')]), 1);
    let r = run(navDown, state); // caption start
    const lastLine = { endOfTextblock: (dir) => dir === 'down' };
    let next = null;
    assert.equal(navDown(r.state, (tr) => { next = r.state.apply(tr); }, lastLine), true);
    assert.deepEqual(where(next), { text: 'paragraph', index: 2, offset: 0, empty: true });
    // Not on the last line: the default movement
    assert.equal(navDown(r.state, () => {}, { endOfTextblock: () => false }), false);
  });

  it('navUp mirrors: from the trailing paragraph to the embed, then to the end of the paragraph above', () => {
    let state = cursorAtStart(stateFor([p('First'), embed()]), 3);
    let r = run(navUp, state);
    assert.equal(r.ok, true);
    assert.deepEqual(where(r.state), { node: 'embed', index: 2 });
    r = run(navUp, r.state);
    assert.equal(r.ok, true);
    assert.deepEqual(where(r.state), { text: 'paragraph', index: 1, offset: 5, empty: true });
  });

  it('navUp mirrors for a figure: next block → caption → figure → block above', () => {
    let state = cursorAtStart(stateFor([p('First'), figure('Cap'), p('After')]), 3);
    let r = run(navUp, state);
    assert.deepEqual(where(r.state), { text: 'figcaption', index: 2, offset: 3, empty: true });
    r = run(navUp, cursorAtStartOfCaption(r.state));
    assert.deepEqual(where(r.state), { node: 'figure', index: 2 });
    r = run(navUp, r.state);
    assert.deepEqual(where(r.state), { text: 'paragraph', index: 1, offset: 5, empty: true });
  });

  it('two embeds in a row: each navDown steps one block', () => {
    let state = cursorAtEnd(stateFor([p('First'), embed(), embed()]), 1);
    let r = run(navDown, state);
    assert.deepEqual(where(r.state), { node: 'embed', index: 2 });
    r = run(navDown, r.state);
    assert.deepEqual(where(r.state), { node: 'embed', index: 3 });
    r = run(navDown, r.state);
    assert.deepEqual(where(r.state), { text: 'paragraph', index: 4, offset: 0, empty: true });
    // and back up
    r = run(navUp, r.state);
    assert.deepEqual(where(r.state), { node: 'embed', index: 3 });
    r = run(navUp, r.state);
    assert.deepEqual(where(r.state), { node: 'embed', index: 2 });
  });

  it('a cursor in the middle of a paragraph is left to the default behavior', () => {
    let state = stateFor([p('First'), embed()]);
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, offsetOf(state, 1) + 3)));
    assert.equal(navDown(state, () => {}), false);
    assert.equal(navRight(state, () => {}), false);
    assert.equal(navUp(state, () => {}), false);
    assert.equal(navLeft(state, () => {}), false);
  });

  it('navDown before a plain paragraph is left to the default behavior', () => {
    const state = cursorAtEnd(stateFor([p('First'), p('Second')]), 1);
    assert.equal(navDown(state, () => {}), false);
  });

  it('navRight and navLeft step over a selected embed like down and up', () => {
    let state = cursorAtEnd(stateFor([p('First'), embed()]), 1);
    let r = run(navRight, state);
    assert.deepEqual(where(r.state), { node: 'embed', index: 2 });
    r = run(navRight, r.state);
    assert.deepEqual(where(r.state), { text: 'paragraph', index: 3, offset: 0, empty: true });
    r = run(navLeft, r.state);
    assert.deepEqual(where(r.state), { node: 'embed', index: 2 });
    r = run(navLeft, r.state);
    assert.deepEqual(where(r.state), { text: 'paragraph', index: 1, offset: 5, empty: true });
  });
});

function cursorAtEndOfCaption(state) {
  const { $from } = state.selection;
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, $from.end())));
}
function cursorAtStartOfCaption(state) {
  const { $from } = state.selection;
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, $from.start())));
}

describe('Enter and typing on a selected media block', () => {
  it('enterAfterMedia adds an empty paragraph right after the embed, cursor inside', () => {
    const state = selectNode(stateFor([p('First'), embed(), p('Last')]), 2);
    const r = run(enterAfterMedia, state);
    assert.equal(r.ok, true);
    assert.deepEqual(names(r.state), ['p(First)', 'embed', 'p()', 'p(Last)']);
    assert.deepEqual(where(r.state), { text: 'paragraph', index: 3, offset: 0, empty: true });
  });

  it('enterAfterMedia does nothing without a media node selection', () => {
    const state = cursorAtEnd(stateFor([p('First'), embed()]), 1);
    assert.equal(enterAfterMedia(state, () => {}), false);
  });

  it('typeAfterMedia keeps the figure and types into a new paragraph after it', () => {
    const state = selectNode(stateFor([p('First'), figure()]), 2);
    const tr = typeAfterMedia(state, 'h');
    assert.ok(tr);
    const next = state.apply(tr);
    assert.deepEqual(names(next).slice(0, 3), ['p(First)', 'figure', 'p(h)']);
    assert.deepEqual(where(next), { text: 'paragraph', index: 3, offset: 1, empty: true });
  });

  it('typing on the last embed uses the trailing paragraph, leaving no blank line after', () => {
    const state = selectNode(stateFor([p('First'), embed()]), 2);
    const next = state.apply(typeAfterMedia(state, 'h'));
    assert.deepEqual(names(next), ['p(First)', 'embed', 'p(h)']);
    assert.deepEqual(where(next), { text: 'paragraph', index: 3, offset: 1, empty: true });
  });

  it('Enter on the last embed moves into the trailing paragraph rather than adding a second', () => {
    const state = selectNode(stateFor([p('First'), embed()]), 2);
    const r = run(enterAfterMedia, state);
    assert.deepEqual(names(r.state), ['p(First)', 'embed', 'p()']);
    assert.deepEqual(where(r.state), { text: 'paragraph', index: 3, offset: 0, empty: true });
  });

  it('typeAfterMedia with a text selection returns null', () => {
    const state = cursorAtEnd(stateFor([p('First'), embed()]), 1);
    assert.equal(typeAfterMedia(state, 'h'), null);
  });
});

describe('trailing paragraph', () => {
  it('a doc ending with an embed gets one empty paragraph; applying again adds nothing', () => {
    let state = stateFor([p('a'), embed()]);
    assert.deepEqual(names(state), ['p(a)', 'embed', 'p()']);
    state = state.apply(state.tr);
    state = state.apply(state.tr.insertText('x', offsetOf(state, 1) + 1));
    assert.deepEqual(names(state), ['p(xa)', 'embed', 'p()']);
  });

  it('its transaction is kept out of history and tagged vp-trailing', () => {
    const doc = fromBlockAst([p('a'), embed()], schema, { title: 'T' });
    const state = EditorState.create({ doc, plugins: [trailingParagraphPlugin()] });
    const { transactions } = state.applyTransaction(state.tr);
    assert.equal(transactions.length, 2);
    const appended = transactions[1];
    assert.equal(appended.getMeta('addToHistory'), false);
    assert.equal(appended.getMeta('vp-trailing'), true);
  });

  it('deleting the final embed does not leave two empty paragraphs', () => {
    let state = selectNode(stateFor([p('a'), embed()]), 2);
    state = state.apply(state.tr.deleteSelection());
    assert.deepEqual(names(state), ['p(a)', 'p()']);

    // An empty paragraph above the embed: deleting the embed leaves one
    state = selectNode(stateFor([p('a'), p(''), embed()]), 3);
    state = state.apply(state.tr.deleteSelection());
    assert.deepEqual(names(state), ['p(a)', 'p()']);
  });

  it('Enter in the trailing paragraph still adds a line', () => {
    let state = cursorAtStart(stateFor([p('a'), embed()]), 3);
    state = state.apply(state.tr.split(state.selection.from));
    assert.deepEqual(names(state), ['p(a)', 'embed', 'p()', 'p()']);
    // and again, from the new last line
    state = state.apply(state.tr.split(state.selection.from));
    assert.deepEqual(names(state), ['p(a)', 'embed', 'p()', 'p()', 'p()']);
  });

  it('undo after inserting an embed, then redo, leaves one trailing paragraph', () => {
    let state = stateFor([p('a')], { plugins: [history(), trailingParagraphPlugin()] });
    // The writer adds an empty line, then the embed replaces it (as the palette does)
    state = cursorAtEnd(state, 1);
    state = state.apply(state.tr.split(state.selection.from));
    const at = offsetOf(state, 2);
    state = state.apply(state.tr.replaceWith(at, at + 2, schema.nodes.embed.create({ url: '/media/x.mp4' })));
    assert.deepEqual(names(state), ['p(a)', 'embed', 'p()']);

    let r = run(undo, state);
    assert.equal(r.ok, true);
    assert.deepEqual(names(r.state), ['p(a)', 'p()']);
    r = run(redo, r.state);
    assert.equal(r.ok, true);
    assert.deepEqual(names(r.state), ['p(a)', 'embed', 'p()']);
    // Again, to check nothing stacks up
    r = run(undo, r.state);
    r = run(redo, r.state);
    assert.deepEqual(names(r.state), ['p(a)', 'embed', 'p()']);
  });
});

describe('toBlockAst drops the trailing paragraph', () => {
  const blocks = (list) => toBlockAst(fromBlockAst(list, schema, { title: 'T' })).map((b) => b.type);

  it('after a media block', () => {
    assert.deepEqual(blocks([p('a'), embed(), p('')]), ['paragraph', 'embed']);
  });

  it('but keeps an empty paragraph after a paragraph', () => {
    assert.deepEqual(blocks([p('a'), p('')]), ['paragraph', 'paragraph']);
  });

  it('and keeps a lone empty paragraph', () => {
    assert.deepEqual(blocks([p('')]), ['paragraph']);
  });
});
