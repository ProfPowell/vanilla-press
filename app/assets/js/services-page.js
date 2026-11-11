/**
 * The Services screen: API keys and on/off switches for outside services,
 * one section per group. Keys go to the server and never come back; the key
 * field is emptied after each save.
 * @module services-page
 */

import { api, h } from './app-api.js';
import { servicesView, serviceRow } from './services-view.js';

const $ = (id) => document.getElementById(id);
const groupsEl = $('groups');
const statusEl = $('status');
const errorEl = $('error');

/** Polite announcement; cleared first so the same words are announced again. */
function announce(message) {
  statusEl.textContent = '';
  requestAnimationFrame(() => { statusEl.textContent = message; });
}

function showError(message) {
  errorEl.textContent = message || '';
  errorEl.hidden = !message;
}

const hidden = (text) => h('span', { class: 'visually-hidden' }, text);

/** One service as an article; `data-control` marks what keeps focus across a re-render. */
function serviceCard(row) {
  const titleId = `service-${row.id}-title`;
  const children = [
    h('div', { class: 'service-head' },
      h('h3', { id: titleId }, row.label),
      h('p', { class: 'sync service-status', 'data-tone': row.tone },
        h('span', { class: 'dot', 'aria-hidden': 'true' }), hidden('Status: '), row.status)),
  ];

  if (row.key) {
    const inputId = `service-${row.id}-key`;
    const form = h('form', { class: 'service-key', 'data-id': row.id },
      h('label', { for: inputId }, `${row.label} API key`),
      h('div', { class: 'row' },
        h('input', {
          id: inputId, name: 'key', type: 'password', autocomplete: 'off', spellcheck: 'false',
          required: true, placeholder: row.key.placeholder, 'data-control': 'key',
        }),
        h('button', { type: 'submit', class: 'primary', 'data-control': 'save' }, 'Save key', hidden(` for ${row.label}`)),
        row.key.canRemove
          ? h('button', { type: 'button', 'data-action': 'remove', 'data-control': 'remove' }, 'Remove key', hidden(` for ${row.label}`))
          : null));
    children.push(form);
  }

  const foot = h('div', { class: 'service-foot' });
  if (row.signupUrl) {
    // Vanilla Breeze draws the outward arrow after an outside link
    foot.append(h('a', { href: row.signupUrl, target: '_blank', rel: 'noopener', class: 'service-signup' },
      'Get a key', hidden(` from ${row.label} (opens in a new tab)`)));
  }
  foot.append(h('label', { class: 'service-switch' },
    h('input', { type: 'checkbox', role: 'switch', 'data-switch': true, 'data-action': 'toggle', 'data-control': 'toggle', checked: row.enabled }),
    'On', hidden(` (${row.label})`)));
  children.push(foot);

  return h('article', { class: 'service-card', 'data-id': row.id, 'aria-labelledby': titleId }, ...children);
}

function groupSection(group) {
  const titleId = `group-${group.id}-title`;
  return h('section', { class: 'service-group', 'aria-labelledby': titleId },
    h('h2', { id: titleId }, group.label),
    group.emptyText
      ? h('p', { class: 'muted service-later' }, group.emptyText)
      : h('div', { class: 'service-list' }, ...group.services.map(serviceCard)));
}

/** Replace a service's card from the server's answer, keeping focus on the same control. */
function replaceCard(state, focusControl) {
  const old = groupsEl.querySelector(`.service-card[data-id="${CSS.escape(state.id)}"]`);
  if (!old) return;
  const card = serviceCard(serviceRow(state));
  old.replaceWith(card);
  const target = card.querySelector(`[data-control="${focusControl}"]`) || card.querySelector('[data-control="key"]');
  target?.focus();
}

async function update(id, change) {
  showError('');
  return api(`/api/services/${encodeURIComponent(id)}`, { method: 'PUT', body: change });
}

groupsEl.addEventListener('submit', async (e) => {
  const form = e.target.closest('form.service-key');
  if (!form) return;
  e.preventDefault();
  const input = form.elements.key;
  const key = input.value.trim();
  input.value = '';
  if (!key) { input.focus(); return; }
  try {
    const state = await update(form.dataset.id, { key });
    replaceCard(state, 'key');
    announce(`${state.label} key saved. ${serviceRow(state).status}.`);
  } catch (err) {
    showError(err.message);
  }
});

groupsEl.addEventListener('click', async (e) => {
  const button = e.target.closest('button[data-action="remove"]');
  if (!button) return;
  const id = button.closest('.service-card').dataset.id;
  try {
    const state = await update(id, { key: null });
    replaceCard(state, 'key');
    announce(`${state.label} key removed. ${serviceRow(state).status}.`);
  } catch (err) {
    showError(err.message);
  }
});

groupsEl.addEventListener('change', async (e) => {
  const box = e.target.closest('input[data-action="toggle"]');
  if (!box) return;
  const id = box.closest('.service-card').dataset.id;
  try {
    const state = await update(id, { enabled: box.checked });
    replaceCard(state, 'toggle');
    announce(state.enabled ? `${state.label} turned on. ${serviceRow(state).status}.` : `${state.label} turned off.`);
  } catch (err) {
    box.checked = !box.checked;
    showError(err.message);
  }
});

async function load() {
  try {
    const view = servicesView(await api('/api/services'));
    groupsEl.replaceChildren(...view.groups.map(groupSection));
  } catch (err) {
    groupsEl.replaceChildren();
    showError(err.message);
  }
}

load();
