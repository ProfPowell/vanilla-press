/**
 * EmbedView — NodeView for `embed` (audio and video from the library). Shows the
 * same placeholder the schema draws, or "Missing file: <name>" when the file is
 * gone from src/media, as a figure does.
 *
 * @module editor/blocks/embed-view
 */

import { isMissingMedia, embedText } from '../media-check.js';

export class EmbedView {
  constructor(node) {
    this.node = node;
    this.dom = document.createElement('div');
    this.dom.className = 'pm-embed-placeholder';
    this.dom.contentEditable = 'false';
    this.dom.setAttribute('data-embed', '');
    this.missing = false;
    this.check = 0;
    this.paint();
    this.recheck();
  }

  paint() {
    const { url, type } = this.node.attrs;
    this.dom.setAttribute('data-url', url);
    this.dom.setAttribute('data-type', type);
    this.dom.toggleAttribute('data-missing', this.missing);
    this.dom.textContent = embedText({ type, url }, this.missing);
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

  // The text is chrome: its changes are not the document's
  ignoreMutation() { return true; }
}
