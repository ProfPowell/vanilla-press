/**
 * <component-settings> — the settings panel for the selected web component.
 *
 * Part of the editor chrome: the Component section at the top of the Post
 * settings panel, outside the themed content pane. Basic fields come first, advanced ones under a <details>;
 * text and code kinds get a textarea for their content. Every edit is
 * applied at once through the callback the editor passes to `show()`.
 *
 * An `accounts` attribute (`<social-feed>`) is a fieldset: "All accounts"
 * (the empty value) and one checkbox per Bluesky, Mastodon or GitHub account
 * from `GET /social`, hidden ones marked. Unticking All ticks every visible
 * account; the value is the comma list of ticked keys.
 *
 * Shown and hidden by componentSettingsPlugin (blocks/component-view.js).
 * Showing it never opens a hidden settings panel: it sets `component-open`
 * on <editor-shell> and fires `component-settings-change` (bubbles,
 * `detail.open`), and the top bar marks the settings toggle instead.
 *
 * @module editor/components/component-settings
 */

import { settingsFields, coerce } from '../component-model.js';
import { accountChoices, accountsValue, parseKeys } from '../accounts-field.js';
import { api } from '../api-client.js';
import { pickerKind } from '../media-insert.js';
import { openMediaPicker } from './media-picker.js';
import { mediaItemSrc } from '../../../../src/media/usage.js';

/** Text fields that hold a media file's URL get a Choose… button. */
const MEDIA_FIELDS = new Set(['src', 'poster']);

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
    this.setAttribute('role', 'region');
    this.setAttribute('aria-label', 'Component');
    this._key = null;
    this._fields = [];
    this._apply = null;
    this._node = null;
    this._accounts = null;

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
      this.announce(true);
    }
  }

  hide() {
    if (this.hidden) return;
    this.hidden = true;
    this._key = null;
    this._node = null;
    this._accounts = null;
    this.replaceChildren();
    this.announce(false);
  }

  /** Tell the shell (and the top bar) whether component settings are available. */
  announce(open) {
    this.closest('editor-shell')?.classList.toggle('component-open', open);
    this.dispatchEvent(new CustomEvent('component-settings-change', { bubbles: true, detail: { open } }));
  }

  render({ node, descriptor, availability, label }) {
    const { tag } = node.attrs;
    const desc = descriptor || { tag, attributes: [], defaults: {}, advanced: [] };
    this._fields = settingsFields(desc);
    this._accounts = null;

    const control = (field) => {
      if (field.control === 'accounts') return this.accountsControl(field);
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
      if (field.control === 'checkbox') return el('div', { class: 'field field-check' }, input, labelEl, hint);
      const choose = input.type === 'text' && MEDIA_FIELDS.has(field.name)
        ? this.chooseButton(input, pickerKind(tag, field.name), field.label)
        : null;
      return el('div', { class: 'field' }, labelEl,
        choose ? el('div', { class: 'field-with-button' }, input, choose) : input, hint);
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

  /**
   * The `accounts` fieldset. Its account checkboxes arrive with `GET /social`;
   * until then (or if that fails) only "All accounts" shows.
   * @param {{ name: string, label: string, description?: string }} field
   */
  accountsControl(field) {
    const id = `cs-${field.name}`;
    const hintId = field.description ? `${id}-hint` : null;
    const all = el('input', { type: 'checkbox', id: `${id}-all`, 'data-accounts-all': '' });
    const list = el('div', { class: 'accounts-list' });
    const state = { field, choices: [], all, list };
    this._accounts = state;
    api.social().then(
      (res) => {
        if (this._accounts !== state) return;
        state.choices = accountChoices(res?.accounts);
        list.replaceChildren(...state.choices.map((c, i) => el('div', { class: 'field-check' },
          el('input', { type: 'checkbox', id: `${id}-${i}`, 'data-account-key': c.key }),
          el('label', { for: `${id}-${i}` }, c.label))));
        if (!state.choices.length) list.append(el('p', { class: 'muted' }, 'No Bluesky, Mastodon or GitHub accounts in Social yet.'));
        this.syncValues();
      },
      () => {
        if (this._accounts === state) list.replaceChildren(el('p', { class: 'muted' }, "Your accounts in Social couldn't be loaded."));
      },
    );
    return el('fieldset', { class: 'field field-accounts', 'data-accounts': field.name, 'aria-describedby': hintId },
      el('legend', {}, field.label),
      el('div', { class: 'field-check' }, all, el('label', { for: all.id }, 'All accounts')),
      list,
      hintId ? el('small', { id: hintId, class: 'hint' }, field.description) : null);
  }

  /** The accounts fieldset from the node's value: All when empty (each visible account shown ticked, locked). */
  syncAccounts(attrs) {
    const state = this._accounts;
    if (!state) return;
    const keys = parseKeys(attrs[state.field.name]).map((k) => k.toLowerCase());
    const isAll = keys.length === 0;
    state.all.checked = isAll;
    for (const box of state.list.querySelectorAll('input[data-account-key]')) {
      const key = box.dataset.accountKey;
      const choice = state.choices.find((c) => c.key === key);
      box.checked = isAll ? !choice?.hidden : keys.includes(key.toLowerCase());
      box.disabled = isAll;
    }
  }

  /** The new `accounts` value after a change in its fieldset. */
  accountsEdit(target) {
    const { choices, list } = this._accounts;
    if (target.matches('[data-accounts-all]')) return accountsValue({ all: target.checked }, choices);
    const keys = [...list.querySelectorAll('input[data-account-key]')].filter((b) => b.checked).map((b) => b.dataset.accountKey);
    return accountsValue({ all: false, keys }, choices);
  }

  /**
   * A Choose… button for a media URL field: the picked file's `/media/<file>`
   * goes into the input and through its usual edit path.
   */
  chooseButton(input, kind, label) {
    const button = el('button', { type: 'button', class: 'choose-media', 'aria-label': `Choose a file for ${label}` }, 'Choose…');
    button.addEventListener('click', async () => {
      const item = await openMediaPicker({ kind });
      if (!item || !input.isConnected) return;
      // A library file's URL, or a linked item's remote URL (an Unsplash photo)
      input.value = mediaItemSrc(item);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    return button;
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
    this.syncAccounts(attrs);
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
    const isAccounts = this._accounts && target.matches('[data-accounts-all], [data-account-key]');
    const name = isAccounts ? this._accounts.field.name : target.dataset.attr;
    const field = this._fields.find(f => f.name === name);
    if (!field) return;
    let raw = field.control === 'checkbox' ? target.checked : target.value;
    if (isAccounts) raw = this.accountsEdit(target);
    const next = { ...(this._node.attrs.attrs || {}) };
    const value = coerce(field.attrDef, raw);
    if (value === undefined || value === false) delete next[name];
    else next[name] = value;
    this._apply({ attrs: next });
  }
}

customElements.define('component-settings', ComponentSettings);
