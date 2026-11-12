/**
 * The layout inspector: the selected block's settings, beside the canvas.
 *
 * - A block (or a field, include, component…) selected on the canvas, or
 *   the text block holding the caret: its fields from `inspectorFields`.
 *   A change goes back through `applyField` and one ProseMirror
 *   transaction, so undo, the edit counter and the rules guard all see it.
 *   A change that breaks a layout rule isn't made: the panel says why.
 * - A slot's label lives in the layout's meta (`setSlotLabel`), not the
 *   doc: `onMetaChange` tells the page (dirty, canvas labels). Renaming a
 *   slot keeps its info entry under the new name.
 * - With the caret in text: the inline elements around it, each with its
 *   one attribute (href, datetime, title) and Remove, which removes that
 *   instance only. Add link wraps a selection that holds no link and
 *   isn't inside one, so links never nest.
 * - The path from the region down to the selection, to select an
 *   enclosing block.
 *
 * @module editor/layout-editor/inspector
 */

import { NodeSelection, TextSelection } from 'prosemirror-state';
import {
  inspectorFields, applyField, fieldError, repeatsAt, markRange, linkWouldNest, setPair, MARK_ATTRS,
} from './inspector-model.js';
import { setSlotLabel } from './convert.js';
import { layoutViolations, addsViolation } from './palette.js';
import { regionLabel, slotLabel } from './views.js';

const NAMES = {
  container: (n) => n.attrs.tag,
  figure: () => 'figure',
  figcaption: () => 'figcaption',
  text_block: (n) => n.attrs.tag,
  image: (n) => (n.attrs.tag === 'picture' ? 'Picture' : 'Image'),
  menu: (n) => ({ ul: 'Bullet list', ol: 'Numbered list', menu: 'Menu' }[n.attrs.tag] || n.attrs.tag),
  menu_item: () => 'li',
  menu_item_blocks: () => 'li',
  include: () => 'Include',
  component: (n) => (n.attrs.tag ? `<${n.attrs.tag}>` : 'Component'),
  inline_component: (n) => (n.attrs.tag ? `<${n.attrs.tag}>` : 'Inline component'),
  comment: () => 'Comment',
  content: () => 'Document body',
  slot_ref: (n) => `Region: ${n.attrs.name}`,
  slot_piece: (n) => `Fills ${n.attrs.name}`,
  head_piece: () => 'Head',
  field: (n) => `Field ${n.attrs.name}`,
  inline_image: () => 'Image',
  empty_inline: (n) => `<${n.attrs.tag}>`,
};

const GROUPS = [
  ['block', null],
  ['attributes', 'Attributes'],
  ['repeat', 'Repeat'],
  ['show', null],
  ['common', null],
];

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
 * The inspector panel in `el`.
 * @param {{ el: Element, getView: () => import('prosemirror-view').EditorView|null, getMeta: () => Object,
 *   getContext: () => Object, onMetaChange?: (what: string) => void }} opts
 * @returns {{ update: (state: import('prosemirror-state').EditorState) => void, render: () => void, destroy: () => void }}
 */
export function createInspector({ el: root, getView, getMeta, getContext, onMetaChange = () => {} }) {
  const prefix = `le-insp-${++ids}`;
  let signature = null;
  let message = '';

  // WHAT IS SELECTED
  // -----------------------------
  /** The node the panel edits: a selected node, else the text block at the caret. */
  function target(state) {
    const sel = state.selection;
    if (sel instanceof NodeSelection) return { node: sel.node, pos: sel.from };
    const { $from } = sel;
    for (let d = $from.depth; d > 0; d--) {
      const node = $from.node(d);
      if (!node.type.name.endsWith('_body')) return { node, pos: $from.before(d) };
    }
    return null;
  }

  /** The inline elements around the caret (or at the start of the selection). */
  function marksAt(state) {
    const sel = state.selection;
    if (sel instanceof NodeSelection || !sel.$from.parent.inlineContent) return [];
    const marks = sel.empty ? sel.$from.marks() : state.doc.nodeAt(sel.from)?.marks ?? [];
    return marks.filter(m => markRange(sel.$from, m));
  }

  function signatureOf(state) {
    const t = target(state);
    const sel = state.selection;
    return JSON.stringify([
      sel.from, sel.to, sel instanceof NodeSelection, t?.pos, t?.node.type.name, t?.node.attrs,
      marksAt(state).map(m => [m.type.name, m.attrs]),
    ]);
  }

  // APPLYING
  // -----------------------------
  function say(text) {
    message = text;
    const out = root.querySelector('[data-le-inspector-message]');
    if (out) out.textContent = text;
  }

  /** Dispatch `tr` unless it breaks a layout rule (then say which). */
  function commit(view, tr) {
    const before = layoutViolations(view.state.doc);
    const after = layoutViolations(tr.doc);
    if (addsViolation(before, after)) {
      const added = after.find(v => after.filter(x => x === v).length > before.filter(x => x === v).length);
      message = `Can't do that: ${added}`;
      render(view.state, true);
      return false;
    }
    message = '';
    view.dispatch(tr);
    return true;
  }

  function applyNodeField(pos, field, value) {
    const view = getView();
    if (!view) return;
    const state = view.state;
    const node = state.doc.nodeAt(pos);
    if (!node) return;
    if (field.key === 'slot.label') {
      setSlotLabel(getMeta(), node.attrs.name, String(value));
      message = '';
      onMetaChange('slot');
      render(view.state, true);
      return;
    }
    const error = fieldError(node, field, value);
    if (error) {
      say(error);
      return;
    }
    const attrs = applyField(node, field, value);
    if (JSON.stringify(attrs) === JSON.stringify({ ...node.attrs })) return;
    const tr = state.tr.setNodeMarkup(pos, null, attrs);
    if (state.selection instanceof NodeSelection && state.selection.from === pos) {
      tr.setSelection(NodeSelection.create(tr.doc, pos));
    }
    const renamed = node.type.name === 'slot_ref' && field.key === 'name' && attrs.name !== node.attrs.name;
    if (renamed && !commitRename(view, tr, node.attrs.name, attrs.name)) return;
    if (!renamed && !commit(view, tr)) return;
    render(view.state, true);
  }

  /** Rename a slot: its info entry moves to the new name (unless that name has one). */
  function commitRename(view, tr, from, to) {
    const meta = getMeta();
    const slots = meta?.info?.slots;
    const entry = slots && typeof slots === 'object' ? slots[from] : undefined;
    if (!commit(view, tr)) return false;
    if (entry !== undefined && !(to in slots)) {
      slots[to] = structuredClone(entry);
      onMetaChange('slot');
    }
    return true;
  }

  function removeMark(mark) {
    const view = getView();
    const range = markRange(view.state.selection.$from, mark);
    if (!range) return;
    if (commit(view, view.state.tr.removeMark(range.from, range.to, mark))) render(view.state, true);
  }

  function setMarkAttr(mark, name, value) {
    const view = getView();
    const range = markRange(view.state.selection.$from, mark);
    if (!range) return;
    const next = mark.type.create({ attrs: setPair(mark.attrs.attrs || [], name, String(value).trim()), key: mark.attrs.key });
    const tr = view.state.tr.removeMark(range.from, range.to, mark).addMark(range.from, range.to, next);
    if (commit(view, tr)) render(view.state, true);
  }

  function addLink(href) {
    const view = getView();
    const { from, to, empty } = view.state.selection;
    if (empty || linkWouldNest(view.state.doc, from, to)) return;
    const link = view.state.schema.marks.a.create({ attrs: [['href', String(href).trim()]] });
    const tr = view.state.tr.addMark(from, to, link);
    tr.setSelection(TextSelection.create(tr.doc, from, to));
    if (commit(view, tr)) render(view.state, true);
  }

  function selectNode(pos) {
    const view = getView();
    if (!view) return;
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
    view.focus?.();
  }

  // DRAWING
  // -----------------------------
  function control(field, pos) {
    const id = `${prefix}-${field.key.replace(/[^\w-]/g, '_')}`;
    const wrap = el('div', { class: `le-insp-field le-insp-${field.type}` });
    const label = el('label', { for: id }, field.label);
    let input;
    switch (field.type) {
      case 'select':
        input = el('select', { id, 'data-field': field.key, disabled: field.disabled });
        for (const o of field.options) {
          const option = el('option', { value: o.value }, o.label);
          if (o.value === field.value) option.selected = true;
          input.append(option);
        }
        input.addEventListener('change', () => applyNodeField(pos, field, selectValue(input)));
        break;
      case 'checkbox':
        input = el('input', { id, type: 'checkbox', 'data-field': field.key, disabled: field.disabled });
        input.checked = Boolean(field.value);
        input.addEventListener('change', () => applyNodeField(pos, field, input.checked));
        wrap.append(input, label);
        return wrap;
      case 'textarea':
        input = el('textarea', { id, 'data-field': field.key, rows: '3' });
        input.value = field.value ?? '';
        input.addEventListener('change', () => applyNodeField(pos, field, input.value));
        break;
      case 'pairs':
        return pairsControl(field, pos);
      default: {
        input = el('input', {
          id, type: field.type === 'number' ? 'number' : 'text', 'data-field': field.key, disabled: field.disabled,
          placeholder: field.placeholder, min: field.type === 'number' ? '0' : null, autocomplete: 'off',
        });
        input.value = field.value ?? '';
        if (field.type === 'combo' && field.options?.length) {
          const list = el('datalist', { id: `${id}-list` });
          for (const o of field.options) list.append(el('option', { value: o.value, label: o.group ? `${o.group}: ${o.label}` : o.label }));
          input.setAttribute('list', list.id);
          wrap.append(list);
        }
        input.addEventListener('change', () => applyNodeField(pos, field, input.value));
      }
    }
    wrap.prepend(label, input);
    if (field.error) wrap.append(el('p', { class: 'le-insp-error' }, field.error));
    return wrap;
  }

  /** Name/value rows for the attributes without a field of their own. */
  function pairsControl(field, pos) {
    const wrap = el('fieldset', { class: 'le-insp-pairs', 'data-field': field.key });
    wrap.append(el('legend', {}, field.label));
    const rows = el('div', { class: 'le-insp-rows' });
    const collect = () => [...rows.querySelectorAll('.le-insp-pair')]
      .map(r => [r.querySelector('[data-pair-name]').value.trim(), r.querySelector('[data-pair-value]').value])
      .filter(([k]) => k);
    const row = ([name, value] = ['', '']) => {
      const r = el('div', { class: 'le-insp-pair' });
      const n = el('input', { type: 'text', 'data-pair-name': '', 'aria-label': 'Attribute name', autocomplete: 'off' });
      n.value = name;
      const v = el('input', { type: 'text', 'data-pair-value': '', 'aria-label': 'Value', autocomplete: 'off' });
      v.value = value;
      const x = el('button', { type: 'button', class: 'quiet', 'data-pair-remove': '', 'aria-label': `Remove ${name || 'attribute'}` }, '×');
      n.addEventListener('change', () => applyNodeField(pos, field, collect()));
      v.addEventListener('change', () => applyNodeField(pos, field, collect()));
      x.addEventListener('click', () => { r.remove(); applyNodeField(pos, field, collect()); });
      r.append(n, v, x);
      return r;
    };
    for (const pair of field.value) rows.append(row(pair));
    const add = el('button', { type: 'button', class: 'quiet', 'data-pair-add': '' }, 'Add attribute');
    add.addEventListener('click', () => {
      const r = row();
      rows.append(r);
      r.querySelector('input').focus?.();
    });
    wrap.append(rows, add);
    return wrap;
  }

  function breadcrumb(state, t) {
    const nav = el('nav', { class: 'le-insp-path', 'aria-label': 'Selected block path' });
    const $pos = state.doc.resolve(t.pos);
    const steps = [];
    for (let d = 1; d <= $pos.depth; d++) {
      const node = $pos.node(d);
      if (!node.type.name.endsWith('_body')) steps.push({ node, pos: $pos.before(d) });
    }
    for (const step of steps) {
      const b = el('button', { type: 'button', class: 'quiet' }, nodeName(step.node));
      b.addEventListener('click', () => selectNode(step.pos));
      nav.append(b, el('span', { 'aria-hidden': 'true' }, ' › '));
    }
    nav.append(el('strong', {}, nodeName(t.node)));
    return nav;
  }

  function nodeName(node) {
    if (node.type.name === 'region') return regionLabel(node);
    if (node.type.name === 'slot_ref') return `Region: ${slotLabel(getMeta(), node.attrs.name)}`;
    return (NAMES[node.type.name] || ((n) => n.type.name))(node);
  }

  function marksSection(state) {
    const sel = state.selection;
    const marks = marksAt(state);
    const canLink = !sel.empty && !(sel instanceof NodeSelection) && sel.$from.parent.inlineContent
      && sel.$from.sameParent(sel.$to) && !linkWouldNest(state.doc, sel.from, sel.to);
    if (!marks.length && !canLink) return null;
    const section = el('section', { class: 'le-insp-marks', 'aria-label': 'Inline elements' });
    section.append(el('h3', {}, 'Inline elements'));
    marks.forEach((mark, i) => {
      const box = el('div', { class: 'le-insp-mark', 'data-mark': mark.type.name });
      box.append(el('span', { class: 'le-insp-mark-name' }, `<${mark.type.name}>`));
      const attr = MARK_ATTRS[mark.type.name];
      if (attr) {
        const id = `${prefix}-mark-${i}`;
        const input = el('input', { id, type: 'text', 'data-mark-attr': attr, autocomplete: 'off' });
        input.value = (mark.attrs.attrs || []).find(([k]) => k === attr)?.[1] ?? '';
        input.addEventListener('change', () => setMarkAttr(mark, attr, input.value));
        box.append(el('label', { for: id }, attr), input);
      }
      const remove = el('button', { type: 'button', class: 'quiet', 'data-mark-remove': mark.type.name }, 'Remove');
      remove.addEventListener('click', () => removeMark(mark));
      box.append(remove);
      section.append(box);
    });
    if (canLink) {
      const id = `${prefix}-new-href`;
      const href = el('input', { id, type: 'text', 'data-mark-new-href': '', placeholder: '/about/ or ${url}', autocomplete: 'off' });
      const add = el('button', { type: 'button', 'data-mark-add-link': '' }, 'Add link');
      add.addEventListener('click', () => addLink(href.value));
      section.append(el('label', { for: id }, 'Link to'), href, add);
    }
    return section;
  }

  /** The slot names this layout has: its info block's and those on the canvas. */
  function slotNames(state) {
    const names = new Set(Object.keys(getMeta()?.info?.slots || {}));
    state.doc.descendants((node) => { if (node.type.name === 'slot_ref') names.add(node.attrs.name); });
    names.delete('head');
    return [...names];
  }

  function render(state = getView()?.state, force = false) {
    if (!state) return;
    const sig = signatureOf(state);
    if (!force && sig === signature) return;
    if (!force) message = '';
    signature = sig;
    const active = document.activeElement;
    const focused = active && root.contains(active) ? active.getAttribute?.('data-field') ?? null : null;
    root.replaceChildren();
    const status = el('p', { class: 'le-insp-message', 'data-le-inspector-message': '', role: 'status' }, message);
    const t = target(state);
    if (!t) {
      root.append(el('p', { class: 'le-insp-empty' }, 'Select a block to see its settings.'), status);
      return;
    }
    root.append(breadcrumb(state, t), status);
    const meta = getMeta() || {};
    const slotLabels = Object.fromEntries(Object.entries(meta.info?.slots || {})
      .map(([k, v]) => [k, v && typeof v === 'object' && typeof v.label === 'string' ? v.label : '']));
    const context = { ...(getContext() || {}), repeats: repeatsAt(state.doc, t.pos), slots: slotNames(state), slotLabels };
    const fields = inspectorFields(t.node, context);
    for (const [group, heading] of GROUPS) {
      const own = fields.filter(f => f.group === group);
      if (!own.length) continue;
      const section = el('section', { class: `le-insp-group le-insp-${group}` });
      if (heading) section.append(el('h3', {}, heading));
      for (const field of own) section.append(control(field, t.pos));
      root.append(section);
    }
    if (t.node.type.name === 'content') root.append(el('p', { class: 'le-insp-note' }, 'Document body goes here'));
    const marks = marksSection(state);
    if (marks) root.append(marks);
    if (focused) root.querySelector(`[data-field="${focused}"]`)?.focus?.();
  }

  return {
    update: (state) => render(state),
    render: () => render(getView()?.state, true),
    destroy: () => root.replaceChildren(),
  };
}
