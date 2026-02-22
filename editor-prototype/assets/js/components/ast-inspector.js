/**
 * <ast-inspector> — live AST debug panel.
 * Updates on every editor change, showing the VP block AST
 * as formatted JSON.
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
    this.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-block-end: var(--space-sm);">
        <strong style="font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em;">AST Inspector</strong>
        <span class="ast-block-count" style="font-size: 0.75rem; opacity: 0.6;"></span>
      </div>
      <pre class="ast-output" style="margin: 0; white-space: pre-wrap; word-break: break-all; line-height: 1.5; font-size: 0.8rem;"></pre>
    `;
    this._pre = this.querySelector('.ast-output');
    this._meta = this.querySelector('.ast-block-count');

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
