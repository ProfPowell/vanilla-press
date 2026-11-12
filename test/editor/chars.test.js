import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, TextSelection } from 'prosemirror-state';
import { schema } from '../../editor/assets/js/schema.js';
import { fromBlockAst } from '../../editor/assets/js/ast.js';
import { charRuleSpecs } from '../../editor/assets/js/chars/char-rules.js';
import { decodeReference, searchSymbols, INVISIBLE_CHARS } from '../../editor/assets/js/chars/symbols.js';
import { createEmojiIndex } from '../../editor/assets/js/chars/emoji-index.js';
import { CORE_EMOJI, CORE_ALIASES } from '../../editor/assets/js/chars/emoji-core.js';

/** A named-reference decoder standing in for the browser's. */
const NAMED = { '&hearts;': '♥', '&mdash;': '—', '&nbsp;': '\u00a0' };
const decodeNamed = (ref) => NAMED[ref] ?? ref;
const decode = (ref) => decodeReference(ref, decodeNamed);
const index = createEmojiIndex(CORE_EMOJI, CORE_ALIASES);
const rules = charRuleSpecs({ decode, resolveEmoji: (c) => index.resolve(c) });

/** A post with one paragraph `text` (marked `marks`), the caret at its end. */
function stateWith(text, marks = []) {
  const doc = fromBlockAst([{ type: 'paragraph', children: [{ type: 'text', value: text, marks }] }], schema, { title: 'T' });
  const end = doc.child(0).nodeSize + 1 + doc.child(1).content.size;
  return EditorState.create({ doc, selection: TextSelection.create(doc, end) });
}

/** What prosemirror-inputrules does when `ch` is typed: the first rule that matches and applies. */
function type(state, ch) {
  const { $from, from, to } = state.selection;
  const before = $from.parent.textBetween(0, $from.parentOffset, null, '\ufffc') + ch;
  for (const rule of rules) {
    const match = rule.match.exec(before);
    if (!match) continue;
    const tr = rule.handler(state, match, from - (match[0].length - ch.length), to);
    if (tr) return tr.doc.child(1).textContent;
  }
  return before;
}

describe('typed references', () => {
  it('turns a named reference into its character on the ;', () => {
    assert.equal(type(stateWith('Made with &hearts'), ';'), 'Made with ♥');
  });
  it('turns decimal and hex references into their characters', () => {
    assert.equal(type(stateWith('a &#9829'), ';'), 'a ♥');
    assert.equal(type(stateWith('a &#x2665'), ';'), 'a ♥');
  });
  it('keeps an unknown name, a forbidden code point and a reference in code as typed', () => {
    assert.equal(type(stateWith('&nosuch'), ';'), '&nosuch;');
    assert.equal(type(stateWith('&#0'), ';'), '&#0;');
    assert.equal(type(stateWith('&#xD800'), ';'), '&#xD800;');
    assert.equal(type(stateWith('use &hearts', ['code']), ';'), 'use &hearts;');
  });
});

describe('typed shortcodes', () => {
  it('turns :shortcode: and an alias into the emoji on the closing colon', () => {
    assert.equal(type(stateWith('Made with :red_heart'), ':'), 'Made with ❤️');
    assert.equal(type(stateWith(':+1'), ':'), '👍');
  });
  it('leaves times, ratios, unknown codes and code alone', () => {
    assert.equal(type(stateWith('at 10:30'), ':'), 'at 10:30:');
    assert.equal(type(stateWith('a:b'), ':'), 'a:b:');
    assert.equal(type(stateWith(':nosuchemoji'), ':'), ':nosuchemoji:');
    assert.equal(type(stateWith('x :smile', ['code']), ':'), 'x :smile:');
  });
});

describe('decodeReference', () => {
  it('needs the whole reference, with its semicolon', () => {
    assert.equal(decode('&hearts'), null);
    assert.equal(decode('x&hearts;'), null);
    assert.equal(decode('&#9829;'), '♥');
  });
  it('refuses controls and noncharacters', () => {
    assert.equal(decode('&#7;'), null);
    assert.equal(decode('&#x9F;'), null);
    assert.equal(decode('&#xFFFE;'), null);
    assert.equal(decode('&#x110000;'), null);
  });
});

describe('emoji index', () => {
  it('ranks shortcode prefixes first and finds keywords', () => {
    assert.equal(index.search('smi')[0].shortcode.startsWith('smi'), true);
    assert.ok(index.search('happy').some(e => e.shortcode === 'smile'));
  });
  it('a later row never replaces a curated shortcode', () => {
    const i = createEmojiIndex(CORE_EMOJI, CORE_ALIASES);
    i.addRows([['smile', 'X', 'other', 'smileys'], ['melting_face', '🫠', 'melting face', 'smileys']]);
    assert.equal(i.resolve('smile'), '😄');
    assert.equal(i.resolve('melting_face'), '🫠');
  });
});

describe('symbols', () => {
  it('finds a symbol by entity name or a word of its name', () => {
    assert.equal(searchSymbols('hea')[0].char, '♥');
    assert.equal(searchSymbols('dash')[0].entity, 'mdash');
    assert.equal(searchSymbols('copy')[0].char, '©');
  });
  it('lists the invisible characters the editors mark', () => {
    assert.deepEqual(INVISIBLE_CHARS, ['\u00a0', '\u00ad', '\u200b', '\u2060']);
  });
});

describe('suggestions while typing', async () => {
  const { suggestQuery, suggestionsFor, insertSuggestion } = await import('../../editor/assets/js/chars/char-suggest.js');
  const text = (state) => state.doc.child(1).textContent;

  it('asks for emoji after :xx and symbols after &xx', () => {
    assert.deepEqual(
      (({ kind, query }) => ({ kind, query }))(suggestQuery(stateWith('so :sm'))),
      { kind: 'emoji', query: 'sm' });
    assert.equal(suggestQuery(stateWith('Made with &he')).kind, 'symbol');
  });
  it('asks for nothing after one character, a time, or in code', () => {
    assert.equal(suggestQuery(stateWith('so :s')), null);
    assert.equal(suggestQuery(stateWith('at 10:30')), null);
    assert.equal(suggestQuery(stateWith('so :sm', ['code'])), null);
    assert.equal(suggestQuery(stateWith('AT&T')), null);
  });
  it('replaces what was typed with the chosen character', () => {
    const state = stateWith('Made with &hea');
    const q = suggestQuery(state);
    const rows = suggestionsFor(q, { emoji: index });
    assert.equal(rows[0].char, '♥');
    assert.equal(rows[0].hint, '&hearts;');
    assert.equal(text(insertSuggestion(state, q, rows[0].char)), 'Made with ♥');
    const e = stateWith('yay :tada');
    const eq = suggestQuery(e);
    const emoji = suggestionsFor(eq, { emoji: index })[0];
    assert.equal(emoji.hint, ':tada:');
    assert.equal(text(insertSuggestion(e, eq, emoji.char)), `yay ${emoji.char}`);
  });
});

describe('invisible character markers', async () => {
  const { findInvisibles } = await import('../../editor/assets/js/chars/invisibles.js');
  it('finds each invisible character with its reference', () => {
    const doc = stateWith('a\u00a0b\u00adc d').doc;
    assert.deepEqual(findInvisibles(doc).map(({ entity }) => entity), ['nbsp', 'shy']);
  });
});

describe('insertChar', async () => {
  const { NodeSelection } = await import('prosemirror-state');
  const { insertChar } = await import('../../editor/assets/js/chars/char-insert.js');
  const fakeView = (state) => ({ state, dispatched: null, dispatch(tr) { this.dispatched = tr; } });
  it('puts the character at a text caret', () => {
    const view = fakeView(stateWith('a'));
    assert.equal(insertChar(view, '♥'), true);
    assert.equal(view.dispatched.doc.child(1).textContent, 'a♥');
  });
  it('inserts nothing with a block selected', () => {
    const s = stateWith('a');
    const view = fakeView(s.apply(s.tr.setSelection(NodeSelection.create(s.doc, s.doc.child(0).nodeSize))));
    assert.equal(insertChar(view, '♥'), false);
    assert.equal(view.dispatched, null);
  });
});
