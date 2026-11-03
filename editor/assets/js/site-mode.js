/**
 * The app's editor (`/editor/?site=<id>#doc-<docId>`): a quiet writing
 * screen for one site.
 *
 * - The header shows `← Posts`, the save state, Preview and Publish/Unpublish.
 * - The doc browser, theme picker, block inspector and Export live behind
 *   Tools (closed by default); the settings panel can be hidden, which is
 *   remembered in localStorage.
 * - Save states: `Saving…`, `Saved`, then `Backed up` once the draft backup
 *   has pushed (GET /status).
 * - Publish saves, then POSTs publish (build, commit, push) and polls the
 *   live check until the page is up.
 *
 * Without `?site=` nothing here runs: every export is a no-op.
 *
 * @module editor/site-mode
 */

import { SITE, backupOutcome } from './site-context.js';
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
const live = { timer: null, token: 0 };

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
    statusSelect.title = 'Use Publish / Unpublish in the header';
  }

  els.tools.addEventListener('click', () => setToolsOpen(!shell.classList.contains('tools-open')));
  els.settings.addEventListener('click', () => setSettingsHidden(!shell.classList.contains('settings-hidden'), true));
  els.preview.addEventListener('click', preview);
  els.publish.addEventListener('click', togglePublish);
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

/** Show `text` in the action slot with a link to `url`. */
function showLink(text, url) {
  els.actionState.className = 'action-state done';
  els.actionState.replaceChildren(`${text} `);
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = url;
  els.actionState.append(a);
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
  switch (status) {
    case 'saving': show(els.saveState, 'Saving…'); break;
    case 'saved':
      show(els.saveState, 'Saved');
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
    if (outcome === 'backed-up') return show(els.saveState, 'Backed up', 'done');
    if (outcome === 'not-connected') return show(els.saveState, 'Not connected to GitHub');
    if (outcome === 'error') return show(els.saveState, `Saved, but not backed up: ${status.error}`, 'error');
    if (Date.now() - backup.savedAt < BACKUP_POLL_FOR_MS) backup.timer = setTimeout(tick, BACKUP_POLL_MS);
  };
  backup.timer = setTimeout(tick, BACKUP_POLL_MS);
}

function stopPolling() {
  clearTimeout(backup.timer);
  backup.timer = null;
  clearTimeout(live.timer);
  live.timer = null;
  live.token++;
}

// --- Publish / Unpublish ---

/**
 * The current document's meta changed (loaded, saved, published): label the button.
 * @param {Object} meta
 */
export function onMetaUpdate(meta) {
  if (!els || !meta) return;
  const published = meta.status === 'published';
  els.publish.textContent = published ? 'Unpublish' : 'Publish';
  els.publish.className = published ? 'btn-unpublish' : 'btn-publish';
}

async function togglePublish() {
  if (busy) return;
  busy = true;
  els.publish.disabled = true;
  clearReport();
  clearTimeout(live.timer);
  live.token++;
  try {
    // Save first (creates a new post; stops on a conflict or a rejected save)
    if (!(await saveDocument())) {
      show(els.actionState, 'Not published: the post is not saved', 'error');
      return;
    }
    const docId = getCurrentDocId();
    const unpublish = getCurrentMeta().status === 'published';
    show(els.actionState, unpublish ? 'Unpublishing…' : 'Publishing…');
    let result;
    try {
      result = unpublish ? await api.unpublishDocument(docId) : await api.publishDocument(docId);
    } catch (err) {
      return showPublishError(err);
    }
    // The server changed status (and published date): load it back
    await loadDocument(docId);
    document.querySelector('doc-browser')?.refresh();

    if (result.status === 'saved') return show(els.actionState, 'Saved (not connected to GitHub)');
    if (unpublish) return show(els.actionState, 'Unpublished', 'done');
    if (!result.url) return show(els.actionState, 'Published and pushed (set siteUrl to check when it is live)', 'done');
    watchLive(docId, result.url);
  } finally {
    busy = false;
    els.publish.disabled = false;
  }
}

/** @param {Error & { status?: number, data?: Object }} err */
function showPublishError(err) {
  const data = err.data || {};
  if (err.status === 422 && data.log !== undefined) {
    show(els.actionState, 'Build failed', 'error');
    showReport("Build failed. Nothing was pushed, and the post's status is unchanged.", { log: data.log });
  } else if (err.status === 409) {
    const message = "Couldn't push: GitHub has changes that conflict with yours";
    show(els.actionState, message, 'error');
    showReport(`${message}. Conflicting files:`, { files: data.files || [] });
  } else {
    show(els.actionState, err.message || 'Publish failed', 'error');
  }
}

/** Poll the live check every 10 s for up to 300 s. */
function watchLive(docId, url) {
  const token = ++live.token;
  const started = Date.now();
  show(els.actionState, 'Publishing…');
  els.actionState.title = 'Pushed to GitHub; waiting for the site to update';
  const tick = async () => {
    live.timer = null;
    if (token !== live.token) return;
    try {
      const res = await api.getLive(docId);
      if (token !== live.token) return;
      if (res.live) {
        els.actionState.title = '';
        return showLink('Live', res.url || url);
      }
    } catch { /* try again */ }
    if (Date.now() - started >= LIVE_POLL_FOR_MS) {
      els.actionState.title = '';
      return show(els.actionState, 'Still deploying, check Cloudflare');
    }
    live.timer = setTimeout(tick, LIVE_POLL_MS);
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
