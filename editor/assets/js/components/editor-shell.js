/**
 * <editor-shell> — layout container for the editor.
 * No Shadow DOM — uses light DOM with CSS grid for layout.
 * Manages toolbar, editor pane, sidebar (doc browser + meta panel),
 * and inspector areas.
 *
 * Listens for doc-browser custom events and delegates to editor functions.
 *
 * @module editor/components/editor-shell
 */

import { loadDocument, createNewDocument, deleteDoc, getSaveStatus } from '../editor.js';

export class EditorShell extends HTMLElement {
  connectedCallback() {
    // Inspector toggle
    this.inspectorToggle = this.querySelector('[data-toggle-inspector]');
    if (this.inspectorToggle) {
      this.inspectorToggle.addEventListener('click', () => this.toggleInspector());
    }

    // Doc browser events (bubble up from <doc-browser>)
    this.addEventListener('doc-select', async (e) => {
      await loadDocument(e.detail.id);
      this.querySelector('doc-browser')?.highlightCurrent();
    });

    this.addEventListener('doc-create', async (e) => {
      await createNewDocument({ collection: e.detail.collection });
      this.querySelector('doc-browser')?.refresh();
    });

    this.addEventListener('doc-delete', async (e) => {
      await deleteDoc(e.detail.id);
      this.querySelector('doc-browser')?.refresh();
    });

    // Save status indicator
    this.saveIndicator = this.querySelector('.save-indicator');
    window.__onSaveStatusChange = (status) => {
      if (this.saveIndicator) {
        this.saveIndicator.className = `save-indicator ${status}`;
        const labels = { saved: 'Saved', saving: 'Saving...', unsaved: 'Unsaved' };
        this.saveIndicator.textContent = labels[status] || '';
      }
    };
  }

  toggleInspector() {
    this.classList.toggle('inspector-open');
  }

  get inspectorOpen() {
    return this.classList.contains('inspector-open');
  }

  set inspectorOpen(val) {
    this.classList.toggle('inspector-open', val);
  }
}

customElements.define('editor-shell', EditorShell);
