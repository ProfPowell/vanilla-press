/**
 * EmbedView — NodeView for `embed` (audio and video from the library). Shows the
 * same placeholder the schema draws, or "Missing file: <name>" when the file is
 * gone from src/media, as a figure does. Its URL field sits under the display,
 * shown while the block is selected or the field has focus.
 *
 * @module editor/blocks/embed-view
 */

import { isMissingMedia, embedText } from '../media-check.js';

export class EmbedView {
  constructor(node, view, getPos) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.dom = document.createElement('div');
    this.dom.className = 'pm-embed';
    this.dom.setAttribute('contenteditable', 'false');
    this.dom.setAttribute('data-embed', '');

    // The display: chrome text, never editable
    this.display = document.createElement('div');
    this.display.className = 'pm-embed-placeholder';
    this.display.setAttribute('contenteditable', 'false');
    this.dom.appendChild(this.display);

    // The URL field, under the display
    this.fields = document.createElement('div');
    this.fields.className = 'node-controls media-fields';
    this.fields.setAttribute('contenteditable', 'false');
    this.urlInput = document.createElement('input');
    this.urlInput.type = 'text';
    this.urlInput.className = 'url-input';
    this.urlInput.placeholder = '/media/clip.mp4';
    this.urlInput.value = node.attrs.url || '';
    this.urlInput.addEventListener('keydown', (e) => e.stopPropagation());
    this.urlInput.addEventListener('change', () => {
      const pos = this.getPos?.();
      if (pos == null) return;
      this.view.dispatch(
        this.view.state.tr.setNodeMarkup(pos, null, { ...this.node.attrs, url: this.urlInput.value })
      );
    });
    const label = document.createElement('label');
    label.append('URL:', this.urlInput);
    this.fields.appendChild(label);
    this.dom.appendChild(this.fields);

    this.missing = false;
    this.check = 0;
    this.paint();
    this.recheck();
  }

  paint() {
    const { url, type } = this.node.attrs;
    this.dom.setAttribute('data-url', url);
    this.dom.setAttribute('data-type', type);
    this.display.toggleAttribute('data-missing', this.missing);
    this.display.textContent = embedText({ type, url }, this.missing);
    if (this.urlInput.value !== (url || '')) this.urlInput.value = url || '';
  }

  recheck() {
    const mine = ++this.check;
    isMissingMedia(this.node.attrs.url).then((missing) => {
      if (mine !== this.check || missing === this.missing) return;
      this.missing = missing;
      this.paint();
    });
  }

  update(node) {
    if (node.type !== this.node.type) return false;
    const urlChanged = node.attrs.url !== this.node.attrs.url;
    this.node = node;
    if (urlChanged) this.missing = false;
    this.paint();
    if (urlChanged) this.recheck();
    return true;
  }

  selectNode() { this.dom.setAttribute('data-selected', ''); }

  deselectNode() { this.dom.removeAttribute('data-selected'); }

  // The field's events are its own, not the editor's
  stopEvent(event) { return this.fields.contains(event.target); }

  // The text and the field are chrome: their changes are not the document's
  ignoreMutation() { return true; }
}
