/**
 * FigureView — NodeView for <figure> elements.
 *
 * Features:
 * - Image display (or placeholder if src is empty; "Missing file" when it fails to load)
 * - Editable src and alt text via controls; Browse opens the media picker
 * - Optional figcaption child (PM handles via content model)
 * - Matches HTML renderer: <figure><img src alt/><figcaption>...</figcaption></figure>
 *
 * @module editor/blocks/figure-view
 */

import { openMediaPicker } from '../components/media-picker.js';
import { SITE, displayMediaUrl } from '../site-context.js';

export class FigureView {
  constructor(node, view, getPos) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;

    // <figure>
    this.dom = document.createElement('figure');
    this.dom.classList.add('pm-node-view', 'pm-figure');

    // Controls overlay
    this.controls = document.createElement('div');
    this.controls.className = 'node-controls';
    this.controls.innerHTML = `
      <label>Src:
      <input type="text" class="src-input" placeholder="/media/photo.jpg"/></label>
      <button type="button" class="browse-media-btn">Browse</button>
      <label>Alt:
      <input type="text" class="alt-input" placeholder="Alt text"/></label>
    `;
    this.dom.appendChild(this.controls);

    const srcInput = this.controls.querySelector('.src-input');
    const altInput = this.controls.querySelector('.alt-input');
    // Values as properties: attrs never go through innerHTML
    srcInput.value = node.attrs.src || '';
    altInput.value = node.attrs.alt || '';

    srcInput.addEventListener('change', () => {
      const pos = this.getPos();
      if (pos == null) return;
      this.view.dispatch(
        this.view.state.tr.setNodeMarkup(pos, null, {
          ...this.node.attrs,
          src: srcInput.value,
        })
      );
    });
    srcInput.addEventListener('keydown', (e) => e.stopPropagation());

    altInput.addEventListener('change', () => {
      const pos = this.getPos();
      if (pos == null) return;
      this.view.dispatch(
        this.view.state.tr.setNodeMarkup(pos, null, {
          ...this.node.attrs,
          alt: altInput.value,
        })
      );
    });
    altInput.addEventListener('keydown', (e) => e.stopPropagation());

    // Browse: pick an image from the library. The figure keeps its own alt
    // unless it has none, then it takes the library's.
    const browseBtn = this.controls.querySelector('.browse-media-btn');
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

    // Image, or a placeholder (no src yet, or the file is missing)
    this.img = document.createElement('img');
    this.placeholder = document.createElement('div');
    this.placeholder.className = 'figure-placeholder';
    // A file that fails to load: say which, in place of the image. Both
    // elements are chrome (ignoreMutation), so this never redraws the node.
    this.img.addEventListener('error', () => {
      if (!this.node.attrs.src) return;
      this.showPlaceholder(`Missing file: ${fileName(this.node.attrs.src)}`);
    });
    this.dom.appendChild(this.img);
    this.dom.appendChild(this.placeholder);
    this.shownSrc = null;
    this.showImage(node);

    // Figcaption content (PM edits here if figcaption child exists)
    this.contentDOM = document.createElement('div');
    this.contentDOM.className = 'figure-caption-wrapper';
    this.dom.appendChild(this.contentDOM);
  }

  /** Show the node's image, or the placeholder when it has no src. Reloads only when src changes. */
  showImage(node) {
    this.img.alt = node.attrs.alt || '';
    if (!node.attrs.src) {
      this.shownSrc = null;
      this.img.removeAttribute('src');
      this.showPlaceholder('No image source set — use controls above');
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

  update(node) {
    if (node.type.name !== 'figure') return false;
    this.node = node;

    this.showImage(node);

    // Sync controls
    const srcInput = this.controls.querySelector('.src-input');
    if (srcInput.value !== (node.attrs.src || '')) {
      srcInput.value = node.attrs.src || '';
    }
    const altInput = this.controls.querySelector('.alt-input');
    if (altInput.value !== (node.attrs.alt || '')) {
      altInput.value = node.attrs.alt || '';
    }

    return true;
  }

  stopEvent(event) {
    return this.controls.contains(event.target);
  }

  ignoreMutation(mutation) {
    return this.controls.contains(mutation.target) ||
      mutation.target === this.img ||
      this.placeholder.contains(mutation.target);
  }
}

/** `/media/a/b.jpg` → `b.jpg` */
function fileName(src) {
  return String(src).split(/[?#]/)[0].split('/').pop() || src;
}

/**
 * Open a figure's controls and put focus in its alt field (after inserting
 * an image that has no alt text yet).
 * @param {import('prosemirror-view').EditorView} view
 * @param {number} pos the figure's position
 */
export function focusFigureAlt(view, pos) {
  const dom = view.nodeDOM(pos);
  const input = dom?.querySelector?.(':scope > .node-controls .alt-input');
  if (input) input.focus();
}
