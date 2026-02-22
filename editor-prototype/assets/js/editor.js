/**
 * Main editor initialization.
 * Sets up ProseMirror with schema, keymap, toolbar, and view.
 *
 * @module editor/editor
 */

import { EditorState, Plugin } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { history } from 'prosemirror-history';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { toggleMark } from 'prosemirror-commands';

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
import './components/editor-shell.js';
import './components/ast-inspector.js';
import './components/meta-panel.js';

// Re-export meta-state functions for convenience
export { getCurrentMeta, setCurrentMeta, getCurrentDocId } from './meta-state.js';

let editorView = null;
let toolbar = null;

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

  setupFixtureLoader();
  setupExportButton();
  restoreFromStorage();

  // Trigger initial AST inspector update (setEditorDoc bypasses dispatchTransaction)
  if (window.__onEditorUpdate) {
    window.__onEditorUpdate(editorView.state);
  }

  editorView.focus();
}

function setupFixtureLoader() {
  const select = document.querySelector('[data-fixture-loader]');
  if (!select) return;

  select.addEventListener('change', async () => {
    const file = select.value;
    if (!file) return;

    try {
      const resp = await fetch(`../test/fixtures/${file}`);
      if (!resp.ok) throw new Error(`Failed to load ${file}`);
      const doc = await resp.json();

      if (doc.meta) resetCurrentMeta(doc.meta);
      if (doc.id) setCurrentDocId(doc.id);

      const pmDoc = fromBlockAst(doc.blocks || [], schema);
      setEditorDoc(pmDoc);

      if (window.__onEditorUpdate) {
        window.__onEditorUpdate(editorView.state);
      }
      if (window.__onMetaUpdate) {
        window.__onMetaUpdate(getCurrentMeta());
      }
    } catch (err) {
      console.error('Error loading fixture:', err);
      alert(`Error loading fixture: ${err.message}`);
    }

    select.value = '';
  });
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

// --- localStorage persistence ---

const STORAGE_KEY = 'vp-editor-doc';
const STORAGE_META_KEY = 'vp-editor-meta';
let saveTimer = null;

function debouncedSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveToStorage, 500);
}

function saveToStorage() {
  if (!editorView) return;
  try {
    const blocks = toBlockAst(editorView.state.doc);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(blocks));
    localStorage.setItem(STORAGE_META_KEY, JSON.stringify(getCurrentMeta()));
  } catch (e) {
    // Storage full or unavailable
  }
}

function restoreFromStorage() {
  try {
    const blocksJson = localStorage.getItem(STORAGE_KEY);
    const metaJson = localStorage.getItem(STORAGE_META_KEY);

    if (blocksJson) {
      const blocks = JSON.parse(blocksJson);
      if (Array.isArray(blocks) && blocks.length > 0) {
        const pmDoc = fromBlockAst(blocks, schema);
        setEditorDoc(pmDoc);
      }
    }

    if (metaJson) {
      const meta = JSON.parse(metaJson);
      setCurrentMeta(meta);
      if (window.__onMetaUpdate) {
        window.__onMetaUpdate(getCurrentMeta());
      }
    }
  } catch (e) {
    // Corrupt storage
  }
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initEditor);
} else {
  initEditor();
}
