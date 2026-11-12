/**
 * The Insert controls in both editors' bars:
 * - Emoji: Vanilla Breeze's <emoji-picker> (search, categories, recents).
 *   Its `emoji-picker:select` puts the emoji at the editor's caret.
 * - Symbols: a popover of the typographic characters and invisible spaces
 *   in chars/symbols.js, with a search field. Arrow keys move through the
 *   grid, Enter or a click inserts, Escape closes. Each shows its name and
 *   its `&reference;`.
 * A character goes where the editor's text caret (or text selection) is; with
 * a block selected, or no text place, nothing is inserted and the status line
 * says why.
 *
 * @module editor/chars/char-insert
 */

import { SYMBOLS, searchSymbols } from './symbols.js';

const COLUMNS = 8;

/**
 * Put `char` at the view's text caret, replacing a text selection.
 * @returns {boolean} false when the selection is not in text
 */
export function insertChar(view, char) {
  const { $from, $to } = view.state.selection;
  if (!$from.parent.inlineContent || !$from.sameParent($to)) return false;
  view.dispatch(view.state.tr.insertText(char).scrollIntoView());
  return true;
}

/**
 * Mount the Emoji and Symbols controls in `container`.
 * @param {HTMLElement} container
 * @param {object} opts
 * @param {() => import('prosemirror-view').EditorView|null} opts.getView
 * @returns {{ destroy(): void }}
 */
export function mountCharInsert(container, { getView }) {
  const doc = container.ownerDocument;
  const el = (tag, attrs = {}, text) => {
    const node = doc.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (text != null) node.textContent = text;
    return node;
  };

  // Why nothing was inserted: a short note beside the buttons
  const note = el('span', { class: 'char-insert-note', role: 'status' });
  let noteTimer = null;
  const notify = (message) => {
    note.textContent = message;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => { note.textContent = ''; }, 5000);
  };

  const put = (char) => {
    const view = getView();
    if (!view) return;
    if (!insertChar(view, char)) notify('Put the cursor in text first');
    // After the picker has returned focus to its trigger
    setTimeout(() => view.focus(), 0);
  };

  // EMOJI: VB's picker, with our trigger
  const emoji = el('emoji-picker', { 'data-label-trigger': 'Insert emoji' });
  const emojiTrigger = el('button', { type: 'button', class: 'ghost char-insert-btn', 'data-trigger': '', 'aria-label': 'Insert emoji', title: 'Insert emoji' }, '😀');
  emoji.append(emojiTrigger);
  emoji.addEventListener('emoji-picker:select', (e) => { if (e.detail?.emoji) put(e.detail.emoji); });

  // SYMBOLS: our popover
  const panelId = `char-symbols-${Math.random().toString(36).slice(2, 8)}`;
  const symbolsBtn = el('button', {
    type: 'button', class: 'ghost char-insert-btn', 'aria-label': 'Insert symbol', title: 'Insert symbol',
    'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-controls': panelId,
  }, 'Ω');
  const panel = el('div', { id: panelId, class: 'char-symbols', role: 'dialog', 'aria-label': 'Symbols', popover: 'auto' });
  const search = el('input', { type: 'search', class: 'char-symbols-search', placeholder: 'Search symbols…', 'aria-label': 'Search symbols' });
  const grid = el('div', { class: 'char-symbols-grid', role: 'grid', 'aria-label': 'Symbols' });
  const empty = el('p', { class: 'char-symbols-empty', hidden: '' }, 'No symbols found');
  const detail = el('p', { class: 'char-symbols-detail', 'aria-live': 'polite' });
  panel.append(search, grid, empty, detail);

  let cells = [];
  let active = 0;
  /** Set while a chosen symbol is inserted: focus goes to the editor, not back to the button. */
  let inserting = false;

  const describe = (s) => `${s.name} · &${s.entity};`;

  const focusCell = (i) => {
    if (!cells.length) return;
    active = Math.max(0, Math.min(cells.length - 1, i));
    cells.forEach((c, n) => c.setAttribute('tabindex', n === active ? '0' : '-1'));
    cells[active].focus();
  };

  const draw = () => {
    const list = search.value.trim() ? searchSymbols(search.value, SYMBOLS.length) : SYMBOLS;
    grid.replaceChildren();
    cells = [];
    for (let i = 0; i < list.length; i += COLUMNS) {
      const row = el('div', { role: 'row', class: 'char-symbols-row' });
      for (const s of list.slice(i, i + COLUMNS)) {
        const cell = el('button', {
          type: 'button', role: 'gridcell', class: 'char-symbols-cell', tabindex: '-1',
          'aria-label': describe(s), title: describe(s), 'data-char': s.char,
        }, s.invisible ? s.short : s.char);
        if (s.invisible) cell.classList.add('is-invisible');
        cell.addEventListener('click', () => {
          inserting = true;
          panel.hidePopover?.();
          put(s.char);
        });
        cell.addEventListener('focus', () => { detail.textContent = describe(s); });
        row.append(cell);
        cells.push(cell);
      }
      grid.append(row);
    }
    empty.hidden = cells.length > 0;
    active = 0;
    if (cells[0]) cells[0].setAttribute('tabindex', '0');
    detail.textContent = '';
  };

  grid.addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLUMNS, ArrowUp: -COLUMNS }[e.key];
    if (step != null) { e.preventDefault(); focusCell(active + step); return; }
    if (e.key === 'Home') { e.preventDefault(); focusCell(0); }
    if (e.key === 'End') { e.preventDefault(); focusCell(cells.length - 1); }
  });
  grid.addEventListener('focusin', (e) => {
    const i = cells.indexOf(e.target);
    if (i >= 0) active = i;
  });
  search.addEventListener('input', draw);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && cells.length) { e.preventDefault(); focusCell(0); }
    if (e.key === 'Enter' && cells.length) { e.preventDefault(); cells[0].click(); }
  });

  const place = () => {
    const r = symbolsBtn.getBoundingClientRect();
    const width = panel.offsetWidth || 320;
    panel.style.top = `${r.bottom + 4}px`;
    panel.style.left = `${Math.max(8, Math.min(r.right - width, doc.documentElement.clientWidth - width - 8))}px`;
  };
  symbolsBtn.addEventListener('click', () => {
    if (panel.matches?.(':popover-open')) { panel.hidePopover(); return; }
    search.value = '';
    draw();
    panel.showPopover?.();
    place();
    search.focus();
  });
  panel.addEventListener('toggle', (e) => {
    const isOpen = e.newState === 'open';
    symbolsBtn.setAttribute('aria-expanded', String(isOpen));
    if (isOpen) return;
    // Closed with Escape or a click outside: back to the button
    const focus = doc.activeElement;
    if (!inserting && (panel.contains(focus) || focus === doc.body)) symbolsBtn.focus();
    inserting = false;
  });

  container.append(emoji, symbolsBtn, panel, note);
  draw();

  return {
    destroy() { clearTimeout(noteTimer); for (const n of [emoji, symbolsBtn, panel, note]) n.remove(); },
  };
}
