import { api, h } from './app-api.js';

const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const listEl = $('sites');

function showError(el, message) {
  el.textContent = message || '';
  el.hidden = !message;
}

function gitText(git) {
  return git?.connected ? `Connected to GitHub (${git.branch})` : 'Not connected to GitHub';
}

async function postCounts(site) {
  try {
    const docs = await api(`/api/sites/${encodeURIComponent(site.id)}/documents`);
    const drafts = docs.filter((d) => d.meta?.status === 'draft').length;
    const published = docs.filter((d) => d.meta?.status === 'published').length;
    return `${drafts} ${drafts === 1 ? 'draft' : 'drafts'}, ${published} published`;
  } catch (err) {
    return `Cannot read posts: ${err.message}`;
  }
}

function card(site) {
  const counts = h('p', { class: 'muted' }, 'Loading posts...');
  postCounts(site).then((text) => { counts.textContent = text; });
  const link = h('a', { href: `/app/site.html?site=${encodeURIComponent(site.id)}` }, site.name);
  return h('li', {},
    h('h2', {}, link),
    h('p', { class: 'muted' }, site.path),
    counts,
    h('p', { class: 'muted' }, gitText(site.git)));
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
