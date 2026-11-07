/**
 * <editor-shell> — layout container for the editor.
 * No Shadow DOM — uses light DOM with CSS grid for layout.
 * Holds the top bar, the editor pane and the Post settings panel (component
 * settings, meta panel; in vp serve also the doc browser and theme picker).
 * The panel shows either the settings or the block tree (`ast-open`).
 *
 * Listens for doc-browser custom events and delegates to editor functions.
 *
 * @module editor/components/editor-shell
 */

import { loadDocument, createNewDocument, deleteDoc } from '../editor.js';
import { api } from '../api-client.js';
import { onSaveStatus } from '../site-mode.js';

export class EditorShell extends HTMLElement {
  connectedCallback() {
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
      try {
        await deleteDoc(e.detail.id);
      } catch (err) {
        // Not deleted (409: its JSON changed on disk, or a published post; 500: unexpected): say why
        console.error('Delete error:', err);
        onSaveStatus('error', err.message);
        return;
      }
      this.querySelector('doc-browser')?.refresh();
    });

    // "Back to settings" in the block tree
    this.addEventListener('ast-close', () => this.toggleInspector(false));

    // The header's save pill shows the save state (in the app and in vp serve)
    window.__onSaveStatusChange = (status, message) => onSaveStatus(status, message);

    this.showSite();
  }

  /** Label the sidebar with the site being edited (or demo mode). */
  async showSite() {
    const label = this.querySelector('[data-site-label]');
    if (!label) return;
    try {
      const { site, syncEnabled } = await api.getWorkspace();
      const name = site ? site.replace(/[\\/]+$/, '').split(/[\\/]/).pop() : '';
      label.textContent = syncEnabled ? `Site: ${name}` : 'Demo content (not synced)';
      label.title = site || '';
      label.classList.toggle('demo', !syncEnabled);
    } catch (err) {
      console.error('Error loading workspace:', err);
    }
  }

  /**
   * Swap the settings panel's contents for the block tree, or back.
   * Focus moves to the heading of what is shown.
   * @param {boolean} [open] - default: the other one
   */
  toggleInspector(open = !this.inspectorOpen) {
    this.inspectorOpen = open;
    const target = open ? '.ast-title' : '.settings-title';
    this.querySelector(target)?.focus();
  }

  get inspectorOpen() {
    return this.classList.contains('ast-open');
  }

  set inspectorOpen(val) {
    this.classList.toggle('ast-open', val);
    const main = this.querySelector('[data-settings-main]');
    const tree = this.querySelector('ast-inspector');
    if (main) main.hidden = val;
    if (tree) tree.hidden = !val;
  }
}

customElements.define('editor-shell', EditorShell);
