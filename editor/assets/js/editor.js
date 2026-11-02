/**
 * Main editor initialization.
 * Sets up ProseMirror with schema, keymap, toolbar, and view.
 * Uses the content API for persistence instead of localStorage.
 *
 * @module editor/editor
 */

import { EditorState, Plugin } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { history } from 'prosemirror-history';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { toggleMark } from 'prosemirror-commands';
import { tableEditing, goToNextCell } from 'prosemirror-tables';

import { schema } from './schema.js';
import { buildKeymap, buildBaseKeymap } from './keymap.js';
import { buildInputRules } from './input-rules.js';
import { EditorToolbar } from './menu.js';
import { toBlockAst, fromBlockAst } from './ast.js';
import { getCurrentMeta, setCurrentMeta, resetCurrentMeta,
  getCurrentDocId, setCurrentDocId } from './meta-state.js';
import { CodeBlockView } from './blocks/code-block-view.js';
import { CalloutView } from './blocks/callout-view.js';
import { CollapsibleView } from './blocks/collapsible-view.js';
import { CardView } from './blocks/card-view.js';
import { TabsView } from './blocks/tabs-view.js';
import { StepsView } from './blocks/steps-view.js';
import { FigureView } from './blocks/figure-view.js';
import { getBlockPalette } from './components/block-palette.js';
import { api } from './api-client.js';
import './components/editor-shell.js';
import './components/ast-inspector.js';
import './components/meta-panel.js';
import './components/doc-browser.js';
import './components/theme-picker.js';
import { initPatterns } from './patterns.js';

// Re-export meta-state functions for convenience
export { getCurrentMeta, setCurrentMeta, getCurrentDocId } from './meta-state.js';

let editorView = null;
let toolbar = null;
let saveTimer = null;
let saveStatus = 'saved'; // 'saved' | 'saving' | 'unsaved' | 'conflict' | 'error'
/** Documents whose JSON changed on disk: id → message. Auto-save is paused for these. */
const conflicts = new Map();

function createToolbarPlugin() {
  return new Plugin({
    view() {
      return {
        update(view) {
          if (toolbar) toolbar.update(view.state);
        },
      };
    },
  });
}

// --- Slash command plugin ---
function createSlashPlugin() {
  const palette = getBlockPalette();

  return new Plugin({
    props: {
      handleKeyDown(view, event) {
        if (palette.visible) {
          switch (event.key) {
            case 'ArrowUp':
              event.preventDefault();
              palette.moveUp();
              return true;
            case 'ArrowDown':
              event.preventDefault();
              palette.moveDown();
              return true;
            case 'Enter':
              event.preventDefault();
              palette.selectCurrent();
              return true;
            case 'Escape':
              event.preventDefault();
              palette.close();
              return true;
            case 'Backspace':
              event.preventDefault();
              palette.backspace();
              return false;
            default:
              if (event.key.length === 1 && !event.metaKey && !event.ctrlKey) {
                event.preventDefault();
                palette.updateFilter(event.key);
                return true;
              }
          }
        }
        return false;
      },

      handleTextInput(view, from, to, text) {
        if (text === '/') {
          const { $from } = view.state.selection;
          if ($from.parent.type.name === 'paragraph' && $from.parent.textContent === '') {
            setTimeout(() => {
              palette.open(view, from);
            }, 0);
          }
        }
        return false;
      },
    },
  });
}

// --- Link shortcut plugin (Mod+K) ---
function createLinkPlugin() {
  return new Plugin({
    props: {
      handleKeyDown(view, event) {
        if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
          event.preventDefault();
          const { state, dispatch } = view;
          const { link: linkMark } = schema.marks;

          const { from, $from, to, empty } = state.selection;
          const hasLink = empty
            ? !!linkMark.isInSet(state.storedMarks || $from.marks())
            : state.doc.rangeHasMark(from, to, linkMark);

          if (hasLink) {
            toggleMark(linkMark)(state, dispatch);
            return true;
          }

          const href = prompt('Enter URL:');
          if (!href) return true;
          toggleMark(linkMark, { href })(state, dispatch);
          return true;
        }
        return false;
      },
    },
  });
}

/** Initialize the editor */
export function initEditor() {
  const editorEl = document.querySelector('.editor-content');
  const toolbarEl = document.querySelector('.editor-toolbar');

  if (!editorEl || !toolbarEl) {
    console.error('Editor mount points not found');
    return;
  }

  // Save utility buttons before toolbar render wipes them
  const utilitySection = toolbarEl.querySelector('.toolbar-utils');

  const state = EditorState.create({
    schema,
    doc: schema.node('doc', null, [
      schema.node('paragraph'),
    ]),
    plugins: [
      buildInputRules(),
      history(),
      buildKeymap(),
      buildBaseKeymap(),
      dropCursor(),
      gapCursor(),
      createToolbarPlugin(),
      createLinkPlugin(),
      createSlashPlugin(),
      tableEditing(),
    ],
  });

  editorView = new EditorView(editorEl, {
    state,
    nodeViews: {
      code_block: (node, view, getPos) => new CodeBlockView(node, view, getPos),
      callout: (node, view, getPos) => new CalloutView(node, view, getPos),
      collapsible: (node, view, getPos) => new CollapsibleView(node, view, getPos),
      card: (node, view, getPos) => new CardView(node, view, getPos),
      tabs: (node, view, getPos) => new TabsView(node, view, getPos),
      steps: (node, view, getPos) => new StepsView(node, view, getPos),
      figure: (node, view, getPos) => new FigureView(node, view, getPos),
    },
    dispatchTransaction(transaction) {
      const newState = editorView.state.apply(transaction);
      editorView.updateState(newState);

      if (window.__onEditorUpdate) {
        window.__onEditorUpdate(newState);
      }

      if (transaction.docChanged) {
        setSaveStatus('unsaved');
        debouncedSave();
      }
    },
  });

  toolbar = new EditorToolbar(toolbarEl, editorView);
  // Re-append utility section after toolbar renders
  if (utilitySection) {
    toolbarEl.appendChild(utilitySection);
  }
  toolbar.update(editorView.state);

  // Expose for external use
  window.__editorView = editorView;
  window.__editorSchema = schema;

  setupExportButton();
  initPatterns();

  // Trigger initial AST inspector update
  if (window.__onEditorUpdate) {
    window.__onEditorUpdate(editorView.state);
  }

  // Load document from URL hash or show empty
  const hashDoc = window.location.hash.match(/^#doc-(.+)/);
  if (hashDoc) {
    loadDocument(hashDoc[1]);
  }

  editorView.focus();
}

function setupExportButton() {
  const btn = document.querySelector('[data-export-json]');
  if (!btn) return;

  btn.addEventListener('click', () => {
    exportDocument();
  });
}

export function exportDocument() {
  if (!editorView) return;

  const blocks = toBlockAst(editorView.state.doc);
  const meta = getCurrentMeta();
  const doc = {
    id: getCurrentDocId(),
    meta: { ...meta, updated: new Date().toISOString().split('T')[0] },
    blocks,
  };

  const json = JSON.stringify(doc, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${meta.slug || 'document'}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Replace editor content with a new PM document.
 * @param {import('prosemirror-model').Node} doc
 */
export function setEditorDoc(doc) {
  if (!editorView) return;
  const state = EditorState.create({
    schema,
    doc,
    plugins: editorView.state.plugins,
  });
  editorView.updateState(state);
}

export function getEditorDoc() {
  return editorView ? editorView.state.doc : null;
}

export function getEditorView() {
  return editorView;
}

// --- API persistence ---

/**
 * Load a document from the API into the editor.
 * @param {string} id
 */
export async function loadDocument(id) {
  try {
    const doc = await api.getDocument(id);

    setCurrentDocId(doc.id);
    if (doc.meta) resetCurrentMeta(doc.meta);

    if (doc.blocks && doc.blocks.length > 0) {
      const pmDoc = fromBlockAst(doc.blocks, schema);
      setEditorDoc(pmDoc);
    } else {
      setEditorDoc(schema.node('doc', null, [schema.node('paragraph')]));
    }

    // Update URL hash
    window.location.hash = `doc-${doc.id}`;

    // Sync UI
    if (window.__onEditorUpdate) {
      window.__onEditorUpdate(editorView.state);
    }
    if (window.__onMetaUpdate) {
      window.__onMetaUpdate(getCurrentMeta());
    }

    setSaveStatus(conflicts.has(doc.id) ? 'conflict' : 'saved');
    notifyConflict();
  } catch (err) {
    console.error('Error loading document:', err);
    alert(`Error loading document: ${err.message}`);
  }
}

/**
 * Save the current document to the API.
 * Does nothing while the document is in conflict with its file on disk.
 * @returns {Promise<boolean>} true when saved (and synced)
 */
export async function saveDocument() {
  if (!editorView) return false;

  const docId = getCurrentDocId();
  // The page the editor opens on (or shows after a delete) is not stored
  // yet: its first save creates the document.
  if (!docId || docId === 'doc_new') return createFromEditor();
  if (conflicts.has(docId)) {
    setSaveStatus('conflict');
    return false;
  }

  setSaveStatus('saving');

  try {
    const blocks = toBlockAst(editorView.state.doc);
    const meta = getCurrentMeta();

    await api.updateDocument(docId, { meta, blocks });
    setSaveStatus('saved');
    return true;
  } catch (err) {
    handleSaveError(docId, err);
    return false;
  }
}

/** The in-flight create, so rapid auto-saves create one document, not several. */
let creating = null;

/**
 * Create a document from what is in the editor now (title, meta, blocks),
 * make it the current document, and list it in the document browser.
 * @returns {Promise<boolean>} true when created (and synced)
 */
function createFromEditor() {
  if (creating) return creating;
  creating = (async () => {
    setSaveStatus('saving');
    const meta = { ...getCurrentMeta() };
    if (!meta.slug || meta.slug === 'untitled') meta.slug = 'untitled-' + Date.now().toString(36);
    if (!meta.collection) meta.collection = 'posts';
    try {
      const doc = await api.createDocument({ meta, blocks: toBlockAst(editorView.state.doc) });
      setCurrentDocId(doc.id);
      setCurrentMeta({ slug: doc.meta.slug });
      window.location.hash = `doc-${doc.id}`;
      setSaveStatus('saved');
      document.querySelector('doc-browser')?.refresh();
      return true;
    } catch (err) {
      handleSaveError(null, err);
      return false;
    } finally {
      creating = null;
    }
  })();
  return creating;
}

/**
 * Show a failed save: a 409 puts the document in conflict (auto-save paused
 * until the on-disk version is loaded); a 422 (not saved, or saved but not
 * synced) shows its message in the save indicator and auto-save continues.
 * @param {string} docId
 * @param {Error & { status?: number }} err
 */
export function handleSaveError(docId, err) {
  console.error('Error saving document:', err);
  if (err.status === 409) {
    conflicts.set(docId, err.message);
    setSaveStatus('conflict');
    notifyConflict();
  } else if (err.status === 422 || err.status >= 500) {
    setSaveStatus('error', err.message);
  } else {
    setSaveStatus('unsaved');
  }
}

/**
 * Replace the stored document with its version on disk, load it, and resume
 * auto-save for it. If it was deleted on disk, clear it from the editor.
 * @param {string} docId
 */
export async function loadVersionOnDisk(docId) {
  const result = await api.reloadDocument(docId);
  conflicts.delete(docId);
  // Deleted on disk (e.g. pulled): the server dropped it from the store too.
  if (result?.deleted) {
    clearIfCurrent(docId);
    setSaveStatus('saved');
    notifyConflict();
    return;
  }
  await loadDocument(docId);
}

function notifyConflict() {
  const docId = getCurrentDocId();
  if (window.__onConflictChange) {
    window.__onConflictChange(docId, conflicts.get(docId) ?? null);
  }
}

/**
 * Create a new document via the API and load it into the editor.
 * @param {Object} [options]
 * @param {string} [options.collection='posts']
 * @returns {Promise<Object>} The created document
 */
export async function createNewDocument(options = {}) {
  const collection = options.collection || 'posts';
  const now = new Date().toISOString();

  const doc = await api.createDocument({
    meta: {
      title: 'Untitled',
      slug: 'untitled-' + Date.now().toString(36),
      collection,
      status: 'draft',
      created: now,
      updated: now,
    },
    blocks: [
      { type: 'paragraph', children: [{ type: 'text', value: '' }] },
    ],
  });

  await loadDocument(doc.id);
  return doc;
}

/**
 * Delete a document via the API.
 * @param {string} id
 */
export async function deleteDoc(id) {
  await api.deleteDocument(id);
  conflicts.delete(id);
  clearIfCurrent(id);
}

/** If `id` is the open document, clear the editor (it no longer exists). */
function clearIfCurrent(id) {
  if (id === getCurrentDocId()) {
    setCurrentDocId(null);
    resetCurrentMeta({
      title: 'Untitled',
      slug: 'untitled',
      collection: 'posts',
      status: 'draft',
    });
    setEditorDoc(schema.node('doc', null, [schema.node('paragraph')]));
    window.location.hash = '';

    if (window.__onMetaUpdate) {
      window.__onMetaUpdate(getCurrentMeta());
    }
  }
}

// --- Debounced auto-save ---

function debouncedSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDocument, 500);
}

// --- Save status ---

function setSaveStatus(status, message) {
  saveStatus = status;
  if (window.__onSaveStatusChange) {
    window.__onSaveStatusChange(status, message);
  }
}

export function getSaveStatus() {
  return saveStatus;
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initEditor);
} else {
  initEditor();
}
