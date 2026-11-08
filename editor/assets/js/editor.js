/**
 * Main editor initialization.
 * Sets up ProseMirror with schema, keymap, format toolbar, block handles, and view.
 * Uses the content API for persistence instead of localStorage.
 *
 * @module editor/editor
 */

import { EditorState, Plugin } from 'prosemirror-state';
import { EditorView, Decoration, DecorationSet } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { history } from 'prosemirror-history';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { tableEditing, goToNextCell } from 'prosemirror-tables';

import { schema } from './schema.js';
import { buildKeymap, buildBaseKeymap } from './keymap.js';
import { buildInputRules } from './input-rules.js';
import { formatToolbarPlugin, setFormatToolbarComponents } from './format-toolbar.js';
import { blockHandlesPlugin } from './block-handles.js';
import { toBlockAst, fromBlockAst } from './ast.js';
import { titleOf, titleKeymap, titlePastePlugin, metaLineText } from './title.js';
import { slugIsHandEdited, isPlaceholderSlug, slugAfterTitleEdit } from './slug.js';
import { getCurrentMeta, setCurrentMeta, resetCurrentMeta,
  getCurrentDocId, setCurrentDocId, takeSaveNotes, clearSaveNotes, addSaveNote } from './meta-state.js';
import { CodeBlockView } from './blocks/code-block-view.js';
import { CalloutView } from './blocks/callout-view.js';
import { CollapsibleView } from './blocks/collapsible-view.js';
import { CardView } from './blocks/card-view.js';
import { TabsView } from './blocks/tabs-view.js';
import { StepsView, StepView } from './blocks/steps-view.js';
import { FigureView, focusFigureAlt } from './blocks/figure-view.js';
import {
  ComponentView, InlineComponentView, componentSettingsPlugin, setComponentDescriptors,
} from './blocks/component-view.js';
import { getBlockPalette } from './components/block-palette.js';
import { insertTargetPlugin } from './insert-target.js';
import { mediaDropPlugin } from './media-drop.js';
import { insertPlan, pdfViewerEnabled } from './media-insert.js';
import { api } from './api-client.js';
import './components/editor-shell.js';
import './components/ast-inspector.js';
import './components/meta-panel.js';
import './components/doc-browser.js';
import './components/theme-picker.js';
import './components/component-settings.js';
import './components/more-menu.js';
import './components/confirm-panel.js';
import { initPatterns } from './patterns.js';
import { enabledDescriptors, unrepresentable, withoutDropped } from './component-model.js';
import { isSiteMode, initSiteMode } from './site-mode.js';
import { saveErrorMessage } from './site-context.js';

// Re-export meta-state functions for convenience
export { getCurrentMeta, setCurrentMeta, getCurrentDocId } from './meta-state.js';

let editorView = null;
let saveTimer = null;
let saveStatus = 'saved'; // 'saved' | 'saving' | 'unsaved' | 'conflict' | 'error'
/** Documents whose JSON changed on disk: id → message. Auto-save is paused for these. */
const conflicts = new Map();
/**
 * Why the open document must not be auto-saved, or null: set on load when
 * the post holds content the editor cannot represent (saving would drop it).
 */
let saveHold = null;
/**
 * The open post's slug was set by hand, so it no longer follows the title
 * (plan ruling P2). Taken from the stored meta on load (it survives a reload);
 * set when the slug is edited in the meta panel.
 */
let slugHandEdited = false;

/** Whether a loaded post's slug was set by hand. A new post's `untitled-<stamp>` follows its first title. */
const handEditedOnLoad = (meta) => slugIsHandEdited(meta) && !isPlaceholderSlug(meta.slug);

/**
 * Record whether the slug was edited by hand (the meta panel's slug field).
 * @param {boolean} edited
 */
export function setSlugHandEdited(edited) {
  slugHandEdited = edited;
}

/**
 * The title (the document's first line) changed: it is `meta.title`, and the
 * slug follows it unless the post is published or its slug was set by hand.
 * @param {string} title
 */
function titleEdited(title) {
  const meta = getCurrentMeta();
  setCurrentMeta({ title, slug: slugAfterTitleEdit(meta, title, { handEdited: slugHandEdited }) });
  if (window.__onMetaUpdate) window.__onMetaUpdate(getCurrentMeta());
}

/**
 * The title's placeholder ("Untitled", while it is empty) and the meta line
 * above it ("Published Nov 3, 2026 · posts" / "Draft · posts"). Recomputed on
 * every view update; `refreshMetaLine()` updates it after a meta-only change.
 */
function createTitleDecorationsPlugin() {
  return new Plugin({
    props: {
      decorations(state) {
        const text = metaLineText(getCurrentMeta());
        const metaLine = Decoration.widget(0, () => {
          const el = document.createElement('div');
          el.className = 'doc-meta-line';
          el.contentEditable = 'false';
          el.textContent = text;
          return el;
        }, { side: -1, key: `meta-line:${text}`, ignoreSelection: true });
        const title = state.doc.firstChild;
        const decorations = [metaLine];
        if (title.content.size === 0) {
          decorations.push(Decoration.node(0, title.nodeSize, { 'data-placeholder': 'Untitled' }));
        }
        return DecorationSet.create(state.doc, decorations);
      },
    },
  });
}

/** Redraw the meta line after the meta changed without an edit (status, collection). */
export function refreshMetaLine() {
  if (editorView) editorView.dispatch(editorView.state.tr.setMeta('addToHistory', false));
}

/** A Post settings field changed the meta: auto-save it like an edit to the text. */
export function metaEdited() {
  setSaveStatus('unsaved');
  debouncedSave();
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
              // With a filter, Backspace edits the filter only; with none it
              // closes the palette and deletes the '/' as usual (opened from
              // a `+` handle there is no '/': it only closes).
              if (palette.filter.length > 0 || palette.insertAfter != null) {
                event.preventDefault();
                palette.backspace();
                return true;
              }
              palette.close();
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
            // Open now (not on a timer) so the very next keys reach the filter
            palette.open(view, from);
          }
        }
        return false;
      },
    },
  });
}

/** Initialize the editor */
export function initEditor() {
  const editorEl = document.querySelector('.editor-content');

  if (!editorEl) {
    console.error('Editor mount points not found');
    return;
  }

  slugHandEdited = handEditedOnLoad(getCurrentMeta());
  const state = EditorState.create({
    schema,
    doc: fromBlockAst([], schema, { title: getCurrentMeta().title }),
    plugins: [
      // First: while the palette is open it owns Enter, Escape, arrows and
      // Backspace, which the keymaps below would otherwise consume.
      createSlashPlugin(),
      // Before titlePastePlugin: a dragged list item, tab or step never
      // drops out of its kind of parent (onto the title either)
      blockHandlesPlugin({
        addAt: (view, pos) => getBlockPalette().open(view, pos, { insertAfter: pos }),
      }),
      buildInputRules(),
      history(),
      // Before the other keymaps: Enter, Backspace, Delete and Mod-a at the title's edge
      keymap(titleKeymap()),
      // Before titlePastePlugin: files dropped or pasted anywhere (the title
      // too) upload and land as their blocks
      ...mediaDropPlugin({
        upload: (file, opts) => api.uploadMedia(file, opts),
        plan: async (item) => insertPlan(item, {
          // Asked per PDF: a package turned on after the editor loaded counts
          pdfViewer: item.kind === 'pdf' ? pdfViewerEnabled(await api.listComponents().catch(() => null)) : false,
        }),
        onInserted: (view, pos, plan) => {
          // The alt field takes focus unless the writer has moved to another field
          const active = document.activeElement;
          const free = !active || active === document.body || view.dom.contains(active);
          if (plan.focusAlt && free) focusFigureAlt(view, pos);
          if (plan.note) addSaveNote(plan.note);
        },
      }),
      titlePastePlugin(),
      createTitleDecorationsPlugin(),
      buildKeymap(),
      buildBaseKeymap(),
      dropCursor(),
      gapCursor(),
      formatToolbarPlugin(),
      tableEditing(),
      componentSettingsPlugin(),
      // Keeps the palette's insert position right while the media picker is open
      insertTargetPlugin(),
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
      steps: (node) => new StepsView(node),
      step: (node, view, getPos) => new StepView(node, view, getPos),
      figure: (node, view, getPos) => new FigureView(node, view, getPos),
      component_leaf: (node, view, getPos) => new ComponentView(node, view, getPos),
      component_blocks: (node, view, getPos) => new ComponentView(node, view, getPos),
      component_inline: (node, view, getPos) => new InlineComponentView(node, view, getPos),
    },
    dispatchTransaction(transaction) {
      const oldDoc = editorView.state.doc;
      const newState = editorView.state.apply(transaction);
      editorView.updateState(newState);

      if (transaction.docChanged && titleOf(newState.doc) !== titleOf(oldDoc)) {
        titleEdited(titleOf(newState.doc));
      }

      if (window.__onEditorUpdate) {
        window.__onEditorUpdate(newState);
      }

      // A save's own clean-up (attributes the server removed) is already saved
      if (transaction.docChanged && !transaction.getMeta(SERVER_NORMALIZED)) {
        setSaveStatus('unsaved');
        debouncedSave();
      }
    },
  });

  // Expose for external use
  window.__editorView = editorView;
  window.__editorSchema = schema;

  initPatterns();
  loadComponents();
  initSiteMode();

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

/**
 * Load component descriptors once and offer the enabled ones: block kinds
 * in the `/` palette, inline kinds under the format toolbar's More menu. The live
 * component views get all of them (to label the ones not on for this site).
 * A failure leaves the editor without component entries.
 */
async function loadComponents() {
  try {
    const res = await api.listComponents();
    const descriptors = enabledDescriptors(res);
    getBlockPalette().registerComponents(descriptors);
    setFormatToolbarComponents(descriptors.filter(d => d.kind === 'inline'));
    setComponentDescriptors(res);
    // Refresh the settings panel for a component selected before this arrived
    if (editorView) editorView.dispatch(editorView.state.tr);
  } catch (err) {
    console.warn('Components unavailable:', err);
  }
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
  getBlockPalette().close(); // its trigger position belongs to the old doc
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
    clearSaveNotes(); // notes belong to the post they were made in
    if (doc.meta) resetCurrentMeta(doc.meta);
    slugHandEdited = handEditedOnLoad(getCurrentMeta());
    const lossy = unrepresentable(doc.blocks || []);
    saveHold = lossy.length
      ? `Not saving: this post has content the editor can't show (${lossy.join(', ')}). Edit it in its file instead.`
      : null;
    if (lossy.length) console.warn('Unrepresentable content, auto-save off:', lossy);

    // The title is the document's first line (an empty post still gets a paragraph)
    setEditorDoc(fromBlockAst(doc.blocks || [], schema, { title: getCurrentMeta().title || '' }));

    // Update URL hash
    window.location.hash = `doc-${doc.id}`;

    // Sync UI
    if (window.__onEditorUpdate) {
      window.__onEditorUpdate(editorView.state);
    }
    if (window.__onMetaUpdate) {
      window.__onMetaUpdate(getCurrentMeta());
    }

    if (saveHold) setSaveStatus('error', saveHold);
    else setSaveStatus(conflicts.has(doc.id) ? 'conflict' : 'saved');
    notifyConflict();
  } catch (err) {
    console.error('Error loading document:', err);
    if (isSiteMode) setSaveStatus('error', `Couldn't open the post: ${err.message}`);
    else alert(`Error loading document: ${err.message}`);
  }
}

/** Transaction meta: the change mirrors what the server already stored. */
const SERVER_NORMALIZED = 'vpServerNormalized';

/**
 * Take a save's `dropped` component attributes (the server removed attributes
 * the component does not declare) out of the editor's doc too, so the settings
 * panel shows what is stored. Not an undo step and not a new save; the
 * selection maps through (setNodeMarkup moves nothing).
 * @param {Array<{ tag: string, attr: string }>|undefined} dropped
 */
function applyDropped(dropped) {
  if (!editorView || !dropped?.length) return;
  const { state } = editorView;
  const tr = state.tr;
  state.doc.descendants((node, pos) => {
    if (!node.type.name.startsWith('component_')) return true;
    const next = withoutDropped(node.attrs.tag, node.attrs.attrs, dropped);
    if (next) tr.setNodeMarkup(pos, null, { ...node.attrs, attrs: next });
    return true;
  });
  if (!tr.docChanged) return;
  tr.setMeta('addToHistory', false);
  tr.setMeta(SERVER_NORMALIZED, true);
  editorView.dispatch(tr);
}

/**
 * The save status message for a save's `notices` and any notes an edit left
 * for it (escaped by the indicator: it sets textContent).
 */
function noticesMessage(saved) {
  const notes = [...(saved?.notices || []), ...takeSaveNotes()];
  return notes.length ? notes.join(' ') : undefined;
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
  if (saveHold) {
    setSaveStatus('error', saveHold);
    return false;
  }
  if (conflicts.has(docId)) {
    setSaveStatus('conflict');
    return false;
  }

  setSaveStatus('saving');

  try {
    const blocks = toBlockAst(editorView.state.doc);
    const meta = getCurrentMeta();

    const saved = await api.updateDocument(docId, { meta, blocks });
    applyDropped(saved?.dropped);
    setSaveStatus('saved', noticesMessage(saved));
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
      applyDropped(doc.dropped);
      setSaveStatus('saved', noticesMessage(doc));
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
 * until the on-disk version is loaded); a 400 with validation `errors` shows
 * them; a 422 (not saved, or saved but not
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
  } else if (err.status === 422 || err.status >= 500 || (err.status === 400 && err.data?.errors?.length)) {
    // A 400 with `errors` failed validation: say what to fix (auto-save keeps trying)
    setSaveStatus('error', saveErrorMessage(err));
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
      title: '',
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
    if (saveTimer) clearTimeout(saveTimer); // a pending auto-save must not re-create it
    setCurrentDocId(null);
    saveHold = null;
    resetCurrentMeta({
      title: '',
      slug: 'untitled',
      collection: 'posts',
      status: 'draft',
    });
    slugHandEdited = false;
    setEditorDoc(fromBlockAst([], schema));
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
