/**
 * The editor's top bar and layout: the app's editor
 * (`/editor/?site=<id>#doc-<docId>`, "site mode") and `vp serve`.
 *
 * - The top bar shows `← Posts` and the site name (site mode only), the
 *   save pill, Preview, the Post settings toggle, the "⋯" menu (Export JSON,
 *   block tree, View live page, Delete, and in site mode Unpublish) and the
 *   primary button (Publish for a draft, Update for a published post).
 *   Unpublish and Delete ask first, in a `<confirm-panel>`.
 * - The Post settings panel can be hidden, which is remembered in
 *   localStorage. While it is hidden, a component under the cursor marks the
 *   toggle with a dot (`data-attention`) instead of opening it; a save
 *   conflict opens it (not remembered). "Show block tree" swaps its contents
 *   for the block tree.
 * - Save states (site mode): `Saving…`, `Saved`, then `Backed up` once the
 *   backup has pushed (GET /status). A backup never changes the live site:
 *   after a save of a published post the pill says `Saved · not live yet`
 *   (warning tone), and any `Live` link is cleared, until Update.
 * - Publish / Update first list any image with no alt text in a
 *   `<confirm-panel>` (both modes); then they save, POST publish / update
 *   (build, commit, push) and poll the live check until the page is up.
 * - The writing area (site mode) shows the site theme, or the open post's own
 *   page theme with the site header strip and the "Page theme: <name>" chip
 *   (GET /theme, loaded once; see pane-theme.js).
 * - In `vp serve` (no `?site=`) the panel ends with the doc browser and theme
 *   picker; the primary button runs the meta panel's publish toggle, and
 *   Unpublish stays in the meta panel.
 *
 * @module editor/site-mode
 */

import {
  SITE, backupOutcome, publishFailure, keepPollingBackup, createLiveTracker,
  savePill, primaryAction, moreMenuItems, confirmText, actionPendingText, afterAction, heldOnLoad,
} from './site-context.js';
import { api } from './api-client.js';
import { postUrlPath } from '../../../src/sync/paths.js';
import { getCurrentMeta, getCurrentDocId } from './meta-state.js';
import { saveDocument, loadDocument, deleteDoc, exportDocument, getEditorDoc } from './editor.js';
import { toBlockAst } from './ast.js';
import { altWarnings, altWarningText } from './alt-check.js';
import { paneTheme, applyPaneTheme, siteThemes } from './pane-theme.js';

const SETTINGS_KEY = 'vp.settingsHidden';
const BACKUP_POLL_MS = 5000;
const BACKUP_POLL_FOR_MS = 180000; // the backup pushes at most 120 s after the first save
const LIVE_POLL_MS = 10000;
const LIVE_POLL_FOR_MS = 300000;

let shell = null;
let els = null;
let busy = false;
/** The editor's last save status; `saved` right after `saving` is a real save, not a document load. */
let lastStatus = 'saved';
const backup = { timer: null, savedAt: 0 };
const live = createLiveTracker();
let liveTimer = null;
/** The open published post has saved edits that are not live yet (until Update). */
let held = false;

/** Set `held`, and tell the settings panel's status box. */
function setHeld(value) {
  held = value;
  document.querySelector('meta-panel')?.setLiveOutOfDate?.(value);
}
/** What the save slot shows once saved: 'saved' or 'backed-up' (null: something else). */
let savedShown = null;
/** What the last save changed (its `notices`), shown with the saved state until the next save. */
let savedNotices = [];
/** Real saves so far: a save during an action means the action did not carry the newest edit. */
let saveCount = 0;

/** Whether the editor runs in the app for one site. */
export const isSiteMode = Boolean(SITE);

/** The site's name and public address (GET /api/sites); null in `vp serve` or before they load. */
let siteInfo = null;
/** Settles once siteInfo and collections have loaded (or failed to); liveUrl() is final after it. */
let siteInfoLoaded = Promise.resolve();
/** The site's collections config, for a post's public path. */
let collections = {};
/** GET /theme's setting and themes (with the adjustments file), once loaded; null outside site mode. */
let themeData = null;
/** The one GET /theme request. */
let themeLoad = null;

/**
 * Wire the header and layout. Call once, after the editor view exists.
 */
export function initSiteMode() {
  shell = document.querySelector('editor-shell');
  const header = shell?.querySelector('[data-site-header]');
  if (!header) return;
  els = {
    header,
    back: header.querySelector('[data-back-to-posts]'),
    rule: header.querySelector('[data-site-name-rule]'),
    siteName: header.querySelector('[data-site-name]'),
    saveState: header.querySelector('[data-save-state]'),
    actionState: header.querySelector('[data-action-state]'),
    settings: header.querySelector('[data-settings-toggle]'),
    preview: header.querySelector('[data-site-preview]'),
    more: header.querySelector('[data-more-menu]'),
    primary: header.querySelector('[data-site-primary]'),
    confirm: shell.querySelector('[data-confirm]'),
    report: header.querySelector('[data-action-report]'),
    reportBody: header.querySelector('[data-action-report-body]'),
  };

  shell.classList.add('has-header');
  header.hidden = false;
  if (SITE) {
    shell.classList.add('site-mode');
    els.back.href = `/app/site.html?site=${encodeURIComponent(SITE)}`;
    siteInfoLoaded = loadSiteInfo();
    loadThemeData();
  } else {
    // vp serve: no site to go back to or name
    els.back.hidden = true;
    els.rule.hidden = true;
    els.siteName.hidden = true;
  }

  els.settings.addEventListener('click', () => setSettingsHidden(!shell.classList.contains('settings-hidden'), true));
  els.preview.addEventListener('click', SITE ? preview : () => document.querySelector('meta-panel [data-preview]')?.click());
  els.primary.addEventListener('click', onPrimary);
  els.more.addEventListener('more-select', (e) => onMore(e.detail.id));
  header.querySelector('[data-action-report-close]').addEventListener('click', clearReport);
  shell.addEventListener('component-settings-change', updateAttention);

  setSettingsHidden(readSettingsHidden(), false);
  onMetaUpdate(getCurrentMeta());

  window.addEventListener('pagehide', stopPolling);
}

/** The site's name for the bar, and its address and collections for "View live page". */
async function loadSiteInfo() {
  try {
    const res = await fetch('/api/sites');
    const sites = res.ok ? await res.json() : [];
    siteInfo = (Array.isArray(sites) ? sites : sites.sites || []).find((s) => s.id === SITE) || null;
  } catch { /* the bar just has no name */ }
  els.siteName.textContent = siteInfo?.name || '';
  const stripName = shell.querySelector('[data-site-strip-name]');
  if (stripName) stripName.textContent = siteInfo?.name || '';
  try {
    const { value } = await api.getConfig('collections');
    collections = value ? JSON.parse(value) : {};
  } catch { /* defaults */ }
  refreshMenu(getCurrentMeta());
}

/**
 * Load the site's theme setting and theme list (site mode, once) and show the
 * open post in it. Resolves to `{ setting, themes }`, or null outside site
 * mode or when it could not load (the pane is then left unthemed).
 * @returns {Promise<{ setting: object|null, themes: object[] }|null>}
 */
export function loadThemeData() {
  if (!SITE) return Promise.resolve(null);
  themeLoad ||= api.getTheme().then(
    (res) => {
      const setting = res?.setting || null;
      themeData = { setting, themes: siteThemes(setting, res?.themes, SITE) };
      showPaneTheme(getCurrentMeta());
      return themeData;
    },
    () => null,
  );
  return themeLoad;
}

/** The loaded `{ setting, themes }`; null outside site mode or before it loads. */
export function getThemeData() {
  return themeData;
}

/** Theme the writing area for `meta` (once the theme data is in). */
function showPaneTheme(meta) {
  if (!themeData || !meta) return;
  applyPaneTheme(paneTheme(themeData.setting, meta, themeData.themes));
}

/** The public URL of the open post when it is published and the site has an address, else null. */
function liveUrl(meta) {
  if (!SITE || !siteInfo?.siteUrl || meta?.status !== 'published') return null;
  return siteInfo.siteUrl.replace(/\/+$/, '') + postUrlPath({ meta }, collections);
}

function refreshMenu(meta) {
  els.more.setItems(moreMenuItems(meta, { siteMode: Boolean(SITE), liveUrl: liveUrl(meta) }));
}

// --- Layout ---

/**
 * @param {boolean} hidden
 * @param {boolean} remember - store the choice (a conflict shows the panel without storing)
 */
function setSettingsHidden(hidden, remember) {
  shell.classList.toggle('settings-hidden', hidden);
  els.settings.setAttribute('aria-pressed', String(!hidden));
  if (remember) {
    try { localStorage.setItem(SETTINGS_KEY, hidden ? '1' : '0'); } catch { /* storage off */ }
  }
  updateAttention();
}

function readSettingsHidden() {
  try { return localStorage.getItem(SETTINGS_KEY) === '1'; } catch { return false; }
}

/** With the panel hidden, a component under the cursor puts a dot on the settings toggle. */
function updateAttention() {
  const attention = shell.classList.contains('settings-hidden') && shell.classList.contains('component-open');
  els.settings.toggleAttribute('data-attention', attention);
  els.settings.setAttribute('aria-label', attention ? 'Post settings (component settings available)' : 'Post settings');
}

// --- Header text ---

/** Set the save pill or the action slot (Publish, Preview) to `text`; kind: '' | 'done' | 'warn' | 'error'. */
function show(el, text, kind = '') {
  el.textContent = text;
  el.className = [el === els.saveState ? 'save-pill' : 'action-state', kind].filter(Boolean).join(' ');
}

/** Show `text` in a header slot with a link to `url`. */
function showLink(el, text, url) {
  show(el, '', 'done');
  el.replaceChildren(`${text} `);
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = url;
  el.append(a);
}

/**
 * Show details under the header: a message and either a log (in a <details>)
 * or a list of file names.
 * @param {string} message
 * @param {{ log?: string, files?: string[] }} [extra]
 */
function showReport(message, { log, files } = {}) {
  const body = [];
  const p = document.createElement('p');
  p.textContent = message;
  body.push(p);
  if (log) {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Build log';
    const pre = document.createElement('pre');
    pre.textContent = log;
    details.append(summary, pre);
    body.push(details);
  }
  if (files?.length) {
    const ul = document.createElement('ul');
    for (const f of files) {
      const li = document.createElement('li');
      li.textContent = f;
      ul.append(li);
    }
    body.push(ul);
  }
  els.reportBody.replaceChildren(...body);
  els.report.hidden = false;
}

function clearReport() {
  els.report.hidden = true;
  els.reportBody.replaceChildren();
}

// --- Save state and draft backup ---

/**
 * The editor's save status changed (from editor-shell).
 * @param {'saved'|'saving'|'unsaved'|'conflict'|'error'} status
 * @param {string} [message]
 */
export function onSaveStatus(status, message) {
  if (!els) return;
  const realSave = status === 'saved' && lastStatus === 'saving';
  lastStatus = status;
  if (status !== 'saved') savedShown = null;
  switch (status) {
    case 'saving':
      els.saveState.title = '';
      show(els.saveState, 'Saving…');
      break;
    case 'saved':
      // A save's notices (message) stay with its saved state; any other 'saved' (a load) clears them
      savedNotices = realSave && message ? [message] : [];
      if (realSave) saveCount++;
      if (SITE && realSave && getCurrentMeta()?.status === 'published') {
        // This edit is not live: a Live link (or a running live check) is out of date.
        setHeld(true);
        cancelLive();
        els.actionState.title = '';
        show(els.actionState, '');
      }
      showSaved('saved');
      if (SITE && realSave) watchBackup();
      break;
    case 'unsaved': show(els.saveState, 'Unsaved'); break;
    case 'conflict':
      show(els.saveState, 'Changed on disk: see Settings', 'error');
      setSettingsHidden(false, false); // the conflict notice lives in the settings panel
      shell.inspectorOpen = false; // with the settings, not the block tree
      break;
    default: show(els.saveState, message || 'Not saved', 'error');
  }
}

/** Show `Saved` / `Backed up` (with `· not live yet`, in the warning tone, for a published post's held edits). */
function showSaved(outcome) {
  savedShown = outcome;
  const meta = getCurrentMeta();
  const pill = savePill(outcome, meta, held, savedNotices);
  show(els.saveState, pill.text, pill.tone === 'warn' ? 'warn' : '');
  els.saveState.title = [
    pill.tone === 'warn' ? 'Backed up to GitHub; click Update to put these edits on the live site' : '',
    ...savedNotices,
  ].filter(Boolean).join('\n');
}

/** Poll GET /status until the save at `now` is backed up (or we know it won't be). */
function watchBackup() {
  backup.savedAt = Date.now();
  if (backup.timer) return; // already polling: it now waits for this save
  const tick = async () => {
    backup.timer = null;
    let status;
    try {
      status = await api.getStatus();
    } catch {
      status = null; // the app is busy or restarting: try again
    }
    if (lastStatus !== 'saved') return; // typing again, or an error: the next save polls again
    const outcome = status ? backupOutcome(status, backup.savedAt) : 'waiting';
    if (outcome === 'backed-up') return showSaved('backed-up');
    if (outcome === 'not-connected') return show(els.saveState, 'Not connected to GitHub');
    // An error may be from an earlier push: show it, but keep waiting for a newer push.
    if (outcome === 'error') show(els.saveState, `Saved, but not backed up: ${status.error}`, 'error');
    if (keepPollingBackup(outcome) && Date.now() - backup.savedAt < BACKUP_POLL_FOR_MS) {
      backup.timer = setTimeout(tick, BACKUP_POLL_MS);
    }
  };
  backup.timer = setTimeout(tick, BACKUP_POLL_MS);
}

function cancelLive() {
  clearTimeout(liveTimer);
  liveTimer = null;
  live.cancel();
}

function stopPolling() {
  clearTimeout(backup.timer);
  backup.timer = null;
  cancelLive();
}

// --- Publish / Unpublish ---

/**
 * The current document's meta changed (loaded, saved, published): label the button and the menu.
 * @param {Object} meta
 */
export function onMetaUpdate(meta) {
  if (!els || !meta) return;
  if (live.docOpened(getCurrentDocId())) {
    // Another post is open: a live poll (and its result) belonged to the last one.
    clearTimeout(liveTimer);
    liveTimer = null;
    setHeld(false);
    for (const el of [els.actionState, els.saveState]) el.title = '';
    show(els.actionState, '');
    if (savedShown) showSaved(savedShown);
    if (SITE) loadHeld(getCurrentDocId());
  }
  els.primary.textContent = primaryAction(meta).text;
  refreshMenu(meta);
  showPaneTheme(meta);
}

/** Ask the server whether the opened post has saved edits that are not live yet (survives a reload). */
async function loadHeld(docId) {
  const meta = getCurrentMeta();
  if (!docId || meta?.status !== 'published') return;
  let state = null;
  try { state = await api.getDocumentState(docId); } catch { return; }
  if (getCurrentDocId() !== docId || !heldOnLoad(getCurrentMeta(), state)) return;
  setHeld(true);
  if (lastStatus === 'saved') showSaved(savedShown || 'saved');
}

/** The open post's edits are on the live site now (or committed for it): drop `· not live yet`. */
function editsApplied() {
  setHeld(false);
  if (savedShown && lastStatus === 'saved') showSaved(savedShown);
}

/**
 * Publish, Update or Unpublish the open post.
 * @param {'publish'|'update'|'unpublish'} action
 */
async function runAction(action) {
  if (busy) return;
  busy = true;
  els.primary.disabled = true;
  clearReport();
  cancelLive();
  try {
    // Save first (creates a new post; stops on a conflict or a rejected save)
    if (!(await saveDocument())) {
      const what = { publish: 'published', update: 'updated', unpublish: 'unpublished' }[action];
      show(els.actionState, `Not ${what}: the post is not saved`, 'error');
      return;
    }
    const docId = getCurrentDocId();
    const savesAtAction = saveCount;
    show(els.actionState, actionPendingText(action));
    let result;
    try {
      const call = { publish: api.publishDocument, update: api.updatePost, unpublish: api.unpublishDocument }[action];
      result = await call.call(api, docId);
    } catch (err) {
      return await showPublishError(err, action, docId, savesAtAction);
    }
    const after = afterAction(savesAtAction, saveCount);
    if (after.clearHeld) editsApplied();
    // The server changed status (and published date): load it back
    await loadDocument(docId);
    document.querySelector('doc-browser')?.refresh();

    if (result.status === 'saved') return show(els.actionState, 'Saved (not connected to GitHub)');
    if (action === 'unpublish') return show(els.actionState, 'Unpublished', 'done');
    if (!result.url) {
      const done = action === 'update' ? 'Updated' : 'Published';
      return show(els.actionState, `${done} and pushed (set siteUrl to check when it is live)`, 'done');
    }
    if (!after.watchLive) {
      // An edit saved while this ran is not in it: Live would be wrong for what you see.
      return show(els.actionState, `${action === 'update' ? 'Updated' : 'Published'}; your newest edits are not live yet: click Update`);
    }
    watchLive(docId, result.url, actionPendingText(action));
  } finally {
    busy = false;
    els.primary.disabled = false;
  }
}

/**
 * Show a failed publish/update/unpublish. When only the push failed, the
 * change is already applied (committed) on this computer: reload the post so
 * the buttons and settings match what is stored. Never starts the live poll.
 * @param {Error & { status?: number, data?: Object }} err
 * @param {'publish'|'update'|'unpublish'} action
 * @param {string} docId
 * @param {number} savesAtAction - the real-save count when the action started
 */
async function showPublishError(err, action, docId, savesAtAction) {
  const failure = publishFailure(err, action);
  if (failure.reload) {
    if (afterAction(savesAtAction, saveCount).clearHeld) editsApplied();
    await loadDocument(docId);
    document.querySelector('doc-browser')?.refresh();
  }
  show(els.actionState, failure.message, 'error');
  if (failure.log !== undefined) {
    showReport(action === 'update'
      ? 'Build failed. Nothing was pushed, and the live site still has the previous version.'
      : "Build failed. Nothing was pushed, and the post's status is unchanged.", { log: failure.log });
  } else if (failure.files) {
    showReport(`${failure.message.replace(/\.$/, '')}. Conflicting files:`, { files: failure.files });
  }
}

/**
 * Poll the live check every 10 s for up to 300 s, showing the result in the
 * action slot (`pendingText` until then). Opening another post, or saving an
 * edit to this one, cancels it.
 */
function watchLive(docId, url, pendingText) {
  const token = live.start(docId);
  const el = els.actionState;
  const started = Date.now();
  show(el, pendingText);
  el.title = 'Pushed to GitHub; waiting for the site to update';
  const tick = async () => {
    liveTimer = null;
    if (!live.current(token)) return;
    try {
      const res = await api.getLive(docId);
      if (!live.current(token)) return;
      if (res.live) {
        el.title = '';
        return showLink(el, 'Live', res.url || url);
      }
      if (!res.url && !url) {
        el.title = '';
        return show(el, 'Pushed (set siteUrl to check when it is live)');
      }
    } catch { /* try again */ }
    if (Date.now() - started >= LIVE_POLL_FOR_MS) {
      el.title = '';
      return show(el, 'Still deploying, check Cloudflare');
    }
    liveTimer = setTimeout(tick, LIVE_POLL_MS);
  };
  tick();
}

// --- Primary button and the "⋯" menu ---

/**
 * Before Publish or Update: when an image in the post has no alt text (and
 * its file is not marked decorative), ask. Without the media list, go ahead.
 * Used by the header's primary button and by `vp serve`'s panel Publish.
 * @param {'publish'|'update'} action
 * @param {HTMLElement} [returnFocus] - focused on Cancel (the header's primary button by default)
 * @returns {Promise<boolean>} whether to go on
 */
export async function altCheckPasses(action, returnFocus) {
  const doc = getEditorDoc();
  const confirm = els?.confirm || document.querySelector('confirm-panel[data-confirm]');
  if (!doc || !confirm) return true;
  let library;
  try {
    library = await api.listMedia();
  } catch {
    return true;
  }
  // A non-array answer counts as no list (altWarnings gives none): never a false warning
  const warnings = altWarnings(toBlockAst(doc), library);
  if (!warnings.length) return true;
  const go = await confirm.ask(altWarningText(warnings, action));
  if (!go) (returnFocus || els?.primary)?.focus();
  return go;
}

let checking = false;

/** The header's primary button: Publish or Update in the app; in vp serve the meta panel's publish toggle (or a plain save for a published post). */
async function onPrimary() {
  if (busy || checking) return;
  const { action } = primaryAction(getCurrentMeta());
  checking = true;
  let go;
  try { go = await altCheckPasses(action); } finally { checking = false; }
  if (!go) return;
  if (SITE) return runAction(action);
  // Already checked: the panel's toggle must not ask again
  if (action === 'publish') return document.querySelector('meta-panel')?.togglePublish({ altChecked: true });
  return saveDocument(); // a published post's edits already sync when saved
}

/**
 * A "⋯" menu item was chosen.
 * @param {'export'|'ast'|'live'|'delete'|'unpublish'} id
 */
async function onMore(id) {
  const meta = getCurrentMeta();
  switch (id) {
    case 'export': return exportDocument();
    case 'ast':
      // The block tree takes the panel's place. A hidden panel opens (not
      // remembered) on the tree, even if the tree was left open in it; a
      // shown panel switches between the tree and the settings.
      if (shell.classList.contains('settings-hidden')) {
        setSettingsHidden(false, false);
        return shell.toggleInspector(true);
      }
      return shell.toggleInspector();
    case 'live': {
      await siteInfoLoaded;
      const url = liveUrl(meta);
      if (url) window.open(url, '_blank', 'noopener');
      return;
    }
    case 'unpublish':
      // The confirmation names the live URL, which needs the site's address
      await siteInfoLoaded;
      if (await els.confirm.ask(confirmText('unpublish', { title: meta.title || 'Untitled', liveUrl: liveUrl(meta) }))) runAction('unpublish');
      return;
    case 'delete':
      if (await els.confirm.ask(confirmText('delete', { title: meta.title || 'Untitled', liveUrl: null }))) deleteCurrent();
      return;
    default:
  }
}

/** Delete the open post (the server refuses a published one: its text is shown), then leave the editor. */
async function deleteCurrent() {
  const docId = getCurrentDocId();
  if (!docId || docId === 'doc_new') return show(els.actionState, 'This post is not saved yet', 'error');
  clearReport();
  try {
    await deleteDoc(docId);
  } catch (err) {
    return show(els.actionState, err.message, 'error');
  }
  if (SITE) {
    window.location.href = els.back.href;
    return;
  }
  document.querySelector('doc-browser')?.refresh();
  show(els.actionState, 'Deleted', 'done');
}

// --- Preview ---

async function preview() {
  clearReport();
  // Open the tab now (still inside the click, so it is not blocked as a
  // popup), then point it at the page once we know the URL.
  const tab = window.open('about:blank', '_blank');
  const fail = (text) => {
    tab?.close();
    show(els.actionState, text, 'error');
  };
  if (!(await saveDocument())) return fail('Preview needs the post saved first');
  const meta = getCurrentMeta();
  if (meta.status !== 'published') return fail('Preview shows published pages: publish first');
  show(els.actionState, 'Starting preview…');
  let url;
  try {
    ({ url } = await api.startPreview());
  } catch (err) {
    return fail(err.message);
  }
  const pageUrl = `${url.replace(/\/+$/, '')}${postUrlPath({ meta }, collections)}`;
  show(els.actionState, '');
  if (tab) tab.location.href = pageUrl;
  else window.open(pageUrl, '_blank');
}
