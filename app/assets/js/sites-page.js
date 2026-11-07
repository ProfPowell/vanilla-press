import { api, h } from './app-api.js';
import { countPosts, syncText, backupText } from './sites-view.js';

const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const listEl = $('sites');
$('local-address').textContent = location.host;

function showError(el, message) {
  el.textContent = message || '';
  el.hidden = !message;
}

const ARROW = '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7"></path><path d="M8 7h9v9"></path></svg>';

function strong(n) {
  return h('strong', {}, String(n));
}

async function fillCounts(site, el) {
  try {
    const docs = await api(`/api/sites/${encodeURIComponent(site.id)}/documents`);
    const { published, drafts } = countPosts(docs);
    el.replaceChildren(strong(published), ' published', h('span', { class: 'sep', 'aria-hidden': 'true' }, ' · '), strong(drafts), drafts === 1 ? ' draft' : ' drafts');
  } catch (err) {
    el.textContent = `Cannot read posts: ${err.message}`;
  }
}

function card(site) {
  const counts = h('span', {}, 'Loading posts...');
  fillCounts(site, counts);
  const sync = syncText(site.git);
  const live = site.siteUrl ? h('a', { class: 'btn-quiet', href: site.siteUrl, target: '_blank', rel: 'noopener' }, 'View live') : null;
  if (live) live.insertAdjacentHTML('beforeend', ARROW);
  const href = `/app/site.html?site=${encodeURIComponent(site.id)}`;
  return h('li', {},
    h('article', { class: 'site-card' },
      h('div', { class: 'site-card-main' },
        h('h2', {}, h('a', { href }, site.name)),
        h('p', { class: 'site-path' }, site.path),
        h('p', { class: 'site-meta' },
          counts,
          h('span', { class: 'sync', 'data-tone': sync.tone }, h('span', { class: 'dot', 'aria-hidden': 'true' }), sync.text),
          h('span', {}, backupText(site.git?.lastBackupAt ?? null, new Date())))),
      h('div', { class: 'site-card-actions' },
        live,
        h('a', { class: 'btn', href }, 'Open'))));
}

async function loadSites() {
  try {
    const sites = await api('/api/sites');
    listEl.replaceChildren(...sites.map(card));
    statusEl.textContent = sites.length ? '' : 'No sites yet. Add a Cook site folder or clone one from GitHub.';
  } catch (err) {
    statusEl.textContent = err.message;
  }
}

function togglePanel(button, panel, open) {
  panel.hidden = !open;
  button.setAttribute('aria-expanded', String(open));
}

// --- Add site + folder browser ---
const addPanel = $('add-panel');
const clonePanel = $('clone-panel');
const pathInput = $('add-path');
const addError = $('add-error');
let browseParent = null;

async function browse(path) {
  try {
    const data = await api(`/api/folders${path ? `?path=${encodeURIComponent(path)}` : ''}`);
    showError(addError, '');
    browseParent = data.parent;
    $('browse-current').textContent = data.path;
    $('browse-up').disabled = !data.parent;
    pathInput.value = data.path;
    $('browse-list').replaceChildren(...data.folders.map((f) => h('li', {},
      h('button', { type: 'button', 'data-path': f.path },
        h('span', {}, f.name),
        f.isSite ? h('span', { class: 'badge' }, 'Cook site') : null))));
  } catch (err) {
    showError(addError, err.message);
  }
}

$('browse-list').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-path]');
  if (btn) browse(btn.dataset.path);
});
$('browse-up').addEventListener('click', () => { if (browseParent) browse(browseParent); });

$('add-btn').addEventListener('click', () => {
  const open = addPanel.hidden;
  togglePanel($('add-btn'), addPanel, open);
  togglePanel($('clone-btn'), clonePanel, false);
  if (open) { browse(''); pathInput.focus(); }
});

$('clone-btn').addEventListener('click', () => {
  const open = clonePanel.hidden;
  togglePanel($('clone-btn'), clonePanel, open);
  togglePanel($('add-btn'), addPanel, false);
  if (open) $('clone-url').focus();
});

$('add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/sites', { method: 'POST', body: { path: pathInput.value.trim() } });
    showError(addError, '');
    togglePanel($('add-btn'), addPanel, false);
    await loadSites();
  } catch (err) {
    showError(addError, err.message);
  }
});

$('clone-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const cloneError = $('clone-error');
  const submit = e.target.querySelector('button[type="submit"]');
  submit.disabled = true;
  showError(cloneError, '');
  statusEl.textContent = 'Cloning...';
  try {
    await api('/api/sites/clone', { method: 'POST', body: { url: $('clone-url').value.trim(), dest: $('clone-dest').value.trim() } });
    togglePanel($('clone-btn'), clonePanel, false);
    await loadSites();
  } catch (err) {
    statusEl.textContent = '';
    showError(cloneError, err.message);
  } finally {
    submit.disabled = false;
  }
});

loadSites();
