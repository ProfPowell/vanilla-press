/**
 * FigureView — NodeView for <figure> elements.
 *
 * Features:
 * - Image display (or placeholder if src is empty; "Missing file" when it fails to load)
 * - Src and alt fields under the media, shown while the figure is selected;
 *   Browse opens the media picker. The media display is not editable, and a
 *   press on it selects the figure. An "Alt: Missing" badge shows when alt is empty
 * - Optional figcaption child (PM handles via content model)
 * - The image credit after the caption: not editable, never caption text
 * - Matches HTML renderer: <figure><img src alt/><figcaption>...</figcaption></figure>
 *
 * @module editor/blocks/figure-view
 */

import { NodeSelection } from 'prosemirror-state';
import { openMediaPicker } from '../components/media-picker.js';
import { SITE, displayMediaUrl } from '../site-context.js';
import { creditParts } from '../../../../src/media/credit.js';

export class FigureView {
  constructor(node, view, getPos) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;

    // <figure>: media, then its fields, then the caption
    this.dom = document.createElement('figure');
    this.dom.classList.add('pm-node-view', 'pm-figure');

    // The media display: chrome, so keystrokes never land in it. A press on
    // it selects the figure.
    this.display = document.createElement('div');
    this.display.className = 'figure-media';
    this.display.setAttribute('contenteditable', 'false');
    this.img = document.createElement('img');
    this.placeholder = document.createElement('div');
    this.placeholder.className = 'figure-placeholder';
    // A file that fails to load: say which, in place of the image. Both
    // elements are chrome (ignoreMutation), so this never redraws the node.
    this.img.addEventListener('error', () => {
      if (!this.node.attrs.src) return;
      this.showPlaceholder(`Missing file: ${fileName(this.node.attrs.src)}`);
    });
    this.display.appendChild(this.img);
    this.display.appendChild(this.placeholder);
    this.display.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      selectNodeAt(this.view, this.getPos());
    });
    this.dom.appendChild(this.display);

    // "Alt: Missing", on the frame while the figure isn't selected
    this.badge = document.createElement('span');
    this.badge.className = 'figure-alt-missing';
    this.badge.setAttribute('contenteditable', 'false');
    this.badge.textContent = 'Alt: Missing';
    this.dom.appendChild(this.badge);

    // Fields under the media, shown while the figure is selected or a field has focus
    this.fields = document.createElement('div');
    this.fields.className = 'node-controls media-fields';
    this.fields.setAttribute('contenteditable', 'false');
    this.srcInput = textInput('src-input', '/media/photo.jpg');
    const browseBtn = document.createElement('button');
    browseBtn.type = 'button';
    browseBtn.className = 'browse-media-btn';
    browseBtn.textContent = 'Browse';
    this.altInput = textInput('alt-input', 'Alt text');
    this.fields.append(label('Src:', this.srcInput), browseBtn, label('Alt:', this.altInput));
    this.dom.appendChild(this.fields);

    this.srcInput.value = node.attrs.src || '';
    this.altInput.value = node.attrs.alt || '';

    this.srcInput.addEventListener('change', () => this.setAttr('src', this.srcInput.value));
    this.altInput.addEventListener('change', () => this.setAttr('alt', this.altInput.value));

    // Browse: pick an image from the library. The figure keeps its own alt
    // unless it has none, then it takes the library's.
    browseBtn.addEventListener('click', async () => {
      const item = await openMediaPicker({ kind: 'image' });
      if (!item) return;
      const pos = this.getPos();
      if (pos == null) return;
      this.view.dispatch(
        this.view.state.tr.setNodeMarkup(pos, null, {
          ...this.node.attrs,
          src: item.src,
          alt: this.node.attrs.alt || (item.alt ?? ''),
        })
      );
    });

    this.shownSrc = null;
    this.showImage(node);
    this.showBadge(node);

    // Figcaption content (PM edits here if figcaption child exists)
    this.contentDOM = document.createElement('div');
    this.contentDOM.className = 'figure-caption-wrapper';
    this.dom.appendChild(this.contentDOM);

    // The credit: after the caption, outside its content hole, so typing in
    // the caption never reaches it
    this.credit = document.createElement('small');
    this.credit.className = 'credit';
    this.credit.setAttribute('contenteditable', 'false');
    this.dom.appendChild(this.credit);
    this.shownCredit = undefined;
    this.showCredit(node);
  }

  setAttr(name, value) {
    const pos = this.getPos();
    if (pos == null) return;
    this.view.dispatch(
      this.view.state.tr.setNodeMarkup(pos, null, { ...this.node.attrs, [name]: value })
    );
  }

  /** Show the node's image, or the placeholder when it has no src. Reloads only when src changes. */
  showImage(node) {
    this.img.alt = node.attrs.alt || '';
    if (!node.attrs.src) {
      this.shownSrc = null;
      this.img.removeAttribute('src');
      this.showPlaceholder('No image source set — select the figure to add one');
      return;
    }
    if (node.attrs.src === this.shownSrc) return; // keep its state (loaded, or missing)
    this.shownSrc = node.attrs.src;
    this.img.style.display = '';
    this.placeholder.style.display = 'none';
    this.img.src = displayMediaUrl(node.attrs.src, SITE);
  }

  showPlaceholder(text) {
    this.img.style.display = 'none';
    this.placeholder.textContent = text;
    this.placeholder.style.display = '';
  }

  /** Show the node's credit as text and links; hidden when it has none. */
  showCredit(node) {
    const key = JSON.stringify(node.attrs.credit ?? null);
    if (key === this.shownCredit) return;
    this.shownCredit = key;
    const parts = creditParts(node.attrs.credit);
    this.credit.replaceChildren(...parts.map((part) => {
      if (!part.href) return part.text;
      const a = document.createElement('a');
      a.setAttribute('href', part.href);
      a.setAttribute('target', '_blank'); // never leave the editor
      a.setAttribute('rel', 'noopener noreferrer');
      a.textContent = part.text;
      return a;
    }));
    this.credit.toggleAttribute('hidden', parts.length === 0);
  }

  showBadge(node) {
    this.badge.toggleAttribute('hidden', Boolean(node.attrs.alt));
  }

  update(node) {
    if (node.type.name !== 'figure') return false;
    this.node = node;

    this.showImage(node);
    this.showBadge(node);
    this.showCredit(node);

    // Sync fields
    if (this.srcInput.value !== (node.attrs.src || '')) {
      this.srcInput.value = node.attrs.src || '';
    }
    if (this.altInput.value !== (node.attrs.alt || '')) {
      this.altInput.value = node.attrs.alt || '';
    }

    return true;
  }

  selectNode() { this.dom.setAttribute('data-selected', ''); }

  deselectNode() { this.dom.removeAttribute('data-selected'); }

  stopEvent(event) {
    if (this.fields.contains(event.target)) return true;
    // A press on the media is ours (it selects the figure); PM would place a caret
    return /^(mouse|pointer)|^click$/.test(event.type) && this.display.contains(event.target);
  }

  ignoreMutation(mutation) {
    return this.fields.contains(mutation.target) ||
      this.display.contains(mutation.target) ||
      this.badge.contains(mutation.target) ||
      this.credit.contains(mutation.target) ||
      mutation.target === this.dom && mutation.type === 'attributes';
  }
}

/** Select the node at `pos` (a NodeSelection) and focus the editor. */
function selectNodeAt(view, pos) {
  if (pos == null) return;
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
  view.focus();
}

/** A text input whose keys stay out of the editor. */
function textInput(className, placeholder) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = className;
  input.placeholder = placeholder;
  input.addEventListener('keydown', (e) => e.stopPropagation());
  return input;
}

/** A label wrapping its control, which is the control's accessible name. */
function label(text, control) {
  const el = document.createElement('label');
  el.append(text, control);
  return el;
}

/** `/media/a/b.jpg` → `b.jpg` */
function fileName(src) {
  return String(src).split(/[?#]/)[0].split('/').pop() || src;
}

/**
 * Open a figure's fields and put focus in its alt field (after inserting
 * an image that has no alt text yet). The fields show only while the figure
 * is selected or one has focus, so the figure is selected first.
 * @param {import('prosemirror-view').EditorView} view
 * @param {number} pos the figure's position
 */
export function focusFigureAlt(view, pos) {
  const dom = view.nodeDOM(pos);
  const input = dom?.querySelector?.(':scope > .media-fields .alt-input');
  if (!input) return;
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
  input.focus();
}
