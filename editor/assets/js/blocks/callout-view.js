/**
 * CalloutView — NodeView for callouts, shown as VB <status-message>.
 *
 * Features:
 * - Variant selector overlay (note, tip, warning, danger)
 * - Rich text editing inside (block+ content)
 * - Matches HTML renderer: <status-message data-variant="info|success|warning|error">
 *   <div data-content>block+</div></status-message> (VP variant names map to VB's)
 *
 * @module editor/blocks/callout-view
 */

import { CALLOUT_TO_VB } from '../schema.js';

const VARIANTS = ['note', 'tip', 'warning', 'danger'];

export class CalloutView {
  constructor(node, view, getPos) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;

    // Match HTML renderer: <status-message data-variant="...">
    this.dom = document.createElement('status-message');
    this.dom.classList.add('pm-node-view');
    this.setVariant(node.attrs.variant);

    // Controls overlay
    this.controls = document.createElement('div');
    this.controls.className = 'node-controls';
    this.controls.innerHTML = `
      <label>Variant:
      <select class="variant-select">
        ${VARIANTS.map(v => `<option value="${v}"${v === node.attrs.variant ? ' selected' : ''}>${v}</option>`).join('')}
      </select></label>
    `;
    this.dom.appendChild(this.controls);

    const variantSelect = this.controls.querySelector('.variant-select');
    variantSelect.addEventListener('change', () => {
      const pos = this.getPos();
      if (pos == null) return;
      this.view.dispatch(
        this.view.state.tr.setNodeMarkup(pos, null, {
          ...this.node.attrs,
          variant: variantSelect.value,
        })
      );
    });

    // Content area — PM edits inside this div
    this.contentDOM = document.createElement('div');
    this.contentDOM.className = 'callout-content';
    this.contentDOM.setAttribute('data-content', '');
    this.dom.appendChild(this.contentDOM);
  }

  update(node) {
    if (node.type.name !== 'callout') return false;
    this.node = node;
    this.setVariant(node.attrs.variant);

    const variantSelect = this.controls.querySelector('.variant-select');
    if (variantSelect.value !== node.attrs.variant) {
      variantSelect.value = node.attrs.variant;
    }
    return true;
  }

  setVariant(variant) {
    this.dom.setAttribute('data-variant', CALLOUT_TO_VB[variant] || 'info');
  }

  stopEvent(event) {
    return this.controls.contains(event.target);
  }

  ignoreMutation(mutation) {
    return this.controls.contains(mutation.target);
  }
}
