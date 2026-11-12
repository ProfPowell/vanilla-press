/**
 * <meta-panel> — the post's fields in the Post settings panel.
 *
 * Top to bottom: the "changed on disk" notice (when in conflict), the
 * publishing status box (site mode; `vp serve` keeps its Status select),
 * URL (the collection's prefix plus the slug), Description with its hint,
 * Featured image (a thumbnail and file name, Choose… and Remove), Tags, Collection (a select from the site's `collections` config) and
 * Appearance (<appearance-section>). The title is the document's first line
 * (title.js); the slug
 * follows it until edited here or the post is published (editor.js, slug.js).
 * In `vp serve` the Publish/Unpublish and Preview actions stay here too.
 * Every field edit auto-saves.
 *
 * @module editor/components/meta-panel
 */

import { validStatuses } from '../../../../src/schema/content-schema.js';
import { getCurrentMeta, setCurrentMeta, getCurrentDocId } from '../meta-state.js';
import { api } from '../api-client.js';
import { postUrlPath, collectionOutput } from '../../../../src/sync/paths.js';
import {
  saveDocument, loadDocument, handleSaveError, loadVersionOnDisk, setSlugHandEdited, refreshMetaLine, metaEdited,
} from '../editor.js';
import { onMetaUpdate as onSiteMetaUpdate, isSiteMode, altCheckPasses } from '../site-mode.js';
import { statusBox, collectionOptions, layoutChoices, urlPrefix, featuredModel } from '../settings-view.js';
import { SITE, displayMediaUrl } from '../site-context.js';
import { openMediaPicker } from './media-picker.js';
import './appearance-section.js';

export class MetaPanel extends HTMLElement {
  connectedCallback() {
    /** The site's `collections` config (Collection choices, URL prefix). */
    this._collections = {};
    /** The open published post has saved edits that are not live (site-mode.js sets it). */
    this._liveOutOfDate = false;
    /** The site's layouts listing (GET /api/layouts), for the Layout select; null until fetched or when the fetch failed. */
    this.layoutsListing = null;
    this.render();
    /** Settled once the collections config has loaded (or failed): the editor waits on it for a document's regions. */
    this.collectionsLoaded = this.loadCollections();
    /** Settled once the layouts listing has loaded (or failed): the editor reuses it (no second fetch). */
    this.layoutsLoaded = this.loadLayouts();

    // Listen for meta updates (e.g. from doc loading)
    window.__onMetaUpdate = (meta) => {
      this.syncFromMeta(meta);
      onSiteMetaUpdate(meta); // the header: primary button and "⋯" menu
    };
    // Show / hide the "changed on disk" notice for the current document
    window.__onConflictChange = (docId, message) => this.showConflict(docId, message);
  }

  /** The site's `collections` config ({} until loaded or when the fetch failed). */
  get collections() {
    return this._collections;
  }

  async loadCollections() {
    try {
      const { value } = await api.getConfig('collections');
      const parsed = value ? JSON.parse(value) : {};
      this._collections = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch { /* defaults */ }
    this.syncFromMeta(getCurrentMeta());
  }

  /**
   * Tell the editor the post's layout changed (its regions follow).
   * @param {string} layout - `meta.layout` ('' for the collection default)
   */
  fireLayoutChange(layout) {
    this.dispatchEvent(new CustomEvent('vp-layout-change', {
      bubbles: true, detail: { layout, listing: this.layoutsListing },
    }));
  }

  /** Fetch the layouts listing once; a failure leaves the select with the default and the current value only. */
  async loadLayouts() {
    try {
      this.layoutsListing = await api.getLayouts();
    } catch { this.layoutsListing = null; }
    this.syncFromMeta(getCurrentMeta());
  }

  /**
   * Whether the open published post's saved edits are not on the live site yet.
   * @param {boolean} outOfDate
   */
  setLiveOutOfDate(outOfDate) {
    this._liveOutOfDate = outOfDate;
    this.renderStatus(getCurrentMeta());
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
    const status = isSiteMode
      ? `<section class="status-box" data-status-box aria-label="Publishing">
          <p class="status-title"><span class="status-dot" aria-hidden="true"></span><span data-status-title></span></p>
          <p class="status-note" data-status-note></p>
        </section>`
      : `<div class="field">
          <label for="meta-status">Status</label>
          <select id="meta-status">
            ${validStatuses.map(s => `<option value="${s}">${s}</option>`).join('')}
          </select>
        </div>`;
    this.innerHTML = `
      <div class="conflict-notice" data-conflict hidden role="alert">
        <p data-conflict-message></p>
        <p>Auto-save is paused for this document.</p>
        <button type="button" class="btn" data-load-disk>Load the version on disk</button>
      </div>

      ${status}

      <div class="field">
        <label for="meta-slug">URL</label>
        <div class="url-field">
          <span class="url-prefix" id="meta-url-prefix" data-url-prefix>/posts/</span>
          <input type="text" id="meta-slug" value="" aria-describedby="meta-url-prefix" spellcheck="false" autocapitalize="off"/>
        </div>
      </div>

      <div class="field">
        <label for="meta-description">Description</label>
        <textarea id="meta-description" rows="4" aria-describedby="meta-description-hint"></textarea>
        <p class="hint" id="meta-description-hint">Used in feeds, search results and link previews.</p>
      </div>

      <div class="field" role="group" aria-labelledby="meta-featured-label">
        <p class="field-label" id="meta-featured-label">Featured image</p>
        <div class="featured" data-featured>
          <img class="featured-thumb" data-featured-thumb alt="" hidden/>
          <span class="featured-name" data-featured-name hidden></span>
          <p class="hint" data-featured-none>No featured image.</p>
        </div>
        <div class="featured-actions">
          <button type="button" class="btn" data-featured-choose>Choose…</button>
          <button type="button" class="btn" data-featured-remove hidden>Remove</button>
        </div>
      </div>

      <div class="field">
        <label for="meta-tags">Tags</label>
        <ul class="tag-chips" id="meta-tag-chips" aria-label="Tags"></ul>
        <input type="text" id="meta-tags" placeholder="Add a tag, then Enter"/>
      </div>

      <div class="field">
        <label for="meta-collection">Collection</label>
        <select id="meta-collection"></select>
      </div>

      <div class="field">
        <label for="meta-layout">Layout</label>
        <select id="meta-layout"></select>
        <p class="meta-note" data-layout-note hidden></p>
      </div>

      <appearance-section></appearance-section>

      <div class="actions">
        <button type="button" class="btn btn-publish" data-publish>Publish</button>
        <button type="button" class="btn" data-preview>Preview</button>
        <div class="build-status" data-build-status></div>
      </div>
    `;

    this.wireEvents();
    this.syncFromMeta(getCurrentMeta());
  }

  wireEvents() {
    const slugInput = this.querySelector('#meta-slug');
    const collectionSelect = this.querySelector('#meta-collection');
    const descInput = this.querySelector('#meta-description');
    const statusSelect = this.querySelector('#meta-status');
    const tagInput = this.querySelector('#meta-tags');
    const publishBtn = this.querySelector('[data-publish]');
    const previewBtn = this.querySelector('[data-preview]');

    slugInput.addEventListener('input', () => {
      // Edited by hand: it stops following the title (cleared, it follows again)
      setSlugHandEdited(!!slugInput.value);
      setCurrentMeta({ slug: slugInput.value });
      metaEdited();
    });

    collectionSelect.addEventListener('change', () => {
      setCurrentMeta({ collection: collectionSelect.value });
      this.renderUrlPrefix(getCurrentMeta());
      this.renderLayouts(getCurrentMeta()); // the collection default's name follows
      refreshMetaLine();
      // With no layout of its own, the post's layout is the collection's: its regions follow
      if (!getCurrentMeta().layout) this.fireLayoutChange('');
      metaEdited();
    });

    this.querySelector('#meta-layout').addEventListener('change', (e) => {
      const layout = e.target.value;
      setCurrentMeta({ layout });
      this.fireLayoutChange(layout);
      metaEdited();
    });

    descInput.addEventListener('input', () => {
      setCurrentMeta({ description: descInput.value });
      metaEdited();
    });

    // vp serve only (site mode shows the status box: status changes only through the header actions)
    statusSelect?.addEventListener('change', () => {
      setCurrentMeta({ status: statusSelect.value });
      refreshMetaLine();
      metaEdited();
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
          metaEdited();
        }
        tagInput.value = '';
      }
    });

    // Featured image: chosen from the library (upload there too); saved at once
    const chooseBtn = this.querySelector('[data-featured-choose]');
    chooseBtn.addEventListener('click', async () => {
      const docId = getCurrentDocId();
      const item = await openMediaPicker({ kind: 'image', heading: 'Choose a featured image' });
      if (!item || getCurrentDocId() !== docId) return; // another post opened meanwhile
      this.setFeatured(item.src);
      chooseBtn.focus();
    });
    this.querySelector('[data-featured-remove]').addEventListener('click', () => {
      this.setFeatured(null);
      chooseBtn.focus();
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
      const base = previewUrl.replace(/\/+$/, '');
      try {
        await fetch(base, { mode: 'no-cors' });
      } catch {
        tab?.close();
        say(`Preview needs the site's dev server at ${base}: run "npm run dev" in the site folder`);
        return;
      }
      const url = `${base}${postUrlPath({ meta }, this._collections)}`;
      if (tab) tab.location.href = url;
      else window.open(url, '_blank');
    });
  }

  /**
   * vp serve: Publish (after the alt check, unless the header already ran it) or Unpublish.
   * @param {{ altChecked?: boolean }} [options]
   */
  async togglePublish({ altChecked = false } = {}) {
    // The app's header owns Publish/Update/Unpublish; a save never sets status there (Ruling P).
    if (isSiteMode) return;
    const publishing = getCurrentMeta()?.status !== 'published';
    if (publishing && !altChecked) {
      if (this._checking) return;
      this._checking = true;
      let go;
      try { go = await altCheckPasses('publish', this.querySelector('[data-publish]')); } finally { this._checking = false; }
      if (!go) return;
    }
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

    const slugInput = this.querySelector('#meta-slug');
    const descInput = this.querySelector('#meta-description');
    const statusSelect = this.querySelector('#meta-status');
    const publishBtn = this.querySelector('[data-publish]');

    if (slugInput && slugInput !== document.activeElement) slugInput.value = meta.slug || '';
    if (descInput && descInput !== document.activeElement) descInput.value = meta.description || '';
    if (statusSelect) statusSelect.value = meta.status || 'draft';

    // Update publish button text
    if (publishBtn) {
      const isPublished = meta.status === 'published';
      publishBtn.textContent = isPublished ? 'Unpublish' : 'Publish';
      publishBtn.className = isPublished
        ? 'btn btn-unpublish'
        : 'btn btn-publish';
    }

    this.renderStatus(meta);
    this.renderCollections(meta);
    this.renderLayouts(meta);
    this.renderUrlPrefix(meta);
    this.renderTags(meta.tags || []);
    this.renderFeatured(meta);
    this.querySelector('appearance-section')?.render?.(meta);
  }

  /**
   * Set (a `/media/` URL) or clear (null) the featured image, and save.
   * @param {string|null} src
   */
  setFeatured(src) {
    setCurrentMeta({ image: src });
    this.renderFeatured(getCurrentMeta());
    saveDocument();
  }

  /** The Featured image field: thumbnail and file name with Remove, or "No featured image." */
  renderFeatured(meta) {
    const { set, src, name } = featuredModel(meta);
    const thumb = this.querySelector('[data-featured-thumb]');
    if (!thumb) return;
    const shown = set ? displayMediaUrl(src, SITE) : '';
    if (thumb.getAttribute('src') !== shown) {
      if (shown) thumb.setAttribute('src', shown);
      else thumb.removeAttribute('src');
    }
    thumb.hidden = !set;
    const nameEl = this.querySelector('[data-featured-name]');
    nameEl.textContent = name || '';
    nameEl.hidden = !set;
    this.querySelector('[data-featured-none]').hidden = set;
    this.querySelector('[data-featured-remove]').hidden = !set;
  }

  /** The status box (site mode): "Published <date>" with the not-live note, or "Draft". */
  renderStatus(meta) {
    const box = this.querySelector('[data-status-box]');
    if (!box || !meta) return;
    const { title, note } = statusBox(meta, { liveOutOfDate: this._liveOutOfDate });
    box.dataset.state = meta.status === 'published' ? (this._liveOutOfDate ? 'held' : 'published') : 'draft';
    box.querySelector('[data-status-title]').textContent = title;
    const noteEl = box.querySelector('[data-status-note]');
    noteEl.textContent = note || '';
    noteEl.hidden = !note;
  }

  /** The Collection select: the config's collections, plus the post's own when not listed. */
  renderCollections(meta) {
    const select = this.querySelector('#meta-collection');
    if (!select) return;
    const current = meta.collection || '';
    const names = collectionOptions(this._collections, current);
    const same = names.length === select.options.length && names.every((n, i) => select.options[i].value === n);
    if (!same) {
      select.replaceChildren(...names.map((n) => {
        const opt = document.createElement('option');
        opt.value = n;
        opt.textContent = n;
        return opt;
      }));
    }
    select.value = current;
  }

  /** The Layout select: the collection default, the site's layouts, the post's own when missing; and the listing's warning. */
  renderLayouts(meta) {
    const select = this.querySelector('#meta-layout');
    if (!select) return;
    const current = meta.layout || '';
    const collectionLayout = collectionOutput(meta.collection || 'posts', this._collections).layout || '';
    const choices = layoutChoices(this.layoutsListing, { collectionLayout, current });
    const same = choices.length === select.options.length
      && choices.every((c, i) => select.options[i].value === c.value && select.options[i].textContent === c.label
        && select.options[i].disabled === !!c.disabled);
    if (!same) {
      select.replaceChildren(...choices.map((c) => {
        const opt = document.createElement('option');
        opt.value = c.value;
        opt.textContent = c.label;
        if (c.disabled) opt.disabled = true;
        return opt;
      }));
    }
    select.value = current;
    const note = this.querySelector('[data-layout-note]');
    const message = this.layoutsListing?.message || '';
    note.textContent = message;
    note.hidden = !message;
  }

  renderUrlPrefix(meta) {
    const prefix = this.querySelector('[data-url-prefix]');
    if (prefix) prefix.textContent = urlPrefix(meta.collection || 'posts', this._collections);
  }

  renderTags(tags) {
    const list = this.querySelector('#meta-tag-chips');
    if (!list) return;
    list.hidden = !tags.length;
    list.replaceChildren(...tags.map((tag) => {
      const li = document.createElement('li');
      li.className = 'tag-chip';
      const text = document.createElement('span');
      text.textContent = tag;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.setAttribute('aria-label', `Remove tag ${tag}`);
      remove.textContent = '×';
      remove.addEventListener('click', () => {
        const meta = getCurrentMeta();
        const newTags = (meta.tags || []).filter(t => t !== tag);
        setCurrentMeta({ tags: newTags });
        this.renderTags(newTags);
        metaEdited();
        this.querySelector('#meta-tags')?.focus();
      });
      li.append(text, remove);
      return li;
    }));
  }
}

customElements.define('meta-panel', MetaPanel);
