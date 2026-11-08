import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from 'prosemirror-state';
import { schema } from '../../editor/assets/js/schema.js';
import { toBlockAst } from '../../editor/assets/js/ast.js';
import { setStepTitle } from '../../editor/assets/js/blocks/steps-view.js';

const { node, text } = { node: schema.node.bind(schema), text: schema.text.bind(schema) };
const p = (s) => node('paragraph', null, [text(s)]);
const step = (title, s) => node('step', { title }, [p(s)]);
const docOf = (...blocks) => node('doc', null, [node('title', null, [text('Title')]), ...blocks]);

/** The position of the `index`th step in the doc. */
function stepPos(doc, index) {
  const found = [];
  doc.descendants((n, pos) => { if (n.type.name === 'step') found.push(pos); });
  return found[index];
}

describe('setStepTitle', () => {
  it('sets the title attr of the step at pos and nothing else', () => {
    const doc = docOf(node('steps', null, [step('One', 'a'), step('Two', 'b')]));
    const state = EditorState.create({ doc });
    const tr = setStepTitle(state, stepPos(doc, 1), 'Second');
    const next = state.apply(tr).doc;
    assert.equal(next.nodeAt(stepPos(next, 0)).attrs.title, 'One');
    assert.equal(next.nodeAt(stepPos(next, 1)).attrs.title, 'Second');
    assert.equal(next.nodeAt(stepPos(next, 1)).textContent, 'b');
  });

  it('round-trips the edited title through the block AST', () => {
    const doc = docOf(node('steps', null, [step('One', 'a')]));
    const state = EditorState.create({ doc });
    const next = state.apply(setStepTitle(state, stepPos(doc, 0), 'Install')).doc;
    const ast = JSON.stringify(toBlockAst(next));
    assert.match(ast, /"title":"Install"/);
    assert.doesNotMatch(ast, /"title":"One"/);
  });

  it('returns null when the position holds no step', () => {
    const doc = docOf(p('x'));
    assert.equal(setStepTitle(EditorState.create({ doc }), 0, 'T'), null);
  });
});
