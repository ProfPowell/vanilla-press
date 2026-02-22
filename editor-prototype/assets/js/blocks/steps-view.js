/**
 * StepsView — NodeView for <ol data-steps> elements.
 *
 * Features:
 * - Numbered circles via CSS counters (from Vanilla Breeze)
 * - Editable step titles
 * - Rich text editing inside each step
 *
 * Note: This is a NodeView for the `steps` container.
 * Individual `step` children use a separate StepView.
 *
 * @module editor/blocks/steps-view
 */

export class StepsView {
  constructor(node, view, getPos) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;

    // <ol data-steps> — matches HTML renderer
    this.dom = document.createElement('ol');
    this.dom.setAttribute('data-steps', '');
    this.dom.classList.add('pm-node-view', 'pm-steps');

    // PM renders step children inside this element
    this.contentDOM = this.dom;
  }

  update(node) {
    if (node.type.name !== 'steps') return false;
    this.node = node;

    // Update step title inputs if they exist
    requestAnimationFrame(() => this.syncStepTitles(node));
    return true;
  }

  syncStepTitles(node) {
    const items = this.dom.querySelectorAll(':scope > li');
    node.forEach((child, _offset, index) => {
      const li = items[index];
      if (!li) return;

      // Add title input if not present
      let titleInput = li.querySelector('.step-title-input');
      if (!titleInput) {
        titleInput = document.createElement('input');
        titleInput.type = 'text';
        titleInput.className = 'step-title-input';
        titleInput.placeholder = 'Step title...';
        titleInput.addEventListener('input', () => {
          const pos = this.getPos();
          if (pos == null) return;

          let stepPos = pos + 1;
          for (let i = 0; i < index; i++) {
            stepPos += node.child(i).nodeSize;
          }
          this.view.dispatch(
            this.view.state.tr.setNodeMarkup(stepPos, null, {
              ...child.attrs,
              title: titleInput.value,
            })
          );
        });
        titleInput.addEventListener('keydown', (e) => e.stopPropagation());
        li.insertBefore(titleInput, li.firstChild);
      }

      // Sync value
      if (titleInput.value !== (child.attrs.title || '')) {
        titleInput.value = child.attrs.title || '';
      }

      // Also set the data attr for CSS ::after
      li.setAttribute('data-step-title', child.attrs.title || '');
    });
  }
}
