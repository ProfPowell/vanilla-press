/**
 * The layout editor's Head dialog (a base layout only; a child's head piece
 * is a block on the canvas). It lists `meta.head` in order, each item with
 * Edit, Move up, Move down and Remove, and adds items of the tags a head
 * item can have (`HeadItem`): title, meta, link, script, style and base.
 *
 * - Text and attribute values are free text, so they take field
 *   placeholders like `${title}`; `Insert field` adds one at the caret.
 * - The `${slot:head}` item (where layouts built on this one add to the
 *   head) can be there once, shown as `Region: Head`.
 * - An inline script or style body is edited in a plain textarea, kept as
 *   typed.
 * - An item's `if`/`unless` (written by hand) is kept.
 *
 * Every change edits `meta.head` in place and calls `onChange`: the head
 * lives outside ProseMirror, so the page counts it as an edit itself.
 *
 * @module editor/layout-editor/head-dialog
 */

import { setSlotLabel } from './convert.js';
import { slotText } from './views.js';

/** `Region: <label>` for the head slot (`Region: Head` before it has an info entry). */
const regionText = (meta) => (meta?.info?.slots?.head ? slotText(meta, 'head') : 'Region: Head');

/** The tags a head item can have (Cook's HeadItem). */
export const HEAD_TAGS = ['title', 'meta', 'link', 'script', 'style', 'base'];

/** Tags without an end tag. */
const VOID = new Set(['meta', 'link', 'base']);
/** Tags whose body is edited in a textarea. */
const BODY_TAGS = new Set(['script', 'style']);

const REGION = 'region';
const ATTR_NAME = /^[A-Za-z_:][-A-Za-z0-9_:.]*$/;

const isRegion = (item) => item?.slot === 'head';
const headOf = (meta) => {
  if (!Array.isArray(meta.head)) meta.head = [];
  return meta.head;
};

/** Whether the head has room for the `${slot:head}` item (it can be there once). */
export function canAddHeadRegion(meta) {
  return !(meta.head ?? []).some(isRegion);
}

/** The region's index, or -1. */
const regionIndex = (meta) => (meta.head ?? []).findIndex(isRegion);

/**
 * Add a head item: `{ tag, attrs, text? }` with a HeadItem tag, or the
 * `{ slot: 'head' }` region when there isn't one yet (its info entry is
 * created as `Head` when missing). The region stays last (Cook: `${slot:head}`
 * must be the last thing in <head>): an item goes in just before it.
 * @returns {boolean} whether it was added
 */
export function addHeadItem(meta, item) {
  if (isRegion(item)) {
    if (!canAddHeadRegion(meta)) return false;
    headOf(meta).push({ slot: 'head' });
    if (meta.info && !meta.info.slots?.head) setSlotLabel(meta, 'head', 'Head');
    return true;
  }
  if (!item || !HEAD_TAGS.includes(item.tag)) return false;
  const out = { tag: item.tag, attrs: Array.isArray(item.attrs) ? item.attrs.map(([k, v]) => [k, v]) : [] };
  if (typeof item.text === 'string') out.text = item.text;
  const head = headOf(meta);
  const at = regionIndex(meta);
  if (at === -1) head.push(out);
  else head.splice(at, 0, out);
  return true;
}

/** Whether the item at `index` can move by `delta`: within the list, and the region stays last. */
export function canMoveHeadItem(meta, index, delta) {
  const head = meta.head ?? [];
  const to = index + delta;
  if (index < 0 || index >= head.length || to < 0 || to >= head.length) return false;
  return !isRegion(head[index]) && !isRegion(head[to]);
}

/** Move the item at `index` by `delta` places (no change past either end, or past the region). */
export function moveHeadItem(meta, index, delta) {
  const head = headOf(meta);
  const to = index + delta;
  if (!canMoveHeadItem(meta, index, delta)) return false;
  const [item] = head.splice(index, 1);
  head.splice(to, 0, item);
  return true;
}

/**
 * Remove the item at `index`. Removing the region drops its info entry too
 * (Cook refuses a declared slot that is never used).
 */
export function removeHeadItem(meta, index) {
  const head = headOf(meta);
  if (index < 0 || index >= head.length) return false;
  const [item] = head.splice(index, 1);
  if (isRegion(item) && meta.info?.slots && typeof meta.info.slots === 'object') delete meta.info.slots.head;
  return true;
}

const quote = (v) => String(v).replace(/"/g, '&quot;');

/** One line for the list: the item as its tag reads, or `Region: <label>`. */
export function headItemSummary(item, meta) {
  if (isRegion(item)) return regionText(meta);
  const attrs = (item.attrs || []).map(([k, v]) => (v === '' ? ` ${k}` : ` ${k}="${quote(v)}"`)).join('');
  const open = `<${item.tag}${attrs}>`;
  if (VOID.has(item.tag)) return open;
  const text = String(item.text ?? '');
  const shown = text.length > 60 ? `${text.slice(0, 60)}…` : text;
  return `${open}${shown.replace(/\s+/g, ' ')}</${item.tag}>`;
}

/** Why an attribute name can't be used, or null. */
function attrNameError(name) {
  if (!ATTR_NAME.test(name)) return `"${name}" isn't an attribute name`;
  if (/^on/i.test(name)) return `${name}: event handler attributes can't be set here`;
  return null;
}

function el(tag, attrs = {}, text = null) {
  const out = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    out.setAttribute(k, v === true ? '' : v);
  }
  if (text !== null) out.textContent = text;
  return out;
}

/** A select's chosen value (the selected option's, so it works where `.value` is read-only). */
function selectValue(select) {
  const chosen = [...select.querySelectorAll('option')].find(o => o.selected);
  return chosen ? chosen.value : select.value;
}

let ids = 0;

/**
 * The Head dialog, appended to `root`.
 * @param {{ root: Element, getMeta: () => Object, getContext?: () => Object, onChange?: () => void,
 *   getChildren?: () => string[] }} opts -
 *   getContext: the inspector's context (documentFields, siteFields, declaredFields) for `Insert field`;
 *   getChildren: the layouts built on this one (the listing's baseFor), named when the region is removed
 * @returns {{ el: HTMLDialogElement, open: () => void, close: () => void, render: () => void, destroy: () => void }}
 */
export function createHeadDialog({ root, getMeta, getContext = () => ({}), onChange = () => {}, getChildren = () => [] }) {
  const prefix = `le-head-${++ids}`;
  /** The item being edited (an object in meta.head), or null. */
  let editing = null;
  /** The value input or textarea last focused, for Insert field. */
  let lastValue = null;

  const dialog = el('dialog', { class: 'le-head-dialog', 'data-le-head-dialog': true, 'aria-labelledby': `${prefix}-title` });
  const title = el('h2', { id: `${prefix}-title` }, 'Head');
  const hint = el('p', { class: 'le-head-hint' }, 'What every page built on this layout has in its <head>. Text and values can use fields, like ${title}.');
  const list = el('ol', { class: 'le-head-list', 'data-head-list': true });
  const newSelect = el('select', { 'data-head-new': true, id: `${prefix}-new` });
  const addBtn = el('button', { type: 'button', 'data-head-add': true }, 'Add');
  const addRow = el('div', { class: 'le-head-add' });
  addRow.append(el('label', { for: `${prefix}-new` }, 'New item'), newSelect, addBtn);
  const form = el('fieldset', { class: 'le-head-form', 'data-head-form': true, hidden: true });
  const message = el('p', { class: 'le-head-message', 'data-head-message': true, role: 'status' });
  const done = el('button', { type: 'button', class: 'primary', 'data-head-close': true }, 'Done');
  const foot = el('div', { class: 'le-head-foot' });
  foot.append(done);
  dialog.append(title, hint, list, addRow, form, message, foot);
  root.append(dialog);

  const changed = () => {
    try { onChange(); } catch (err) { console.error(err); }
  };
  const say = (text) => { message.textContent = text; };

  // THE LIST
  // -----------------------------
  function renderNewSelect() {
    const meta = getMeta();
    const opts = HEAD_TAGS.map(tag => el('option', { value: tag }, `<${tag}>`));
    const region = el('option', { value: REGION }, regionText(meta));
    region.disabled = !canAddHeadRegion(meta);
    if (region.disabled) region.setAttribute('disabled', '');
    opts.push(region);
    const current = selectValue(newSelect) || 'meta';
    newSelect.replaceChildren(...opts);
    const pick = opts.find(o => o.value === current && !o.disabled) || opts.find(o => o.value === 'meta');
    pick.selected = true;
  }

  function renderList() {
    const meta = getMeta();
    const head = meta.head ?? [];
    list.replaceChildren(...head.map((item, i) => {
      const li = el('li', { 'data-head-item': String(i), 'aria-current': item === editing ? 'true' : null });
      const summary = el(isRegion(item) ? 'span' : 'code', { class: 'le-head-summary' }, headItemSummary(item, meta));
      const actions = el('span', { class: 'le-head-actions' });
      if (!isRegion(item)) actions.append(el('button', { type: 'button', class: 'quiet', 'data-head-edit': true }, 'Edit'));
      actions.append(
        el('button', { type: 'button', class: 'quiet', 'data-head-up': true, 'aria-label': 'Move up', disabled: !canMoveHeadItem(meta, i, -1) }, '↑'),
        el('button', { type: 'button', class: 'quiet', 'data-head-down': true, 'aria-label': 'Move down', disabled: !canMoveHeadItem(meta, i, 1) }, '↓'),
        el('button', { type: 'button', class: 'quiet', 'data-head-remove': true }, 'Remove'),
      );
      li.append(summary, actions);
      return li;
    }));
  }

  /** Refresh one item's summary (while its form is being typed in, keeping focus). */
  function refreshSummary() {
    const meta = getMeta();
    const i = (meta.head ?? []).indexOf(editing);
    const li = list.querySelector(`[data-head-item="${i}"] .le-head-summary`);
    if (li && editing) li.textContent = headItemSummary(editing, meta);
  }

  // THE FORM: the item being edited
  // -----------------------------
  function attrRow(name = '', value = '') {
    const row = el('div', { class: 'le-head-attr', 'data-head-attr': true });
    const n = el('input', { type: 'text', 'data-head-attr-name': true, 'aria-label': 'Attribute name', placeholder: 'name', spellcheck: 'false' });
    const v = el('input', { type: 'text', 'data-head-attr-value': true, 'aria-label': 'Value', placeholder: 'value', spellcheck: 'false' });
    n.value = name;
    v.value = value;
    const rm = el('button', { type: 'button', class: 'quiet', 'data-head-attr-remove': true, 'aria-label': 'Remove attribute' }, 'Remove');
    row.append(n, v, rm);
    return row;
  }

  function fieldNames() {
    const ctx = getContext() || {};
    const list = (v) => (Array.isArray(v) ? v.filter(x => typeof x === 'string') : []);
    return [...new Set([...list(ctx.documentFields), ...list(ctx.siteFields), ...list(ctx.declaredFields)])];
  }

  function renderForm() {
    form.replaceChildren();
    lastValue = null;
    if (!editing) {
      form.hidden = true;
      return;
    }
    form.hidden = false;
    form.append(el('legend', {}, `Edit <${editing.tag}>`));
    const attrs = el('div', { class: 'le-head-attrs', 'data-head-attrs': true });
    for (const [k, v] of editing.attrs || []) attrs.append(attrRow(k, v));
    form.append(attrs, el('button', { type: 'button', class: 'quiet', 'data-head-attr-add': true }, 'Add attribute'));
    if (!VOID.has(editing.tag)) {
      const id = `${prefix}-text`;
      const body = BODY_TAGS.has(editing.tag)
        ? el('textarea', { id, 'data-head-text': true, rows: '6', spellcheck: 'false', class: 'le-head-body' })
        : el('input', { id, type: 'text', 'data-head-text': true });
      body.value = editing.text ?? '';
      form.append(el('label', { for: id }, BODY_TAGS.has(editing.tag) ? 'Body' : 'Text'), body);
    }
    const names = fieldNames();
    if (names.length) {
      const id = `${prefix}-field`;
      const pick = el('select', { id, 'data-head-field': true });
      pick.append(el('option', { value: '' }, 'Choose…'), ...names.map(n => el('option', { value: n }, n)));
      form.append(el('label', { for: id }, 'Insert field'), pick);
    }
  }

  /** Read the form back into the item being edited. */
  /** Read the form back into the item being edited; the body only when `target` is the text box (kept byte for byte otherwise). */
  function readForm(target = null) {
    if (!editing) return;
    const out = [];
    const seen = new Set();
    let problem = '';
    for (const row of form.querySelectorAll('[data-head-attr]')) {
      const name = row.querySelector('[data-head-attr-name]').value.trim();
      const value = row.querySelector('[data-head-attr-value]').value;
      if (!name) continue;
      const err = attrNameError(name);
      if (err) { problem ||= err; continue; }
      if (seen.has(name.toLowerCase())) { problem ||= `${name} is set twice; the first is kept`; continue; }
      seen.add(name.toLowerCase());
      out.push([name, value]);
    }
    editing.attrs = out;
    const text = form.querySelector('[data-head-text]');
    if (text && target === text) editing.text = text.value;
    say(problem);
    refreshSummary();
    changed();
  }

  function insertField(name) {
    const target = lastValue && form.contains(lastValue) ? lastValue : form.querySelector('[data-head-text]');
    if (!target) {
      say('Pick a value or text box first');
      return;
    }
    const token = `\${${name}}`;
    const at = typeof target.selectionStart === 'number' ? target.selectionStart : target.value.length;
    const end = typeof target.selectionEnd === 'number' ? target.selectionEnd : at;
    target.value = target.value.slice(0, at) + token + target.value.slice(end);
    target.focus?.();
    target.setSelectionRange?.(at + token.length, at + token.length);
    readForm(target);
  }

  function render() {
    if (editing && !(getMeta().head ?? []).includes(editing)) editing = null;
    renderNewSelect();
    renderList();
    renderForm();
  }

  /** What removing the region means for the layouts built on this one. */
  function regionRemovedNote() {
    let children = [];
    try { children = (getChildren() || []).filter(n => typeof n === 'string' && n); } catch { /* unnamed */ }
    const who = children.length ? `Layouts built on this one (${children.join(', ')})` : 'Layouts built on this one';
    return `Region: Head removed. ${who} that fill the Head region will need it: add it back, or remove their Head pieces.`;
  }

  // EVENTS
  // -----------------------------
  const onListClick = (e) => {
    const btn = e.target.closest?.('button');
    const li = btn?.closest('[data-head-item]');
    if (!li) return;
    const meta = getMeta();
    const i = Number(li.dataset.headItem);
    const item = meta.head?.[i];
    if (!item) return;
    if (btn.hasAttribute('data-head-edit')) {
      editing = item;
      say('');
      render();
      form.querySelector('input, textarea')?.focus?.();
      return;
    }
    let ok = false;
    if (btn.hasAttribute('data-head-up')) ok = moveHeadItem(meta, i, -1);
    else if (btn.hasAttribute('data-head-down')) ok = moveHeadItem(meta, i, 1);
    else if (btn.hasAttribute('data-head-remove')) {
      ok = removeHeadItem(meta, i);
      if (item === editing) editing = null;
    }
    if (ok) {
      say(isRegion(item) && btn.hasAttribute('data-head-remove') ? regionRemovedNote() : '');
      render();
      changed();
    }
  };

  const onAdd = () => {
    const meta = getMeta();
    const value = selectValue(newSelect);
    if (value === REGION) {
      if (!addHeadItem(meta, { slot: 'head' })) {
        say(`${regionText(meta)} is already in the head`);
        return;
      }
      editing = null;
    } else {
      const item = { tag: value, attrs: [] };
      if (!VOID.has(value)) item.text = '';
      if (!addHeadItem(meta, item)) return;
      // Just before the region when there is one, else last
      const r = regionIndex(meta);
      editing = meta.head[r === -1 ? meta.head.length - 1 : r - 1];
    }
    say('');
    render();
    changed();
    form.querySelector('input, textarea')?.focus?.();
  };

  const onFormInput = (e) => {
    if (e.target.matches?.('[data-head-attr-name], [data-head-attr-value], [data-head-text]')) readForm(e.target);
  };
  const onFormChange = (e) => {
    if (e.target.matches?.('[data-head-field]')) {
      const name = selectValue(e.target);
      const none = e.target.querySelector('option[value=""]');
      if (none) none.selected = true;
      if (name) insertField(name);
    }
  };
  const onFormClick = (e) => {
    const btn = e.target.closest?.('button');
    if (!btn) return;
    if (btn.hasAttribute('data-head-attr-add')) {
      const row = attrRow();
      form.querySelector('[data-head-attrs]').append(row);
      row.querySelector('input').focus?.();
    } else if (btn.hasAttribute('data-head-attr-remove')) {
      btn.closest('[data-head-attr]').remove();
      readForm();
    }
  };
  const onFocusIn = (e) => {
    if (e.target.matches?.('[data-head-attr-value], [data-head-text]')) lastValue = e.target;
  };
  const close = () => {
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    else dialog.removeAttribute('open');
  };

  list.addEventListener('click', onListClick);
  addBtn.addEventListener('click', onAdd);
  form.addEventListener('input', onFormInput);
  form.addEventListener('change', onFormChange);
  form.addEventListener('click', onFormClick);
  form.addEventListener('focusin', onFocusIn);
  done.addEventListener('click', close);

  return {
    el: dialog,
    open() {
      editing = null;
      say('');
      render();
      if (typeof dialog.showModal === 'function') {
        if (!dialog.open) dialog.showModal();
      } else dialog.setAttribute('open', '');
    },
    close,
    render,
    destroy() {
      list.removeEventListener('click', onListClick);
      addBtn.removeEventListener('click', onAdd);
      form.removeEventListener('input', onFormInput);
      form.removeEventListener('change', onFormChange);
      form.removeEventListener('click', onFormClick);
      form.removeEventListener('focusin', onFocusIn);
      done.removeEventListener('click', close);
      dialog.remove();
    },
  };
}
