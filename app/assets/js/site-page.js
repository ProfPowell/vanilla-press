import { api, h, formatDate, listComponents, setComponent } from './app-api.js';
import { packageRows, toggleOutcome } from './components-view.js';
import { loadComponent, createComponentElement, setComponentValue } from '/editor/assets/js/component-loader.js';

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

// Components section.
let componentState = null;
let busy = false;

function setComponentsError(text, posts) {
  const el = $('components-error');
  el.replaceChildren();
  if (text) el.append(text);
  if (posts?.length) {
    el.append(h('ul', {}, ...posts.map((p) =>
      h('li', {}, h('a', { href: editorUrl(p.id) }, p.title || 'Untitled'), ` (${p.status})`))));
  }
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
      setComponentsError(out.text, out.posts);
    }
  } catch (err) {
    setComponentsError(err.message);
  }
  busy = false;
  renderComponents();
});

// Sidebar: Posts and Components are real; every other section is a placeholder.
document.querySelector('.side-nav').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-section]');
  if (!btn) return;
  for (const b of document.querySelectorAll('.side-nav button')) b.removeAttribute('aria-current');
  btn.setAttribute('aria-current', 'page');
  const section = btn.dataset.section;
  $('posts-section').hidden = section !== 'posts';
  $('components-section').hidden = section !== 'components';
  $('soon-section').hidden = section === 'posts' || section === 'components';
  $('soon-title').textContent = btn.textContent;
  if (section === 'components' && !componentState) loadComponents();
});

if (!siteId) {
  $('site-name').textContent = 'Site not found';
  showError('No site given. Go back to Sites and pick one.');
} else if (await loadSite()) {
  loadPosts();
  loadBackupStatus();
}
