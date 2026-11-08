/**
 * StepsView and StepView — NodeViews for <ol data-steps> and its steps.
 *
 * Features:
 * - Numbered circles via CSS counters (from Vanilla Breeze)
 * - Editable step titles
 * - Rich text editing inside each step
 *
 * Each step draws its title field in a non-editable wrapper and its content
 * in a separate element, so ProseMirror never sees the field as foreign
 * content (injecting it into the step's content element made ProseMirror
 * redraw the step on every update, endlessly).
 *
 * @module editor/blocks/steps-view
 */

import { isChromeMutation } from './node-view-mutations.js';

/**
 * The transaction that sets the title of the step at `pos`, or null when
 * `pos` holds no step.
 * @param {import('prosemirror-state').EditorState} state
 * @param {number} pos
 * @param {string} title
 */
export function setStepTitle(state, pos, title) {
  const step = state.doc.nodeAt(pos);
  if (!step || step.type.name !== 'step') return null;
  return state.tr.setNodeMarkup(pos, null, { ...step.attrs, title });
}

export class StepsView {
  constructor(node) {
    this.node = node;

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
    return true;
  }
}

export class StepView {
  constructor(node, view, getPos) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;

    this.dom = document.createElement('li');
    this.dom.className = 'pm-step';
    this.dom.setAttribute('data-step-title', node.attrs.title || '');

    this.chrome = document.createElement('div');
    this.chrome.className = 'step-title';
    this.chrome.contentEditable = 'false';

    this.titleInput = document.createElement('input');
    this.titleInput.type = 'text';
    this.titleInput.className = 'step-title-input';
    this.titleInput.placeholder = 'Step title...';
    this.titleInput.setAttribute('aria-label', 'Step title');
    this.titleInput.value = node.attrs.title || '';
    this.titleInput.addEventListener('input', () => {
      const pos = this.getPos();
      if (pos == null) return;
      const tr = setStepTitle(this.view.state, pos, this.titleInput.value);
      if (tr) this.view.dispatch(tr);
    });
    this.titleInput.addEventListener('keydown', (e) => e.stopPropagation());
    this.chrome.appendChild(this.titleInput);
    this.dom.appendChild(this.chrome);

    this.contentDOM = document.createElement('div');
    this.contentDOM.className = 'step-content';
    this.dom.appendChild(this.contentDOM);
  }

  update(node) {
    if (node.type.name !== 'step') return false;
    this.node = node;
    const title = node.attrs.title || '';
    if (this.titleInput.value !== title) this.titleInput.value = title;
    if (this.dom.getAttribute('data-step-title') !== title) this.dom.setAttribute('data-step-title', title);
    return true;
  }

  stopEvent(event) {
    return this.chrome.contains(event.target);
  }

  ignoreMutation(mutation) {
    return isChromeMutation(mutation, this.dom, this.chrome);
  }
}
