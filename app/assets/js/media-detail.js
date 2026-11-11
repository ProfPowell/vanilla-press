/**
 * The Media detail panel: preview, alt text, credit, URL, where a file is used, delete
 * and Edit image. The page owns the library; this module owns what is shown beside it.
 * @module media-detail
 */
import { api, h } from './app-api.js';
import {
  ALT_PLACEHOLDER, ALT_HINT, detailModel, altForCheckbox, createAltSaver, deleteDecision, refusedDeleteMessage,
  CREDIT_FIELDS, CREDIT_NOTE, creditFormValues, creditFromForm,
} from '../../../src/media/library-view.js';
import { creditText } from '../../../src/media/credit.js';
import { exportFormat } from '../../../src/media/types.js';
import { uploadMedia } from '../../../editor/assets/js/media-upload.js';

/**
 * @param {{ siteId: string, base: string, root: HTMLElement,
 *   host: { getItem: (id: string) => Object|undefined, replaceItem: (item: Object) => void,
 *     showError: (message: string) => void, deleted: (item: Object) => void,
 *     copySaved: (copy: Object) => Promise<void>, refresh: () => Promise<void> } }} opts
 * @returns {{ show: (item: Object|null) => void, flushAlt: () => Promise<void>, shownId: () => string|null, focusAlt: () => void }}
 */
export function createMediaDetail({ siteId, base, root, host }) {
  const $ = (id) => root.querySelector(`#${id}`);
  const displayUrl = (item) => `/sites/${encodeURIComponent(siteId)}/media/${encodeURIComponent(item.filename)}`;
  const detailBody = $('media-detail-body');
  const setStatus = (text) => { $('media-detail-status').textContent = text || ''; };
  let shownId = null; // the item the panel is built for
  let paintToken = 0;

  const saver = createAltSaver({
    save: async (id, alt) => {
      try {
        const fresh = await api(`${base}/media/${encodeURIComponent(id)}`, { method: 'PUT', body: { alt } });
        host.replaceItem(fresh);
        if (shownId === id) { syncAltUi(fresh); setStatus('Saved'); }
      } catch (err) {
        const name = host.getItem(id)?.filename || 'a file';
        host.showError(`Couldn't save the alt text for ${name}. ${err.message} Select the file and try again.`);
        if (shownId === id) setStatus('');
        throw err;
      }
    },
  });
  const flushAlt = () => saver.flush().catch(() => {}); // save() has already shown its error

  // The page is going away: a normal save may not finish, a keepalive request does.
  function saveAltBeforeLeaving() {
    const pending = saver.take();
    if (!pending) return;
    fetch(`${base}/media/${encodeURIComponent(pending.id)}`, {
      method: 'PUT', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ alt: pending.alt }),
    }).catch(() => {});
  }
  window.addEventListener('pagehide', saveAltBeforeLeaving);
  // Links that leave the page (Used in, All sites) save first; the request outlives the navigation.
  document.addEventListener('click', (e) => {
    if (root.hidden) return;
    const link = e.target.closest?.('a[href]');
    if (link && (link.closest('#media-detail') || link.classList.contains('rail-back'))) saveAltBeforeLeaving();
  }, true);

  /** The alt field's look and the hint follow the stored state. */
  function syncAltUi(item) {
    const alt = detailBody.querySelector('#media-alt');
    if (!alt) return;
    const state = item.kind === 'image' ? (item.alt == null ? 'missing' : item.alt === '' ? 'decorative' : 'written') : 'written';
    alt.dataset.state = state;
    detailBody.querySelector('#media-alt-hint').hidden = state !== 'missing';
  }

  function previewEl(item, token) {
    const box = h('div', { class: 'detail-preview' });
    const src = displayUrl(item);
    if (item.missing) {
      box.append(h('p', { class: 'detail-missing' }, 'This file is missing from src/media.'));
    } else if (item.kind === 'image') {
      box.append(h('img', { src, alt: item.alt || '' }));
    } else if (item.kind === 'audio') {
      box.append(h('audio-player', {}, h('audio', { controls: true, src })));
    } else if (item.kind === 'video') {
      box.append(h('video-player', {}, h('video', { controls: true, src })));
    } else if (item.kind === 'pdf') {
      box.dataset.kind = 'pdf';
      import('/assets/pdf-viewer/pdf-viewer.js').then(() => {
        if (token === paintToken) box.append(h('pdf-viewer', { src, 'no-print': true }));
      }).catch(() => {
        if (token === paintToken) box.append(h('p', { class: 'detail-missing' }, "Couldn't load the PDF viewer. Reload the page to try again."));
      });
    }
    return box;
  }

  function altField(item) {
    const alt = h('textarea', { id: 'media-alt', rows: '3', placeholder: ALT_PLACEHOLDER, 'aria-describedby': 'media-alt-hint' });
    alt.value = item.alt || '';
    alt.disabled = item.alt === '';
    const hint = h('p', { id: 'media-alt-hint', class: 'detail-hint' }, ALT_HINT);
    const deco = h('input', { type: 'checkbox', id: 'media-decorative' });
    deco.checked = item.alt === '';
    alt.addEventListener('input', () => {
      setStatus('');
      saver.change(item.id, alt.value === '' ? null : alt.value);
    });
    deco.addEventListener('change', () => {
      setStatus('');
      alt.value = '';
      alt.disabled = deco.checked;
      saver.change(item.id, altForCheckbox(deco.checked));
      flushAlt();
      if (!deco.checked) alt.focus();
    });
    return h('div', { class: 'detail-group' },
      h('label', { for: 'media-alt', class: 'detail-label' }, 'Alt text'),
      alt, hint,
      h('label', { class: 'detail-check' }, deco, 'Decorative (alt="")'));
  }

  /**
   * The Credit fieldset: who made the image and under what license. Save sends
   * `PUT { credit }` (null once every field is empty); posts keep the credit they have.
   */
  function creditField(item) {
    const inputs = {};
    const errorId = 'media-credit-error';
    const error = h('p', { id: errorId, class: 'error', role: 'alert', hidden: true });
    const line = h('p', { class: 'detail-muted', id: 'media-credit-line' });
    const adapted = h('input', { type: 'checkbox', id: 'media-credit-adapted' });
    const fill = (values) => {
      for (const { key } of CREDIT_FIELDS) inputs[key].value = values[key];
      adapted.checked = values.adapted;
    };
    const showLine = (credit) => {
      const text = creditText(credit);
      line.textContent = text ? `Shows as: ${text}` : 'No credit.';
    };
    const clearInvalid = () => {
      for (const input of Object.values(inputs)) {
        input.removeAttribute('aria-invalid');
        input.removeAttribute('aria-describedby');
      }
      error.hidden = true;
    };
    const fields = CREDIT_FIELDS.map(({ key, label, link }) => {
      const id = `media-credit-${key}`;
      inputs[key] = h('input', {
        type: link ? 'url' : 'text', id, autocomplete: 'off', spellcheck: link ? 'false' : null,
        placeholder: link ? 'https://' : null,
      });
      return h('div', { class: 'detail-credit-field' }, h('label', { for: id }, label), inputs[key]);
    });
    const save = h('button', { type: 'submit', 'data-action': 'save-credit' }, 'Save credit');
    const form = h('form', { class: 'detail-group detail-credit', novalidate: true },
      h('fieldset', { 'aria-describedby': 'media-credit-note' },
        h('legend', { class: 'detail-label' }, 'Credit'),
        line,
        ...fields,
        h('label', { class: 'detail-check' }, adapted, 'Adapted (changed from the original)')),
      h('p', { id: 'media-credit-note', class: 'detail-muted' }, CREDIT_NOTE),
      error,
      h('div', {}, save));
    fill(creditFormValues(item));
    showLine(item.credit);
    form.addEventListener('input', () => { if (!error.hidden) clearInvalid(); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearInvalid();
      const values = { adapted: adapted.checked };
      for (const { key } of CREDIT_FIELDS) values[key] = inputs[key].value;
      const answer = creditFromForm(values);
      if (answer.error) {
        error.textContent = answer.error;
        error.hidden = false;
        for (const key of answer.invalid) {
          inputs[key].setAttribute('aria-invalid', 'true');
          inputs[key].setAttribute('aria-describedby', errorId);
        }
        inputs[answer.invalid[0]]?.focus();
        return;
      }
      save.disabled = true;
      setStatus('Saving the credit…');
      try {
        const fresh = await api(`${base}/media/${encodeURIComponent(item.id)}`, { method: 'PUT', body: { credit: answer.credit } });
        host.replaceItem(fresh);
        if (shownId !== item.id || !form.isConnected) return;
        fill(creditFormValues(fresh));
        showLine(fresh.credit);
        setStatus(fresh.credit ? 'Credit saved' : 'Credit removed');
      } catch (err) {
        if (shownId !== item.id || !form.isConnected) {
          host.showError(`Couldn't save the credit for ${item.filename}. ${err.message}`);
          return;
        }
        setStatus('');
        error.textContent = `Couldn't save the credit. ${err.message}`;
        error.hidden = false;
      } finally {
        save.disabled = false;
      }
    });
    return form;
  }

  function urlField(model) {
    const code = h('code', { class: 'detail-url', id: 'media-url' }, model.url);
    const copy = h('button', { type: 'button' }, 'Copy');
    let timer = null;
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(model.url);
        setStatus('');
        copy.textContent = 'Copied';
        clearTimeout(timer);
        timer = setTimeout(() => { copy.textContent = 'Copy'; }, 2000);
      } catch {
        const range = document.createRange();
        range.selectNodeContents(code);
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        setStatus("Couldn't copy. The URL is selected; press Ctrl+C or ⌘C.");
      }
    });
    return h('div', { class: 'detail-group' },
      h('p', { class: 'detail-label' }, 'URL'),
      h('div', { class: 'detail-url-row' }, code, copy));
  }

  function usedInList(model) {
    const group = h('div', { class: 'detail-group' }, h('p', { class: 'detail-label' }, 'Used in'));
    if (!model.usedIn.length) {
      group.append(h('p', { class: 'detail-muted' }, 'Not used in any post.'));
      return group;
    }
    group.append(h('ul', { class: 'detail-used' }, ...model.usedIn.map((u) =>
      h('li', {}, u.href ? h('a', { href: u.href }, u.title) : h('code', {}, u.title), ` (${u.statusText})`))));
    return group;
  }

  async function deleteItem(id, message) {
    await flushAlt();
    const item = host.getItem(id); // the current row, not the one the panel was built from
    if (!item) return;
    const decision = deleteDecision(item);
    if (!decision.allowed) {
      message.textContent = decision.message;
      message.hidden = false;
      return;
    }
    message.hidden = true;
    const yes = await document.querySelector('confirm-panel').ask({ heading: decision.heading, body: decision.body, confirm: decision.confirm });
    if (!yes) return;
    try {
      await api(`${base}/media/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
    } catch (err) {
      if (err.status === 409 && Array.isArray(err.data?.posts)) {
        // Something now uses the file that the panel didn't know about: name it, and bring the tile and panel up to date.
        const notice = refusedDeleteMessage(err.data.posts);
        await host.refresh();
        const fresh = host.getItem(id);
        if (fresh && shownId === id) show(fresh, { notice });
        else if (message.isConnected) { message.textContent = notice; message.hidden = false; }
        return;
      }
      message.textContent = err.message;
      message.hidden = false;
      return;
    }
    host.deleted(item);
  }

  /** Edit image: the preview becomes an editor; Save copy uploads the result as a new file. */
  async function openEditor(item, { preview, editorSlot, edit }) {
    const mime = item.mime_type;
    const format = exportFormat(mime);
    const error = h('p', { class: 'error', role: 'alert', hidden: true });
    const save = h('button', { type: 'button', class: 'primary', 'data-action': 'save-copy' }, 'Save copy');
    const cancel = h('button', { type: 'button', 'data-action': 'cancel-edit' }, 'Cancel');
    const close = () => {
      editorSlot.hidden = true;
      editorSlot.replaceChildren();
      preview.hidden = false;
      edit.hidden = false;
    };
    preview.hidden = true;
    edit.hidden = true;
    editorSlot.hidden = false;
    editorSlot.replaceChildren(h('p', { class: 'detail-muted' }, 'Loading the editor…'));
    try {
      await import('/assets/image-editor/image-editor.js');
    } catch {
      close();
      host.showError("Couldn't load the image editor. Reload the page to try again.");
      edit.focus();
      return;
    }
    if (editorSlot.hidden) return; // the panel was rebuilt meanwhile
    const editor = h('image-editor', { src: displayUrl(item), format });
    editorSlot.replaceChildren(editor, error, h('div', { class: 'detail-actions' }, save, cancel));
    cancel.addEventListener('click', () => { close(); edit.focus(); });
    save.addEventListener('click', async () => {
      error.hidden = true;
      save.disabled = cancel.disabled = true;
      setStatus('Saving a copy…');
      try {
        const blob = await editor.getBlob(format, 0.92);
        const copy = await uploadMedia(base, new File([blob], item.filename, { type: mime }), { editedFrom: item.filename });
        await host.copySaved(copy);
        setStatus(`Saved a copy as ${copy.filename}. The original is unchanged.`);
      } catch (err) {
        setStatus('');
        error.textContent = `${err.message || "Couldn't save the copy."} Your edits are still here; try Save copy again.`;
        error.hidden = false;
        save.disabled = cancel.disabled = false;
      }
    });
  }

  /** Build the panel for one item (or the empty panel for null). */
  function show(item, { notice = '' } = {}) {
    const token = ++paintToken;
    shownId = item ? item.id : null;
    setStatus('');
    const aside = $('media-detail');
    if (!item) {
      aside.removeAttribute('aria-labelledby');
      aside.setAttribute('aria-label', 'File details');
      detailBody.replaceChildren(h('p', { class: 'detail-muted' }, 'Select a file to see its details.'));
      return;
    }
    const model = detailModel(item, { siteId, locale: navigator.language });
    aside.removeAttribute('aria-label');
    aside.setAttribute('aria-labelledby', 'detail-title');
    const message = h('p', { class: 'error', role: 'alert', hidden: !notice }, notice);
    const del = h('button', { type: 'button', class: 'danger-text' }, 'Delete…');
    del.addEventListener('click', () => deleteItem(item.id, message));
    const actions = h('div', { class: 'detail-actions' });
    const preview = previewEl(item, token);
    const editorSlot = h('div', { class: 'detail-editor', hidden: true });
    if (model.canEdit) {
      const edit = h('button', { type: 'button', 'data-action': 'edit-image' }, 'Edit image');
      edit.addEventListener('click', () => openEditor(item, { preview, editorSlot, edit }));
      actions.append(edit);
    }
    actions.append(del);
    detailBody.replaceChildren(
      preview,
      editorSlot,
      h('div', {},
        h('h2', { id: 'detail-title' }, model.title),
        model.original ? h('p', { class: 'detail-muted' }, `Uploaded as ${model.original}`) : null,
        model.source ? h('p', { class: 'detail-muted', 'data-source': item.source }, model.source) : null,
        h('p', { class: 'detail-muted' }, model.meta),
        model.dims ? h('p', { class: 'detail-muted' }, model.dims) : null),
      model.showAlt ? altField(item) : null,
      model.showCredit ? creditField(item) : null,
      urlField(model),
      usedInList(model),
      message,
      actions);
    if (model.showAlt) syncAltUi(item);
  }

  return {
    show,
    flushAlt,
    shownId: () => shownId,
    focusAlt: () => detailBody.querySelector('#media-alt')?.focus(),
  };
}
