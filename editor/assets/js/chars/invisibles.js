/**
 * Marks the invisible characters in both editors (non-breaking space, soft
 * hyphen, zero-width space, word joiner) with a faint sign, so a writer can
 * see them. Decorations only: the text is unchanged. Each is saved as a
 * character reference (`&nbsp;`, `&shy;`, `&#8203;`, `&#8288;`) so it can be
 * seen in the file too.
 *
 * @module editor/chars/invisibles
 */

import { Plugin } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { SYMBOLS } from './symbols.js';

const INVISIBLE = new Map(SYMBOLS.filter(s => s.invisible).map(s => [s.char, s]));
const PATTERN = new RegExp(`[${[...INVISIBLE.keys()].join('')}]`, 'g');

/**
 * Where the invisible characters are: [{ pos, entity, name }].
 * @param {import('prosemirror-model').Node} doc
 */
export function findInvisibles(doc) {
  const out = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    for (const m of node.text.matchAll(PATTERN)) {
      const s = INVISIBLE.get(m[0]);
      out.push({ pos: pos + m.index, entity: s.entity, name: s.name });
    }
  });
  return out;
}

function decorate(doc) {
  return DecorationSet.create(doc, findInvisibles(doc).map(({ pos, entity, name }) =>
    Decoration.inline(pos, pos + 1, { class: 'char-invisible', 'data-char': entity, title: name })));
}

export function invisiblesPlugin() {
  return new Plugin({
    state: {
      init: (_, state) => decorate(state.doc),
      apply: (tr, set) => (tr.docChanged ? decorate(tr.doc) : set),
    },
    props: {
      decorations(state) { return this.getState(state); },
    },
  });
}
