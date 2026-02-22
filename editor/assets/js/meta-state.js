/**
 * Shared document metadata state.
 * Extracted to avoid circular imports between editor.js and meta-panel.js.
 *
 * @module editor/meta-state
 */

let currentMeta = {
  title: 'Untitled',
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
