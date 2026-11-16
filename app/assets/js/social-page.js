/**
 * The Social section: the site's accounts, with add (checked first), reorder, hide and
 * remove. Renders and wires events; the rules live in social-view.js and the server.
 * Every reorder, hide and remove is one PUT of the whole list.
 * @module social-page
 */
import { h, getSocial, recheckSocial, checkSocial, saveSocial } from './app-api.js';
import {
  accountRow, moveAccount, addFormFor, toPutEntry, COOK_TOO_OLD, SERVICE_NAMES, SERVICE_IDS,
} from './social-view.js';

/**
 * @param {{ siteId: string, root: HTMLElement }} opts
 * @returns {{ show: () => Promise<void>, refresh: () => Promise<void> }}
 */
export function initSocialSection({ siteId, root }) {
  const $ = (id) => root.querySelector(`#${id}`);
  let accounts = [];
  let checks = new Map(); // row id -> recheck result
  let cookReady = true;
  let busy = false;
  let pending = null; // the account waiting for Save in the Add panel: { entry, unchecked }

  const rowId = (a) => accountRow(a).id;
  const showError = (message) => {
    $('social-error').textContent = message || '';
    $('social-error').hidden = !message;
  };
  /** A write's answer: a note when it was not committed (it is saved, but not live). */
  const wrote = (result) => {
    const note = result && result.committed === false ? result.note || 'Saved, but not committed.' : '';
    $('social-note').textContent = note;
    $('social-note').hidden = !note;
  };

  function setBusy(value) {
    busy = value;
    root.setAttribute('aria-busy', String(value));
    applyDisabled();
  }
  function applyDisabled() {
    const off = busy || !cookReady;
    for (const el of root.querySelectorAll('#social-list button, #social-add-btn, #social-add-panel button, #social-add-panel select, #social-add-panel input')) {
      el.disabled = off || el.dataset.edge === 'true';
    }
  }

  // --- The list ---
  function badge(row) {
    if (row.avatar) {
      return h('span', { class: 'social-badge' },
        h('img', { src: row.avatar, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', width: 40, height: 40 }));
    }
    return h('span', { class: 'social-badge', 'aria-hidden': 'true' }, row.icon);
  }

  function renderRow(account, index) {
    const row = accountRow(account, checks.get(rowId(account)), { index, count: accounts.length });
    const btn = (action, label, extra = {}) => h('button', {
      type: 'button', 'data-action': action, 'data-index': String(index), 'aria-label': `${label} ${row.name}`, ...extra,
    }, label);
    return h('li', { class: 'social-row', 'data-hidden': String(row.hidden), 'data-index': String(index) },
      badge(row),
      h('span', { class: 'social-main' },
        h('span', { class: 'social-name' },
          h('strong', {}, row.name), ' ',
          h('a', { href: row.url, target: '_blank', rel: 'noopener' }, row.handle),
          row.hidden ? h('span', { class: 'media-badge', 'data-badge': 'hidden' }, 'Hidden') : null),
        row.displayName ? h('span', { class: 'muted' }, row.displayName) : null,
        h('span', { class: 'sync social-status', 'data-tone': row.tone },
          h('span', { class: 'dot', 'aria-hidden': 'true' }), h('span', { class: 'visually-hidden' }, 'Status: '), row.status)),
      h('span', { class: 'actions' },
        btn('up', 'Move up', { disabled: !row.canMoveUp, 'data-edge': String(!row.canMoveUp) }),
        btn('down', 'Move down', { disabled: !row.canMoveDown, 'data-edge': String(!row.canMoveDown) }),
        btn('hide', row.hidden ? 'Show' : 'Hide'),
        btn('remove', 'Remove', { class: 'danger-text' })));
  }

  function render() {
    const focus = document.activeElement?.closest?.('#social-list [data-action]');
    const keep = focus ? { index: focus.dataset.index, action: focus.dataset.action } : null;
    $('social-list').replaceChildren(...accounts.map(renderRow));
    $('social-empty').hidden = accounts.length > 0 || !cookReady;
    const shown = accounts.filter((a) => !a.hidden).length;
    $('social-summary').textContent = !cookReady ? '' : accounts.length
      ? `${accounts.length} ${accounts.length === 1 ? 'account' : 'accounts'}, ${shown} shown on your pages`
      : '';
    $('social-old').textContent = cookReady ? '' : COOK_TOO_OLD;
    $('social-old').hidden = cookReady;
    applyDisabled();
    if (keep) {
      const same = $('social-list').querySelector(`[data-index="${keep.index}"][data-action="${keep.action}"]:not(:disabled)`);
      (same || $('social-list').querySelector(`[data-index="${keep.index}"][data-action]:not(:disabled)`))?.focus();
    }
  }

  async function putList(list, { saveUnchecked = false } = {}) {
    setBusy(true);
    showError('');
    try {
      const result = await saveSocial(siteId, list.map(toPutEntry), saveUnchecked);
      accounts = result.accounts;
      wrote(result);
      return true;
    } catch (err) {
      showError(err.message);
      return false;
    } finally {
      setBusy(false);
      render();
    }
  }

  $('social-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn || busy || !cookReady) return;
    const index = Number(btn.dataset.index);
    const action = btn.dataset.action;
    let list;
    if (action === 'up') list = moveAccount(accounts, index, -1);
    else if (action === 'down') list = moveAccount(accounts, index, 1);
    else if (action === 'hide') list = accounts.map((a, i) => (i === index ? { ...a, hidden: !a.hidden } : a));
    else if (action === 'remove') list = accounts.filter((_, i) => i !== index);
    else return;
    const ok = await putList(list, { saveUnchecked: true });
    if (ok && action === 'remove') (($('social-list').querySelector('[data-action]')) || $('social-add-btn')).focus();
  });

  // --- Add ---
  const addPanel = $('social-add-panel');
  const fieldsEl = $('social-add-fields');
  const serviceEl = $('social-add-service');
  serviceEl.replaceChildren(...SERVICE_IDS.map((id) => h('option', { value: id }, id === 'link' ? 'Other link' : SERVICE_NAMES[id])));

  function renderFields() {
    const { fields } = addFormFor(serviceEl.value);
    fieldsEl.replaceChildren(...fields.map((f) => h('div', { class: 'theme-field' },
      h('label', { for: `social-add-${f.name}` }, f.label),
      h('input', { type: f.type, id: `social-add-${f.name}`, name: f.name, placeholder: f.placeholder, autocomplete: 'off', spellcheck: 'false' }))));
    $('social-add-check').textContent = serviceEl.value === 'link' ? 'Add' : 'Check';
    resetConfirm();
  }
  function resetConfirm() {
    pending = null;
    $('social-add-confirm').hidden = true;
    $('social-add-confirm').replaceChildren();
    $('social-add-save').hidden = true;
    $('social-add-unchecked').hidden = true;
    $('social-add-check').hidden = false;
    $('social-add-error').hidden = true;
  }
  function closeAdd() {
    addPanel.hidden = true;
    $('social-add-btn').setAttribute('aria-expanded', 'false');
    resetConfirm();
    $('social-add-btn').focus();
  }
  $('social-add-btn').addEventListener('click', () => {
    if (!addPanel.hidden) { closeAdd(); return; }
    addPanel.hidden = false;
    $('social-add-btn').setAttribute('aria-expanded', 'true');
    renderFields();
    fieldsEl.querySelector('input')?.focus();
  });
  $('social-add-cancel').addEventListener('click', closeAdd);
  serviceEl.addEventListener('change', renderFields);
  fieldsEl.addEventListener('input', resetConfirm);

  const addError = (message) => {
    $('social-add-error').textContent = message;
    $('social-add-error').hidden = !message;
  };

  function showConfirm(result, entry) {
    const lines = [];
    const who = h('span', { class: 'social-main' },
      h('strong', {}, result.displayName || result.handle),
      result.displayName ? h('span', { class: 'muted' }, result.handle) : null);
    lines.push(result.avatar
      ? h('span', { class: 'social-badge' }, h('img', { src: result.avatar, alt: '', referrerpolicy: 'no-referrer', width: 40, height: 40 }))
      : null);
    lines.push(who);
    const box = $('social-add-confirm');
    box.replaceChildren(h('div', { class: 'social-confirm-card' }, ...lines.filter(Boolean)),
      ...(result.message ? [h('p', { class: 'muted' }, result.message)] : []));
    box.hidden = false;
  }

  $('social-add-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy || !cookReady) return;
    const service = serviceEl.value;
    const val = (name) => fieldsEl.querySelector(`[name="${name}"]`)?.value.trim() || '';
    addError('');
    if (service === 'link') {
      if (await putList([...accounts, { service: 'link', label: val('label'), url: val('url') }])) { recheck(); closeAdd(); }
      return;
    }
    setBusy(true);
    try {
      const result = await checkSocial(siteId, service, val('handle'));
      const entry = { service, handle: result.handle };
      if (result.status === 'not-found') { addError(result.message); return; }
      pending = { entry, unchecked: result.status === 'unreachable' };
      showConfirm(result, entry);
      $('social-add-check').hidden = true;
      if (result.status === 'unreachable') {
        addError('That account could not be checked just now.');
        $('social-add-unchecked').hidden = false;
      } else {
        $('social-add-save').hidden = false;
      }
    } catch (err) {
      addError(err.message);
    } finally {
      setBusy(false);
      ($('social-add-save').hidden ? $('social-add-unchecked').hidden ? fieldsEl.querySelector('input') : $('social-add-unchecked') : $('social-add-save'))?.focus();
    }
  });

  async function savePending() {
    if (!pending || busy) return;
    const { entry, unchecked } = pending;
    if (await putList([...accounts, entry], { saveUnchecked: unchecked })) { recheck(); closeAdd(); }
  }
  $('social-add-save').addEventListener('click', savePending);
  $('social-add-unchecked').addEventListener('click', savePending);

  // --- Load ---
  let latest = 0;
  async function recheck() {
    const mine = ++latest;
    try {
      const { results } = await recheckSocial(siteId);
      if (mine !== latest) return;
      checks = new Map();
      for (const r of results) if (accounts[r.index]) checks.set(rowId(accounts[r.index]), r);
      render();
    } catch (err) {
      if (mine === latest) showError(err.message);
    }
  }

  async function refresh() {
    showError('');
    try {
      const state = await getSocial(siteId);
      accounts = Array.isArray(state.accounts) ? state.accounts : [];
      cookReady = state.cookReady !== false;
    } catch (err) {
      if (err.data?.cookReady === false) { cookReady = false; accounts = []; } else { showError(err.message); return; }
    }
    checks = new Map();
    render();
    if (cookReady) await recheck();
  }

  return { refresh, show: () => refresh() };
}
