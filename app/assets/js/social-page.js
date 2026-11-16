/**
 * The Social section: the site's accounts, with add (checked first), reorder, hide and
 * remove. Renders and wires events; the rules live in social-view.js and the server.
 * Every reorder, hide and remove is one PUT of the whole list.
 * @module social-page
 */
import {
  h, getSocial, recheckSocial, checkSocial, saveSocial, saveAbout, saveContact, saveFollowing, previewAbout, importOpml, followingOpmlUrl,
} from './app-api.js';
import {
  accountRow, mergeChecks, moveAccount, replaceAccount, addFormFor, toPutEntry, COOK_TOO_OLD, SERVICE_NAMES, SERVICE_IDS,
} from './social-view.js';
import {
  SOCIALSPEC_TOO_OLD, EMAIL_HELPER, PREVIEW_UNAVAILABLE, aboutForm, toAboutPut, contactForm, toContactPut,
  followingRows, blankRow, editable, toFollowingPut, moveRow, importSummary, previewDocument, mergeImported,
} from './socialspec-view.js';

/**
 * @param {{ siteId: string, root: HTMLElement }} opts
 * @returns {{ show: () => Promise<void>, refresh: () => Promise<void> }}
 */
export function initSocialSection({ siteId, root }) {
  const $ = (id) => root.querySelector(`#${id}`);
  let accounts = [];
  let checks = new Map(); // row id -> recheck result
  let cookReady = true;
  let loaded = false; // true after a successful GET /social; until then nothing can be saved
  let socialSpecReady = true;
  let contact = null; // the stored Contact, kept so Save keeps its other keys
  let followDirty = false; // unsaved edits in the Following list
  let about = null; // the stored About, kept so Save keeps its other keys (file)
  let followRows = [];
  let storedFollowing = [];
  let previewing = false;
  let busy = false;
  let pending = null; // the account waiting for Save in the Add panel: { entry, unchecked, replaceId? }
  let offeredHandle = ''; // the handle "Use @handle" filled in
  let replaceId = null; // set when the Add panel was opened from "Use @handle"

  const specOn = () => editable({ loaded, ready: socialSpecReady });
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
    const off = busy || !editable({ loaded, ready: cookReady });
    for (const el of root.querySelectorAll('#social-list button, #social-add-btn, #social-add-panel button, #social-add-panel select, #social-add-panel input')) {
      el.disabled = off || el.dataset.edge === 'true';
    }
    const specOff = busy || !specOn();
    for (const el of root.querySelectorAll('.socialspec-panel button, .socialspec-panel input, .socialspec-panel textarea')) {
      el.disabled = specOff || el.dataset.edge === 'true';
    }
    const exp = $('following-export');
    exp.setAttribute('aria-disabled', String(specOff));
    exp.style.pointerEvents = specOff ? 'none' : '';
    exp.hidden = !specOn() || !storedFollowing.some((e) => e.public !== false);
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
          row.url ? h('a', { href: row.url, target: '_blank', rel: 'noopener' }, row.handle) : h('span', {}, row.handle),
          row.hidden ? h('span', { class: 'media-badge', 'data-badge': 'hidden' }, 'Hidden') : null),
        row.skipped ? h('span', { class: 'muted' }, row.skippedNote) : null,
        row.displayName ? h('span', { class: 'muted' }, row.displayName) : null,
        row.currentHandle ? h('span', { class: 'muted' }, `The account you saved is now @${row.currentHandle}`) : null,
        h('span', { class: 'sync social-status', 'data-tone': row.tone },
          h('span', { class: 'dot', 'aria-hidden': 'true' }), h('span', { class: 'visually-hidden' }, 'Status: '), row.status)),
      h('span', { class: 'actions' },
        row.useLabel ? btn('use-handle', row.useLabel, { 'aria-label': `${row.useLabel} for ${row.name}` }) : null,
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
    if (!btn || busy || !editable({ loaded, ready: cookReady })) return;
    const index = Number(btn.dataset.index);
    const action = btn.dataset.action;
    if (action === 'use-handle') { useCurrentHandle(index); return; }
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
  function useCurrentHandle(index) {
    const old = accounts[index];
    const row = accountRow(old, checks.get(rowId(old)));
    if (!row.currentHandle) return;
    openAdd();
    replaceId = rowId(old);
    serviceEl.value = 'bluesky';
    renderFields();
    offeredHandle = row.currentHandle;
    fieldsEl.querySelector('[name="handle"]').value = row.currentHandle;
    $('social-add-form').requestSubmit();
  }
  function closeAdd() {
    replaceId = null;
    addPanel.hidden = true;
    $('social-add-btn').setAttribute('aria-expanded', 'false');
    resetConfirm();
    $('social-add-btn').focus();
  }
  function openAdd() {
    addPanel.hidden = false;
    $('social-add-btn').setAttribute('aria-expanded', 'true');
    renderFields();
    fieldsEl.querySelector('input')?.focus();
  }
  $('social-add-btn').addEventListener('click', () => {
    if (!addPanel.hidden) { closeAdd(); return; }
    openAdd();
  });
  $('social-add-cancel').addEventListener('click', closeAdd);
  serviceEl.addEventListener('change', () => { replaceId = null; renderFields(); });
  fieldsEl.addEventListener('input', () => {
    // typing a different handle than the one offered makes this a new account, not a replacement
    if (replaceId && fieldsEl.querySelector('[name="handle"]')?.value.trim() !== offeredHandle) replaceId = null;
    resetConfirm();
  });

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
    if (busy || !editable({ loaded, ready: cookReady })) return;
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
      pending = { entry, unchecked: result.status === 'unreachable', replaceId };
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
    const { entry, unchecked, replaceId: old } = pending;
    const list = old ? replaceAccount(accounts, old, entry) : [...accounts, entry];
    if (await putList(list, { saveUnchecked: unchecked })) { recheck(); closeAdd(); }
  }
  $('social-add-save').addEventListener('click', savePending);
  $('social-add-unchecked').addEventListener('click', savePending);

  // --- About, Contact and Following (Cook 2.11.0) ---
  const field = (id) => $(id);
  const panelMessage = (panel, kind, message) => {
    const el = $(`${panel}-${kind}`);
    el.textContent = message || '';
    el.hidden = !message;
  };
  /** Run a panel's one PUT: busy while in flight, 400 messages and the commit note beside the panel. */
  async function savePanel(panel, call) {
    if (busy || !specOn()) return;
    setBusy(true);
    panelMessage(panel, 'error', '');
    panelMessage(panel, 'note', '');
    try {
      const result = await call();
      const note = result.committed === false ? result.note || 'Saved, but not committed.' : '';
      panelMessage(panel, 'note', note);
      return result;
    } catch (err) {
      panelMessage(panel, 'error', err.data?.needsCook && err.data.needsCook !== '2.11.1' ? SOCIALSPEC_TOO_OLD : err.message);
    } finally {
      setBusy(false);
    }
  }

  function renderSpecGate() {
    $('socialspec-old').textContent = socialSpecReady ? '' : SOCIALSPEC_TOO_OLD;
    $('socialspec-old').hidden = socialSpecReady;
    applyDisabled();
  }

  function fillSpecPanels(state) {
    const a = aboutForm(state.about);
    field('about-summary').value = a.summary;
    field('about-body').value = a.body;
    setPreview(false);
    const c = contactForm(state.contact);
    field('contact-name').value = c.name;
    field('contact-email').value = c.email;
    field('contact-url').value = c.url;
    field('contact-org').value = c.org;
    field('contact-title-field').value = c.title;
    followRows = followingRows(state.following);
    followDirty = false;
    renderFollowing();
    for (const panel of ['about', 'contact', 'following']) { panelMessage(panel, 'error', ''); panelMessage(panel, 'note', ''); }
    $('following-import-result').hidden = true;
  }

  $('contact-email-help').textContent = EMAIL_HELPER;

  // About
  function setPreview(on) {
    previewing = on;
    $('about-edit').hidden = on;
    $('about-preview').hidden = !on;
    $('about-preview-btn').textContent = on ? 'Edit' : 'Preview';
    $('about-preview-btn').setAttribute('aria-pressed', String(on));
    if (!on) { $('about-preview-note').hidden = true; $('about-preview-frame').srcdoc = ''; }
  }
  $('about-preview-btn').addEventListener('click', async () => {
    if (busy || !specOn()) return;
    if (previewing) { setPreview(false); field('about-body').focus(); return; }
    panelMessage('about', 'error', '');
    setBusy(true);
    try {
      const { html } = await previewAbout(siteId, field('about-body').value);
      // The HTML is the owner's Markdown with raw HTML passed through: only ever a sandboxed iframe, never this page.
      setPreview(true);
      $('about-preview-frame').srcdoc = previewDocument(html);
    } catch (err) {
      if (err.status === 409) {
        setPreview(true);
        $('about-preview-note').textContent = PREVIEW_UNAVAILABLE;
        $('about-preview-note').hidden = false;
      } else {
        panelMessage('about', 'error', err.message);
      }
    } finally {
      setBusy(false);
    }
  });
  $('about-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const value = toAboutPut({ summary: field('about-summary').value, body: field('about-body').value }, about);
    const result = await savePanel('about', () => saveAbout(siteId, value));
    if (result) about = result.about || null;
  });

  // Contact
  $('contact-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const value = toContactPut({
      name: field('contact-name').value, email: field('contact-email').value, url: field('contact-url').value,
      org: field('contact-org').value, title: field('contact-title-field').value,
    }, contact);
    const result = await savePanel('contact', () => saveContact(siteId, value));
    if (result) contact = result.contact || null;
  });

  // Following
  function followRow(row, index) {
    const input = (name, label, type = 'text') => {
      const id = `follow-${row.key}-${name}`;
      return h('div', { class: 'theme-field' },
        h('label', { for: id }, label),
        h('input', { type, id, 'data-field': name, value: row[name], autocomplete: 'off', spellcheck: 'false' }));
    };
    const btn = (action, label, extra = {}) => h('button', {
      type: 'button', 'data-action': action, 'data-key': String(row.key), 'aria-label': `${label} feed ${index + 1}`, ...extra,
    }, label);
    const pubId = `follow-${row.key}-public`;
    return h('li', { class: 'follow-row', 'data-key': String(row.key) },
      input('title', 'Title'),
      input('feedUrl', 'Feed URL', 'url'),
      input('siteUrl', 'Site URL', 'url'),
      h('label', { class: 'follow-public', for: pubId },
        h('input', { type: 'checkbox', id: pubId, 'data-field': 'public', checked: row.public }), 'Public'),
      h('span', { class: 'actions' },
        btn('up', 'Move up', { 'data-edge': String(index === 0) }),
        btn('down', 'Move down', { 'data-edge': String(index === followRows.length - 1) }),
        btn('remove', 'Remove', { class: 'danger-text' })));
  }
  function renderFollowing(focusSel) {
    $('following-list').replaceChildren(...followRows.map(followRow));
    $('following-empty').hidden = followRows.length > 0;
    applyDisabled();
    if (focusSel) $('following-list').querySelector(focusSel)?.focus();
  }
  const rowOf = (el) => followRows.find((r) => String(r.key) === el.closest('.follow-row')?.dataset.key);
  $('following-list').addEventListener('input', (e) => {
    const row = rowOf(e.target);
    const name = e.target.dataset.field;
    if (!row || !name) return;
    row[name] = name === 'public' ? e.target.checked : e.target.value;
    followDirty = true;
  });
  $('following-list').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn || busy || !specOn()) return;
    const index = followRows.findIndex((r) => String(r.key) === btn.dataset.key);
    if (index < 0) return;
    const { action, key } = btn.dataset;
    if (action === 'up' || action === 'down') {
      followRows = moveRow(followRows, index, action === 'up' ? -1 : 1);
      followDirty = true;
      renderFollowing(`[data-key="${key}"][data-action="${action}"]:not(:disabled), [data-key="${key}"][data-action]:not(:disabled)`);
    } else if (action === 'remove') {
      followRows = followRows.filter((_, i) => i !== index);
      followDirty = true;
      renderFollowing('[data-action="remove"], #following-add');
    }
  });
  $('following-add').addEventListener('click', () => {
    if (busy || !specOn()) return;
    const row = blankRow();
    followRows = [...followRows, row];
    followDirty = true;
    renderFollowing(`[data-key="${row.key}"] [data-field="title"]`);
  });
  $('following-save').addEventListener('click', async () => {
    const list = toFollowingPut(followRows);
    const result = await savePanel('following', () => saveFollowing(siteId, list));
    if (result) {
      storedFollowing = result.following || [];
      followRows = followingRows(storedFollowing);
      followDirty = false;
      renderFollowing();
    }
  });
  $('following-import').addEventListener('click', () => { if (!busy && specOn()) $('following-file').click(); });
  $('following-file').addEventListener('change', async () => {
    const file = $('following-file').files[0];
    $('following-file').value = '';
    if (!file || busy || !specOn()) return;
    $('following-import-result').hidden = true;
    const result = await savePanel('following', async () => importOpml(siteId, await file.text()));
    if (result) {
      const previous = storedFollowing;
      storedFollowing = result.following || [];
      // With unsaved edits, keep them and add only the imported feeds; Save then commits everything.
      followRows = followDirty ? mergeImported(followRows, previous, storedFollowing) : followingRows(storedFollowing);
      renderFollowing();
      $('following-import-result').textContent = importSummary(result) + (followDirty ? ' Your unsaved changes are kept; Save Following to publish them.' : '');
      $('following-import-result').hidden = false;
    }
  });
  $('following-export').href = followingOpmlUrl(siteId);

  // --- Load ---
  let latest = 0;
  async function recheck() {
    const mine = ++latest;
    try {
      const snapshot = accounts; // results are for this list, however the list changes meanwhile
      const { results } = await recheckSocial(siteId);
      if (mine !== latest) return;
      checks = mergeChecks(snapshot, results);
      render();
      // An account added since the recheck started has no result: check again.
      if (accounts.some((a) => !checks.has(rowId(a)))) recheck();
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
      socialSpecReady = state.socialSpecReady === true;
      about = state.about || null;
      contact = state.contact || null;
      storedFollowing = Array.isArray(state.following) ? state.following : [];
      fillSpecPanels(state);
      loaded = true;
    } catch (err) {
      if (err.data?.cookReady === false) { cookReady = false; socialSpecReady = false; accounts = []; } else { showError(err.message); applyDisabled(); return; }
    }
    checks = new Map();
    render();
    renderSpecGate();
    if (cookReady) await recheck();
  }

  return { refresh, show: () => refresh() };
}
