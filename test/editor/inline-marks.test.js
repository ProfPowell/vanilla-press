import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from 'prosemirror-state';
import { schema } from '../../editor/assets/js/schema.js';
import { fromBlockAst } from '../../editor/assets/js/ast.js';
import { matchInlineMark, applyInlineMark } from '../../editor/assets/js/inline-marks.js';
import { normalizeLinkUrl } from '../../editor/assets/js/link-url.js';

describe('matchInlineMark', () => {
  const cases = [
    ['a **bold**', { mark: 'strong', start: 2, text: 'bold' }],
    ['__bold__', { mark: 'strong', start: 0, text: 'bold' }],
    ['x *it*', { mark: 'em', start: 2, text: 'it' }],
    ['_it_', { mark: 'em', start: 0, text: 'it' }],
    ['`c`', { mark: 'code', start: 0, text: 'c' }],
    ['~~s~~', { mark: 'strikethrough', start: 0, text: 's' }],
    ['==h==', { mark: 'highlight', start: 0, text: 'h' }],
    ['see [VP](https://vp.dev)', { mark: 'link', start: 4, text: 'VP', attrs: { href: 'https://vp.dev' } }],
    ['[x](example.com)', { mark: 'link', start: 0, text: 'x', attrs: { href: 'https://example.com' } }],
  ];
  for (const [input, want] of cases) {
    it(`matches ${JSON.stringify(input)}`, () => assert.deepEqual(matchInlineMark(input), want));
  }
  for (const input of ['[x](javascript:alert(1))', 'snake_case_', 'a_b_', '2 * 3 *', '** x**', '****', '**bold*', '***',
    '` x `', '`a `', '` a`', 'use ` to quote and then `', '[ x ](u.com)', '[x ](u.com)', '[ x](u.com)',
    '** a**', '**a **', '__ a__', '__a __', '* a*', '*a *', '_ a_', '_a _', '~~ a~~', '~~a ~~', '== a==', '==a ==']) {
    it(`ignores ${JSON.stringify(input)}`, () => assert.equal(matchInlineMark(input), null));
  }
});

describe('applyInlineMark', () => {
  it('removes the delimiters, marks the inner text and clears the stored mark', () => {
    const doc = fromBlockAst([{ type: 'paragraph', children: [{ type: 'text', value: 'a **bold**' }] }], schema, { title: 'T' });
    const state = EditorState.create({ doc });
    const p = doc.child(1);
    const from = 1 + doc.child(0).nodeSize + 2; // start of "**bold**"
    const to = 1 + doc.child(0).nodeSize + p.content.size;
    const match = matchInlineMark(p.textContent);
    const tr = applyInlineMark(state, match, from, to);
    const para = tr.doc.child(1);
    assert.equal(para.textContent, 'a bold');
    const last = para.lastChild;
    assert.equal(last.text, 'bold');
    assert.ok(schema.marks.strong.isInSet(last.marks));
    assert.ok(!(tr.storedMarks || []).some(m => m.type === schema.marks.strong));
  });
});

describe('link-url', () => {
  it('normalizes a bare domain', () => assert.equal(normalizeLinkUrl('example.com'), 'https://example.com'));
});
