import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from 'prosemirror-state';
import { history, undo } from 'prosemirror-history';
import { insertPlan } from '../../editor/assets/js/media-insert.js';
import { schema } from '../../editor/assets/js/schema.js';
import { fromBlockAst, toBlockAst } from '../../editor/assets/js/ast.js';
import {
  shouldUpload, insertRangeFor, placeholderPlugin, placeholderKey, findPlaceholder, mediaDropPlugin,
} from '../../editor/assets/js/media-drop.js';

const para = (text) => ({ type: 'paragraph', children: text ? [{ type: 'text', value: text }] : [] });
const docOf = (blocks, title = 'Title') => fromBlockAst(blocks, schema, { title });
const bodyStart = (doc) => doc.firstChild.nodeSize;

function stateWith(blocks) {
  return EditorState.create({ doc: docOf(blocks), plugins: [placeholderPlugin()] });
}
const meta = (state, m) => state.apply(state.tr.setMeta(placeholderKey, m));

describe('placeholders', () => {
  it('placeholder position follows edits above it', () => {
    let state = stateWith([para('One'), para('Two')]);
    const at = bodyStart(state.doc);
    state = meta(state, { add: { id: 'a', pos: at, name: 'photo.png' } });
    assert.equal(findPlaceholder(state, 'a'), at);
    // A paragraph of text inserted at the start of the body pushes it down by its size
    const p = schema.nodes.paragraph.create(null, schema.text('New'));
    state = state.apply(state.tr.insert(at, p));
    assert.equal(findPlaceholder(state, 'a'), at + p.nodeSize);
  });

  it('a deletion around it moves it to a block boundary instead of dropping it', () => {
    let state = stateWith([para('One'), para('Two'), para('Three')]);
    const start = bodyStart(state.doc);
    const between = start + state.doc.child(1).nodeSize;
    state = meta(state, { add: { id: 'a', pos: between, name: 'photo.png' } });
    // Delete from inside "One" to inside "Two": the paragraphs join
    state = state.apply(state.tr.delete(start + 2, between + 2));
    const pos = findPlaceholder(state, 'a');
    assert.notEqual(pos, null);
    assert.equal(state.doc.resolve(pos).depth, 0);
  });

  it('placeholder moves by the length of text inserted before it', () => {
    let state = stateWith([para('One'), para('Two')]);
    const after = bodyStart(state.doc) + state.doc.child(1).nodeSize;
    state = meta(state, { add: { id: 'a', pos: after, name: 'photo.png' } });
    state = state.apply(state.tr.insertText('abc', bodyStart(state.doc) + 1));
    assert.equal(findPlaceholder(state, 'a'), after + 3);
  });

  it('remove drops it', () => {
    let state = stateWith([para('One')]);
    state = meta(state, { add: { id: 'a', pos: bodyStart(state.doc), name: 'a.png' } });
    state = meta(state, { add: { id: 'b', pos: bodyStart(state.doc), name: 'b.png' } });
    state = meta(state, { remove: { id: 'a' } });
    assert.equal(findPlaceholder(state, 'a'), null);
    assert.equal(findPlaceholder(state, 'b'), bodyStart(state.doc));
  });

  it('fail keeps it with the error text', () => {
    let state = stateWith([para('One')]);
    state = meta(state, { add: { id: 'a', pos: bodyStart(state.doc), name: 'a.png' } });
    state = meta(state, { progress: { id: 'a', value: 0.5 } });
    state = meta(state, { fail: { id: 'a', error: 'Upload failed (500). Try again.' } });
    assert.equal(findPlaceholder(state, 'a'), bodyStart(state.doc));
    const [deco] = placeholderKey.getState(state).find();
    assert.equal(deco.spec.id, 'a');
    assert.equal(deco.spec.error, 'Upload failed (500). Try again.');
    assert.equal(deco.spec.name, 'a.png');
  });

  it('progress updates the value and keeps the position', () => {
    let state = stateWith([para('One')]);
    state = meta(state, { add: { id: 'a', pos: bodyStart(state.doc), name: 'a.png' } });
    state = meta(state, { progress: { id: 'a', value: 0.25 } });
    const [deco] = placeholderKey.getState(state).find();
    assert.equal(deco.spec.progress, 0.25);
    assert.equal(findPlaceholder(state, 'a'), bodyStart(state.doc));
  });
});

describe('insertRangeFor', () => {
  it('insertRangeFor in the title goes to the start of the body', () => {
    const doc = docOf([para('One')]);
    const end = bodyStart(doc);
    assert.deepEqual(insertRangeFor(doc, 2), { from: end, to: end });
  });

  it('insertRangeFor mid-paragraph goes after that paragraph', () => {
    const doc = docOf([para('One'), para('Two words'), para('Three')]);
    const start = bodyStart(doc) + doc.child(1).nodeSize;
    const after = start + doc.child(2).nodeSize;
    assert.deepEqual(insertRangeFor(doc, start + 4), { from: after, to: after });
  });

  it('insertRangeFor inside a nested block goes after its top-level block', () => {
    const doc = docOf([{ type: 'blockquote', children: [para('Quoted'), para('More')] }, para('After')]);
    const start = bodyStart(doc);
    const after = start + doc.child(1).nodeSize;
    assert.deepEqual(insertRangeFor(doc, start + 3), { from: after, to: after });
  });

  it('insertRangeFor on an empty paragraph replaces it', () => {
    const doc = docOf([para('One'), para(''), para('Three')]);
    const start = bodyStart(doc) + doc.child(1).nodeSize;
    assert.deepEqual(insertRangeFor(doc, start + 1), { from: start, to: start + doc.child(2).nodeSize });
  });

  it('insertRangeFor between top-level blocks stays there', () => {
    const doc = docOf([para('One'), para('Two')]);
    const between = bodyStart(doc) + doc.child(1).nodeSize;
    assert.deepEqual(insertRangeFor(doc, between), { from: between, to: between });
  });
});

describe('shouldUpload', () => {
  const dt = (files, types = []) => ({ files: { length: files }, types });
  it('files only → true', () => assert.equal(shouldUpload(dt(1, ['Files'])), true));
  it('files plus text/html → false', () => assert.equal(shouldUpload(dt(1, ['Files', 'text/html'])), false));
  it('no files → false', () => {
    assert.equal(shouldUpload(dt(0, ['text/plain'])), false);
    assert.equal(shouldUpload(null), false);
  });
});

describe('mediaDropPlugin', () => {
  /** A minimal view: state, dispatch, posAtCoords. */
  function fakeView(state, pos) {
    const view = {
      state,
      isDestroyed: false,
      dispatch(tr) { view.state = view.state.apply(tr); },
      posAtCoords: () => ({ pos, inside: -1 }),
      focus() {},
    };
    return view;
  }
  const file = (name) => ({ name, size: 10 });
  const dropEvent = (files) => ({ clientX: 0, clientY: 0, dataTransfer: { files: Object.assign([...files], { length: files.length }), types: ['Files'] } });
  const tick = () => new Promise((r) => setTimeout(r, 0));

  function setup(blocks, uploadImpl, onInserted) {
    const plugins = mediaDropPlugin({
      upload: uploadImpl,
      plan: (item) => insertPlan(item, { pdfViewer: false }),
      onInserted,
    });
    const state = EditorState.create({ doc: docOf(blocks), plugins: [history(), ...plugins] });
    return { plugins, state, handler: plugins[1] };
  }

  it('a dropped image becomes a figure after the paragraph, and one undo removes it', async () => {
    const { state, handler } = setup([para('One'), para('Two')], async (f) => ({ kind: 'image', filename: f.name, alt: null }));
    const twoAt = bodyStart(state.doc) + state.doc.child(1).nodeSize + 2;
    const view = fakeView(state, twoAt);
    assert.equal(handler.props.handleDrop(view, dropEvent([file('photo.png')])), true);
    assert.equal(placeholderKey.getState(view.state).find().length, 1);
    await tick(); await tick();
    assert.equal(placeholderKey.getState(view.state).find().length, 0);
    assert.deepEqual(toBlockAst(view.state.doc).map((b) => b.type), ['paragraph', 'paragraph', 'figure']);
    let next = null;
    undo(view.state, (tr) => { next = view.state.apply(tr); });
    assert.deepEqual(toBlockAst(next.doc).map((b) => b.type), ['paragraph', 'paragraph']);
  });

  it('one file failing never affects the others', async () => {
    const { state, handler } = setup([para('One')], async (f) => {
      if (f.name === 'bad.png') throw new Error('Upload failed (500). Try again.');
      return { kind: 'audio', filename: f.name };
    });
    const view = fakeView(state, bodyStart(state.doc) + 2);
    handler.props.handleDrop(view, dropEvent([file('bad.png'), file('notes.txt'), file('song.mp3')]));
    for (let i = 0; i < 6; i++) await tick();
    // Shown in drop order (the widgets' side)
    const left = placeholderKey.getState(view.state).find().sort((a, b) => a.spec.side - b.spec.side).map((d) => [d.spec.name, d.spec.error]);
    assert.equal(left.length, 2);
    assert.equal(left[0][0], 'bad.png');
    assert.equal(left[0][1], 'Upload failed (500). Try again.');
    assert.equal(left[1][0], 'notes.txt');
    assert.match(left[1][1], /isn't a file type Vanilla Press accepts/);
    const blocks = toBlockAst(view.state.doc);
    assert.deepEqual(blocks.map((b) => b.type), ['paragraph', 'embed']);
    assert.deepEqual(blocks[1].attrs, { url: '/media/song.mp3', type: 'audio' });
  });

  it('finished uploads leave the queue; a failed one stays until dismissed', async () => {
    const { state, handler } = setup([para('One')], async (f) => {
      if (f.name === 'bad.png') throw new Error('Upload failed (500). Try again.');
      return { kind: 'image', filename: f.name, alt: 'x' };
    });
    const view = fakeView(state, bodyStart(state.doc) + 2);
    handler.props.handleDrop(view, dropEvent([file('good.png'), file('bad.png')]));
    assert.equal(handler.pendingUploads(view), 2);
    for (let i = 0; i < 10; i++) await tick();
    assert.equal(handler.pendingUploads(view), 1, 'only the failed one is kept');
  });

  it('a drop on an empty paragraph replaces it; a web paste is left alone', async () => {
    const { state, handler } = setup([para('One'), para('')], async (f) => ({ kind: 'image', filename: f.name, alt: 'A' }));
    const emptyAt = bodyStart(state.doc) + state.doc.child(1).nodeSize + 1;
    const view = fakeView(state, emptyAt);
    handler.props.handleDrop(view, dropEvent([file('a.png')]));
    await tick(); await tick();
    assert.deepEqual(toBlockAst(view.state.doc).map((b) => b.type), ['paragraph', 'figure']);
    const paste = { clipboardData: { files: { length: 1 }, types: ['Files', 'text/html'] } };
    assert.equal(handler.props.handlePaste(view, paste), false);
  });

  const names = (doc) => toBlockAst(doc).map((b) => (b.type === 'figure' ? b.attrs.src.replace('/media/', '') : b.type));
  const settle = async () => { for (let i = 0; i < 20; i++) await tick(); };

  it('several files dropped on an empty paragraph land in drop order', async () => {
    const { state, handler } = setup([para('One'), para('')], async (f) => ({ kind: 'image', filename: f.name, alt: 'x' }));
    const view = fakeView(state, bodyStart(state.doc) + state.doc.child(1).nodeSize + 1);
    handler.props.handleDrop(view, dropEvent([file('a.png'), file('b.png'), file('c.png')]));
    await settle();
    assert.deepEqual(names(view.state.doc), ['paragraph', 'a.png', 'b.png', 'c.png']);
  });

  it('several files dropped mid-paragraph land after it in drop order', async () => {
    const { state, handler } = setup([para('One'), para('Two')], async (f) => ({ kind: 'image', filename: f.name, alt: 'x' }));
    const view = fakeView(state, bodyStart(state.doc) + 2);
    handler.props.handleDrop(view, dropEvent([file('a.png'), file('b.png'), file('c.png')]));
    await settle();
    assert.deepEqual(names(view.state.doc), ['paragraph', 'a.png', 'b.png', 'c.png', 'paragraph']);
  });

  /** An upload that waits until released. */
  function heldUpload() {
    let release;
    const gate = new Promise((r) => { release = r; });
    return { release, upload: async (f) => { await gate; return { kind: 'image', filename: f.name, alt: 'x' }; } };
  }

  it('text typed into the target empty paragraph meanwhile keeps it: the figure goes after it', async () => {
    const held = heldUpload();
    const { state, handler } = setup([para('One'), para('')], held.upload);
    const emptyAt = bodyStart(state.doc) + state.doc.child(1).nodeSize;
    const view = fakeView(state, emptyAt + 1);
    handler.props.handleDrop(view, dropEvent([file('a.png')]));
    view.dispatch(view.state.tr.insertText('typed', emptyAt + 1));
    held.release();
    await settle();
    const blocks = toBlockAst(view.state.doc);
    assert.deepEqual(names(view.state.doc), ['paragraph', 'paragraph', 'a.png']);
    assert.equal(blocks[1].children[0].value, 'typed');
  });

  it('a moved placeholder never replaces another empty paragraph', async () => {
    const held = heldUpload();
    const { state, handler } = setup([para('One'), para(''), para('')], held.upload);
    const target = bodyStart(state.doc) + state.doc.child(1).nodeSize;
    const view = fakeView(state, target + 1);
    handler.props.handleDrop(view, dropEvent([file('a.png')]));
    // The target paragraph is deleted; the other empty paragraph now sits where it was
    view.dispatch(view.state.tr.delete(target, target + 2));
    held.release();
    await settle();
    assert.deepEqual(names(view.state.doc), ['paragraph', 'a.png', 'paragraph']);
  });

  it('the large-file note reaches onInserted', async () => {
    const seen = [];
    const { state, handler } = setup([para('One')], async (f) => ({ kind: 'image', filename: f.name, alt: 'x', large: true }),
      (view, pos, plan, extra) => seen.push(extra?.note));
    const view = fakeView(state, bodyStart(state.doc) + 2);
    handler.props.handleDrop(view, dropEvent([file('a.png')]));
    await settle();
    assert.equal(seen.length, 1);
    assert.match(seen[0], /^Large file: /);
  });

  it('an alt edit right after the insert is its own undo step', async () => {
    const { state, handler } = setup([para('One')], async (f) => ({ kind: 'image', filename: f.name, alt: null }));
    const view = fakeView(state, bodyStart(state.doc) + 2);
    handler.props.handleDrop(view, dropEvent([file('a.png')]));
    await settle();
    const figPos = bodyStart(view.state.doc) + view.state.doc.child(1).nodeSize;
    const fig = view.state.doc.nodeAt(figPos);
    assert.equal(fig.type.name, 'figure');
    view.dispatch(view.state.tr.setNodeMarkup(figPos, null, { ...fig.attrs, alt: 'Typed' }));
    let next = null;
    undo(view.state, (tr) => { next = view.state.apply(tr); });
    const after = toBlockAst(next.doc);
    assert.deepEqual(after.map((b) => b.type), ['paragraph', 'figure'], 'the figure stays');
    assert.equal(after[1].attrs.alt, '', 'only the alt edit is undone');
  });
});

