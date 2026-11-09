/**
 * The Programs screen's Add program panel: choose the area, then a folder on this computer
 * (with the folder browser) or a folder to upload (picked or dropped), and the slug.
 * @module programs-add
 */
import { api, h } from './app-api.js';
import { slugFromFolder } from '../../../src/programs/programs-view.js';
import { formatBytes } from '../../../src/media/limits.js';

const TOO_LARGE = 'This program is larger than 50 MB.';

/** Every file under a dropped entry, with its path from the drop (`plasma/js/app.js`). */
async function walkEntry(entry, prefix = '') {
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    return [{ file, rel: `${prefix}${entry.name}` }];
  }
  if (!entry.isDirectory) return [];
  const reader = entry.createReader();
  const children = [];
  // readEntries answers in batches until it answers none.
  for (;;) {
    const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) break;
    children.push(...batch);
  }
  const out = [];
  for (const child of children) out.push(...await walkEntry(child, `${prefix}${entry.name}/`));
  return out;
}

/**
 * @param {{ base: string, root: HTMLElement,
 *   host: { areas: () => Array<{ path: string, title: string }>, limits: () => Object|null,
 *     added: (program: Object, result: Object) => Promise<void> } }} opts
 * @returns {{ open: (area?: string) => void, close: () => void }}
 */
export function createProgramsAdd({ base, root, host }) {
  const $ = (id) => root.querySelector(`#${id}`);
  const panel = $('program-add-panel');
  const toggle = $('program-add-btn');
  const slugInput = $('program-add-slug');
  const sourceInput = $('program-add-source');
  let picked = []; // [{ file, rel }] for an upload
  let slugTyped = false;
  let browseParent = null;

  const showError = (message) => {
    $('program-add-error').textContent = message || '';
    $('program-add-error').hidden = !message;
  };
  const setStatus = (text) => { $('program-add-status').textContent = text || ''; };
  const mode = () => panel.querySelector('input[name="program-from"]:checked').value;

  function suggestSlug(fromPath) {
    if (slugTyped) return;
    slugInput.value = slugFromFolder(fromPath);
    showUrl();
  }
  function showUrl() {
    const area = $('program-add-area').value;
    $('program-add-url').textContent = area && slugInput.value ? `Its address: /${area}/${slugInput.value}/` : '';
  }

  // --- Folder browser ---
  async function browse(path) {
    try {
      const data = await api(`/api/folders${path ? `?path=${encodeURIComponent(path)}` : ''}`);
      showError('');
      browseParent = data.parent;
      $('program-browse-current').textContent = data.path;
      $('program-browse-up').disabled = !data.parent;
      sourceInput.value = data.path;
      suggestSlug(data.path);
      $('program-browse-list').replaceChildren(...data.folders.map((f) => h('li', {},
        h('button', { type: 'button', 'data-path': f.path }, h('span', {}, f.name)))));
    } catch (err) {
      showError(err.message);
    }
  }
  $('program-browse-list').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-path]');
    if (btn) browse(btn.dataset.path);
  });
  $('program-browse-up').addEventListener('click', () => { if (browseParent) browse(browseParent); });
  sourceInput.addEventListener('change', () => suggestSlug(sourceInput.value));

  // --- Upload: picked or dropped ---
  function setPicked(list) {
    picked = list;
    const bytes = list.reduce((n, f) => n + f.file.size, 0);
    $('program-add-picked').textContent = list.length
      ? `${list.length} ${list.length === 1 ? 'file' : 'files'}, ${formatBytes(bytes)}.`
      : '';
    const top = list[0]?.rel.split('/')[0];
    if (top && list.every((f) => f.rel.startsWith(`${top}/`))) suggestSlug(top);
  }
  $('program-add-files').addEventListener('change', (e) => {
    setPicked([...e.target.files].map((file) => ({ file, rel: file.webkitRelativePath || file.name })));
  });
  const drop = $('program-add-drop');
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  drop.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    drop.dataset.dragging = '';
  });
  drop.addEventListener('dragleave', () => { delete drop.dataset.dragging; });
  drop.addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    delete drop.dataset.dragging;
    const entries = [...e.dataTransfer.items].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
    try {
      const lists = await Promise.all(entries.map((entry) => walkEntry(entry)));
      setPicked(lists.flat());
      showError('');
    } catch (err) {
      showError(`Couldn't read the dropped folder (${err.message}).`);
    }
  });

  for (const radio of panel.querySelectorAll('input[name="program-from"]')) {
    radio.addEventListener('change', () => {
      $('program-from-folder').hidden = mode() !== 'folder';
      $('program-from-upload').hidden = mode() !== 'upload';
      showError('');
    });
  }
  slugInput.addEventListener('input', () => { slugTyped = slugInput.value !== ''; showUrl(); });
  $('program-add-area').addEventListener('change', showUrl);

  // --- Submit ---
  async function upload(area, slug) {
    const limits = host.limits();
    const bytes = picked.reduce((n, f) => n + f.file.size, 0);
    if (limits && bytes > limits.totalBytes) throw new Error(TOO_LARGE);
    const form = new FormData();
    form.append('area', area);
    form.append('slug', slug);
    for (const { file, rel } of picked) form.append('files', file, rel);
    let res;
    try {
      res = await fetch(`${base}/programs/upload`, { method: 'POST', body: form });
    } catch {
      throw new Error('Cannot reach the Vanilla Press app. Is it still running?');
    }
    let data = null;
    try { data = await res.json(); } catch { /* no body */ }
    if (res.status === 413) throw new Error(TOO_LARGE);
    if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
    return data;
  }

  $('program-add-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const area = $('program-add-area').value;
    const slug = slugInput.value.trim();
    if (!area) return showError('Add an area first: programs live in an area.');
    if (!slug) { showError('Give the program a slug.'); slugInput.focus(); return; }
    const fromFolder = mode() === 'folder';
    if (fromFolder && !sourceInput.value.trim()) return showError('Choose a folder on this computer.');
    if (!fromFolder && !picked.length) return showError('Choose or drop a folder to upload.');
    const submit = $('program-add-submit');
    submit.disabled = true;
    showError('');
    setStatus(fromFolder ? 'Copying the folder…' : 'Uploading…');
    try {
      const result = fromFolder
        ? await api(`${base}/programs`, { method: 'POST', body: { area, source: sourceInput.value.trim(), slug } })
        : await upload(area, slug);
      setStatus('');
      close();
      await host.added(result.program, result);
    } catch (err) {
      setStatus('');
      showError(err.message);
    } finally {
      submit.disabled = false;
    }
  });

  function open(area) {
    const areas = host.areas();
    $('program-add-area').replaceChildren(...areas.map((a) => h('option', { value: a.path }, `${a.title} (/${a.path}/)`)));
    if (area && areas.some((a) => a.path === area)) $('program-add-area').value = area;
    slugTyped = false;
    slugInput.value = '';
    setPicked([]);
    $('program-add-files').value = '';
    showError(areas.length ? '' : 'Add an area first: programs live in an area. Open Areas below.');
    setStatus('');
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    if (mode() === 'folder') browse(sourceInput.value.trim() || '');
    showUrl();
    $('program-add-area').focus();
  }
  function close() {
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
  }
  $('program-add-cancel').addEventListener('click', () => { close(); toggle.focus(); });
  toggle.addEventListener('click', () => (panel.hidden ? open() : close()));

  return { open, close };
}
