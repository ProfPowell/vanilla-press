/**
 * <meta-panel> — sidebar form for document metadata.
 *
 * Fields: title, slug (auto-derived), collection, description, status, tags.
 * Updates the current document metadata stored in editor.js.
 *
 * @module editor/components/meta-panel
 */

import { validStatuses } from '../../../../src/schema/content-schema.js';
import { getCurrentMeta, setCurrentMeta } from '../meta-state.js';

export class MetaPanel extends HTMLElement {
  connectedCallback() {
    this.render();

    // Listen for meta updates (e.g. from fixture loading)
    window.__onMetaUpdate = (meta) => this.syncFromMeta(meta);
  }

  render() {
    this.className = 'meta-panel';
    this.innerHTML = `
      <h3>Document</h3>

      <div class="field">
        <label for="meta-title">Title</label>
        <input type="text" id="meta-title" value="" placeholder="Document title"/>
      </div>

      <div class="field">
        <label for="meta-slug">Slug</label>
        <input type="text" id="meta-slug" value="" placeholder="auto-derived-slug"/>
      </div>

      <div class="field">
        <label for="meta-collection">Collection</label>
        <input type="text" id="meta-collection" value="posts" placeholder="posts"/>
      </div>

      <div class="field">
        <label for="meta-description">Description</label>
        <textarea id="meta-description" placeholder="Brief description..."></textarea>
      </div>

      <div class="field">
        <label for="meta-status">Status</label>
        <select id="meta-status">
          ${validStatuses.map(s => `<option value="${s}">${s}</option>`).join('')}
        </select>
      </div>

      <div class="field">
        <label for="meta-tags">Tags</label>
        <div class="tag-chips" id="meta-tag-chips"></div>
        <input type="text" id="meta-tags" placeholder="Add tag + Enter"/>
      </div>

      <div class="actions">
        <button class="btn btn-primary" data-export-json-sidebar>Export JSON</button>
      </div>
    `;

    this.wireEvents();
    this.syncFromMeta(getCurrentMeta());
  }

  wireEvents() {
    const titleInput = this.querySelector('#meta-title');
    const slugInput = this.querySelector('#meta-slug');
    const collectionInput = this.querySelector('#meta-collection');
    const descInput = this.querySelector('#meta-description');
    const statusSelect = this.querySelector('#meta-status');
    const tagInput = this.querySelector('#meta-tags');
    const exportBtn = this.querySelector('[data-export-json-sidebar]');

    titleInput.addEventListener('input', () => {
      setCurrentMeta({ title: titleInput.value });
      // Auto-derive slug if slug hasn't been manually edited
      if (!this._slugManuallyEdited) {
        const slug = titleInput.value
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');
        slugInput.value = slug;
        setCurrentMeta({ slug });
      }
    });

    slugInput.addEventListener('input', () => {
      this._slugManuallyEdited = true;
      setCurrentMeta({ slug: slugInput.value });
    });

    collectionInput.addEventListener('input', () => {
      setCurrentMeta({ collection: collectionInput.value });
    });

    descInput.addEventListener('input', () => {
      setCurrentMeta({ description: descInput.value });
    });

    statusSelect.addEventListener('change', () => {
      setCurrentMeta({ status: statusSelect.value });
    });

    tagInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const tag = tagInput.value.trim();
        if (!tag) return;

        const meta = getCurrentMeta();
        const tags = [...(meta.tags || [])];
        if (!tags.includes(tag)) {
          tags.push(tag);
          setCurrentMeta({ tags });
          this.renderTags(tags);
        }
        tagInput.value = '';
      }
    });

    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        // Trigger the main export button
        const mainBtn = document.querySelector('[data-export-json]');
        if (mainBtn) mainBtn.click();
      });
    }
  }

  syncFromMeta(meta) {
    if (!meta) return;
    this._slugManuallyEdited = false;

    const titleInput = this.querySelector('#meta-title');
    const slugInput = this.querySelector('#meta-slug');
    const collectionInput = this.querySelector('#meta-collection');
    const descInput = this.querySelector('#meta-description');
    const statusSelect = this.querySelector('#meta-status');

    if (titleInput) titleInput.value = meta.title || '';
    if (slugInput) slugInput.value = meta.slug || '';
    if (collectionInput) collectionInput.value = meta.collection || '';
    if (descInput) descInput.value = meta.description || '';
    if (statusSelect) statusSelect.value = meta.status || 'draft';

    this.renderTags(meta.tags || []);
  }

  renderTags(tags) {
    const container = this.querySelector('#meta-tag-chips');
    if (!container) return;

    container.innerHTML = tags.map(tag => `
      <span class="tag-chip">
        ${tag}
        <button data-remove-tag="${tag}" title="Remove">&times;</button>
      </span>
    `).join('');

    container.querySelectorAll('[data-remove-tag]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tagToRemove = btn.getAttribute('data-remove-tag');
        const meta = getCurrentMeta();
        const newTags = (meta.tags || []).filter(t => t !== tagToRemove);
        setCurrentMeta({ tags: newTags });
        this.renderTags(newTags);
      });
    });
  }
}

customElements.define('meta-panel', MetaPanel);
