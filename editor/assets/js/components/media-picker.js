/**
 * <media-picker> — modal for browsing and uploading media.
 *
 * Shows a grid of uploaded media thumbnails, an upload zone,
 * and returns a selection via callback.
 *
 * @module editor/components/media-picker
 */

import { api } from '../api-client.js';
import { SITE, displayMediaUrl } from '../site-context.js';

let singleton = null;

/**
 * Open the media picker and resolve with the selected media.
 * @returns {Promise<{ src: string, alt: string } | null>}
 */
export function openMediaPicker() {
  return new Promise((resolve) => {
    if (!singleton) {
      singleton = document.createElement('media-picker');
      document.body.appendChild(singleton);
    }
    singleton.open(resolve);
  });
}

export class MediaPicker extends HTMLElement {
  connectedCallback() {
    this.className = 'media-picker-overlay';
    this.style.display = 'none';
    this._resolve = null;
    this._media = [];

    this.innerHTML = `
      <div class="media-picker-dialog">
        <div class="media-picker-header">
          <h3>Media Library</h3>
          <button class="media-picker-close" title="Close">&times;</button>
        </div>
        <div class="media-picker-upload">
          <label class="upload-zone">
            <input type="file" accept="image/*" hidden />
            <span>Drop image here or click to upload</span>
          </label>
          <div class="upload-alt">
            <input type="text" class="alt-input" placeholder="Alt text (optional)" />
          </div>
        </div>
        <div class="media-picker-grid"></div>
      </div>
    `;

    this.wireEvents();
  }

  wireEvents() {
    // Close
    this.querySelector('.media-picker-close').addEventListener('click', () => this.close());
    this.addEventListener('click', (e) => {
      if (e.target === this) this.close();
    });

    // File upload
    const fileInput = this.querySelector('input[type="file"]');
    fileInput.addEventListener('change', async () => {
      if (fileInput.files.length === 0) return;
      const file = fileInput.files[0];
      const alt = this.querySelector('.alt-input').value.trim();

      try {
        const result = await api.uploadMedia(file, alt);
        this.select(result.src, result.alt);
      } catch (err) {
        alert(`Upload failed: ${err.message}`);
      }
      fileInput.value = '';
    });

    // Drag and drop
    const zone = this.querySelector('.upload-zone');
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', () => {
      zone.classList.remove('drag-over');
    });
    zone.addEventListener('drop', async (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');

      const file = e.dataTransfer.files[0];
      if (!file || !file.type.startsWith('image/')) return;

      const alt = this.querySelector('.alt-input').value.trim();
      try {
        const result = await api.uploadMedia(file, alt);
        this.select(result.src, result.alt);
      } catch (err) {
        alert(`Upload failed: ${err.message}`);
      }
    });
  }

  async open(resolve) {
    this._resolve = resolve;
    this.style.display = '';

    try {
      this._media = await api.listMedia();
      this.renderGrid();
    } catch (err) {
      console.error('Error loading media:', err);
    }
  }

  close() {
    this.style.display = 'none';
    if (this._resolve) {
      this._resolve(null);
      this._resolve = null;
    }
  }

  select(src, alt) {
    this.style.display = 'none';
    if (this._resolve) {
      this._resolve({ src, alt });
      this._resolve = null;
    }
  }

  renderGrid() {
    const grid = this.querySelector('.media-picker-grid');

    if (this._media.length === 0) {
      grid.innerHTML = '<div class="media-picker-empty">No media uploaded yet</div>';
      return;
    }

    grid.innerHTML = this._media.map(m => `
      <div class="media-item" data-src="/media/${escapeAttr(m.filename)}" data-alt="${escapeAttr(m.alt || '')}">
        <img src="${escapeAttr(displayMediaUrl(`/media/${m.filename}`, SITE))}" alt="${escapeAttr(m.alt || '')}" loading="lazy" />
        <div class="media-item-name">${escapeHtml(m.filename)}</div>
      </div>
    `).join('');

    grid.querySelectorAll('.media-item').forEach(item => {
      item.addEventListener('click', () => {
        this.select(item.dataset.src, item.dataset.alt);
      });
    });
  }
}

function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

customElements.define('media-picker', MediaPicker);
