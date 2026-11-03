/**
 * <meta-panel> — sidebar form for document metadata.
 *
 * Fields: title, slug (auto-derived), collection, description, status, tags.
 * Actions: publish/unpublish, preview.
 * Updates the current document metadata stored in meta-state.js.
 *
 * @module editor/components/meta-panel
 */

import { validStatuses } from '../../../../src/schema/content-schema.js';
import { getCurrentMeta, setCurrentMeta, getCurrentDocId } from '../meta-state.js';
import { api } from '../api-client.js';
import { postUrlPath } from '../../../../src/sync/paths.js';
import { saveDocument, loadDocument, handleSaveError, loadVersionOnDisk } from '../editor.js';

export class MetaPanel extends HTMLElement {
  connectedCallback() {
    this.render();

    // Listen for meta updates (e.g. from doc loading)
    window.__onMetaUpdate = (meta) => this.syncFromMeta(meta);
    // Show / hide the "changed on disk" notice for the current document
    window.__onConflictChange = (docId, message) => this.showConflict(docId, message);
  }

  /**
   * Show the conflict notice for `docId`, or hide it when `message` is null.
   * @param {string} docId
   * @param {string|null} message
   */
  showConflict(docId, message) {
    const notice = this.querySelector('[data-conflict]');
    if (!notice) return;
    notice.hidden = !message;
    notice.dataset.docId = docId || '';
    notice.querySelector('[data-conflict-message]').textContent = message || '';
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

      <div class="conflict-notice" data-conflict hidden role="alert">
        <p data-conflict-message></p>
        <p>Auto-save is paused for this document.</p>
        <button class="btn" data-load-disk>Load the version on disk</button>
      </div>

      <div class="actions">
        <button class="btn btn-publish" data-publish>Publish</button>
        <button class="btn" data-preview>Preview</button>
        <div class="build-status" data-build-status></div>
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
    const publishBtn = this.querySelector('[data-publish]');
    const previewBtn = this.querySelector('[data-preview]');

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

    // Publish / Unpublish
    publishBtn.addEventListener('click', () => this.togglePublish());

    // Resolve a conflict by taking the version on disk
    this.querySelector('[data-load-disk]').addEventListener('click', async () => {
      const notice = this.querySelector('[data-conflict]');
      const docId = notice.dataset.docId;
      if (!docId) return;
      try {
        await loadVersionOnDisk(docId);
        document.querySelector('doc-browser')?.refresh();
      } catch (err) {
        console.error('Reload error:', err);
        notice.querySelector('[data-conflict-message]').textContent = `Could not load: ${err.message}`;
      }
    });

    // Preview: open the page on the Cook dev server (cook dev)
    api.getWorkspace().then(({ syncEnabled }) => {
      if (!syncEnabled) {
        previewBtn.disabled = true;
        previewBtn.title = 'Preview needs a site (--site)';
      }
    }).catch(() => {});
    previewBtn.addEventListener('click', async () => {
      const buildStatus = this.querySelector('[data-build-status]');
      const say = (text) => {
        if (!buildStatus) return;
        buildStatus.textContent = text;
        buildStatus.className = 'build-status error';
      };
      // Open the tab now (still inside the click, so it is not blocked as a
      // popup), then point it at the page once we know the URL.
      const tab = window.open('about:blank', '_blank');
      if (!(await saveDocument())) {
        tab?.close();
        say('Preview needs the document saved first');
        return;
      }
      const meta = getCurrentMeta();
      const { syncEnabled, previewUrl } = await api.getWorkspace();
      if (!syncEnabled || !meta.collection || !meta.slug) {
        tab?.close();
        return;
      }
      if (meta.status !== 'published') {
        tab?.close();
        say('Preview shows published pages: publish first');
        return;
      }
      let collections = {};
      try {
        const { value } = await api.getConfig('collections');
        collections = value ? JSON.parse(value) : {};
      } catch { /* defaults */ }
      const base = previewUrl.replace(/\/+$/, '');
      try {
        await fetch(base, { mode: 'no-cors' });
      } catch {
        tab?.close();
        say(`Preview needs the site's dev server at ${base}: run "npm run dev" in the site folder`);
        return;
      }
      const url = `${base}${postUrlPath({ meta }, collections)}`;
      if (tab) tab.location.href = url;
      else window.open(url, '_blank');
    });
  }

  async togglePublish() {
    // A page not stored yet is created first (saveDocument creates it).
    if (!getCurrentDocId() || getCurrentDocId() === 'doc_new') {
      if (!(await saveDocument())) return;
    }
    const docId = getCurrentDocId();

    const meta = getCurrentMeta();
    const isPublished = meta.status === 'published';
    const buildStatus = this.querySelector('[data-build-status]');

    try {
      // Save current state first (stops here if it is in conflict with disk)
      if (!(await saveDocument())) return;

      const update = isPublished
        ? { status: 'draft', published: undefined } // Unpublish: set to draft
        : { status: 'published', published: meta.published || new Date().toISOString() };
      const before = { status: meta.status, published: meta.published };
      setCurrentMeta(update);
      try {
        // Saving syncs the document to the site (HTML added or removed)
        await api.updateDocument(docId, { meta: { ...getCurrentMeta() } });
      } catch (err) {
        // Not saved: put the local status back so auto-save and the panel
        // agree with the server again.
        if (getCurrentDocId() === docId) {
          setCurrentMeta(before);
          this.syncFromMeta(getCurrentMeta());
        }
        handleSaveError(docId, err);
        throw err;
      }

      const { syncEnabled } = await api.getWorkspace();
      if (buildStatus) {
        buildStatus.textContent = syncEnabled ? 'Synced to site' : 'Saved (demo content, not synced)';
        buildStatus.className = 'build-status done';
        setTimeout(() => {
          buildStatus.textContent = '';
          buildStatus.className = 'build-status';
        }, 3000);
      }

      // Reload doc to get server-side timestamps
      await loadDocument(docId);

      // Refresh doc browser
      const browser = document.querySelector('doc-browser');
      if (browser) browser.refresh();
    } catch (err) {
      console.error('Publish error:', err);
      if (buildStatus) {
        buildStatus.textContent = `Error: ${err.message}`;
        buildStatus.className = 'build-status error';
      }
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
    const publishBtn = this.querySelector('[data-publish]');

    if (titleInput) titleInput.value = meta.title || '';
    if (slugInput) slugInput.value = meta.slug || '';
    if (collectionInput) collectionInput.value = meta.collection || '';
    if (descInput) descInput.value = meta.description || '';
    if (statusSelect) statusSelect.value = meta.status || 'draft';

    // Update publish button text
    if (publishBtn) {
      const isPublished = meta.status === 'published';
      publishBtn.textContent = isPublished ? 'Unpublish' : 'Publish';
      publishBtn.className = isPublished
        ? 'btn btn-unpublish'
        : 'btn btn-publish';
    }

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
