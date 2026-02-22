/**
 * CardView — NodeView for <content-card> elements.
 *
 * Features:
 * - href input via controls overlay
 * - Not clickable in editor (prevents navigation)
 * - Rich text editing inside (block+ content)
 * - Matches HTML renderer: <content-card href="...">block+</content-card>
 *
 * @module editor/blocks/card-view
 */

export class CardView {
  constructor(node, view, getPos) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;

    // <content-card> — no click handler in editor
    this.dom = document.createElement('content-card');
    this.dom.classList.add('pm-node-view', 'pm-card');
    if (node.attrs.href) {
      this.dom.setAttribute('href', node.attrs.href);
    }
    // Prevent card from acting as a link in editor
    this.dom.style.cursor = 'default';
    this.dom.addEventListener('click', (e) => {
      // Only prevent if clicking the card itself, not content
      if (e.target === this.dom) e.preventDefault();
    });

    // Controls overlay
    this.controls = document.createElement('div');
    this.controls.className = 'node-controls';
    this.controls.innerHTML = `
      <label>Link:</label>
      <input type="text" class="href-input" value="${node.attrs.href || ''}" placeholder="/path/to/page"/>
    `;
    this.dom.appendChild(this.controls);

    const hrefInput = this.controls.querySelector('.href-input');
    hrefInput.addEventListener('change', () => {
      const pos = this.getPos();
      if (pos == null) return;
      this.view.dispatch(
        this.view.state.tr.setNodeMarkup(pos, null, {
          ...this.node.attrs,
          href: hrefInput.value,
        })
      );
    });
    hrefInput.addEventListener('keydown', (e) => e.stopPropagation());

    // Content area
    this.contentDOM = document.createElement('div');
    this.contentDOM.className = 'card-content';
    this.dom.appendChild(this.contentDOM);
  }

  update(node) {
    if (node.type.name !== 'card') return false;
    this.node = node;

    if (node.attrs.href) {
      this.dom.setAttribute('href', node.attrs.href);
    } else {
      this.dom.removeAttribute('href');
    }

    const hrefInput = this.controls.querySelector('.href-input');
    if (hrefInput.value !== (node.attrs.href || '')) {
      hrefInput.value = node.attrs.href || '';
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
