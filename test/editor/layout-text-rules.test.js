/**
 * Layout editor text: `${name}` becomes a field token as the `}` is typed,
 * Markdown closes into inline elements, and `/` opens the palette where a
 * new word could start.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, TextSelection, NodeSelection } from 'prosemirror-state';
import { layoutSchema } from '../../editor/assets/js/layout-editor/schema.js';
import { treeToDoc } from '../../editor/assets/js/layout-editor/convert.js';
import { layoutTextRuleSpecs, toggleLayoutMark } from '../../editor/assets/js/layout-editor/text-rules.js';
import { slashOpens, paletteItems, insertEntry } from '../../editor/assets/js/layout-editor/palette.js';

const fragment = (inline, tag = 'p') => ({
  kind: 'fragment', info: null, parent: null, vars: [], pageLayout: null, htmlAttrs: [], head: [],
  body: [{ type: 'text', tag, attrs: [], inline }], slots: [],
});

/** A state with the caret after the text `typed` in a fragment's paragraph. */
function typedState(typed, inline = [{ text: typed }]) {
  const { doc } = treeToDoc(fragment(inline), layoutSchema);
  const p = doc.firstChild.firstChild;
  const at = 2 + p.content.size; // body 0, p 1, content from 2
  return EditorState.create({ doc, selection: TextSelection.create(doc, at) });
}

/** Run the rule set as the input-rules plugin would for `ch` typed at the caret. */
function type(state, ch) {
  const { $from } = state.selection;
  const before = $from.parent.textBetween(0, $from.parentOffset, null, '￼') + ch;
  for (const rule of layoutTextRuleSpecs()) {
    const m = rule.match.exec(before);
    if (!m) continue;
    const tr = rule.handler(state, m, $from.pos - (m[0].length - ch.length), $from.pos);
    if (tr) return state.apply(tr);
  }
  return null;
}

const para = (state) => state.doc.firstChild.firstChild;

describe('layout text rules: fields', () => {
  it('${title} becomes a field token when the } is typed', () => {
    const next = type(typedState('By ${title'), '}');
    assert.ok(next);
    const p = para(next);
    assert.equal(p.textContent, 'By ');
    assert.equal(p.lastChild.type.name, 'field');
    assert.equal(p.lastChild.attrs.name, 'title');
  });

  it('takes dotted names (post.title)', () => {
    const next = type(typedState('${post.title'), '}');
    assert.equal(para(next).firstChild.attrs.name, 'post.title');
  });

  it('leaves ${content} and ${slot:name} as text: they are blocks', () => {
    assert.equal(type(typedState('${content'), '}'), null);
    assert.equal(type(typedState('${slot:aside'), '}'), null);
  });
});

describe('layout text rules: Markdown', () => {
  it('**bold** becomes <strong>', () => {
    const next = type(typedState('a **b*'), '*');
    const p = para(next);
    assert.equal(p.textContent, 'a b');
    assert.ok(p.lastChild.marks.some(m => m.type.name === 'strong'));
  });

  it('*it* and `code` become <em> and <code>', () => {
    assert.ok(para(type(typedState('*it'), '*')).firstChild.marks.some(m => m.type.name === 'em'));
    assert.ok(para(type(typedState('`c'), '`')).firstChild.marks.some(m => m.type.name === 'code'));
  });

  it('[text](/about/) becomes a link with an href attribute pair', () => {
    const next = type(typedState('[About](/about/'), ')');
    const link = para(next).firstChild.marks.find(m => m.type.name === 'a');
    assert.ok(link);
    assert.deepEqual(link.attrs.attrs, [['href', '/about/']]);
  });

  it('~~strike~~ stays text: a layout has no strike element', () => {
    assert.equal(type(typedState('~~s~'), '~'), null);
  });
});

describe('layout text: Bold and Italic keys', () => {
  it('Mod-b bolds the selected text', () => {
    const state = typedState('hello');
    const sel = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2, 7)));
    let next = null;
    assert.equal(toggleLayoutMark('strong')(sel, (tr) => { next = sel.apply(tr); }), true);
    assert.ok(para(next).firstChild.marks.some(m => m.type.name === 'strong'));
  });
});

describe('layout palette: / and inline items', () => {
  it('opens in an empty text block, after a space, or at the start of text', () => {
    assert.equal(slashOpens(typedState('', [])), 'block');
    assert.equal(slashOpens(typedState('Made by ')), 'text');
    const start = typedState('Hello');
    assert.equal(slashOpens(start.apply(start.tr.setSelection(TextSelection.create(start.doc, 2)))), 'text');
  });

  it('stays shut mid-word (and/or, a URL)', () => {
    assert.equal(slashOpens(typedState('and')), null);
  });

  it('opens with a block selected', () => {
    const state = typedState('Hello');
    assert.equal(slashOpens(state.apply(state.tr.setSelection(NodeSelection.create(state.doc, 1)))), 'block');
  });

  it('offers a Field and a Line break in text, inserted at the caret', () => {
    const state = typedState('By ');
    const items = paletteItems(state).map(e => e.id);
    assert.ok(items.includes('field'));
    assert.ok(items.includes('line-break'));
    const tr = insertEntry(state, paletteItems(state).find(e => e.id === 'field'));
    const next = state.apply(tr);
    assert.equal(para(next).lastChild.type.name, 'field');
    assert.equal(next.selection.node.type.name, 'field', 'selected, for the inspector to name');
  });
});
