/**
 * CollapsibleView — NodeView for <details> elements.
 *
 * Features:
 * - Always open in editor (can't collapse while editing)
 * - Editable summary via text input
 * - Rich text editing inside (block+ content)
 * - Matches HTML renderer: <details><summary>text</summary>block+</details>
 *
 * @module editor/blocks/collapsible-view
 */

export class CollapsibleView {
  constructor(node, view, getPos) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;

    // <details open> — always open in editor
    this.dom = document.createElement('details');
    this.dom.classList.add('pm-node-view', 'pm-collapsible');
    this.dom.setAttribute('open', '');

    // Summary — editable input instead of native <summary> click-to-toggle
    const summary = document.createElement('summary');
    summary.addEventListener('click', (e) => e.preventDefault()); // Prevent toggling

    this.summaryInput = document.createElement('input');
    this.summaryInput.type = 'text';
    this.summaryInput.className = 'summary-input';
    this.summaryInput.placeholder = 'Section title...';
    this.summaryInput.value = node.attrs.summary || '';
    this.summaryInput.addEventListener('input', () => {
      const pos = this.getPos();
      if (pos == null) return;
      this.view.dispatch(
        this.view.state.tr.setNodeMarkup(pos, null, {
          ...this.node.attrs,
          summary: this.summaryInput.value,
        })
      );
    });
    this.summaryInput.addEventListener('keydown', (e) => e.stopPropagation());
    summary.appendChild(this.summaryInput);
    this.dom.appendChild(summary);

    // Content area
    this.contentDOM = document.createElement('div');
    this.contentDOM.className = 'collapsible-content';
    this.dom.appendChild(this.contentDOM);
  }

  update(node) {
    if (node.type.name !== 'collapsible') return false;
    this.node = node;

    if (this.summaryInput.value !== (node.attrs.summary || '')) {
      this.summaryInput.value = node.attrs.summary || '';
    }
    return true;
  }

  stopEvent(event) {
    return event.target === this.summaryInput;
  }

  ignoreMutation(mutation) {
    return mutation.target === this.summaryInput || this.summaryInput.contains(mutation.target);
  }
}
