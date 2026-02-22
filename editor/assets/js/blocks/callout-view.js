/**
 * CalloutView — NodeView for <ui-callout> elements.
 *
 * Features:
 * - Variant selector overlay (note, tip, warning, danger)
 * - Rich text editing inside (block+ content)
 * - Matches HTML renderer: <ui-callout data-variant="...">block+</ui-callout>
 *
 * @module editor/blocks/callout-view
 */

const VARIANTS = ['note', 'tip', 'warning', 'danger'];

export class CalloutView {
  constructor(node, view, getPos) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;

    // Match HTML renderer: <ui-callout data-variant="...">
    this.dom = document.createElement('ui-callout');
    this.dom.classList.add('pm-node-view');
    this.dom.setAttribute('data-variant', node.attrs.variant || 'note');

    // Controls overlay
    this.controls = document.createElement('div');
    this.controls.className = 'node-controls';
    this.controls.innerHTML = `
      <label>Variant:</label>
      <select class="variant-select">
        ${VARIANTS.map(v => `<option value="${v}"${v === node.attrs.variant ? ' selected' : ''}>${v}</option>`).join('')}
      </select>
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
    this.dom.appendChild(this.contentDOM);
  }

  update(node) {
    if (node.type.name !== 'callout') return false;
    this.node = node;
    this.dom.setAttribute('data-variant', node.attrs.variant || 'note');

    const variantSelect = this.controls.querySelector('.variant-select');
    if (variantSelect.value !== node.attrs.variant) {
      variantSelect.value = node.attrs.variant;
    }
    return true;
  }

  stopEvent(event) {
    return this.controls.contains(event.target);
  }

  ignoreMutation(mutation) {
    return this.controls.contains(mutation.target);
  }
}
