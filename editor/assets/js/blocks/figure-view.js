/**
 * FigureView — NodeView for <figure> elements.
 *
 * Features:
 * - Image display (or placeholder if src is empty)
 * - Editable src and alt text via controls
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
      <label>Src:</label>
      <input type="text" class="src-input" value="${node.attrs.src || ''}" placeholder="/images/photo.jpg"/>
      <button class="browse-media-btn" title="Browse media">Browse</button>
      <label>Alt:</label>
      <input type="text" class="alt-input" value="${node.attrs.alt || ''}" placeholder="Alt text"/>
    `;
    this.dom.appendChild(this.controls);

    const srcInput = this.controls.querySelector('.src-input');
    const altInput = this.controls.querySelector('.alt-input');

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

    // Browse media button
    const browseBtn = this.controls.querySelector('.browse-media-btn');
    browseBtn.addEventListener('click', async () => {
      const result = await openMediaPicker();
      if (!result) return;
      const pos = this.getPos();
      if (pos == null) return;
      this.view.dispatch(
        this.view.state.tr.setNodeMarkup(pos, null, {
          ...this.node.attrs,
          src: result.src,
          alt: result.alt || this.node.attrs.alt,
        })
      );
    });

    // Image or placeholder
    this.img = document.createElement('img');
    this.img.alt = node.attrs.alt || '';
    if (node.attrs.src) {
      this.img.src = displayMediaUrl(node.attrs.src, SITE);
      this.img.style.display = '';
    } else {
      this.img.style.display = 'none';
    }
    this.dom.appendChild(this.img);

    // Placeholder when no src
    this.placeholder = document.createElement('div');
    this.placeholder.className = 'figure-placeholder';
    this.placeholder.textContent = 'No image source set — use controls above';
    this.placeholder.style.display = node.attrs.src ? 'none' : '';
    this.dom.appendChild(this.placeholder);

    // Figcaption content (PM edits here if figcaption child exists)
    this.contentDOM = document.createElement('div');
    this.contentDOM.className = 'figure-caption-wrapper';
    this.dom.appendChild(this.contentDOM);
  }

  update(node) {
    if (node.type.name !== 'figure') return false;
    this.node = node;

    // Update image
    if (node.attrs.src) {
      this.img.src = displayMediaUrl(node.attrs.src, SITE);
      this.img.alt = node.attrs.alt || '';
      this.img.style.display = '';
      this.placeholder.style.display = 'none';
    } else {
      this.img.style.display = 'none';
      this.placeholder.style.display = '';
    }

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
      mutation.target === this.placeholder;
  }
}
