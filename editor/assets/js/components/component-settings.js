/**
 * <component-settings> — the settings panel for the selected web component.
 *
 * Part of the editor chrome (it sits in the sidebar, outside the themed
 * content pane). Basic fields come first, advanced ones under a <details>;
 * text and code kinds get a textarea for their content. Every edit is
 * applied at once through the callback the editor passes to `show()`.
 *
 * Shown and hidden by componentSettingsPlugin (blocks/component-view.js).
 *
 * @module editor/components/component-settings
 */

import { settingsFields, coerce } from '../component-model.js';

/** Element constructors are created in this document; build nodes, no innerHTML with user strings. */
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k in node && typeof v !== 'string') node[k] = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  node.append(...children.filter(c => c != null));
  return node;
}

/** The control's value as the form sees an attr value. */
function formValue(field, value) {
  if (field.control === 'checkbox') return value === true || value === '' || value === 'true';
  return value === undefined || value === null || value === false ? '' : String(value);
}

export class ComponentSettings extends HTMLElement {
  connectedCallback() {
    this.hidden = true;
    this.classList.add('component-settings');
    this._key = null;
    this._fields = [];
    this._apply = null;
    this._node = null;

    this.addEventListener('input', (e) => this.onEdit(e));
    this.addEventListener('change', (e) => this.onEdit(e));
  }

  /**
   * Show the panel for a component node; re-renders only when the node
   * (position, tag or availability) changes, else updates values in place.
   * @param {{ key: string, node: import('prosemirror-model').Node, descriptor: object|null,
   *   availability: 'pending'|'on'|'off', label: string }} info
   * @param {(patch: object) => void} apply
   */
  show(info, apply) {
    this._apply = apply;
    this._node = info.node;
    if (info.key !== this._key) {
      this._key = info.key;
      this.render(info);
    } else {
      this.syncValues();
    }
    if (this.hidden) {
      this.hidden = false;
      this.closest('editor-shell')?.classList.add('component-open');
    }
  }

  hide() {
    if (this.hidden) return;
    this.hidden = true;
    this._key = null;
    this._node = null;
    this.replaceChildren();
    this.closest('editor-shell')?.classList.remove('component-open');
  }

  render({ node, descriptor, availability, label }) {
    const { tag } = node.attrs;
    const desc = descriptor || { tag, attributes: [], defaults: {}, advanced: [] };
    this._fields = settingsFields(desc);

    const control = (field) => {
      const id = `cs-${field.name}`;
      const hintId = field.description ? `${id}-hint` : null;
      let input;
      if (field.control === 'checkbox') {
        input = el('input', { type: 'checkbox', id });
      } else if (field.control === 'select') {
        input = el('select', { id }, el('option', { value: '' }, '(not set)'),
          ...field.options.map(o => el('option', { value: o }, o)));
      } else if (field.control === 'number') {
        input = el('input', { type: 'number', step: 'any', id });
      } else {
        input = el('input', { type: 'text', id, inputmode: field.inputmode || null });
      }
      input.dataset.attr = field.name;
      if (hintId) input.setAttribute('aria-describedby', hintId);
      const labelEl = el('label', { for: id }, field.label);
      const hint = hintId ? el('small', { id: hintId, class: 'hint' }, field.description) : null;
      return field.control === 'checkbox'
        ? el('div', { class: 'field field-check' }, input, labelEl, hint)
        : el('div', { class: 'field' }, labelEl, input, hint);
    };

    const basic = this._fields.filter(f => !f.advanced).map(control);
    const advanced = this._fields.filter(f => f.advanced).map(control);
    const hasValue = node.type.name === 'component_leaf' && (desc.kind === 'text' || desc.kind === 'code'
      || typeof node.attrs.value === 'string');
    const valueField = hasValue
      ? el('div', { class: 'field' },
        el('label', { for: 'cs-value' }, desc.kind === 'code' ? 'Code' : 'Text'),
        el('textarea', { id: 'cs-value', rows: '5', 'data-value': '', spellcheck: desc.kind === 'code' ? 'false' : null }))
      : null;

    const notes = {
      off: `${label} is not on for this site. Turn it on in the site's Components, or remove it before you publish.`,
    };

    this.replaceChildren(...[
      el('h3', {}, label),
      el('p', { class: 'component-tag' }, el('code', {}, `<${tag}>`)),
      notes[availability] ? el('p', { class: 'component-note', role: 'status' }, notes[availability]) : null,
      el('form', { class: 'component-form' },
        ...basic,
        valueField,
        advanced.length ? el('details', {}, el('summary', {}, 'Advanced'), ...advanced) : null,
        !basic.length && !advanced.length && !valueField ? el('p', { class: 'muted' }, 'No settings.') : null),
    ].filter(Boolean));
    this.querySelector('form').addEventListener('submit', (e) => e.preventDefault());
    this.syncValues();
  }

  /** Put the node's values in the controls, leaving the one being edited alone. */
  syncValues() {
    const node = this._node;
    if (!node) return;
    const attrs = node.attrs.attrs || {};
    for (const field of this._fields) {
      const input = this.querySelector(`[data-attr="${CSS.escape(field.name)}"]`);
      if (!input || input === document.activeElement) continue;
      const value = formValue(field, attrs[field.name]);
      if (field.control === 'checkbox') input.checked = value;
      else if (input.value !== value) input.value = value;
    }
    const textarea = this.querySelector('[data-value]');
    if (textarea && textarea !== document.activeElement) {
      const value = node.attrs.value ?? '';
      if (textarea.value !== value) textarea.value = value;
    }
  }

  onEdit(event) {
    const target = event.target;
    if (!this._node || !this._apply) return;
    // Text-like controls apply on input; checkboxes and selects on change
    const isText = target.matches('input[type="text"], input[type="number"], textarea');
    if ((event.type === 'input') !== isText) return;

    if (target.matches('[data-value]')) {
      this._apply({ value: target.value });
      return;
    }
    const name = target.dataset.attr;
    const field = this._fields.find(f => f.name === name);
    if (!field) return;
    const raw = field.control === 'checkbox' ? target.checked : target.value;
    const next = { ...(this._node.attrs.attrs || {}) };
    const value = coerce(field.attrDef, raw);
    if (value === undefined || value === false) delete next[name];
    else next[name] = value;
    this._apply({ attrs: next });
  }
}

customElements.define('component-settings', ComponentSettings);
