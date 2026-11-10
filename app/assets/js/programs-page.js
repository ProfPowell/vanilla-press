/**
 * The Programs section: header, Areas, filters, tiles, and Open (the program running in
 * an iframe from the program server). Renders and wires events; the rules live in
 * src/programs/programs-view.js. The detail panel and the Add panel are their own modules.
 * @module programs-page
 */
import { api, h } from './app-api.js';
import {
  FILTERS, SANDBOX_ATTR, withEffectiveSandbox, filterPrograms, headerText, tileModel, emptyText,
} from '../../../src/programs/programs-view.js';
import { createProgramsDetail } from './programs-detail.js';
import { createProgramsAdd } from './programs-add.js';

const PLACEHOLDER = '<rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="m9 9 3 3-3 3"></path><path d="M13 15h3"></path>';

function placeholderIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [k, v] of Object.entries({ width: 28, height: 28, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
  svg.innerHTML = PLACEHOLDER; // constant markup, never program data
  return svg;
}

/**
 * @param {{ siteId: string, root: HTMLElement, siteUrl?: string|null }} opts
 * @returns {{ refresh: () => Promise<void>, show: () => Promise<void>, hide: () => void }}
 */
export function initProgramsSection({ siteId, root, siteUrl = null }) {
  const base = `/api/sites/${encodeURIComponent(siteId)}`;
  const $ = (id) => root.querySelector(`#${id}`);
  const view = { area: 'all', filter: 'all', q: '' };
  let state = { areas: [], programs: [], runBase: null, limits: null };
  let selectedKey = null;
  const keyOf = (p) => `${p.area}/${p.slug}`;

  const showError = (message) => {
    $('programs-error').textContent = message || '';
    $('programs-error').hidden = !message;
  };
  /** A write's answer: a note when it was not committed (it is saved, but not live). */
  const wrote = (result) => {
    const note = result && result.committed === false ? result.note || 'Saved, but not committed.' : '';
    $('programs-note').textContent = note;
    $('programs-note').hidden = !note;
  };

  $('program-filters').replaceChildren(...FILTERS.map(([value, label]) =>
    h('button', { type: 'button', 'data-filter': value, 'aria-pressed': String(value === view.filter) }, label)));

  // --- Tiles ---
  function tile(program) {
    const m = tileModel(program);
    const thumb = h('span', { class: 'media-thumb program-thumb' });
    const file = program.image?.startsWith('/media/') ? program.image.slice('/media/'.length) : null;
    if (file) thumb.append(h('img', { src: `/sites/${encodeURIComponent(siteId)}/media/${encodeURIComponent(file)}`, alt: '', loading: 'lazy' }));
    else thumb.append(placeholderIcon());
    const btn = h('button', { type: 'button', class: 'media-tile program-tile', 'data-key': keyOf(program), 'aria-pressed': String(keyOf(program) === selectedKey) },
      thumb,
      h('span', { class: 'program-name' }, m.title),
      h('span', { class: 'media-name' }, m.path));
    if (m.badges.length) {
      btn.append(h('span', { class: 'media-badges' }, ...m.badges.map((b) =>
        h('span', { class: 'media-badge', 'data-badge': b.toLowerCase().replace(/[^a-z]+/g, '-').replace(/-$/, '') }, b))));
    }
    return h('li', {}, btn);
  }

  function renderAreaFilter() {
    const select = $('program-area-filter');
    if (view.area !== 'all' && !state.areas.some((a) => a.path === view.area)) view.area = 'all';
    select.replaceChildren(h('option', { value: 'all' }, 'All areas'),
      ...state.areas.map((a) => h('option', { value: a.path }, `${a.title} (/${a.path}/)`)));
    select.value = view.area;
  }

  function render() {
    $('programs-summary').textContent = headerText(state);
    for (const btn of $('program-filters').querySelectorAll('button')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.filter === view.filter));
    }
    const shown = filterPrograms(state.programs, view);
    const focused = document.activeElement?.closest?.('.program-tile')?.dataset.key;
    $('program-grid').replaceChildren(...shown.map(tile));
    if (focused) $('program-grid').querySelector(`[data-key="${CSS.escape(focused)}"]`)?.focus();
    $('program-empty-text').textContent = emptyText(state.programs.length);
    $('program-empty').hidden = shown.length > 0;
  }

  // --- Areas ---
  function areaRow(area) {
    const row = h('li', { class: 'program-area' });
    const paint = () => {
      const edit = h('button', { type: 'button', 'data-action': 'edit-area' }, 'Edit');
      edit.addEventListener('click', () => editArea(area, row));
      const del = area.count === 0 ? h('button', { type: 'button', class: 'danger-text', 'data-action': 'delete-area' }, 'Delete…') : null;
      del?.addEventListener('click', () => deleteArea(area, row));
      row.replaceChildren(
        h('span', { class: 'program-area-main' },
          h('strong', {}, area.title), ' ', h('code', { class: 'mono' }, `/${area.path}/`)),
        h('span', { class: 'muted' }, `${area.sandbox ? 'Sandboxed' : 'Not sandboxed'} by default · ${area.count} ${area.count === 1 ? 'program' : 'programs'}`),
        h('span', { class: 'actions' }, edit, del),
        h('p', { class: 'error', role: 'alert', hidden: true }));
    };
    paint();
    row.paint = paint;
    return row;
  }

  function editArea(area, row) {
    const id = `area-${area.path}`;
    const form = h('form', { class: 'program-area-form', novalidate: true });
    const title = h('input', { type: 'text', id: `${id}-title`, autocomplete: 'off' });
    title.value = area.title;
    const path = h('input', { type: 'text', id: `${id}-path`, autocomplete: 'off', disabled: area.count > 0, 'aria-describedby': `${id}-path-hint` });
    path.value = area.path;
    const sandbox = h('input', { type: 'checkbox' });
    sandbox.checked = area.sandbox;
    const error = h('p', { class: 'error', role: 'alert', hidden: true });
    const cancel = h('button', { type: 'button' }, 'Cancel');
    form.append(
      h('div', { class: 'row' },
        h('label', { for: `${id}-title` }, 'Title ', title),
        h('label', { for: `${id}-path` }, 'Path ', path)),
      h('p', { class: 'muted', id: `${id}-path-hint` }, area.count > 0 ? 'The path can change only while the area is empty.' : 'One lowercase word or words joined by hyphens.'),
      h('label', { class: 'detail-check' }, sandbox, 'Sandbox its programs by default'),
      error,
      h('div', { class: 'actions' }, h('button', { type: 'submit', class: 'primary' }, 'Save'), cancel));
    cancel.addEventListener('click', () => { row.paint(); row.querySelector('[data-action="edit-area"]').focus(); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const changes = { title: title.value, sandbox: sandbox.checked };
      if (!path.disabled && path.value.trim() !== area.path) changes.path = path.value.trim();
      try {
        const result = await api(`${base}/programs/areas/${encodeURIComponent(area.path)}`, { method: 'PATCH', body: changes });
        wrote(result);
        await refresh();
        $('program-areas-list').querySelector(`[data-area="${CSS.escape(result.area.path)}"] [data-action="edit-area"]`)?.focus();
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
      }
    });
    row.replaceChildren(form);
    title.focus();
  }

  async function deleteArea(area, row) {
    const yes = await document.querySelector('confirm-panel').ask({
      heading: `Delete the area ${area.title}?`,
      body: `/${area.path}/ is empty. Deleting it removes it from the site's programs.`,
      confirm: 'Delete area',
    });
    if (!yes) return;
    try {
      wrote(await api(`${base}/programs/areas/${encodeURIComponent(area.path)}`, { method: 'DELETE' }));
      await refresh();
      $('program-areas').querySelector('summary').focus();
    } catch (err) {
      const error = row.querySelector('.error');
      if (error) { error.textContent = err.message; error.hidden = false; }
    }
  }

  function renderAreas() {
    $('program-areas-count').textContent = `(${state.areas.length})`;
    $('program-areas-list').replaceChildren(...state.areas.map((a) => {
      const row = areaRow(a);
      row.dataset.area = a.path;
      return row;
    }));
    if (!state.areas.length) $('program-areas').open = true;
  }

  $('program-area-add').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const error = form.querySelector('.error');
    const path = form.elements.path.value.trim();
    const title = form.elements.title.value.trim();
    try {
      const result = await api(`${base}/programs/areas`, {
        method: 'POST', body: { path, ...(title ? { title } : {}), sandbox: form.elements.sandbox.checked },
      });
      wrote(result);
      error.hidden = true;
      form.reset();
      await refresh();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
  });

  // --- Load ---
  let latest = 0;
  async function refresh() {
    const mine = ++latest;
    try {
      const fresh = await api(`${base}/programs`);
      if (mine !== latest) return;
      state = { ...fresh, programs: withEffectiveSandbox(fresh) };
      showError('');
    } catch (err) {
      if (mine === latest) showError(err.message);
      return;
    }
    renderAreaFilter();
    renderAreas();
    render();
    const current = state.programs.find((p) => keyOf(p) === selectedKey) || null;
    if (!current) selectedKey = null;
    detail.show(current); // fresh status, source and Used in
    followRunning();
  }

  // --- Open: the program in an iframe from the program server ---
  let running = null; // { key, button }
  function frameFor(program) {
    const frame = h('iframe', {
      src: `${state.runBase}/${encodeURIComponent(program.area)}/${encodeURIComponent(program.slug)}/`,
      title: program.title,
      class: 'program-frame',
    });
    if (program.sandboxed) frame.setAttribute('sandbox', SANDBOX_ATTR);
    return frame;
  }
  /** @param {{ focus?: boolean }} [opts] - focus: false when the frame is rebuilt for a change made elsewhere */
  function openRun(program, button, { focus = true } = {}) {
    if (!state.runBase) {
      showError('Open is not available yet: the program server is starting. Try again in a moment.');
      return;
    }
    showError('');
    running = { key: keyOf(program), button };
    $('program-run-title').textContent = program.title;
    $('program-run-note').textContent = program.sandboxed
      ? 'Sandboxed, as on the live site: its saved data won’t work.'
      : 'Not sandboxed: it runs as it does on the live site.';
    $('program-run-stage').replaceChildren(frameFor(program));
    $('program-run').hidden = false;
    if (!focus) return;
    $('program-run').scrollIntoView({ block: 'nearest' });
    $('program-run-close').focus();
  }
  function closeRun() {
    const button = running?.button;
    running = null;
    $('program-run').hidden = true;
    $('program-run-stage').replaceChildren();
    if (button?.isConnected) button.focus();
    else root.querySelector('#program-detail [data-action="open"]')?.focus();
  }
  $('program-run-close').addEventListener('click', closeRun);

  /**
   * The running program follows the state: gone closes it; a changed effective sandbox (its
   * own setting or its area's default) gets a new frame, so the attribute takes effect.
   */
  function followRunning() {
    if (!running) return;
    const now = state.programs.find((p) => keyOf(p) === running.key);
    if (!now) { closeRun(); return; }
    const frame = $('program-run-stage').querySelector('iframe');
    if (frame?.hasAttribute('sandbox') !== now.sandboxed) openRun(now, running.button, { focus: false });
    else {
      $('program-run-title').textContent = now.title;
      frame.title = now.title;
    }
  }

  // --- Detail and Add ---
  const detail = createProgramsDetail({
    siteId,
    base,
    root,
    siteUrl,
    host: {
      getProgram: (key) => state.programs.find((p) => keyOf(p) === key),
      areaOf: (path) => state.areas.find((a) => a.path === path),
      replaceProgram(fresh) {
        const programs = state.programs.map((p) => (keyOf(p) === keyOf(fresh) ? fresh : p));
        state = { ...state, programs: withEffectiveSandbox({ areas: state.areas, programs }) };
        render();
        followRunning();
      },
      refresh,
      wrote,
      removed(program) {
        if (running?.key === keyOf(program)) closeRun();
        const order = filterPrograms(state.programs, view).map(keyOf);
        const at = order.indexOf(keyOf(program));
        selectedKey = order[at + 1] ?? order[at - 1] ?? null;
        refresh().then(() => {
          ($('program-grid').querySelector('.program-tile[aria-pressed="true"]') || $('program-add-btn')).focus();
        });
      },
      open: openRun,
    },
  });

  const adder = createProgramsAdd({
    base,
    root,
    host: {
      areas: () => state.areas,
      limits: () => state.limits,
      async added(program, result) {
        wrote(result);
        const extra = [
          result.skipped?.length ? `Skipped: ${result.skipped.join(', ')}.` : '',
          result.large ? 'Large program: everything is committed to git, so the repository grows by its size.' : '',
        ].filter(Boolean).join(' ');
        if (extra) {
          $('programs-note').textContent = [$('programs-note').textContent, extra].filter(Boolean).join(' ');
          $('programs-note').hidden = false;
        }
        view.area = 'all';
        view.filter = 'all';
        selectedKey = keyOf(program);
        await refresh();
        $('program-grid').querySelector(`[data-key="${CSS.escape(selectedKey)}"]`)?.focus();
      },
    },
  });

  function select(key) {
    selectedKey = key;
    for (const btn of $('program-grid').querySelectorAll('.program-tile')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.key === key));
    }
    detail.show(state.programs.find((p) => keyOf(p) === key) || null);
  }

  $('program-grid').addEventListener('click', (e) => {
    const btn = e.target.closest('.program-tile');
    if (!btn) return;
    select(btn.dataset.key === selectedKey ? null : btn.dataset.key);
    if (selectedKey && matchMedia('(max-width: 52rem)').matches) $('program-detail').scrollIntoView({ block: 'nearest' });
  });
  $('program-filters').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-filter]');
    if (!btn) return;
    view.filter = btn.dataset.filter;
    render();
  });
  $('program-area-filter').addEventListener('change', (e) => { view.area = e.target.value; render(); });
  $('program-search').addEventListener('input', (e) => { view.q = e.target.value; render(); });

  // A folder dropped outside the drop zone would navigate the app away: refuse it while Programs shows.
  for (const type of ['dragover', 'drop']) {
    window.addEventListener(type, (e) => {
      if (root.hidden || ![...(e.dataTransfer?.types || [])].includes('Files')) return;
      if (e.target.closest?.('#program-add-drop')) return;
      e.preventDefault();
      if (type === 'dragover') e.dataTransfer.dropEffect = 'none';
    });
  }

  detail.show(null);
  return {
    refresh,
    show: () => refresh(),
    hide: () => { if (running) closeRun(); adder.close(); },
  };
}
