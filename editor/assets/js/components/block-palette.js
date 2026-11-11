/**
 * <block-palette> — slash command menu for inserting block types.
 *
 * Triggered by typing `/` in an empty paragraph (the entry replaces that
 * paragraph), or by a block's `+` handle (the entry goes after the block:
 * the `insertAfter` position). Shows a popover
 * with block types grouped by category. Filter by typing, keyboard
 * navigation, Enter selects.
 *
 * @module editor/components/block-palette
 */

import { Selection, NodeSelection } from 'prosemirror-state';
import { Fragment } from 'prosemirror-model';
import { schema } from '../schema.js';
import { placePopover } from '../popover-place.js';
import { openMediaPicker } from './media-picker.js';
import { nodeTypeFor, initialAttrs, paletteEntries } from '../component-model.js';
import { insertPlan, nodesFor, pdfViewerEnabled } from '../media-insert.js';
import { trackTarget, untrackTarget, insertAtTarget } from '../insert-target.js';
import { focusFigureAlt } from '../blocks/figure-view.js';
import { addSaveNote } from '../meta-state.js';
import { api } from '../api-client.js';

/**
 * Palette entries: each has an id, label, description, icon, category,
 * and a factory function that returns a ProseMirror node.
 */
const PALETTE_ENTRIES = [
  // --- Prose ---
  {
    id: 'heading2', label: 'Heading 2', description: 'Section heading',
    icon: 'H2', category: 'prose',
    create: () => schema.nodes.heading.create({ level: 2 }),
  },
  {
    id: 'heading3', label: 'Heading 3', description: 'Subsection heading',
    icon: 'H3', category: 'prose',
    create: () => schema.nodes.heading.create({ level: 3 }),
  },
  {
    id: 'heading4', label: 'Heading 4', description: 'Minor heading',
    icon: 'H4', category: 'prose',
    create: () => schema.nodes.heading.create({ level: 4 }),
  },
  {
    id: 'bullet_list', label: 'Bullet list', description: 'Unordered list',
    icon: '\u2022', category: 'prose',
    create: () => schema.nodes.bullet_list.create(null, [
      schema.nodes.list_item.create(null, [schema.nodes.paragraph.create()]),
    ]),
  },
  {
    id: 'ordered_list', label: 'Numbered list', description: 'Ordered list',
    icon: '1.', category: 'prose',
    create: () => schema.nodes.ordered_list.create(null, [
      schema.nodes.list_item.create(null, [schema.nodes.paragraph.create()]),
    ]),
  },
  {
    id: 'blockquote', label: 'Blockquote', description: 'Quoted passage',
    icon: '\u201c', category: 'prose',
    create: () => schema.nodes.blockquote.create(null, [schema.nodes.paragraph.create()]),
  },
  {
    id: 'hr', label: 'Divider', description: 'Horizontal rule',
    icon: '\u2014', category: 'prose',
    create: () => schema.nodes.hr.create(),
  },
  {
    id: 'hr_decorative', label: 'Decorative divider', description: 'Decorative horizontal rule',
    icon: '\u2026', category: 'prose',
    create: () => schema.nodes.hr.create({ variant: 'decorative' }),
  },
  {
    id: 'table', label: 'Table', description: '3-column table with header row',
    icon: '\u2637', category: 'prose',
    create: () => schema.nodes.table.create(null, [
      schema.nodes.table_row.create(null, [
        schema.nodes.table_header.create(null, [schema.text('Header 1')]),
        schema.nodes.table_header.create(null, [schema.text('Header 2')]),
        schema.nodes.table_header.create(null, [schema.text('Header 3')]),
      ]),
      schema.nodes.table_row.create(null, [
        schema.nodes.table_cell.create(),
        schema.nodes.table_cell.create(),
        schema.nodes.table_cell.create(),
      ]),
    ]),
  },
  {
    id: 'definition_list', label: 'Definition list', description: 'Term and definition pairs',
    icon: '\u2261', category: 'prose',
    create: () => schema.nodes.definition_list.create(null, [
      schema.nodes.definition_term.create(null, [schema.text('Term')]),
      schema.nodes.definition_desc.create(null, [schema.nodes.paragraph.create()]),
    ]),
  },

  // --- Components ---
  {
    id: 'callout_note', label: 'Note', description: 'Blue informational callout',
    icon: '\u24d8', category: 'component',
    create: () => schema.nodes.callout.create({ variant: 'note' }, [schema.nodes.paragraph.create()]),
  },
  {
    id: 'callout_tip', label: 'Tip', description: 'Green helpful tip',
    icon: '\u2713', category: 'component',
    create: () => schema.nodes.callout.create({ variant: 'tip' }, [schema.nodes.paragraph.create()]),
  },
  {
    id: 'callout_warning', label: 'Warning', description: 'Orange caution callout',
    icon: '\u26a0', category: 'component',
    create: () => schema.nodes.callout.create({ variant: 'warning' }, [schema.nodes.paragraph.create()]),
  },
  {
    id: 'callout_danger', label: 'Danger', description: 'Red danger callout',
    icon: '\u2718', category: 'component',
    create: () => schema.nodes.callout.create({ variant: 'danger' }, [schema.nodes.paragraph.create()]),
  },
  {
    id: 'collapsible', label: 'Collapsible', description: 'Expandable details section',
    icon: '\u25b8', category: 'component',
    create: () => schema.nodes.collapsible.create({ summary: '' }, [schema.nodes.paragraph.create()]),
  },
  {
    id: 'card', label: 'Card', description: 'Linked card block',
    icon: '\ud83d\udcc4', category: 'component',
    create: () => schema.nodes.card.create({ href: '' }, [schema.nodes.paragraph.create()]),
  },
  {
    id: 'tabs', label: 'Tabs', description: 'Tabbed content with 2 tabs',
    icon: '\u2630', category: 'component',
    create: () => schema.nodes.tabs.create(null, [
      schema.nodes.tab.create({ label: 'Tab 1' }, [schema.nodes.paragraph.create()]),
      schema.nodes.tab.create({ label: 'Tab 2' }, [schema.nodes.paragraph.create()]),
    ]),
  },
  {
    id: 'steps', label: 'Steps', description: 'Step-by-step instructions',
    icon: '#', category: 'component',
    create: () => schema.nodes.steps.create(null, [
      schema.nodes.step.create({ title: 'Step 1' }, [schema.nodes.paragraph.create()]),
    ]),
  },

  // --- Media ---
  // `pick`: open the media picker for that kind first; insert only on a choice.
  {
    id: 'figure', label: 'Image', description: 'Choose or upload an image',
    icon: '\ud83d\uddbc\ufe0f', category: 'media', pick: 'image',
  },
  {
    id: 'audio', label: 'Audio', description: 'Choose or upload an audio file',
    icon: '\u266b', category: 'media', pick: 'audio',
  },
  {
    id: 'video', label: 'Video', description: 'Choose or upload a video file',
    icon: '\u25b6', category: 'media', pick: 'video',
  },
  {
    id: 'pdf', label: 'PDF', description: 'Choose or upload a PDF',
    icon: '\u2399', category: 'media', pick: 'pdf',
  },
  {
    id: 'embed', label: 'Embed', description: 'CodePen, Observable or other external embed',
    icon: '\u29c9', category: 'media',
    create: () => schema.nodes.embed.create({ url: '', type: 'video' }),
  },

  // --- Code ---
  {
    id: 'code_block', label: 'Code block', description: 'Syntax-highlighted code',
    icon: '<>', category: 'code',
    create: () => schema.nodes.code_block.create({ language: 'text' }),
  },
];

// Catalog icon names → palette glyphs (the icon slot is one character wide)
const COMPONENT_ICON_GLYPHS = {
  accordion: '\u25be', audio: '\u266b', blink: '\u2733', browser: '\u25a3', carousel: '\u21c4',
  code: '<>', diagram: '\u25c7', 'edit-image': '\u270e', file: '\u2399', footnote: '\u2020',
  frame: '\u25a2', gallery: '\u25a6', image: '\u25a7', map: '\u2316', marquee: '\u21e0',
  play: '\u25b6', qr: '\u25a9', share: '\u21aa', terminal: '>_', video: '\u25b6', youtube: '\u25b6',
};

const CATEGORY_LABELS = {
  prose: 'Prose',
  component: 'Components',
  media: 'Media',
  code: 'Code',
  pattern: 'Patterns',
};

export class BlockPalette {
  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'block-palette';
    // Options are announced as a listbox; the editor keeps focus, and the
    // selected option is marked with aria-selected (and shown by .selected).
    this.el.setAttribute('role', 'listbox');
    this.el.setAttribute('aria-label', 'Blocks');
    this.el.id = `block-palette-${Math.random().toString(36).slice(2, 8)}`;
    document.body.appendChild(this.el);

    this.items = [];
    this.selected = 0;
    this.filter = '';
    this.visible = false;
    this.view = null;
    this.triggerPos = null;
    /** Where the entry goes when opened from a `+` handle, else null */
    this.insertAfter = null;

    this._entries = [...PALETTE_ENTRIES];
    this._patternEntries = [];
    this._componentEntries = [];

    // Close on outside click
    document.addEventListener('mousedown', (e) => {
      if (this.visible && !this.el.contains(e.target)) {
        this.close();
      }
    });
  }

  /**
   * Register pattern entries (called by patterns module).
   * @param {Array} patterns
   */
  registerPatterns(patterns) {
    this._patternEntries = patterns;
  }

  /**
   * Register web-component entries from descriptors (enabled packages only).
   * Inline kinds are skipped: they are offered by the toolbar's wrap select.
   * @param {Array} descriptors
   */
  registerComponents(descriptors) {
    const byTag = new Map(descriptors.map(d => [d.tag, d]));
    this._componentEntries = paletteEntries(descriptors).map(entry => {
      const desc = byTag.get(entry.tag);
      const type = nodeTypeFor(desc);
      return {
        ...entry,
        icon: COMPONENT_ICON_GLYPHS[entry.icon] || '\u29c9',
        create: () => schema.nodes[type].create(initialAttrs(desc),
          type === 'component_blocks' ? [schema.nodes.paragraph.create()] : null),
      };
    });
  }

  /**
   * @param {import('prosemirror-view').EditorView} view
   * @param {number} pos - where the palette shows (the `/` it was typed at)
   * @param {{ insertAfter?: number }} [options] - insert the entry at this
   *   position (just after a block) instead of replacing the `/` paragraph
   */
  open(view, pos, { insertAfter = null } = {}) {
    this.view = view;
    this.triggerPos = pos;
    this.insertAfter = insertAfter;
    this.filter = '';
    this.selected = 0;
    this.visible = true;

    this.render();
    this.el.classList.add('open'); // displayed first, so position() can measure it
    this.position();
    this.onReflow = (e) => { if (!e || e.target !== this.el) this.position(); }; // the list's own scrolling is not a reason to re-place
    window.addEventListener('scroll', this.onReflow, true);
    window.addEventListener('resize', this.onReflow);
  }

  close() {
    if (this.onReflow) {
      window.removeEventListener('scroll', this.onReflow, true);
      window.removeEventListener('resize', this.onReflow);
      this.onReflow = null;
    }
    this.visible = false;
    this.filter = '';
    this.selected = 0;
    this.triggerPos = null;
    this.insertAfter = null;
    this.el.classList.remove('open');
  }

  /**
   * The positions just before and after the paragraph the palette was
   * opened from, or null when the trigger position no longer points into a
   * paragraph (the doc was replaced or changed under the open palette).
   */
  _triggerRange() {
    const { doc } = this.view.state;
    if (this.triggerPos == null || this.triggerPos > doc.content.size) return null;
    const $pos = doc.resolve(this.triggerPos);
    if ($pos.parent.type.name !== 'paragraph' || $pos.depth < 1) return null;
    return [$pos.before(), $pos.after()];
  }

  position() {
    if (!this.view) return;
    const coords = this.view.coordsAtPos(this.triggerPos);
    const scrolled = this.el.scrollTop;
    this.el.style.maxHeight = ''; // measure at the natural (CSS) height
    const p = placePopover(
      coords,
      { width: this.el.offsetWidth, height: this.el.offsetHeight },
      { width: document.documentElement.clientWidth, height: window.innerHeight },
    );
    this.el.style.left = `${p.left}px`;
    this.el.style.top = `${p.top}px`;
    if (p.maxHeight != null) this.el.style.maxHeight = `${p.maxHeight}px`;
    this.el.scrollTop = scrolled;
  }

  updateFilter(char) {
    this.filter += char;
    this.selected = 0;
    this.render();
    this.position();
  }

  backspace() {
    if (this.filter.length > 0) {
      this.filter = this.filter.slice(0, -1);
      this.selected = 0;
      this.render();
      this.position();
    } else {
      this.close();
    }
  }

  moveUp() {
    if (this.items.length === 0) return;
    this.selected = (this.selected - 1 + this.items.length) % this.items.length;
    this.highlightSelected();
    this.items[this.selected].el.scrollIntoView({ block: 'nearest' });
  }

  moveDown() {
    if (this.items.length === 0) return;
    this.selected = (this.selected + 1) % this.items.length;
    this.highlightSelected();
    this.items[this.selected].el.scrollIntoView({ block: 'nearest' });
  }

  selectCurrent() {
    if (this.items.length === 0) return;
    const item = this.items[this.selected];
    if (!item) return;

    if (item.entry.isPattern) {
      this.insertPattern(item.entry);
    } else {
      this.insertBlock(item.entry);
    }
  }

  /**
   * Insert `nodes` at the `insertAfter` position and put the cursor in the
   * first (or select it, when it holds no text).
   * @returns {boolean} false when the position no longer fits the doc
   */
  _insertAfterBlock(nodes) {
    const { state, dispatch } = this.view;
    const at = this.insertAfter;
    if (at > state.doc.content.size) return false;
    const tr = state.tr.insert(at, Fragment.fromArray(nodes));
    if (!tr.docChanged) return false;
    const inserted = tr.doc.nodeAt(at);
    const text = Selection.findFrom(tr.doc.resolve(at), 1, true);
    if (text && inserted && text.from < at + inserted.nodeSize) tr.setSelection(text);
    else if (inserted) tr.setSelection(NodeSelection.create(tr.doc, at));
    dispatch(tr.scrollIntoView());
    return true;
  }

  insertBlock(entry) {
    if (!this.view || this.triggerPos == null) return;
    if (entry.pick) { this._pickAndInsert(entry); return; }

    if (this.insertAfter != null) {
      this._insertAfterBlock([entry.create()]);
      this.view.focus();
      this.close();
      return;
    }

    const range = this._triggerRange();
    if (!range) { this.close(); return; }
    const node = entry.create();
    const { state, dispatch } = this.view;

    let tr = state.tr;
    tr = tr.replaceRangeWith(range[0], range[1], node);
    dispatch(tr.scrollIntoView());
    this.view.focus();
    this.close();
  }

  /**
   * Media entries: open the picker, and on a choice insert its block where
   * the palette was opened (the `/` paragraph, or after the `+` block). The
   * place is tracked through any edits made meanwhile (insert-target.js).
   * Closing the picker inserts nothing.
   */
  async _pickAndInsert(entry) {
    const view = this.view;
    const where = this.insertAfter != null ? { after: this.insertAfter } : { replace: this.triggerPos };
    this.close();
    const { tr, id } = trackTarget(view.state, where);
    view.dispatch(tr);
    // Whether a PDF can be a <pdf-viewer>: asked now, alongside the picker
    const components = entry.pick === 'pdf' ? api.listComponents().catch(() => null) : null;

    const item = await openMediaPicker({ kind: entry.pick });
    if (view.isDestroyed) return;
    if (!item) {
      view.dispatch(untrackTarget(view.state, id));
      view.focus();
      return;
    }
    const pdfViewer = item.kind === 'pdf' ? pdfViewerEnabled(await components) : false;
    if (view.isDestroyed) return;
    const plan = insertPlan(item, { pdfViewer });
    const done = insertAtTarget(view.state, id, nodesFor(plan, schema));
    view.focus();
    if (!done) return; // another post was opened meanwhile
    view.dispatch(done.tr);
    if (plan.focusAlt) focusFigureAlt(view, done.pos);
    if (plan.note) addSaveNote(plan.note);
  }

  insertPattern(entry) {
    if (!this.view || this.triggerPos == null) return;

    const nodes = entry.createNodes();
    if (!nodes || nodes.length === 0) return;

    if (this.insertAfter != null) {
      this._insertAfterBlock(nodes);
      this.view.focus();
      this.close();
      return;
    }

    const range = this._triggerRange();
    if (!range) { this.close(); return; }
    const { state, dispatch } = this.view;
    const from = range[0] + 1;

    let tr = state.tr;
    // Replace the paragraph with the first node
    tr = tr.replaceRangeWith(range[0], range[1], nodes[0]);

    // Insert remaining nodes after the first one
    if (nodes.length > 1) {
      // Find the position after the first inserted node
      let insertPos = from - 1 + nodes[0].nodeSize;
      for (let i = 1; i < nodes.length; i++) {
        tr = tr.insert(insertPos, nodes[i]);
        insertPos += nodes[i].nodeSize;
      }
    }

    dispatch(tr.scrollIntoView());
    this.view.focus();
    this.close();
  }

  get _allEntries() {
    return [...this._entries, ...this._componentEntries, ...this._patternEntries];
  }

  render() {
    const filterLower = this.filter.toLowerCase();
    this.el.innerHTML = '';
    this.items = [];

    // Group entries by category
    const grouped = {};
    for (const entry of this._allEntries) {
      const matchesLabel = entry.label.toLowerCase().includes(filterLower);
      const matchesDesc = entry.description.toLowerCase().includes(filterLower);
      const matchesId = entry.id.toLowerCase().includes(filterLower);
      const matchesCat = entry.category.toLowerCase().includes(filterLower);

      if (!matchesLabel && !matchesDesc && !matchesId && !matchesCat) continue;

      if (!grouped[entry.category]) grouped[entry.category] = [];
      grouped[entry.category].push(entry);
    }

    for (const [category, entries] of Object.entries(grouped)) {
      const catEl = document.createElement('div');
      catEl.className = 'palette-category';
      catEl.textContent = CATEGORY_LABELS[category] || category;
      this.el.appendChild(catEl);

      for (const entry of entries) {
        const item = document.createElement('div');
        item.className = 'palette-item';
        item.setAttribute('role', 'option');
        item.id = `${this.el.id}-${this.items.length}`;
        const isSelected = this.items.length === this.selected;
        item.classList.toggle('selected', isSelected);
        item.setAttribute('aria-selected', String(isSelected));
        // textContent: component labels/descriptions come from package manifests
        const icon = document.createElement('span');
        icon.className = 'palette-icon';
        icon.textContent = entry.icon || '\u25a1';
        const textEl = document.createElement('span');
        textEl.className = 'palette-text';
        const labelEl = document.createElement('span');
        labelEl.className = 'palette-label';
        labelEl.textContent = entry.label;
        const descEl = document.createElement('span');
        descEl.className = 'palette-description';
        descEl.textContent = entry.description;
        textEl.append(labelEl, descEl);
        item.append(icon, textEl);
        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          if (entry.isPattern) {
            this.insertPattern(entry);
          } else {
            this.insertBlock(entry);
          }
        });
        const idx = this.items.length;
        // mousemove, not mouseenter: a resting pointer that the menu opens or
        // scrolls under must not take the selection from the arrow keys.
        item.addEventListener('mousemove', () => {
          if (this.selected === idx) return;
          this.selected = idx;
          this.highlightSelected();
        });
        this.el.appendChild(item);
        this.items.push({ entry, el: item });
      }
    }

    if (this.items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'palette-empty';
      empty.textContent = `No blocks matching "${this.filter}"`;
      this.el.appendChild(empty);
    }
  }

  highlightSelected() {
    for (let i = 0; i < this.items.length; i++) {
      const isSelected = i === this.selected;
      this.items[i].el.classList.toggle('selected', isSelected);
      this.items[i].el.setAttribute('aria-selected', String(isSelected));
    }
  }
}

// Singleton palette
let paletteInstance = null;

export function getBlockPalette() {
  if (!paletteInstance) paletteInstance = new BlockPalette();
  return paletteInstance;
}
