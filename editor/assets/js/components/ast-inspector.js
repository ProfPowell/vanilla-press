/**
 * <ast-inspector> — the block tree (the VP block AST as formatted JSON),
 * updated on every editor change.
 *
 * It lives in the Post settings panel: "Show block tree" (the "⋯" menu)
 * swaps the panel's contents for it, and its "Back to settings" button
 * fires `ast-close` (bubbles) for editor-shell to swap them back.
 *
 * @module editor/components/ast-inspector
 */

import { toBlockAst } from '../ast.js';

export class AstInspector extends HTMLElement {
  constructor() {
    super();
    this._pre = null;
    this._meta = null;
  }

  connectedCallback() {
    this.classList.add('ast-inspector');
    this.innerHTML = `
      <div class="ast-header">
        <h2 class="ast-title" tabindex="-1">Block tree</h2>
        <span class="ast-block-count"></span>
      </div>
      <button type="button" class="ast-back" data-ast-back>Back to settings</button>
      <pre class="ast-output"></pre>
    `;
    this._pre = this.querySelector('.ast-output');
    this._meta = this.querySelector('.ast-block-count');
    this.querySelector('[data-ast-back]').addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('ast-close', { bubbles: true }));
    });

    // Hook into editor updates
    window.__onEditorUpdate = (state) => this.update(state);

    // Initial update if editor already exists
    if (window.__editorView) {
      this.update(window.__editorView.state);
    }
  }

  update(state) {
    if (!this._pre) return;

    const blocks = toBlockAst(state.doc);
    const json = JSON.stringify(blocks, null, 2);
    this._pre.textContent = json;

    if (this._meta) {
      const count = blocks.length;
      this._meta.textContent = `${count} block${count !== 1 ? 's' : ''}`;
    }
  }

  disconnectedCallback() {
    if (window.__onEditorUpdate === this.update) {
      window.__onEditorUpdate = null;
    }
  }
}

customElements.define('ast-inspector', AstInspector);
