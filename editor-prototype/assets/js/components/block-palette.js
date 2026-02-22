/**
 * <block-palette> — slash command menu for inserting block types.
 *
 * Triggered by typing `/` in an empty paragraph. Shows a popover
 * with block types grouped by category. Filter by typing, keyboard
 * navigation, Enter selects.
 *
 * @module editor/components/block-palette
 */

import { categorizedBlocks } from '../../../../src/schema/content-schema.js';
import { schema } from '../schema.js';

const BLOCK_ICONS = {
  paragraph: '\u00b6',
  heading: 'H',
  blockquote: '\u201c',
  list: '\u2022',
  hr: '\u2014',
  figure: '\ud83d\uddbc\ufe0f',
  embed: '\u25b6',
  code_block: '<>',
  callout: '\u25a0',
  collapsible: '\u25b8',
  card: '\ud83d\udcc4',
  tabs: '\u2630',
  steps: '1.',
};

const BLOCK_DEFAULTS = {
  paragraph: () => schema.nodes.paragraph.create(),
  heading: () => schema.nodes.heading.create({ level: 2 }),
  blockquote: () => schema.nodes.blockquote.create(null, [schema.nodes.paragraph.create()]),
  list: () => schema.nodes.bullet_list.create(null, [
    schema.nodes.list_item.create(null, [schema.nodes.paragraph.create()]),
  ]),
  hr: () => schema.nodes.hr.create(),
  figure: () => schema.nodes.figure.create({ src: '', alt: '' }),
  embed: () => schema.nodes.embed.create({ url: '', type: 'video' }),
  code_block: () => schema.nodes.code_block.create({ language: 'text' }),
  callout: () => schema.nodes.callout.create({ variant: 'note' }, [schema.nodes.paragraph.create()]),
  collapsible: () => schema.nodes.collapsible.create({ summary: '' }, [schema.nodes.paragraph.create()]),
  card: () => schema.nodes.card.create({ href: '' }, [schema.nodes.paragraph.create()]),
  tabs: () => schema.nodes.tabs.create(null, [
    schema.nodes.tab.create({ label: 'Tab 1' }, [schema.nodes.paragraph.create()]),
    schema.nodes.tab.create({ label: 'Tab 2' }, [schema.nodes.paragraph.create()]),
  ]),
  steps: () => schema.nodes.steps.create(null, [
    schema.nodes.step.create({ title: 'Step 1' }, [schema.nodes.paragraph.create()]),
  ]),
};

export class BlockPalette {
  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'block-palette';
    document.body.appendChild(this.el);

    this.items = [];
    this.selected = 0;
    this.filter = '';
    this.visible = false;
    this.view = null;
    this.triggerPos = null;

    // Build category list
    this.categories = categorizedBlocks();

    // Close on outside click
    document.addEventListener('mousedown', (e) => {
      if (this.visible && !this.el.contains(e.target)) {
        this.close();
      }
    });
  }

  open(view, pos) {
    this.view = view;
    this.triggerPos = pos;
    this.filter = '';
    this.selected = 0;
    this.visible = true;

    this.render();
    this.position();
    this.el.classList.add('open');
  }

  close() {
    this.visible = false;
    this.el.classList.remove('open');
  }

  position() {
    if (!this.view) return;
    const coords = this.view.coordsAtPos(this.triggerPos);
    this.el.style.left = `${coords.left}px`;
    this.el.style.top = `${coords.bottom + 4}px`;
  }

  updateFilter(char) {
    this.filter += char;
    this.selected = 0;
    this.render();
  }

  backspace() {
    if (this.filter.length > 0) {
      this.filter = this.filter.slice(0, -1);
      this.selected = 0;
      this.render();
    } else {
      this.close();
    }
  }

  moveUp() {
    if (this.items.length === 0) return;
    this.selected = (this.selected - 1 + this.items.length) % this.items.length;
    this.highlightSelected();
  }

  moveDown() {
    if (this.items.length === 0) return;
    this.selected = (this.selected + 1) % this.items.length;
    this.highlightSelected();
  }

  selectCurrent() {
    if (this.items.length === 0) return;
    const item = this.items[this.selected];
    if (item) this.insertBlock(item.type);
  }

  insertBlock(type) {
    if (!this.view || this.triggerPos == null) return;

    const factory = BLOCK_DEFAULTS[type];
    if (!factory) return;

    const node = factory();
    const { state, dispatch } = this.view;

    // Delete the slash (and any filter text) from the current paragraph
    const $pos = state.doc.resolve(this.triggerPos);
    const from = $pos.start();
    const to = $pos.end();

    // Replace the paragraph with the new block
    let tr = state.tr;
    tr = tr.replaceRangeWith(from - 1, to + 1, node);
    dispatch(tr.scrollIntoView());
    this.view.focus();
    this.close();
  }

  render() {
    const filterLower = this.filter.toLowerCase();
    this.el.innerHTML = '';
    this.items = [];

    for (const [category, types] of Object.entries(this.categories)) {
      const matchingTypes = types.filter(t =>
        t.toLowerCase().includes(filterLower) ||
        category.toLowerCase().includes(filterLower)
      );

      if (matchingTypes.length === 0) continue;

      const catEl = document.createElement('div');
      catEl.className = 'palette-category';
      catEl.textContent = category;
      this.el.appendChild(catEl);

      for (const type of matchingTypes) {
        const item = document.createElement('div');
        item.className = 'palette-item';
        if (this.items.length === this.selected) {
          item.classList.add('selected');
        }
        item.innerHTML = `
          <span class="palette-icon">${BLOCK_ICONS[type] || '\u25a1'}</span>
          <span class="palette-label">${type.replace(/_/g, ' ')}</span>
        `;
        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          this.insertBlock(type);
        });
        item.addEventListener('mouseenter', () => {
          this.selected = this.items.indexOf(this.items.find(i => i.type === type));
          this.highlightSelected();
        });
        this.el.appendChild(item);
        this.items.push({ type, el: item });
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
      this.items[i].el.classList.toggle('selected', i === this.selected);
    }
  }
}

// Singleton palette
let paletteInstance = null;

export function getBlockPalette() {
  if (!paletteInstance) paletteInstance = new BlockPalette();
  return paletteInstance;
}
