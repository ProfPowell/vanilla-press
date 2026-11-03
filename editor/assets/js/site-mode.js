/**
 * The app's editor (`/editor/?site=<id>#doc-<docId>`): a quiet writing
 * screen for one site.
 *
 * - The header shows `← Posts`, the save state, Preview and Publish (a
 *   draft) or Unpublish plus Update (a published post).
 * - The doc browser, theme picker, block inspector and Export live behind
 *   Tools (closed by default); the settings panel can be hidden, which is
 *   remembered in localStorage.
 * - Save states: `Saving…`, `Saved`, then `Backed up` once the backup has
 *   pushed (GET /status). A backup never changes the live site: after a save
 *   of a published post it says `Saved · not live yet` / `Backed up · not
 *   live yet`, and any `Live` link is cleared, until Update.
 * - Publish / Update save, then POST publish / update (build, commit, push)
 *   and poll the live check until the page is up.
 *
 * Without `?site=` nothing here runs: every export is a no-op.
 *
 * @module editor/site-mode
 */

import {
  SITE, backupOutcome, publishFailure, keepPollingBackup, createLiveTracker,
  saveStateText, headerActions, actionPendingText,
} from './site-context.js';
import { api } from './api-client.js';
import { postUrlPath } from '../../../src/sync/paths.js';
import { getCurrentMeta, getCurrentDocId } from './meta-state.js';
import { saveDocument, loadDocument } from './editor.js';

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
/** What the save slot shows once saved: 'saved' or 'backed-up' (null: something else). */
let savedShown = null;

/** Whether the editor runs in the app for one site. */
export const isSiteMode = Boolean(SITE);

/**
 * Wire the header and layout. Call once, after the editor view exists.
 */
export function initSiteMode() {
  if (!SITE) return;
  shell = document.querySelector('editor-shell');
  const header = shell?.querySelector('[data-site-header]');
  if (!header) return;
  els = {
    header,
    back: header.querySelector('[data-back-to-posts]'),
    saveState: header.querySelector('[data-save-state]'),
    actionState: header.querySelector('[data-action-state]'),
    tools: header.querySelector('[data-tools-toggle]'),
    settings: header.querySelector('[data-settings-toggle]'),
    preview: header.querySelector('[data-site-preview]'),
    publish: header.querySelector('[data-site-publish]'),
    update: header.querySelector('[data-site-update]'),
    report: header.querySelector('[data-action-report]'),
    reportBody: header.querySelector('[data-action-report-body]'),
  };

  shell.classList.add('site-mode');
  header.hidden = false;
  els.back.href = `/app/site.html?site=${encodeURIComponent(SITE)}`;

  // Status is set by Publish/Unpublish, not by hand (that would skip the build and push)
  const statusSelect = document.querySelector('#meta-status');
  if (statusSelect) {
    statusSelect.disabled = true;
    statusSelect.title = 'Use Publish / Unpublish / Update in the header';
  }

  els.tools.addEventListener('click', () => setToolsOpen(!shell.classList.contains('tools-open')));
  els.settings.addEventListener('click', () => setSettingsHidden(!shell.classList.contains('settings-hidden'), true));
  els.preview.addEventListener('click', preview);
  els.publish.addEventListener('click', () => runAction(headerActions(getCurrentMeta()).publish.action));
  els.update.addEventListener('click', () => runAction('update'));
  header.querySelector('[data-action-report-close]').addEventListener('click', clearReport);

  setSettingsHidden(readSettingsHidden(), false);
  setToolsOpen(false);
  onMetaUpdate(getCurrentMeta());

  window.addEventListener('pagehide', stopPolling);
}

// --- Layout ---

function setToolsOpen(open) {
  shell.classList.toggle('tools-open', open);
  if (!open) shell.classList.remove('inspector-open');
  els.tools.setAttribute('aria-expanded', String(open));
  updateSidebar();
}

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
  updateSidebar();
}

function readSettingsHidden() {
  try { return localStorage.getItem(SETTINGS_KEY) === '1'; } catch { return false; }
}

function updateSidebar() {
  const hidden = shell.classList.contains('settings-hidden') && !shell.classList.contains('tools-open');
  shell.classList.toggle('sidebar-hidden', hidden);
}

// --- Header text ---

/** Set the save slot or the action slot (Publish, Preview) to `text`; kind: '' | 'done' | 'error'. */
function show(el, text, kind = '') {
  el.textContent = text;
  el.className = [el === els.saveState ? 'save-state' : 'action-state', kind].filter(Boolean).join(' ');
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
      if (realSave && getCurrentMeta()?.status === 'published') {
        // This edit is not live: a Live link (or a running live check) is out of date.
        held = true;
        cancelLive();
        els.actionState.title = '';
        show(els.actionState, '');
      }
      showSaved('saved');
      if (realSave) watchBackup();
      break;
    case 'unsaved': show(els.saveState, 'Unsaved'); break;
    case 'conflict':
      show(els.saveState, 'Changed on disk: see Settings', 'error');
      setSettingsHidden(false, false); // the conflict notice lives in the settings panel
      break;
    default: show(els.saveState, message || 'Not saved', 'error');
  }
}

/** Show `Saved` / `Backed up` (with `· not live yet` for a published post's held edits). */
function showSaved(outcome) {
  savedShown = outcome;
  const published = getCurrentMeta()?.status === 'published';
  const text = saveStateText(outcome, { published, held });
  show(els.saveState, text, outcome === 'backed-up' ? 'done' : '');
  els.saveState.title = published && held ? 'Backed up to GitHub; click Update to put these edits on the live site' : '';
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
 * The current document's meta changed (loaded, saved, published): label the button.
 * @param {Object} meta
 */
export function onMetaUpdate(meta) {
  if (!els || !meta) return;
  if (live.docOpened(getCurrentDocId())) {
    // Another post is open: a live poll (and its result) belonged to the last one.
    clearTimeout(liveTimer);
    liveTimer = null;
    held = false;
    for (const el of [els.actionState, els.saveState]) el.title = '';
    show(els.actionState, '');
    if (savedShown) showSaved(savedShown);
  }
  const actions = headerActions(meta);
  els.publish.textContent = actions.publish.text;
  els.publish.className = actions.publish.className;
  els.update.hidden = !actions.update;
}

/** The open post's edits are on the live site now (or committed for it): drop `· not live yet`. */
function editsApplied() {
  held = false;
  if (savedShown && lastStatus === 'saved') showSaved(savedShown);
}

/**
 * Publish, Update or Unpublish the open post.
 * @param {'publish'|'update'|'unpublish'} action
 */
async function runAction(action) {
  if (busy) return;
  busy = true;
  els.publish.disabled = true;
  els.update.disabled = true;
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
    show(els.actionState, actionPendingText(action));
    let result;
    try {
      const call = { publish: api.publishDocument, update: api.updateDocument, unpublish: api.unpublishDocument }[action];
      result = await call.call(api, docId);
    } catch (err) {
      return await showPublishError(err, action, docId);
    }
    editsApplied();
    // The server changed status (and published date): load it back
    await loadDocument(docId);
    document.querySelector('doc-browser')?.refresh();

    if (result.status === 'saved') return show(els.actionState, 'Saved (not connected to GitHub)');
    if (action === 'unpublish') return show(els.actionState, 'Unpublished', 'done');
    if (!result.url) {
      const done = action === 'update' ? 'Updated' : 'Published';
      return show(els.actionState, `${done} and pushed (set siteUrl to check when it is live)`, 'done');
    }
    watchLive(docId, result.url, actionPendingText(action));
  } finally {
    busy = false;
    els.publish.disabled = false;
    els.update.disabled = false;
  }
}

/**
 * Show a failed publish/update/unpublish. When only the push failed, the
 * change is already applied (committed) on this computer: reload the post so
 * the buttons and settings match what is stored. Never starts the live poll.
 * @param {Error & { status?: number, data?: Object }} err
 * @param {'publish'|'update'|'unpublish'} action
 * @param {string} docId
 */
async function showPublishError(err, action, docId) {
  const failure = publishFailure(err, action);
  if (failure.reload) {
    editsApplied();
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
  let collections = {};
  try {
    const { value } = await api.getConfig('collections');
    collections = value ? JSON.parse(value) : {};
  } catch { /* defaults */ }
  const pageUrl = `${url.replace(/\/+$/, '')}${postUrlPath({ meta }, collections)}`;
  show(els.actionState, '');
  if (tab) tab.location.href = pageUrl;
  else window.open(pageUrl, '_blank');
}
