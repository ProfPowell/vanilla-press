import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EditorState, TextSelection } from 'prosemirror-state';
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
    assert.equal(metaLineText({ status: 'published', published: '2026-11-03T12:00:00.000Z', collection: 'posts' }, 'en-US'),
      'Published Nov 3, 2026 · posts');
    assert.equal(metaLineText({ status: 'draft', collection: 'posts' }), 'Draft · posts');
    assert.equal(metaLineText({ status: 'draft' }), 'Draft · posts');
    assert.equal(metaLineText({ status: 'published', collection: 'notes' }), 'Published · notes');
  });
});
