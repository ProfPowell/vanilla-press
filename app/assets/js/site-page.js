import { api, h, formatDate } from './app-api.js';

const $ = (id) => document.getElementById(id);
const siteId = new URLSearchParams(location.search).get('site');
const base = `/api/sites/${encodeURIComponent(siteId || '')}`;

function showError(message) {
  $('error').textContent = message || '';
  $('error').hidden = !message;
}

const editorUrl = (docId) => `/editor/?site=${encodeURIComponent(siteId)}#doc-${encodeURIComponent(docId)}`;

function postRow(doc) {
  const status = doc.meta?.status || 'draft';
  return h('li', {},
    h('a', { href: editorUrl(doc.id) },
      h('span', { class: 'post-title' }, doc.meta?.title || 'Untitled'),
      h('span', { class: 'status', 'data-status': status }, status),
      h('span', { class: 'date' }, formatDate(doc.meta?.updated || doc.meta?.created))));
}

async function loadPosts() {
  try {
    const docs = (await api(`${base}/documents`)).filter((d) => d.meta?.collection === 'posts');
    docs.sort((a, b) => String(b.meta?.updated || '').localeCompare(String(a.meta?.updated || '')));
    $('posts').replaceChildren(...docs.map(postRow));
    $('empty').hidden = docs.length > 0;
    showError('');
  } catch (err) {
    showError(err.message);
  }
}

async function loadSite() {
  try {
    const sites = await api('/api/sites');
    const site = sites.find((s) => s.id === siteId);
    if (!site) throw new Error('Unknown site');
    $('site-name').textContent = site.name;
    document.title = `${site.name} - Vanilla Press`;
  } catch (err) {
    $('site-name').textContent = 'Site not found';
    showError(err.message);
    return false;
  }
  api(`${base}/info`).then(({ siteUrl }) => {
    if (!siteUrl) return;
    $('view-site').href = siteUrl;
    $('view-site').hidden = false;
  }).catch(() => {});
  return true;
}

async function loadBackupStatus() {
  const el = $('backup-status');
  try {
    const s = await api(`${base}/status`);
    if (s.error) el.textContent = `Backup problem: ${s.error}`;
    else if (!s.connected) el.textContent = 'Not connected to GitHub';
    else if (s.lastPushAt) el.textContent = `Backed up ${new Date(s.lastPushAt).toLocaleString()}`;
    else el.textContent = s.pending ? 'Backup pending' : 'Connected to GitHub';
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
        meta: { title: 'Untitled', slug: `untitled-${stamp}`, collection: 'posts', status: 'draft' },
        blocks: [{ type: 'paragraph', children: [] }],
      },
    });
    location.href = editorUrl(doc.id);
  } catch (err) {
    showError(err.message);
    btn.disabled = false;
  }
});

// Sidebar: Posts shows the list; every other section is a placeholder.
document.querySelector('.side-nav').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-section]');
  if (!btn) return;
  for (const b of document.querySelectorAll('.side-nav button')) b.removeAttribute('aria-current');
  btn.setAttribute('aria-current', 'page');
  const posts = btn.dataset.section === 'posts';
  $('posts-section').hidden = !posts;
  $('soon-section').hidden = posts;
  $('soon-title').textContent = btn.textContent;
});

if (!siteId) {
  $('site-name').textContent = 'Site not found';
  showError('No site given. Go back to Sites and pick one.');
} else if (await loadSite()) {
  loadPosts();
  loadBackupStatus();
}
