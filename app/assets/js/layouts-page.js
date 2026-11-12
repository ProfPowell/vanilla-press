/**
 * The Layouts section: the site's layouts and includes, New layout, Duplicate, Delete and
 * Publish layout. Renders and wires events; the wording and rules are in layouts-view.js.
 * Questions are native <dialog>s (see theme-dialogs.js), never browser prompts.
 * @module layouts-page
 */
import { h, listLayoutFiles, createLayoutFile, deleteLayoutFile, publishLayoutFiles } from './app-api.js';
import { openDialog } from './theme-dialogs.js';
import {
  layoutRows, deletedRows, publishFiles, publishSummary, nameFromLabel, startOptions, startFromValue,
  newLayoutProblem, blockedText, OLD_COOK_TEXT, CHANGED_OUTSIDE,
} from './layouts-view.js';

/**
 * @param {{ siteId: string, root: HTMLElement }} opts
 * @returns {{ refresh: () => Promise<void>, show: () => Promise<void>, hide: () => Promise<void> }}
 */
export function initLayoutsSection({ siteId, root }) {
  const $ = (id) => root.querySelector(`#${id}`);
  let listing = { supported: true, layouts: [], includes: [], deleted: [] };

  const showError = (message) => {
    $('layouts-error').textContent = message || '';
    $('layouts-error').hidden = !message;
  };
  const showResult = (message) => {
    $('layouts-result').textContent = message || '';
    $('layouts-result').hidden = !message;
  };

  const openHref = (r) =>
    `/editor/layout.html?site=${encodeURIComponent(siteId)}&kind=${encodeURIComponent(r.kind)}&name=${encodeURIComponent(r.name)}`;

  function renderRow(r, readOnly) {
    const problemsId = `layouts-problems-${r.kind}-${r.name}`;
    const li = h('li', { class: 'layouts-row', 'data-kind': r.kind, 'data-name': r.name });
    const title = h('p', { class: 'layouts-name' }, h('strong', {}, r.label), ' ', h('code', { class: 'mono' }, r.fileName));
    if (r.unpublished) title.append(' ', h('span', { class: 'layouts-unpublished' }, 'Not published'));
    li.append(title, h('p', { class: 'layouts-status', 'data-editable': String(r.canOpen) }, r.statusText));
    const meta = [r.usedText, r.relationText].filter(Boolean).join(' · ');
    if (meta) li.append(h('p', { class: 'layouts-meta' }, meta));
    if (r.problems.length) {
      const list = h('ul', { class: 'layouts-problems', id: problemsId, hidden: true }, ...r.problems.map((p) => h('li', {}, p)));
      const toggle = h('button', { type: 'button', 'aria-expanded': 'false', 'aria-controls': problemsId }, 'Show all problems');
      toggle.addEventListener('click', () => {
        list.hidden = !list.hidden;
        toggle.setAttribute('aria-expanded', String(!list.hidden));
      });
      li.append(toggle, list);
    }
    if (readOnly) return li;
    const actions = h('div', { class: 'layouts-actions' });
    if (r.canOpen) {
      actions.append(h('a', { class: 'btn', href: openHref(r) }, 'Open'));
      const dup = h('button', { type: 'button' }, 'Duplicate');
      dup.addEventListener('click', () => openNewDialog({ opener: dup, duplicate: r }));
      actions.append(dup);
    }
    const del = h('button', { type: 'button', disabled: !r.canDelete }, 'Delete');
    del.addEventListener('click', () => askDelete(r, del));
    actions.append(del);
    li.append(actions);
    if (!r.canDelete) li.append(h('p', { class: 'layouts-blocked' }, r.deleteBlockedText));
    return li;
  }

  function render() {
    const supported = listing.supported !== false;
    $('layouts-old').hidden = supported;
    $('layouts-old').textContent = supported ? '' : (listing.message || OLD_COOK_TEXT);
    $('layouts-new').hidden = !supported;
    const pending = supported ? publishFiles(listing) : [];
    $('layouts-publish').hidden = pending.length === 0;
    const rows = layoutRows(listing);
    $('layouts-summary').textContent = supported
      ? `${rows.length} in src/layouts and src/includes` : '';
    const items = rows.map((r) => renderRow(r, !supported));
    for (const d of supported ? deletedRows(listing) : []) items.push(h('li', { class: 'layouts-row layouts-deleted' }, d.text));
    $('layouts-list').replaceChildren(...items);
  }

  async function refresh() {
    try {
      listing = await listLayoutFiles(siteId);
      showError('');
    } catch (err) {
      showError(err.message);
      return;
    }
    render();
  }

  // --- Dialogs ---
  /** One yes/no question with an optional list; `submit` returns an error text to stay open. */
  function confirmDialog({ opener, title, description, items = [], ok, busyText, submit, focusCancel = false }) {
    $('layouts-confirm-title').textContent = title;
    $('layouts-confirm-desc').textContent = description;
    $('layouts-confirm-list').replaceChildren(...items.map((i) =>
      h('li', {}, h('strong', {}, i.label), i.text ? ` ${i.text}` : '')));
    $('layouts-confirm-ok').textContent = ok;
    openDialog($('layouts-confirm-dialog'), {
      opener, fallback: $('layouts-new'),
      first: focusCancel ? $('layouts-confirm-dialog').querySelector('[data-dialog-cancel]') : $('layouts-confirm-ok'),
      error: $('layouts-confirm-error'), ok: $('layouts-confirm-ok'), busyText, submit,
    });
  }

  function askDelete(r, opener) {
    confirmDialog({
      opener,
      title: `Delete ${r.label}?`,
      description: `This removes ${r.fileName} from the site. Publish layout makes the deletion final.`,
      ok: 'Delete',
      busyText: 'Deleting…',
      focusCancel: true, // a destructive question starts on the safe answer
      submit: async () => {
        try {
          await deleteLayoutFile(siteId, r.kind, r.name);
        } catch (err) {
          if (err.status === 409 && err.data) {
            refresh();
            return blockedText(err.data.usedBy, err.data.baseFor) || err.message;
          }
          throw err;
        }
        showResult('');
        await refresh();
      },
    });
  }

  /** The Publish dialog's list: a checkbox per file, ticked when VP wrote it. */
  function publishChecklist(items) {
    const ok = $('layouts-confirm-ok');
    const boxes = [];
    const lis = items.map((i, n) => {
      const id = `layouts-publish-file-${n}`;
      const box = h('input', { type: 'checkbox', id, checked: i.vpWrote });
      box.checked = i.vpWrote;
      box.addEventListener('change', () => { ok.disabled = !boxes.some((b) => b.checked); });
      boxes.push(box);
      const label = h('label', { for: id }, h('strong', {}, i.label), i.text ? ` ${i.text}` : '');
      if (!i.vpWrote) label.append(' ', h('span', { class: 'layouts-outside' }, CHANGED_OUTSIDE));
      return h('li', {}, box, ' ', label);
    });
    $('layouts-confirm-list').replaceChildren(...lis);
    ok.disabled = !boxes.some((b) => b.checked);
    return () => items.filter((_, n) => boxes[n].checked).map((i) => ({ kind: i.kind, name: i.name }));
  }

  function askPublish(opener) {
    const { items, needsConfirm } = publishSummary(listing);
    confirmDialog({
      opener,
      title: 'Publish layout',
      description: needsConfirm
        ? 'Some of these are in use, so publishing changes pages on the live site. Publish them?'
        : 'These files will be committed and pushed. Nothing uses them yet.',
      ok: 'Publish',
      busyText: 'Publishing…',
      submit: async () => {
        const files = ticked();
        if (!files.length) return 'Tick at least one file to publish.';
        let out;
        try {
          out = await publishLayoutFiles(siteId, files);
        } catch (err) {
          if (err.status === 502 && err.data?.committed) {
            showResult(`Committed, but pushing failed: ${err.data.error || 'the push failed'}. It will be pushed with the next backup.`);
            await refresh();
            return;
          }
          if (err.status === 409 && err.data?.problems?.length) {
            const list = err.data.problems.map((p) => [p.name, p.message].filter(Boolean).join(': ')).join('; ');
            return `${err.message}. ${list}`;
          }
          throw err;
        }
        showResult(out.status === 'pushed'
          ? 'Published and pushed.'
          : 'Published here. This site has no remote to push to.');
        await refresh();
      },
    });
    // After the dialog opens: its list is the checklist, and Publish waits for a tick.
    const ticked = publishChecklist(items);
  }

  let nameTouched = false;
  /** New layout, or Duplicate when `duplicate` (a row) is given. */
  function openNewDialog({ opener, duplicate = null }) {
    const kind = duplicate ? duplicate.kind : 'layout';
    const options = startOptions(listing, { kind }).filter((o) => !duplicate || o.value === `copy:${duplicate.name}` || o.value === 'blank');
    $('layouts-new-title').textContent = duplicate ? `Duplicate ${duplicate.label}` : 'New layout';
    const want = duplicate ? `copy:${duplicate.name}` : options[0].value;
    $('layouts-new-start').replaceChildren(...options.map((o) => h('option', { value: o.value, selected: o.value === want }, o.text)));
    const label = $('layouts-new-label');
    const name = $('layouts-new-name');
    label.value = duplicate ? `${duplicate.label} copy` : '';
    name.value = duplicate ? nameFromLabel(label.value) : '';
    nameTouched = false;
    label.oninput = () => { if (!nameTouched) name.value = nameFromLabel(label.value); };
    name.oninput = () => { nameTouched = true; };
    openDialog($('layouts-new-dialog'), {
      opener, fallback: $('layouts-new'), first: label, error: $('layouts-new-error'), ok: $('layouts-new-ok'),
      busyText: 'Creating…',
      submit: async () => {
        const problem = newLayoutProblem(label.value, name.value);
        if (problem) return problem;
        await createLayoutFile(siteId, {
          kind, name: name.value, label: label.value.trim(), start: startFromValue([...$('layouts-new-start').querySelectorAll('option')].find((o) => o.selected)?.value ?? 'blank'),
        });
        showResult('');
        await refresh();
      },
    });
  }

  $('layouts-new').addEventListener('click', () => openNewDialog({ opener: $('layouts-new') }));
  $('layouts-publish').addEventListener('click', () => askPublish($('layouts-publish')));

  return { refresh, show: refresh, hide: async () => {} };
}
