/**
 * The Programs detail panel: the card fields (saved on change), the sandbox choice, path
 * with Copy, source and Update from source, Used in, Write a post about it, Open, View
 * live and Remove. The page owns the list; this module owns what is shown beside it.
 * @module programs-detail
 */
import { api, h } from './app-api.js';
import {
  sandboxChoiceText, sandboxChoice, sandboxFromChoice, previewText, postDocument,
} from '../../../src/programs/programs-view.js';

const LARGE_NOTE = 'Large program: everything is committed to git, so the repository grows by its size.';

/**
 * @param {{ siteId: string, base: string, root: HTMLElement, siteUrl: string|null,
 *   host: { getProgram: (key: string) => Object|undefined, areaOf: (path: string) => Object|undefined,
 *     replaceProgram: (program: Object) => void, refresh: () => Promise<void>,
 *     wrote: (result: Object) => void, removed: (program: Object) => void,
 *     open: (program: Object, button: HTMLElement) => void } }} opts
 * @returns {{ show: (program: Object|null) => void }}
 */
export function createProgramsDetail({ siteId, base, root, siteUrl, host }) {
  const $ = (id) => root.querySelector(`#${id}`);
  const body = $('program-detail-body');
  const setStatus = (text) => { $('program-detail-status').textContent = text || ''; };
  const keyOf = (p) => `${p.area}/${p.slug}`;
  const url = (p) => `${base}/programs/${encodeURIComponent(p.area)}/${encodeURIComponent(p.slug)}`;
  const editorUrl = (docId) => `/editor/?site=${encodeURIComponent(siteId)}#doc-${encodeURIComponent(docId)}`;

  /** An alert line in the panel, filled by the actions. */
  const message = () => h('p', { class: 'error', role: 'alert', hidden: true });
  const say = (el, text) => { el.textContent = text || ''; el.hidden = !text; };

  /** PATCH one change to the card; answers the fresh program, or null when refused. */
  async function save(program, changes, errorEl) {
    setStatus('Saving…');
    say(errorEl, '');
    try {
      const result = await api(url(program), { method: 'PATCH', body: changes });
      host.replaceProgram({ ...result.program, usedIn: program.usedIn });
      const heading = body.querySelector('#program-detail-title');
      if (heading) heading.textContent = result.program.title;
      host.wrote(result);
      setStatus('Saved');
      return result.program;
    } catch (err) {
      setStatus('');
      say(errorEl, err.data?.errors?.length ? err.data.errors.join(' ') : err.message);
      return null;
    }
  }

  function field(id, label, control, hint) {
    return h('div', { class: 'detail-group' },
      h('label', { for: id, class: 'detail-label' }, label), control,
      hint ? h('p', { class: 'detail-muted', id: `${id}-hint` }, hint) : null);
  }

  function cardFields(program, errorEl) {
    const key = keyOf(program);
    const current = () => host.getProgram(key) || program;
    const text = (id, name, value, attrs = {}) => {
      const input = h(name === 'description' ? 'textarea' : 'input',
        { id, ...(name === 'description' ? { rows: '3' } : { type: 'text' }), autocomplete: 'off', ...attrs });
      input.value = value ?? '';
      input.addEventListener('change', () => {
        const v = input.value;
        save(current(), { [name]: name === 'tags' ? v.split(',').map((t) => t.trim()).filter(Boolean) : v }, errorEl);
      });
      return input;
    };
    const date = h('input', { id: 'program-date', type: 'date' });
    date.value = program.date || '';
    date.addEventListener('change', () => save(current(), { date: date.value }, errorEl));

    const listed = h('input', { type: 'checkbox', id: 'program-listed', 'aria-describedby': 'program-listed-hint' });
    listed.checked = program.listed === true;
    const canList = program.status === 'ok';
    listed.disabled = !canList && !listed.checked;
    listed.addEventListener('change', async () => {
      const fresh = await save(current(), { listed: listed.checked }, errorEl);
      if (!fresh) listed.checked = !listed.checked;
    });
    const listedHint = canList
      ? 'Listed programs appear in the site’s program lists. Unlisted ones are live at their address only.'
      : program.status === 'no-index' ? 'Not a program (no index.html): it can’t be listed.' : 'Its folder is missing: it can’t be listed.';

    return [
      field('program-title', 'Title', text('program-title', 'title', program.title)),
      field('program-description', 'Description', text('program-description', 'description', program.description)),
      field('program-date', 'Date', date),
      field('program-tags', 'Tags', text('program-tags', 'tags', (program.tags || []).join(', '), { 'aria-describedby': 'program-tags-hint' }), 'Separate tags with commas.'),
      field('program-image', 'Preview image', text('program-image', 'image', program.image, { placeholder: '/media/…', 'aria-describedby': 'program-image-hint' }),
        'A file from Media, as /media/<name>.'),
      h('div', { class: 'detail-group' },
        h('label', { class: 'detail-check' }, listed, 'Listed'),
        h('p', { class: 'detail-muted', id: 'program-listed-hint' }, listedHint)),
    ];
  }

  function sandboxGroup(program, errorEl) {
    const areaDefault = host.areaOf(program.area)?.sandbox === true;
    const chosen = sandboxChoice(program);
    const choices = sandboxChoiceText(areaDefault).map((c) => {
      const input = h('input', { type: 'radio', name: 'program-sandbox', value: c.value, 'aria-describedby': `program-sandbox-${c.value}` });
      input.checked = c.value === chosen;
      return h('div', { class: 'program-choice' },
        h('label', { class: 'detail-check' }, input, c.label),
        h('p', { class: 'detail-muted', id: `program-sandbox-${c.value}` }, c.hint));
    });
    const group = h('fieldset', { class: 'detail-group program-sandbox' }, h('legend', { class: 'detail-label' }, 'Sandbox'), ...choices);
    group.addEventListener('change', async (e) => {
      const value = e.target.value;
      const before = sandboxChoice(host.getProgram(keyOf(program)) || program);
      const fresh = await save(host.getProgram(keyOf(program)) || program, { sandbox: sandboxFromChoice(value) }, errorEl);
      if (!fresh) group.querySelector(`input[value="${before}"]`).checked = true;
    });
    return group;
  }

  function pathRow(program) {
    const code = h('code', { class: 'detail-url' }, program.url);
    const copy = h('button', { type: 'button' }, 'Copy');
    let timer = null;
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(program.url);
        copy.textContent = 'Copied';
        clearTimeout(timer);
        timer = setTimeout(() => { copy.textContent = 'Copy'; }, 2000);
      } catch {
        const range = document.createRange();
        range.selectNodeContents(code);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        setStatus("Couldn't copy. The path is selected; press Ctrl+C or ⌘C.");
      }
    });
    return h('div', { class: 'detail-group' }, h('p', { class: 'detail-label' }, 'Path'), h('div', { class: 'detail-url-row' }, code, copy));
  }

  /** Update from source: a preview in the panel, then Apply with its token. */
  function sourceGroup(program) {
    const group = h('div', { class: 'detail-group' }, h('p', { class: 'detail-label' }, 'Source'));
    if (!program.source) {
      group.append(h('p', { class: 'detail-muted' }, 'Uploaded. To update it, remove it and upload it again.'));
      return group;
    }
    const check = h('button', { type: 'button', 'data-action': 'refresh' }, 'Update from source');
    const out = h('div', { class: 'program-preview', role: 'status' });
    const err = message();
    group.append(h('code', { class: 'detail-muted mono' }, program.source), h('div', {}, check), out, err);

    async function look() {
      say(err, '');
      out.replaceChildren(h('p', { class: 'detail-muted' }, 'Comparing with the source folder…'));
      check.disabled = true;
      try {
        const { preview, token } = await api(`${url(program)}/refresh`, { method: 'POST', body: { confirm: false } });
        showPreview(preview, token);
      } catch (e) {
        out.replaceChildren();
        say(err, e.message);
      } finally {
        check.disabled = false;
      }
    }
    function showPreview(preview, token) {
      const empty = !preview.added.length && !preview.changed.length && !preview.removed.length;
      const lists = [['Changed', preview.changed], ['Added', preview.added], ['Removed', preview.removed]]
        .filter(([, files]) => files.length)
        .map(([label, files]) => h('details', {}, h('summary', {}, `${label} (${files.length})`),
          h('ul', { class: 'detail-used' }, ...files.map((f) => h('li', {}, h('code', {}, f))))));
      const notes = [
        preview.skipped?.length ? h('p', { class: 'detail-muted' }, `Skipped: ${preview.skipped.join(', ')}`) : null,
        preview.large ? h('p', { class: 'detail-hint' }, LARGE_NOTE) : null,
      ].filter(Boolean);
      const apply = h('button', { type: 'button', class: 'primary', 'data-action': 'apply' }, 'Apply');
      const cancel = h('button', { type: 'button' }, empty ? 'Done' : 'Cancel');
      cancel.addEventListener('click', () => { out.replaceChildren(); check.focus(); });
      apply.addEventListener('click', async () => {
        apply.disabled = cancel.disabled = true;
        say(err, '');
        setStatus('Updating…');
        try {
          const result = await api(`${url(program)}/refresh`, { method: 'POST', body: { confirm: true, token } });
          host.wrote(result);
          out.replaceChildren();
          await host.refresh();
          setStatus(result.committed ? 'Updated. It goes live when the site rebuilds.' : 'Updated on this computer.');
        } catch (e) {
          setStatus('');
          apply.disabled = cancel.disabled = false;
          if (e.status === 409) {
            const again = h('button', { type: 'button' }, 'Look again');
            again.addEventListener('click', look);
            out.replaceChildren(h('p', { class: 'error' }, e.message), h('div', { class: 'detail-actions' }, again));
            again.focus();
          } else {
            say(err, e.message);
          }
        }
      });
      out.replaceChildren(
        h('p', {}, previewText(preview)),
        ...lists, ...notes,
        h('div', { class: 'detail-actions' }, ...(empty ? [] : [apply]), cancel));
    }
    check.addEventListener('click', look);
    return group;
  }

  function usedIn(program) {
    const group = h('div', { class: 'detail-group' }, h('p', { class: 'detail-label' }, 'Used in'));
    const uses = program.usedIn || [];
    if (!uses.length) group.append(h('p', { class: 'detail-muted' }, 'Not used in any post.'));
    else group.append(usedList(uses));
    return group;
  }
  const usedList = (uses) => h('ul', { class: 'detail-used' }, ...uses.map((u) =>
    h('li', {}, u.title, u.path && u.path !== u.title ? h('span', { class: 'detail-muted' }, ' ', h('code', {}, u.path)) : null)));

  async function writePost(program, button, errorEl) {
    button.disabled = true;
    say(errorEl, '');
    try {
      const docs = await api(`${base}/documents`);
      const doc = await api(`${base}/documents`, { method: 'POST', body: postDocument(program, docs.map((d) => d.meta?.slug)) });
      location.href = editorUrl(doc.id);
    } catch (err) {
      say(errorEl, err.message);
      button.disabled = false;
    }
  }

  async function remove(program, errorEl) {
    say(errorEl, '');
    const yes = await document.querySelector('confirm-panel').ask({
      heading: `Remove ${program.title}?`,
      body: `Its folder and card are deleted, and ${program.url} stops working on the live site once it rebuilds.`,
      confirm: 'Remove',
    });
    if (!yes) return;
    setStatus('Removing…');
    try {
      const result = await api(url(program), { method: 'DELETE' });
      setStatus('');
      host.wrote(result);
      host.removed(program);
    } catch (err) {
      setStatus('');
      errorEl.replaceChildren(err.message);
      if (err.status === 409 && err.data?.usedIn?.length) errorEl.append(usedList(err.data.usedIn));
      errorEl.hidden = false;
    }
  }

  /** Build the panel for one program (or the empty panel for null). */
  function show(program) {
    setStatus('');
    const aside = $('program-detail');
    if (!program) {
      aside.removeAttribute('aria-labelledby');
      aside.setAttribute('aria-label', 'Program details');
      body.replaceChildren(h('p', { class: 'detail-muted' }, 'Select a program to see its details.'));
      return;
    }
    aside.removeAttribute('aria-label');
    aside.setAttribute('aria-labelledby', 'program-detail-title');
    const fieldError = message();
    const actionError = message();
    const open = h('button', { type: 'button', 'data-action': 'open' }, 'Open');
    open.disabled = program.status !== 'ok';
    open.addEventListener('click', () => host.open(host.getProgram(keyOf(program)) || program, open));
    const post = h('button', { type: 'button', 'data-action': 'write-post' }, 'Write a post about it');
    post.addEventListener('click', () => writePost(host.getProgram(keyOf(program)) || program, post, actionError));
    const del = h('button', { type: 'button', class: 'danger-text', 'data-action': 'remove' }, 'Remove…');
    del.addEventListener('click', () => remove(host.getProgram(keyOf(program)) || program, actionError));
    const live = siteUrl
      ? h('a', { class: 'btn-quiet', href: `${siteUrl.replace(/\/+$/, '')}${program.url}`, target: '_blank', rel: 'noopener', 'data-no-icon': true },
        'View live ↗', h('span', { class: 'visually-hidden' }, ' (opens in a new tab)'))
      : null;
    const statusNote = program.status === 'missing-folder' ? 'Its folder is missing from the site. Update from source or remove it.'
      : program.status === 'no-index' ? 'Not a program (no index.html): its folder has no index.html at the top.' : null;
    body.replaceChildren(
      h('div', {},
        h('h2', { id: 'program-detail-title' }, program.title),
        h('p', { class: 'detail-muted mono' }, program.url),
        program.hasCard ? null : h('p', { class: 'detail-muted' }, 'No card yet: it gets one when you save a field.'),
        statusNote ? h('p', { class: 'detail-missing' }, statusNote) : null),
      h('div', { class: 'detail-actions program-primary' }, open, post, live),
      ...cardFields(program, fieldError),
      sandboxGroup(program, fieldError),
      fieldError,
      pathRow(program),
      sourceGroup(program),
      usedIn(program),
      actionError,
      h('div', { class: 'detail-actions' }, del));
  }

  return { show };
}
