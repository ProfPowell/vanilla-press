/**
 * Uploading media: one request with progress, and a small queue that runs a
 * few at a time so one bad file never stops the rest.
 * @module media-upload
 */
import { checkBeforeUpload, LARGE_NOTE } from '../../../src/media/limits.js';

const UNREACHABLE = "Upload failed: the app didn't answer. Is vp still running?";

/**
 * POST one file to `<base>/media`.
 * @param {string} base e.g. `/api/sites/<id>`
 * @param {File} file
 * @param {{ alt?: string|null, editedFrom?: string, credit?: object, source?: string,
 *   onProgress?: (fraction: number) => void }} [opts] `credit` is a Credit (sent as JSON);
 *   `source` the web image service it came from
 * @returns {Promise<object>} the new MediaItem plus `large`
 */
export function uploadMedia(base, file, { alt, editedFrom, credit, source, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('file', file, file.name);
    if (alt != null) form.append('alt', alt);
    if (editedFrom) form.append('edited_from', editedFrom);
    if (credit) form.append('credit', JSON.stringify(credit));
    if (source) form.append('source', source);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${base}/media`);
    xhr.responseType = 'text';
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onerror = () => reject(new Error(UNREACHABLE));
    xhr.onabort = xhr.onerror;
    xhr.ontimeout = xhr.onerror;
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* no body */ }
      if (xhr.status >= 200 && xhr.status < 300 && data) resolve(data);
      else reject(new Error(data?.error || `Upload failed (${xhr.status}). Try again.`));
    };
    xhr.send(form);
  });
}

/**
 * A queue of uploads, `concurrency` at a time. Every file ends `done` or `error`.
 * @param {{ upload: (file: File, opts: { onProgress: (f: number) => void }) => Promise<object>, concurrency?: number, onChange?: () => void }} opts
 */
export function createUploadQueue({ upload, concurrency = 2, onChange = () => {} }) {
  /** @type {Array<object>} */
  let list = [];
  const files = new Map();
  let seq = 0;

  const pump = () => {
    for (const entry of list) {
      if (list.filter((e) => e.state === 'uploading').length >= concurrency) break;
      if (entry.state === 'waiting') start(entry);
    }
  };

  async function start(entry) {
    entry.state = 'uploading';
    onChange();
    try {
      const item = await upload(files.get(entry.key), {
        onProgress: (f) => { entry.progress = f; onChange(); },
      });
      entry.item = item;
      entry.progress = 1;
      entry.state = 'done';
      if (item?.large) entry.note = LARGE_NOTE;
    } catch (err) {
      entry.state = 'error';
      entry.error = err?.message || 'Upload failed. Try again.';
    }
    files.delete(entry.key);
    onChange();
    pump();
  }

  return {
    add(incoming) {
      for (const file of incoming) {
        const entry = { key: `u${++seq}`, name: file.name, size: file.size, state: 'waiting', progress: 0, error: null, note: null, item: null };
        const check = checkBeforeUpload(file);
        if (check.ok) files.set(entry.key, file);
        else { entry.state = 'error'; entry.error = check.error; }
        list.push(entry);
      }
      pump();
      onChange();
    },
    entries: () => list,
    dismiss(key) {
      list = list.filter((e) => e.key !== key || e.state === 'waiting' || e.state === 'uploading');
      onChange();
    },
  };
}
