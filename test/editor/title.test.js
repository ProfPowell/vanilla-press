import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EditorState, TextSelection, NodeSelection } from 'prosemirror-state';
import { Slice, Fragment } from 'prosemirror-model';
import { history, undo } from 'prosemirror-history';
import { schema } from '../../editor/assets/js/schema.js';
import { toBlockAst, fromBlockAst } from '../../editor/assets/js/ast.js';
import { titleOf, setTitleTr, titleKeymap, titlePastePlugin, metaLineText } from '../../editor/assets/js/title.js';

const fixturesDir = join(import.meta.dirname, '..', 'fixtures');
const para = (text, marks) => ({ type: 'paragraph', children: [{ type: 'text', value: text, ...(marks ? { marks } : {}) }] });

/** A state for `blocks` titled `title`, cursor at `pos` (a number, or a function of the doc). */
function stateFor(blocks, title, pos = 1, plugins = []) {
  const doc = fromBlockAst(blocks, schema, { title });
  const at = typeof pos === 'function' ? pos(doc) : pos;
  return EditorState.create({ doc, plugins, selection: TextSelection.create(doc, at) });
}

/** Run a command; return the next state (or null when it didn't apply). */
function run(state, command) {
  let next = null;
  const applied = command(state, (tr) => { next = state.apply(tr); });
  return applied ? next ?? state : null;
}

const bodyStart = (doc) => doc.firstChild.nodeSize + 1;

describe('title in the document', () => {
  it('round-trips every fixture with a title', () => {
    const files = readdirSync(fixturesDir).filter((f) => f.endsWith('.json'));
    assert.ok(files.length > 20);
    for (const file of files) {
      const { meta, blocks } = JSON.parse(readFileSync(join(fixturesDir, file), 'utf8'));
      // The editor's own form of the fixture (some fixtures carry default
      // attrs or empty text runs the editor drops: that is not the title's doing).
      const normal = toBlockAst(fromBlockAst(blocks, schema));
      const pmDoc = fromBlockAst(normal, schema, { title: meta.title });
      pmDoc.check();
      assert.deepEqual(toBlockAst(pmDoc), normal, file);
      assert.equal(titleOf(pmDoc), meta.title, file);
      assert.equal(pmDoc.firstChild.type.name, 'title', file);
    }
  });

  it('an empty title is an empty first node; no blocks still gives a paragraph', () => {
    const pmDoc = fromBlockAst([], schema);
    assert.equal(pmDoc.childCount, 2);
    assert.equal(titleOf(pmDoc), '');
    assert.deepEqual(toBlockAst(pmDoc), [{ type: 'paragraph', children: [] }]);
  });

  it('setTitleTr replaces and clears the title', () => {
    const state = stateFor([para('Body')], 'Old');
    const set = state.apply(setTitleTr(state, 'New title'));
    assert.equal(titleOf(set.doc), 'New title');
    assert.deepEqual(toBlockAst(set.doc), [para('Body')]);
    const cleared = set.apply(setTitleTr(set, ''));
    assert.equal(titleOf(cleared.doc), '');
  });

  it('the title holds no marks', () => {
    const state = stateFor([para('Body')], 'Plain', 3);
    assert.equal(schema.nodes.title.allowsMarkType(schema.marks.strong), false);
    const marked = state.tr.addMark(1, 6, schema.marks.strong.create()).doc;
    assert.deepEqual(marked.firstChild.firstChild.marks, [], 'addMark skips the title');
  });

  it('enter in the title moves to the first block', () => {
    const state = stateFor([para('Body')], 'Title', 3);
    const next = run(state, titleKeymap().Enter);
    assert.ok(next);
    assert.equal(titleOf(next.doc), 'Title', 'the title is not split');
    assert.equal(next.selection.from, bodyStart(next.doc));
    assert.equal(next.selection.$from.parent.textContent, 'Body');
    assert.equal(next.selection.$from.parentOffset, 0);
  });

  it('enter in the title adds a paragraph when the first block holds no text', () => {
    const state = stateFor([{ type: 'hr' }, para('After')], 'Title', 6);
    const next = run(state, titleKeymap().Enter);
    assert.equal(next.doc.child(1).type.name, 'paragraph');
    assert.equal(next.doc.child(2).type.name, 'hr');
    assert.equal(next.selection.$from.parent, next.doc.child(1));
  });

  it('enter outside the title is left to the other keymaps', () => {
    const state = stateFor([para('Body')], 'Title', bodyStart);
    assert.equal(run(state, titleKeymap().Enter), null);
  });

  it('backspace at the start of the first block moves into the title', () => {
    const state = stateFor([para('Body', ['strong']), para('Two')], 'Title', bodyStart);
    const next = run(state, titleKeymap().Backspace);
    assert.ok(next);
    assert.equal(next.selection.from, 6, 'end of the title');
    assert.equal(titleOf(next.doc), 'Title');
    assert.deepEqual(toBlockAst(next.doc), [para('Body', ['strong']), para('Two')], 'nothing joined');
  });

  it('backspace in an empty first block removes it, unless it is the only block', () => {
    const state = stateFor([para(''), para('Two')], 'Title', bodyStart);
    const next = run(state, titleKeymap().Backspace);
    assert.equal(next.selection.from, 6);
    assert.deepEqual(toBlockAst(next.doc), [para('Two')]);

    const only = stateFor([], 'Title', bodyStart);
    const kept = run(only, titleKeymap().Backspace);
    assert.equal(kept.selection.from, 6);
    assert.equal(kept.doc.childCount, 2);
  });

  it('backspace elsewhere is left to the other keymaps', () => {
    assert.equal(run(stateFor([para('Body')], 'Title', (d) => bodyStart(d) + 2), titleKeymap().Backspace), null);
    assert.equal(run(stateFor([para('Body')], 'Title', 3), titleKeymap().Backspace), null);
  });

  it('delete at the end of the title never joins the first block into it', () => {
    const state = stateFor([para('Body'), para('Two')], 'Title', 6);
    const next = run(state, titleKeymap().Delete);
    assert.ok(next, 'handled');
    assert.equal(titleOf(next.doc), 'Title');
    assert.deepEqual(toBlockAst(next.doc), [para('Body'), para('Two')]);

    const empty = stateFor([para(''), para('Two')], 'Title', 6);
    assert.deepEqual(toBlockAst(run(empty, titleKeymap().Delete).doc), [para('Two')]);
  });

  it('mod-a inside the title selects only the title', () => {
    const state = stateFor([para('Body')], 'Title', 3);
    const next = run(state, titleKeymap()['Mod-a']);
    assert.equal(next.selection.from, 1);
    assert.equal(next.selection.to, 6);
    assert.equal(run(stateFor([para('Body')], 'Title', bodyStart), titleKeymap()['Mod-a']), null);
  });

  it('paste into the title is plain text', () => {
    const plugin = titlePastePlugin();
    let state = stateFor([para('Body')], 'Ti', 3, [plugin]);
    const view = { get state() { return state; }, dispatch(tr) { state = state.apply(tr); } };
    const slice = new Slice(Fragment.from([
      schema.node('heading', { level: 2 }, [schema.text('Big')]),
      schema.node('paragraph', null, [schema.text('bold', [schema.marks.strong.create()]), schema.text(' and\nmore')]),
    ]), 0, 0);
    assert.equal(plugin.props.handlePaste(view, null, slice), true);
    assert.equal(titleOf(state.doc), 'TiBig bold and more');
    assert.ok(!titleOf(state.doc).includes('\n'));
    assert.equal(state.doc.firstChild.childCount, 1, 'one unmarked text node');
    assert.deepEqual(state.doc.firstChild.firstChild.marks, []);
    assert.deepEqual(toBlockAst(state.doc), [para('Body')]);
  });

  it('paste outside the title is left to the editor', () => {
    const plugin = titlePastePlugin();
    const state = stateFor([para('Body')], 'Ti', bodyStart, [plugin]);
    const view = { state, dispatch() { throw new Error('not expected'); } };
    assert.equal(plugin.props.handlePaste(view, null, Slice.empty), false);
  });

  /** A minimal view over `state` for the plugin's props. */
  function fakeView(initial, posAtCoords = () => null) {
    let state = initial;
    return { get state() { return state; }, dispatch(tr) { state = state.apply(tr); }, posAtCoords };
  }
  const richSlice = () => new Slice(Fragment.from([
    schema.node('heading', { level: 2 }, [schema.text('Big')]),
    schema.node('paragraph', null, [schema.text('bold', [schema.marks.strong.create()])]),
  ]), 1, 1);
  const across = (doc) => TextSelection.create(doc, 3, bodyStart(doc) + 4);

  it('typing over a selection across the title/body edge keeps the body out of the title', () => {
    const plugin = titlePastePlugin();
    const start = stateFor([para('Body text', ['strong']), para('Two')], 'My title', 3, [plugin]);
    const view = fakeView(start.apply(start.tr.setSelection(across(start.doc))));
    const { from, to } = view.state.selection;
    assert.equal(plugin.props.handleTextInput(view, from, to, 'X'), true);
    view.state.doc.check();
    assert.equal(titleOf(view.state.doc), 'MyX');
    assert.deepEqual(view.state.doc.firstChild.firstChild.marks, []);
    assert.deepEqual(toBlockAst(view.state.doc), [para(' text', ['strong']), para('Two')]);
    assert.equal(view.state.selection.from, 4, 'cursor after the typed text, in the title');
  });

  it('typing inside the title or the body is left to the editor', () => {
    const plugin = titlePastePlugin();
    const inTitle = fakeView(stateFor([para('Body')], 'Title', 3, [plugin]));
    assert.equal(plugin.props.handleTextInput(inTitle, 3, 3, 'X'), false);
    const inBody = fakeView(stateFor([para('Body')], 'Title', bodyStart, [plugin]));
    assert.equal(plugin.props.handleTextInput(inBody, 8, 8, 'X'), false);
  });

  it('paste over a selection across the title/body edge is plain text in the title', () => {
    const plugin = titlePastePlugin();
    const start = stateFor([para('Body text'), para('Two')], 'My title', 3, [plugin]);
    const view = fakeView(start.apply(start.tr.setSelection(across(start.doc))));
    assert.equal(plugin.props.handlePaste(view, null, richSlice()), true);
    view.state.doc.check();
    assert.equal(titleOf(view.state.doc), 'MyBig bold');
    assert.equal(view.state.doc.firstChild.childCount, 1, 'one unmarked text node');
    assert.deepEqual(toBlockAst(view.state.doc), [para(' text'), para('Two')]);
  });

  it('enter over a selection across the title/body edge moves to the first block', () => {
    const start = stateFor([para('Body text'), para('Two')], 'My title', 3);
    const next = run(start.apply(start.tr.setSelection(across(start.doc))), titleKeymap().Enter);
    assert.ok(next);
    next.doc.check();
    assert.equal(titleOf(next.doc), 'My');
    assert.deepEqual(toBlockAst(next.doc), [para(' text'), para('Two')]);
    assert.equal(next.selection.from, bodyStart(next.doc));
  });

  it('backspace and delete over a selection across the edge never join the body into the title', () => {
    for (const key of ['Backspace', 'Delete']) {
      const start = stateFor([para('Body text'), para('Two')], 'My title', 3);
      const next = run(start.apply(start.tr.setSelection(across(start.doc))), titleKeymap()[key]);
      assert.ok(next, key);
      next.doc.check();
      assert.equal(titleOf(next.doc), 'My', key);
      assert.deepEqual(toBlockAst(next.doc), [para(' text'), para('Two')], key);
      assert.equal(next.selection.from, 3, key);
    }
  });

  it('a selection across the edge into a later block keeps the rest of that block', () => {
    const start = stateFor([para('One'), para('Two'), para('Three')], 'My title', 3);
    const into = start.doc.child(1).nodeSize + start.doc.child(2).nodeSize;
    const sel = start.apply(start.tr.setSelection(TextSelection.create(start.doc, 3, bodyStart(start.doc) + into + 2)));
    const next = run(sel, titleKeymap().Backspace);
    next.doc.check();
    assert.equal(titleOf(next.doc), 'My');
    assert.deepEqual(toBlockAst(next.doc), [para('ree')]);
  });

  it('paste over a selection inside the title keeps the rest of the title', () => {
    const plugin = titlePastePlugin();
    const start = stateFor([para('Body')], 'My long title', 1, [plugin]);
    const view = fakeView(start.apply(start.tr.setSelection(TextSelection.create(start.doc, 4, 8))));
    assert.equal(plugin.props.handlePaste(view, null, richSlice()), true);
    assert.equal(titleOf(view.state.doc), 'My Big bold title');
  });

  it('cut over a selection across the edge never joins the body into the title', async () => {
    const plugin = titlePastePlugin();
    const start = stateFor([para('Body text'), para('Two')], 'My title', 3, [plugin]);
    const view = fakeView(start.apply(start.tr.setSelection(across(start.doc))));
    assert.equal(plugin.props.handleDOMEvents.cut(view), false, 'the clipboard is still filled by ProseMirror');
    const cutTr = view.state.tr.deleteSelection().setMeta('uiEvent', 'cut');
    assert.equal(plugin.spec.filterTransaction(cutTr, view.state), false, 'the joining delete is replaced');
    await new Promise((r) => queueMicrotask(r));
    view.state.doc.check();
    assert.equal(titleOf(view.state.doc), 'My');
    assert.deepEqual(toBlockAst(view.state.doc), [para(' text'), para('Two')]);
  });

  it('a drop onto the title is plain text and never splits it', () => {
    const plugin = titlePastePlugin();
    const view = fakeView(stateFor([para('Body text')], 'My title', 1, [plugin]), () => ({ pos: 3, inside: -1 }));
    assert.equal(plugin.props.handleDrop(view, { clientX: 0, clientY: 0 }, richSlice(), false), true);
    view.state.doc.check();
    assert.equal(titleOf(view.state.doc), 'MyBig bold title');
    assert.equal(view.state.doc.firstChild.childCount, 1, 'one unmarked text node');
    assert.deepEqual(toBlockAst(view.state.doc), [para('Body text')]);
  });

  it('a drag from the body onto the title moves its plain text', () => {
    const plugin = titlePastePlugin();
    const start = stateFor([para('Body text', ['strong'])], 'My title', 1, [plugin]);
    const b = bodyStart(start.doc);
    const view = fakeView(start.apply(start.tr.setSelection(TextSelection.create(start.doc, b, b + 4))), () => ({ pos: 3, inside: -1 }));
    const slice = view.state.selection.content();
    assert.equal(plugin.props.handleDrop(view, { clientX: 0, clientY: 0 }, slice, true), true);
    view.state.doc.check();
    assert.equal(titleOf(view.state.doc), 'MyBody title');
    assert.deepEqual(view.state.doc.firstChild.firstChild.marks, []);
    assert.deepEqual(toBlockAst(view.state.doc), [para(' text', ['strong'])]);
  });

  it('a file drop on the title is not swallowed', () => {
    const plugin = titlePastePlugin();
    const view = fakeView(stateFor([para('Body text')], 'My title', 1, [plugin]), () => ({ pos: 3, inside: -1 }));
    const before = view.state.doc;
    const event = { clientX: 0, clientY: 0, dataTransfer: { files: { length: 1 } } };
    assert.equal(plugin.props.handleDrop(view, event, Slice.empty, false), false);
    assert.equal(view.state.doc, before);
  });

  it('a drop onto the body is left to the editor', () => {
    const plugin = titlePastePlugin();
    const state = stateFor([para('Body text')], 'My title', 1, [plugin]);
    const view = fakeView(state, () => ({ pos: bodyStart(state.doc) + 2, inside: -1 }));
    assert.equal(plugin.props.handleDrop(view, { clientX: 0, clientY: 0 }, richSlice(), false), false);
  });

  it('a dragged block with no text dropped onto the title changes nothing', () => {
    const plugin = titlePastePlugin();
    const start = stateFor([para('Before'), { type: 'hr' }, para('After')], 'My title', 1, [plugin]);
    const hrPos = bodyStart(start.doc) - 1 + start.doc.child(1).nodeSize;
    const selected = start.apply(start.tr.setSelection(NodeSelection.create(start.doc, hrPos)));
    const view = fakeView(selected, () => ({ pos: 3, inside: -1 }));
    const slice = view.state.selection.content();
    assert.equal(plugin.props.handleDrop(view, { clientX: 0, clientY: 0 }, slice, true), true, 'the drop is handled');
    assert.equal(view.state.doc, selected.doc, 'the rule stays in the body, the title is unchanged');
  });

  it('a drag across the title edge dropped in the body keeps the body text out of the title', () => {
    const plugin = titlePastePlugin();
    const start = stateFor([para('Body text'), para('Two words')], 'My title', 1, [plugin]);
    const view = fakeView(start.apply(start.tr.setSelection(across(start.doc))), ({ left }) => ({ pos: left, inside: -1 }));
    const twoAt = bodyStart(start.doc) + start.doc.child(1).nodeSize + 4; // after "Two "
    const slice = view.state.selection.content();
    assert.equal(plugin.props.handleDrop(view, { clientX: twoAt, clientY: 0 }, slice, true), true);
    view.state.doc.check();
    assert.equal(titleOf(view.state.doc), 'My', 'nothing joined into the title');
    assert.deepEqual(toBlockAst(view.state.doc), [para(' text'), para('Two  title'), para('Bodywords')]);
  });

  it('deleting a selection across the title/body edge keeps both', () => {
    const state = stateFor([para('Body text', ['strong'])], 'My title', 3);
    const sel = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 3, bodyStart(state.doc) + 4)));
    const next = sel.apply(sel.tr.deleteSelection());
    next.doc.check();
    assert.equal(titleOf(next.doc), 'My');
    assert.deepEqual(toBlockAst(next.doc), [para(' text', ['strong'])]);
  });

  it('title edits undo with the body', () => {
    let state = stateFor([para('Body')], 'Title', 6, [history()]);
    state = state.apply(state.tr.insertText(' more'));
    const end = bodyStart(state.doc) + 4;
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, end)));
    state = state.apply(state.tr.insertText('!'));
    assert.equal(titleOf(state.doc), 'Title more');
    assert.deepEqual(toBlockAst(state.doc), [para('Body!')]);

    state = run(state, undo);
    assert.deepEqual(toBlockAst(state.doc), [para('Body')]);
    assert.equal(titleOf(state.doc), 'Title more');
    state = run(state, undo);
    assert.equal(titleOf(state.doc), 'Title');
    assert.deepEqual(toBlockAst(state.doc), [para('Body')]);
  });
});

describe('metaLineText', () => {
  it('names the status, published day and collection', () => {
    assert.equal(metaLineText({ status: 'published', published: new Date(2026, 10, 3, 12).toISOString(), collection: 'posts' }, 'en-US'),
      'Published Nov 3, 2026 · posts');
    assert.equal(metaLineText({ status: 'draft', collection: 'posts' }), 'Draft · posts');
    assert.equal(metaLineText({ status: 'published', published: '2026-11-03', collection: 'posts' }, 'en-US'),
      'Published Nov 3, 2026 · posts');
    assert.equal(metaLineText({ status: 'draft' }), 'Draft · posts');
    assert.equal(metaLineText({ status: 'published', collection: 'notes' }), 'Published · notes');
  });
});
