import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, TextSelection } from 'prosemirror-state';
import { schema } from '../../editor/assets/js/schema.js';
import { toBlockAst, fromBlockAst } from '../../editor/assets/js/ast.js';
import { insertTargetPlugin, trackTarget, insertAtTarget } from '../../editor/assets/js/insert-target.js';

const para = (t) => ({ type: 'paragraph', children: t ? [{ type: 'text', value: t }] : [] });
const embed = () => schema.nodes.embed.create({ url: '/media/a.mp3', type: 'audio' });

/** A state for `texts` (one paragraph each) with the tracking plugin. */
function stateFor(texts) {
  const doc = fromBlockAst(texts.map(para), schema, { title: 'T' });
  return EditorState.create({ doc, plugins: [insertTargetPlugin()] });
}

/** Position inside the paragraph holding `text` (its start). */
function inside(state, text) {
  let at = null;
  state.doc.forEach((n, off) => { if (at == null && n.type.name === 'paragraph' && n.textContent === text) at = off + 1; });
  return at;
}
/** Position just after the paragraph holding `text`. */
function after(state, text) {
  let at = null;
  state.doc.forEach((n, off) => { if (at == null && n.type.name === 'paragraph' && n.textContent === text) at = off + n.nodeSize; });
  return at;
}

const apply = (state, tr) => state.apply(tr);
const texts = (state) => toBlockAst(state.doc).map((b) => (b.type === 'paragraph' ? (b.children || []).map((c) => c.value).join('') : b.type));

describe('insert target: replace the `/` paragraph', () => {
  it('lands at the mapped place after an edit above it, deleting nothing else', () => {
    let state = stateFor(['one', 'two', '/', 'three']);
    let id, tracked;
    ({ tr: tracked, id } = trackTarget(state, { replace: inside(state, '/') })); state = apply(state, tracked);
    // An edit above the trigger while the picker is open: a new paragraph before "one"
    state = apply(state, state.tr.insert(state.doc.firstChild.nodeSize, schema.nodes.paragraph.create(null, schema.text('new'))));
    const { tr, placed } = insertAtTarget(state, id, [embed()]);
    assert.equal(placed, 'target');
    state = apply(state, tr);
    assert.deepEqual(texts(state), ['new', 'one', 'two', 'embed', 'three']);
  });

  it('replaces nothing when the trigger paragraph was edited: inserts at the end', () => {
    let state = stateFor(['one', '/', 'three']);
    let id, tracked;
    ({ tr: tracked, id } = trackTarget(state, { replace: inside(state, '/') })); state = apply(state, tracked);
    const at = inside(state, '/') + 1;
    state = apply(state, state.tr.insertText('x', at));
    const { tr, placed } = insertAtTarget(state, id, [embed()]);
    assert.equal(placed, 'end');
    state = apply(state, tr);
    assert.deepEqual(texts(state), ['one', '/x', 'three', 'embed']);
  });

  it('inserts at the end when the trigger paragraph was deleted', () => {
    let state = stateFor(['one', '/', 'three']);
    let id, tracked;
    ({ tr: tracked, id } = trackTarget(state, { replace: inside(state, '/') })); state = apply(state, tracked);
    const from = inside(state, '/') - 1;
    state = apply(state, state.tr.delete(from, from + 3));
    const { tr, placed } = insertAtTarget(state, id, [embed()]);
    assert.equal(placed, 'end');
    assert.deepEqual(texts(apply(state, tr)), ['one', 'three', 'embed']);
  });
});

describe('insert target: after a block (`+`)', () => {
  it('follows its block through an edit above', () => {
    let state = stateFor(['one', 'two', 'three']);
    let id, tracked;
    ({ tr: tracked, id } = trackTarget(state, { after: after(state, 'two') })); state = apply(state, tracked);
    state = apply(state, state.tr.insertText('AA', inside(state, 'one')));
    const { tr, placed } = insertAtTarget(state, id, [embed()]);
    assert.equal(placed, 'target');
    assert.deepEqual(texts(apply(state, tr)), ['AAone', 'two', 'embed', 'three']);
  });

  it('never splits a block: a stale position inside text goes to the end', () => {
    let state = stateFor(['one', 'two']);
    let id, tracked;
    ({ tr: tracked, id } = trackTarget(state, { after: after(state, 'one') })); state = apply(state, tracked);
    // Join "one" and "two" into one paragraph: the boundary is now mid-text
    const join = after(state, 'one');
    state = apply(state, state.tr.join(join));
    const { tr, placed } = insertAtTarget(state, id, [embed()]);
    assert.equal(placed, 'end');
    assert.deepEqual(texts(apply(state, tr)), ['onetwo', 'embed']);
  });
});

describe('insert target: bookkeeping', () => {
  it('an unknown target (doc replaced) inserts nothing', () => {
    const state = stateFor(['one']);
    assert.equal(insertAtTarget(state, 'nope', [embed()]), null);
  });

  it('a used target is forgotten', () => {
    let state = stateFor(['/']);
    let id, tracked;
    ({ tr: tracked, id } = trackTarget(state, { replace: inside(state, '/') })); state = apply(state, tracked);
    state = apply(state, insertAtTarget(state, id, [embed()]).tr);
    assert.equal(insertAtTarget(state, id, [embed()]), null);
  });

  it('tracking does not change the doc or the undo history', () => {
    const state = stateFor(['/']);
    const { tr } = trackTarget(state, { replace: inside(state, '/') });
    assert.equal(tr.docChanged, false);
    assert.equal(tr.getMeta('addToHistory'), false);
  });

  it('the cursor goes after an inserted atom (TextSelection never inside the title)', () => {
    let state = stateFor(['/', 'next']);
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, inside(state, '/') + 1)));
    let id, tracked;
    ({ tr: tracked, id } = trackTarget(state, { replace: inside(state, '/') })); state = apply(state, tracked);
    const { tr, pos } = insertAtTarget(state, id, [embed()]);
    state = apply(state, tr);
    assert.equal(state.doc.nodeAt(pos).type.name, 'embed');
  });
});
