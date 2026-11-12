/**
 * Character suggestions while typing, in both editors:
 * - `:sm` (two or more characters after a `:` that doesn't follow a letter,
 *   digit, `_` or `:`) lists matching emoji
 * - `&he` (two or more letters after `&`) lists matching symbols
 * ↑/↓ move, Enter or Tab inserts the chosen character in place of what was
 * typed, Escape closes the list until the text before the caret changes
 * course. A click inserts too. Nothing is offered inside code. Typing the
 * closing `:` or `;` still converts through the input rules (char-rules.js).
 *
 * The list is a listbox; while it is open the editor element carries
 * `aria-expanded`, `aria-controls`, `aria-autocomplete` and
 * `aria-activedescendant` for it.
 *
 * @module editor/chars/char-suggest
 */

import { Plugin, PluginKey } from 'prosemirror-state';
import { placePopover } from '../popover-place.js';
import { inCode } from './char-rules.js';
import { emojiIndex } from './emoji-index.js';
import { searchSymbols } from './symbols.js';

export const charSuggestKey = new PluginKey('charSuggest');

const EMOJI_QUERY = /(?:^|[^\w:]):([A-Za-z0-9_+-]{2,50})$/;
const SYMBOL_QUERY = /&([A-Za-z][A-Za-z0-9]{1,31})$/;

/**
 * What the text before an empty selection asks for, or null.
 * @returns {{ kind: 'emoji'|'symbol', query: string, from: number, to: number }|null}
 */
export function suggestQuery(state) {
  const { empty, $from, from } = state.selection;
  if (!empty || !$from.parent.isTextblock) return null;
  const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 60), $from.parentOffset, null, '\ufffc');
  let m = EMOJI_QUERY.exec(before);
  let kind = 'emoji';
  if (!m) { m = SYMBOL_QUERY.exec(before); kind = 'symbol'; }
  if (!m) return null;
  const start = from - m[1].length - 1;
  if (inCode(state, start)) return null;
  return { kind, query: m[1], from: start, to: from };
}

/** The suggestions for a query: { char, label, hint } rows. */
export function suggestionsFor(q, { emoji = emojiIndex(), limit = 8 } = {}) {
  if (!q) return [];
  if (q.kind === 'emoji') {
    return emoji.search(q.query, limit).map(e => ({ char: e.emoji, label: e.name, hint: `:${e.shortcode}:` }));
  }
  return searchSymbols(q.query, limit).map(s => ({ char: s.char, label: s.name, hint: `&${s.entity};`, invisible: Boolean(s.invisible), short: s.short }));
}

/** Replace the typed query with `char`. */
export function insertSuggestion(state, q, char) {
  return state.tr.insertText(char, q.from, q.to).scrollIntoView();
}

let uid = 0;

/**
 * @param {object} [opts]
 * @param {(q: object) => object[]} [opts.suggest] - suggestions for a query (suggestionsFor by default)
 */
export function charSuggestPlugin({ suggest = (q) => suggestionsFor(q) } = {}) {
  const listId = `char-suggest-${++uid}`;
  /** The open list: its query, rows and active row; null when closed. */
  let open = null;

  const optionId = (i) => `${listId}-${i}`;
  let list = null;

  /** The editor is the list's combobox while it is open. */
  const setComboAttrs = (view) => {
    const dom = view.dom;
    if (open) {
      dom.setAttribute('aria-expanded', 'true');
      dom.setAttribute('aria-controls', listId);
      dom.setAttribute('aria-autocomplete', 'list');
      dom.setAttribute('aria-activedescendant', optionId(open.active));
    } else {
      for (const a of ['aria-expanded', 'aria-controls', 'aria-autocomplete', 'aria-activedescendant']) dom.removeAttribute(a);
    }
  };

  /** Mark the active row and keep it in view. */
  const showActive = (view) => {
    if (!open || !list) return;
    for (const li of list.children) li.setAttribute('aria-selected', li.dataset.index === String(open.active) ? 'true' : 'false');
    list.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
    setComboAttrs(view);
  };

  return new Plugin({
    key: charSuggestKey,
    state: {
      init: () => ({ dismissedFrom: null }),
      apply(tr, value) {
        const meta = tr.getMeta(charSuggestKey);
        if (meta && 'dismissedFrom' in meta) return { dismissedFrom: meta.dismissedFrom };
        if (value.dismissedFrom == null || !tr.docChanged) return value;
        return { dismissedFrom: tr.mapping.map(value.dismissedFrom) };
      },
    },
    props: {
      handleKeyDown(view, event) {
        if (!open || event.isComposing) return false;
        const n = open.rows.length;
        const move = (d) => {
          open.active = (open.active + d + n) % n;
          showActive(view);
        };
        switch (event.key) {
          case 'ArrowDown': move(1); return true;
          case 'ArrowUp': move(-1); return true;
          case 'Enter':
          case 'Tab': {
            const row = open.rows[open.active];
            view.dispatch(insertSuggestion(view.state, open.q, row.char));
            return true;
          }
          case 'Escape':
            view.dispatch(view.state.tr.setMeta(charSuggestKey, { dismissedFrom: open.q.from }));
            return true;
          default:
            return false;
        }
      },
    },
    view(editorView) {
      const doc = editorView.dom.ownerDocument;
      list = doc.createElement('ul');
      list.id = listId;
      list.className = 'char-suggest';
      list.setAttribute('role', 'listbox');
      list.setAttribute('aria-label', 'Suggestions');
      list.hidden = true;
      doc.body.append(list);
      // A click must not take focus from the editor before it inserts
      list.addEventListener('mousedown', (e) => e.preventDefault());
      list.addEventListener('click', (e) => {
        const li = e.target.closest?.('[role="option"]');
        if (!li || !open) return;
        const row = open.rows[Number(li.dataset.index)];
        if (row) editorView.dispatch(insertSuggestion(editorView.state, open.q, row.char));
        editorView.focus();
      });

      const draw = (view) => {
        const q = suggestQuery(view.state);
        const dismissed = charSuggestKey.getState(view.state)?.dismissedFrom;
        const rows = q && q.from !== dismissed && view.hasFocus?.() !== false ? suggest(q) : [];
        if (!rows.length) {
          open = null;
          list.hidden = true;
          list.replaceChildren();
          setComboAttrs(view);
          return;
        }
        const same = open && open.q.from === q.from && open.q.kind === q.kind;
        const active = same && open.q.query === q.query ? Math.min(open.active, rows.length - 1) : 0;
        open = { q, rows, active };
        list.replaceChildren(...rows.map((row, i) => {
          const li = doc.createElement('li');
          li.id = optionId(i);
          li.setAttribute('role', 'option');
          li.setAttribute('aria-selected', i === active ? 'true' : 'false');
          li.dataset.index = String(i);
          const glyph = doc.createElement('span');
          glyph.className = 'char-suggest-glyph';
          glyph.setAttribute('aria-hidden', 'true');
          glyph.textContent = row.invisible ? row.short : row.char;
          const label = doc.createElement('span');
          label.className = 'char-suggest-label';
          label.textContent = row.label;
          const hint = doc.createElement('span');
          hint.className = 'char-suggest-hint';
          hint.textContent = row.hint;
          li.append(glyph, label, hint);
          return li;
        }));
        list.hidden = false;
        const caret = view.coordsAtPos?.(q.from);
        if (caret && typeof window !== 'undefined') {
          const rect = list.getBoundingClientRect();
          const place = placePopover(caret, { width: rect.width, height: rect.height },
            { width: window.innerWidth, height: window.innerHeight });
          list.style.top = `${place.top}px`;
          list.style.left = `${place.left}px`;
          list.style.maxHeight = place.maxHeight == null ? '' : `${place.maxHeight}px`;
        }
        showActive(view);
      };

      return {
        update(view, prev) {
          if (prev && prev.doc.eq(view.state.doc) && prev.selection.eq(view.state.selection)
            && charSuggestKey.getState(prev) === charSuggestKey.getState(view.state)) return;
          draw(view);
        },
        destroy() { list.remove(); list = null; open = null; setComboAttrs(editorView); },
      };
    },
  });
}
