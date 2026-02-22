/**
 * <editor-shell> — layout container for the editor.
 * No Shadow DOM — uses light DOM with CSS grid for layout.
 * Manages toolbar, editor pane, sidebar, and inspector areas.
 *
 * @module editor/components/editor-shell
 */

export class EditorShell extends HTMLElement {
  connectedCallback() {
    // Structure is set in index.html, this just manages toggle state
    this.inspectorToggle = this.querySelector('[data-toggle-inspector]');
    if (this.inspectorToggle) {
      this.inspectorToggle.addEventListener('click', () => this.toggleInspector());
    }
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
