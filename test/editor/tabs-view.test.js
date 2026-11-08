import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from 'prosemirror-state';
import { history, undo } from 'prosemirror-history';
import { schema } from '../../editor/assets/js/schema.js';
import { renameTabTr } from '../../editor/assets/js/blocks/tabs-view.js';

const { node, text } = { node: schema.node.bind(schema), text: schema.text.bind(schema) };
const p = (s) => node('paragraph', null, s ? [text(s)] : []);
const tab = (label) => node('tab', { label }, [p(label)]);
const doc = node('doc', null, [node('title', null, [text('T')]), node('tabs', null, [tab('One'), tab('Two'), tab('Three')])]);
const tabsPos = doc.firstChild.nodeSize;
const labels = (d) => { const out = []; d.nodeAt(tabsPos).forEach((c) => out.push(c.attrs.label)); return out; };

describe('renameTabTr', () => {
  it('renames only the chosen tab', () => {
    const state = EditorState.create({ doc, plugins: [history()] });
    const next = state.apply(renameTabTr(state, tabsPos, 1, 'Second'));
    assert.deepEqual(labels(next.doc), ['One', 'Second', 'Three']);
  });

  it('is a single undo step', () => {
    const state = EditorState.create({ doc, plugins: [history()] });
    const next = state.apply(renameTabTr(state, tabsPos, 2, 'Last'));
    let undone = null;
    undo(next, (tr) => { undone = next.apply(tr); });
    assert.deepEqual(labels(undone.doc), ['One', 'Two', 'Three']);
  });

  it('is null when the label is unchanged or the target is not there', () => {
    const state = EditorState.create({ doc });
    assert.equal(renameTabTr(state, tabsPos, 0, 'One'), null);
    assert.equal(renameTabTr(state, tabsPos, 9, 'X'), null);
    assert.equal(renameTabTr(state, 1, 0, 'X'), null);
  });
});
