/**
 * Shared document metadata state.
 * Extracted to avoid circular imports between editor.js and meta-panel.js.
 *
 * @module editor/meta-state
 */

let currentMeta = {
  title: '', // a new post starts untitled (the title line shows an "Untitled" placeholder)
  slug: 'untitled',
  collection: 'posts',
  status: 'draft',
  created: new Date().toISOString().split('T')[0],
  updated: new Date().toISOString().split('T')[0],
};

let currentDocId = 'doc_new';

export function getCurrentMeta() { return currentMeta; }

export function setCurrentMeta(meta) {
  currentMeta = { ...currentMeta, ...meta };
}

export function resetCurrentMeta(meta) {
  currentMeta = { ...meta };
}

export function getCurrentDocId() { return currentDocId; }

export function setCurrentDocId(id) {
  currentDocId = id;
}

/** Notes to show with the next save's state (what an insert did, e.g. a PDF inserted as a link). */
let saveNotes = [];

export function addSaveNote(text) {
  if (!saveNotes.includes(text)) saveNotes.push(text);
}

/** The pending notes, cleared. */
export function takeSaveNotes() {
  const notes = saveNotes;
  saveNotes = [];
  return notes;
}

/** Drop pending notes (another post opened). */
export function clearSaveNotes() {
  saveNotes = [];
}

/** The post goes back to the site theme: drop `theme` and `themeScope` from the current meta. */
export function clearPageTheme() {
  const { theme, themeScope, ...rest } = currentMeta;
  currentMeta = rest;
}

/**
 * The meta a save sends. The server merges it over the stored meta, so a page
 * theme the post no longer has (`clearPageTheme`) is sent as null to drop it.
 * @param {Object} meta
 * @returns {Object}
 */
export function metaToSave(meta) {
  return { ...meta, theme: meta.theme ?? null, themeScope: meta.themeScope ?? null };
}
