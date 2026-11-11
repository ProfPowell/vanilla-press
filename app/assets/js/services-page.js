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

/**
 * Polite announcement. The region always stays rendered; a message that repeats
 * the last one gets a trailing no-break space, so it is still changed text and
 * read again.
 */
function announce(message) {
  statusEl.textContent = statusEl.textContent === message ? `${message}\u00a0` : message;
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

/**
 * Replace a service's card from the server's answer, keeping focus on the same
 * control. Text in the key field survives (a key pasted but not yet saved),
 * unless `clearKey` (after that key was saved).
 */
function replaceCard(old, state, focusControl, { clearKey = false } = {}) {
  const typed = old.querySelector('input[data-control="key"]')?.value ?? '';
  const card = serviceCard(serviceRow(state));
  const input = card.querySelector('input[data-control="key"]');
  if (input && !clearKey) input.value = typed;
  old.replaceWith(card);
  const target = card.querySelector(`[data-control="${focusControl}"]`) || input;
  target?.focus();
}

/** Mark a card busy and disable its controls; returns a function that frees it. */
function hold(card) {
  card.setAttribute('aria-busy', 'true');
  const controls = [...card.querySelectorAll('input, button')].filter((c) => !c.disabled);
  for (const c of controls) c.disabled = true;
  return () => {
    card.removeAttribute('aria-busy');
    for (const c of controls) c.disabled = false;
  };
}

/**
 * One save for a card at a time: PUT the change, then rebuild the card from the
 * answer. On failure the card is freed as it was and the error is shown.
 * @returns {Promise<object|null>} the service's new state, or null
 */
async function save(card, change, focusControl, { clearKey = false, onFail } = {}) {
  if (card.hasAttribute('aria-busy')) return null;
  showError('');
  const release = hold(card);
  try {
    const state = await api(`/api/services/${encodeURIComponent(card.dataset.id)}`, { method: 'PUT', body: change });
    replaceCard(card, state, focusControl, { clearKey });
    return state;
  } catch (err) {
    release();
    onFail?.();
    card.querySelector(`[data-control="${focusControl}"]`)?.focus();
    showError(err.message);
    return null;
  }
}

groupsEl.addEventListener('submit', async (e) => {
  const form = e.target.closest('form.service-key');
  if (!form) return;
  e.preventDefault();
  const input = form.querySelector('input[data-control="key"]');
  const key = input.value.trim();
  if (!key) { input.value = ''; input.focus(); return; }
  const state = await save(form.closest('.service-card'), { key }, 'key', { clearKey: true });
  if (state) announce(`${state.label} key saved. ${serviceRow(state).status}.`);
});

groupsEl.addEventListener('click', async (e) => {
  const button = e.target.closest('button[data-action="remove"]');
  if (!button) return;
  const state = await save(button.closest('.service-card'), { key: null }, 'key');
  if (state) announce(`${state.label} key removed. ${serviceRow(state).status}.`);
});

groupsEl.addEventListener('change', async (e) => {
  const box = e.target.closest('input[data-action="toggle"]');
  if (!box) return;
  const card = box.closest('.service-card');
  const wanted = box.checked;
  if (card.hasAttribute('aria-busy')) { box.checked = !wanted; return; }
  const state = await save(card, { enabled: wanted }, 'toggle', { onFail: () => { box.checked = !wanted; } });
  if (state) announce(state.enabled ? `${state.label} turned on. ${serviceRow(state).status}.` : `${state.label} turned off.`);
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
