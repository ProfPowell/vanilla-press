/**
 * <doc-browser> — sidebar document list with collection/status filters and search.
 *
 * Displays documents from the content API. Click to load, create new,
 * filter by collection/status, or search. In `vp serve` it sits at the
 * bottom of the Post settings panel. Delete asks first, in the page's
 * <confirm-panel>.
 *
 * @module editor/components/doc-browser
 */

import { api } from '../api-client.js';
import { confirmText } from '../site-context.js';

export class DocBrowser extends HTMLElement {
  connectedCallback() {
    this.className = 'doc-browser';
    this._collection = '';
    this._status = '';
    this._searchQuery = '';
    this._docs = [];
    this._collections = [];
    this._collapsed = false;

    this.render();
    this.loadCollections();
    this.loadDocuments();
  }

  render() {
    this.innerHTML = `
      <div class="browser-header">
        <h3>Documents</h3>
        <button class="browser-toggle" title="Toggle document browser">&blacktriangledown;</button>
      </div>
      <div class="browser-body">
        <div class="browser-controls">
          <select class="browser-collection" title="Filter by collection">
            <option value="">All collections</option>
          </select>
          <div class="browser-status-tabs">
            <button class="status-tab active" data-status="">All</button>
            <button class="status-tab" data-status="draft">Draft</button>
            <button class="status-tab" data-status="published">Published</button>
          </div>
          <input type="search" class="browser-search" placeholder="Search..." />
        </div>
        <div class="browser-actions">
          <button class="browser-new-btn">+ New Document</button>
        </div>
        <div class="browser-list"></div>
      </div>
    `;

    this.wireEvents();
  }

  wireEvents() {
    // Toggle collapse
    this.querySelector('.browser-toggle').addEventListener('click', () => {
      this._collapsed = !this._collapsed;
      this.querySelector('.browser-body').style.display = this._collapsed ? 'none' : '';
      this.querySelector('.browser-toggle').textContent = this._collapsed ? '\u25b6' : '\u25bc';
    });

    // Collection filter
    this.querySelector('.browser-collection').addEventListener('change', (e) => {
      this._collection = e.target.value;
      this.loadDocuments();
    });

    // Status filter tabs
    this.querySelectorAll('.status-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this.querySelectorAll('.status-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this._status = tab.dataset.status;
        this.loadDocuments();
      });
    });

    // Search
    let searchTimer;
    this.querySelector('.browser-search').addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        this._searchQuery = e.target.value.trim();
        if (this._searchQuery) {
          this.performSearch();
        } else {
          this.loadDocuments();
        }
      }, 300);
    });

    // New document
    this.querySelector('.browser-new-btn').addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('doc-create', {
        bubbles: true,
        detail: { collection: this._collection || 'posts' },
      }));
    });
  }

  async loadCollections() {
    try {
      this._collections = await api.listCollections();
      const select = this.querySelector('.browser-collection');
      // Keep the "All" option, add collections
      const existing = select.value;
      select.innerHTML = '<option value="">All collections</option>';
      for (const col of this._collections) {
        const opt = document.createElement('option');
        opt.value = col;
        opt.textContent = col;
        select.appendChild(opt);
      }
      select.value = existing;
    } catch (err) {
      console.error('Error loading collections:', err);
    }
  }

  async loadDocuments() {
    try {
      this._docs = await api.listDocuments(this._collection, this._status);
      this.renderList();
    } catch (err) {
      console.error('Error loading documents:', err);
    }
  }

  async performSearch() {
    try {
      this._docs = await api.search(this._searchQuery);
      this.renderList();
    } catch (err) {
      console.error('Error searching:', err);
      this._docs = [];
      this.renderList();
    }
  }

  renderList() {
    const list = this.querySelector('.browser-list');

    if (this._docs.length === 0) {
      list.innerHTML = '<div class="browser-empty">No documents found</div>';
      return;
    }

    list.innerHTML = this._docs.map(doc => `
      <div class="browser-item" data-doc-id="${doc.id}">
        <div class="browser-item-title">${escapeHtml(doc.meta.title || 'Untitled')}</div>
        <div class="browser-item-meta">
          <span class="browser-item-collection">${escapeHtml(doc.meta.collection)}</span>
          <span class="browser-item-status status-${doc.meta.status}">${doc.meta.status}</span>
        </div>
        <button type="button" class="browser-item-delete" data-delete-id="${doc.id}" title="Delete" aria-label="Delete ${escapeHtml(doc.meta.title || 'Untitled').replace(/"/g, '&quot;')}">&times;</button>
      </div>
    `).join('');

    // Wire click events
    list.querySelectorAll('.browser-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.classList.contains('browser-item-delete')) return;
        this.dispatchEvent(new CustomEvent('doc-select', {
          bubbles: true,
          detail: { id: item.dataset.docId },
        }));
      });
    });

    // Wire delete events
    list.querySelectorAll('.browser-item-delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.deleteId;
        const title = btn.closest('.browser-item').querySelector('.browser-item-title').textContent;
        const panel = document.querySelector('confirm-panel');
        if (!panel || !(await panel.ask(confirmText('delete', { title, liveUrl: null })))) return;
        this.dispatchEvent(new CustomEvent('doc-delete', {
          bubbles: true,
          detail: { id },
        }));
      });
    });

    // Highlight current document
    this.highlightCurrent();
  }

  /** Highlight the currently loaded document in the list. */
  highlightCurrent() {
    const currentId = window.location.hash.replace('#doc-', '');
    this.querySelectorAll('.browser-item').forEach(item => {
      item.classList.toggle('active', item.dataset.docId === currentId);
    });
  }

  /** Refresh the document list (called after create/delete/save). */
  refresh() {
    if (this._searchQuery) {
      this.performSearch();
    } else {
      this.loadDocuments();
    }
    this.loadCollections();
  }
}

function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

customElements.define('doc-browser', DocBrowser);
