import { api, h, listComponents, setComponent } from './app-api.js';
import { filterPosts, filterCounts, rowModel, emptyText } from './posts-view.js';
import { packageRows, toggleOutcome } from './components-view.js';
import { SECTIONS, LATER, sectionFromSearch, sectionHref } from './site-nav.js';
import { syncText, backupText } from './sites-view.js';
import { loadComponent, createComponentElement, setComponentValue } from '/editor/assets/js/component-loader.js';

const $ = (id) => document.getElementById(id);
const siteId = new URLSearchParams(location.search).get('site');
const base = `/api/sites/${encodeURIComponent(siteId || '')}`;

function showError(message) {
  $('error').textContent = message || '';
  $('error').hidden = !message;
}

const editorUrl = (docId) => `/editor/?site=${encodeURIComponent(siteId)}#doc-${encodeURIComponent(docId)}`;

let allDocs = [];
const view = { filter: 'all', query: '' };

function postRow(doc) {
  const m = rowModel(doc);
  return h('li', {},
    h('a', { href: editorUrl(doc.id) },
      h('span', { class: 'post-main' },
        h('span', { class: 'post-title' }, m.title),
        h('span', { class: m.descriptionMissing ? 'post-desc missing' : 'post-desc' }, m.description),
        h('span', { class: 'post-path' }, m.path)),
      h('span', { class: 'post-side' },
        h('span', { class: 'post-status', 'data-state': m.statusText.toLowerCase() },
          h('span', { class: 'dot', 'aria-hidden': 'true' }), m.statusText),
        h('span', { class: 'date' }, m.date))));
}

function renderPosts() {
  const counts = filterCounts(allDocs);
  for (const btn of document.querySelectorAll('#post-filters button')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.filter === view.filter));
    btn.querySelector('.count').textContent = counts[btn.dataset.filter];
  }
  const shown = filterPosts(allDocs, view);
  $('posts').replaceChildren(...shown.map(postRow));
  $('empty').textContent = emptyText(view.filter, view.query);
  $('empty').hidden = shown.length > 0;
}

$('post-filters').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-filter]');
  if (!btn) return;
  view.filter = btn.dataset.filter;
  renderPosts();
});
$('post-search').addEventListener('input', (e) => {
  view.query = e.target.value;
  renderPosts();
});

async function loadPosts() {
  try {
    allDocs = await api(`${base}/documents`);
    renderPosts();
    showError('');
  } catch (err) {
    showError(err.message);
  }
}

$('preview-btn').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const out = $('preview-error');
  out.hidden = true;
  btn.disabled = true;
  btn.textContent = 'Starting preview\u2026';
  // Open the tab inside the click so it is not blocked as a popup, then point it at the preview.
  const tab = window.open('about:blank', '_blank');
  try {
    const { url } = await api(`${base}/preview`, { method: 'POST' });
    if (tab) tab.location.href = url;
    else window.open(url, '_blank');
  } catch (err) {
    tab?.close();
    out.textContent = `${err.message.trim()}\nTo check the site yourself, run "npm run dev" in the site folder.`;
    out.hidden = false;
  }
  btn.disabled = false;
  btn.textContent = 'Preview site';
});

async function loadSite() {
  try {
    const sites = await api('/api/sites');
    const site = sites.find((s) => s.id === siteId);
    if (!site) throw new Error('Unknown site');
    $('site-name').textContent = site.name;
    document.title = `${site.name} - Vanilla Press`;
    if (site.siteUrl) {
      $('view-site').href = site.siteUrl;
      $('view-site').hidden = false;
    }
    const sync = syncText(site.git);
    $('rail-sync').dataset.tone = sync.tone;
    $('rail-sync-text').textContent = sync.text;
    lastBackupAt = site.git?.lastBackupAt || null;
    $('backup-status').textContent = backupText(lastBackupAt, new Date());
  } catch (err) {
    $('site-name').textContent = 'Site not found';
    showError(err.message);
    return false;
  }
  return true;
}

let lastBackupAt = null;

async function loadBackupStatus() {
  const el = $('backup-status');
  try {
    const s = await api(`${base}/status`);
    if (s.error) el.textContent = `Backup problem: ${s.error}`;
    else if (s.lastPushAt) el.textContent = backupText(s.lastPushAt, new Date());
    else if (s.pending) el.textContent = 'Backup pending';
    else el.textContent = backupText(lastBackupAt, new Date());
  } catch (err) {
    el.textContent = err.message;
  }
}

$('new-post').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    const stamp = Date.now().toString(36);
    const doc = await api(`${base}/documents`, {
      method: 'POST',
      body: {
        meta: { title: '', slug: `untitled-${stamp}`, collection: 'posts', status: 'draft' },
        blocks: [{ type: 'paragraph', children: [] }],
      },
    });
    location.href = editorUrl(doc.id);
  } catch (err) {
    showError(err.message);
    btn.disabled = false;
  }
});

// Components section.
let componentState = null;
let busy = false;

/** Show a refused toggle: its text, the posts in the way, or npm's output (all as text). */
function setComponentsError(text, posts, log) {
  const el = $('components-error');
  el.replaceChildren();
  if (text) el.append(text);
  if (posts?.length) {
    el.append(h('ul', {}, ...posts.map((p) =>
      h('li', {}, h('a', { href: editorUrl(p.id) }, p.title || 'Untitled'), ` (${p.status})`))));
  }
  if (log) el.append(h('details', { class: 'npm-log' }, h('summary', {}, "npm's output"), h('pre', {}, log)));
  el.hidden = !text;
}

// "Try it": each element live with its catalog defaults. The package's
// script loads only when the disclosure opens (Vanilla Breeze's own elements
// are already live: this page loads its bundle).
const tryOpen = new Set();

const SAMPLE = {
  text: (e) => `${e.label}: sample text`,
  code: () => "console.log('Hello, world');",
  inline: () => 'Sample text',
};

function tryItem(e) {
  const stage = h('div', { class: 'try-stage' }, h('span', { class: 'muted' }, 'Loading\u2026'));
  loadComponent(e).then((result) => {
    if (result !== 'ready') {
      stage.replaceChildren(h('span', { class: 'muted' }, `${e.label} couldn't load`));
      return;
    }
    const live = createComponentElement(e.tag, e.defaults || {});
    if (e.kind === 'blocks') live.append(h('p', {}, 'Sample content.'));
    else if (SAMPLE[e.kind]) setComponentValue(live, SAMPLE[e.kind](e), e.kind === 'code' ? e.codeWrap : 'text');
    stage.replaceChildren(live);
  });
  return h('div', { class: 'try-item' }, h('p', { class: 'try-label' }, e.label), stage);
}

function tryIt(pkg) {
  const details = h('details', { class: 'component-try', open: tryOpen.has(pkg.package) },
    h('summary', {}, 'Try it'));
  const fill = () => {
    if (details.dataset.filled) return;
    details.dataset.filled = '1';
    details.append(...(pkg.elements || []).map(tryItem));
  };
  details.addEventListener('toggle', () => {
    if (details.open) { tryOpen.add(pkg.package); fill(); } else tryOpen.delete(pkg.package);
  });
  if (details.open) fill();
  return details;
}

function componentRow(pkg, row, working) {
  const id = `comp-${row.package.replace(/[^a-z0-9]/gi, '-')}`;
  const box = h('input', { type: 'checkbox', role: 'switch', id, 'data-package': row.package });
  box.checked = row.enabled;
  box.disabled = !row.canToggle || busy;
  const elements = (pkg.elements || []).map((e) =>
    h('li', {}, h('strong', {}, e.label), e.description ? ` ${e.description}` : ''));
  return h('li', { class: 'component' },
    h('div', { class: 'component-head' },
      h('label', { for: id }, h('span', { class: 'component-name' }, row.label)),
      box,
      h('span', { class: 'muted' }, row.version ? `v${row.version}` : ''),
      h('span', { class: 'muted', role: 'status' }, working || row.note)),
    h('ul', { class: 'component-elements' }, ...elements),
    tryIt(pkg));
}

function renderComponents(workingPkg, workingText) {
  const rows = packageRows(componentState.packages);
  $('components').replaceChildren(...rows.map((row, i) =>
    componentRow(componentState.packages[i], row, row.package === workingPkg ? workingText : '')));
  const n = $('components-notice');
  n.hidden = componentState.cookSupportsPackages !== false;
  n.textContent = n.hidden ? '' : "This site's Cook is older than 2.5.0, so turned-on components won't load on the live site yet. Update cook-ssg in the site to ^2.5.0.";
}

async function loadComponents() {
  try {
    componentState = await listComponents(siteId);
    setComponentsError('');
    renderComponents();
  } catch (err) {
    setComponentsError(err.message);
  }
}

$('components').addEventListener('change', async (e) => {
  const box = e.target.closest('input[data-package]');
  if (!box || busy) return;
  const pkg = box.dataset.package;
  const enabled = box.checked;
  busy = true;
  setComponentsError('');
  renderComponents(pkg, enabled ? 'Installing\u2026' : 'Removing\u2026');
  try {
    const { status, body } = await setComponent(siteId, pkg, enabled);
    const out = toggleOutcome(status, body);
    if (out.kind === 'ok') {
      componentState.packages = componentState.packages.map((p) => (p.package === pkg ? body : p));
    } else {
      setComponentsError(out.text, out.posts, out.log);
    }
  } catch (err) {
    setComponentsError(err.message);
  }
  busy = false;
  renderComponents();
});

// The rail: real links, so each section has an address; clicks swap the section in place.
const railLinks = [...document.querySelectorAll('#rail-sections a[data-section]')];
for (const a of railLinks) a.href = siteId ? sectionHref(siteId, a.dataset.section) : '#';
$('rail-later').replaceChildren(...LATER.map((name) => h('li', {}, name)));

function showSection(section) {
  for (const name of SECTIONS) $(`${name}-section`).hidden = name !== section;
  for (const a of railLinks) {
    if (a.dataset.section === section) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  if (section === 'components' && !componentState) loadComponents();
  if (section === 'media') startMedia();
  else mediaPage?.then((media) => media?.hide());
  if (section === 'theme') startTheme();
}

// Theme is set up on first view, only once (its draft lives until reload); every view refreshes it.
let themePage = null;
function startTheme() {
  themePage ||= import('./theme-page.js')
    .then((m) => m.initThemeSection({ siteId, root: $('theme-section') }))
    .catch((err) => showError(err.message));
  themePage.then((theme) => theme?.show());
}

// Media is set up on first view, only once; every view refreshes it and applies a ?file= deep link.
let mediaPage = null;
function startMedia() {
  mediaPage ||= import('./media-page.js')
    .then((m) => m.initMediaSection({ siteId, root: $('media-section') }))
    .catch((err) => showError(err.message));
  mediaPage.then((media) => media?.show());
}

$('rail-sections').addEventListener('click', (e) => {
  const a = e.target.closest('a[data-section]');
  if (!a || !siteId || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
  e.preventDefault();
  history.pushState(null, '', a.href);
  showSection(a.dataset.section);
});
window.addEventListener('popstate', () => showSection(sectionFromSearch(location.search)));

if (!siteId) {
  $('site-name').textContent = 'Site not found';
  showError('No site given. Go back to Sites and pick one.');
} else if (await loadSite()) {
  showSection(sectionFromSearch(location.search));
  loadPosts();
  loadBackupStatus();
}
