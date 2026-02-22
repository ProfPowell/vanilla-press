/**
 * Formatting toolbar for the editor.
 * Reads PM editor state and dispatches commands.
 *
 * @module editor/menu
 */

import { toggleMark, setBlockType, wrapIn, lift } from 'prosemirror-commands';
import { wrapInList } from 'prosemirror-schema-list';
import { schema } from './schema.js';

/**
 * @typedef {Object} ToolbarItem
 * @property {string} label
 * @property {string} [title]
 * @property {string} type - 'button' | 'separator' | 'select' | 'spacer'
 * @property {Function} [command]
 * @property {Function} [active] - (state) => boolean
 * @property {Function} [enabled] - (state) => boolean
 */

function markActive(state, markType) {
  const { from, $from, to, empty } = state.selection;
  if (empty) return !!markType.isInSet(state.storedMarks || $from.marks());
  return state.doc.rangeHasMark(from, to, markType);
}

function blockTypeActive(state, nodeType, attrs) {
  const { $from } = state.selection;
  const node = $from.parent;
  if (attrs) {
    return node.type === nodeType && Object.entries(attrs).every(([k, v]) => node.attrs[k] === v);
  }
  return node.type === nodeType;
}

function canWrap(state, nodeType) {
  const { $from, $to } = state.selection;
  const range = $from.blockRange($to);
  return range && wrapIn(nodeType)(state);
}

function toggleHeading(level) {
  return (state, dispatch) => {
    const { $from } = state.selection;
    if ($from.parent.type === schema.nodes.heading && $from.parent.attrs.level === level) {
      return setBlockType(schema.nodes.paragraph)(state, dispatch);
    }
    return setBlockType(schema.nodes.heading, { level })(state, dispatch);
  };
}

function insertHr(state, dispatch) {
  if (dispatch) {
    dispatch(state.tr.replaceSelectionWith(schema.nodes.hr.create()).scrollIntoView());
  }
  return true;
}

/** Build toolbar items config */
export function buildToolbarItems() {
  return [
    {
      label: 'B', title: 'Bold (Mod+B)', type: 'button',
      command: toggleMark(schema.marks.strong),
      active: (state) => markActive(state, schema.marks.strong),
    },
    {
      label: 'I', title: 'Italic (Mod+I)', type: 'button',
      command: toggleMark(schema.marks.em),
      active: (state) => markActive(state, schema.marks.em),
      style: 'font-style: italic',
    },
    {
      label: '<>', title: 'Code (Mod+E)', type: 'button',
      command: toggleMark(schema.marks.code),
      active: (state) => markActive(state, schema.marks.code),
      style: 'font-family: var(--font-mono); font-size: 0.8em',
    },
    {
      label: 'S', title: 'Strikethrough (Mod+Shift+X)', type: 'button',
      command: toggleMark(schema.marks.strikethrough),
      active: (state) => markActive(state, schema.marks.strikethrough),
      style: 'text-decoration: line-through',
    },
    { type: 'separator' },
    {
      label: 'H2', title: 'Heading 2 (Mod+Alt+2)', type: 'button',
      command: toggleHeading(2),
      active: (state) => blockTypeActive(state, schema.nodes.heading, { level: 2 }),
    },
    {
      label: 'H3', title: 'Heading 3 (Mod+Alt+3)', type: 'button',
      command: toggleHeading(3),
      active: (state) => blockTypeActive(state, schema.nodes.heading, { level: 3 }),
    },
    {
      label: 'H4', title: 'Heading 4 (Mod+Alt+4)', type: 'button',
      command: toggleHeading(4),
      active: (state) => blockTypeActive(state, schema.nodes.heading, { level: 4 }),
    },
    { type: 'separator' },
    {
      label: '\u2022', title: 'Bullet List', type: 'button',
      command: wrapInList(schema.nodes.bullet_list),
      active: (state) => {
        const { $from } = state.selection;
        for (let d = $from.depth; d > 0; d--) {
          if ($from.node(d).type === schema.nodes.bullet_list) return true;
        }
        return false;
      },
    },
    {
      label: '1.', title: 'Ordered List', type: 'button',
      command: wrapInList(schema.nodes.ordered_list),
      active: (state) => {
        const { $from } = state.selection;
        for (let d = $from.depth; d > 0; d--) {
          if ($from.node(d).type === schema.nodes.ordered_list) return true;
        }
        return false;
      },
    },
    {
      label: '\u201C', title: 'Blockquote (Mod+Shift+B)', type: 'button',
      command: wrapIn(schema.nodes.blockquote),
    },
    {
      label: '\u2014', title: 'Horizontal Rule (Mod+Shift+H)', type: 'button',
      command: insertHr,
    },
    { type: 'separator' },
    {
      label: '\u21a5', title: 'Lift out of enclosing block (Mod+[)', type: 'button',
      command: lift,
    },
  ];
}

/**
 * Create and manage the formatting toolbar DOM.
 */
export class EditorToolbar {
  constructor(container, editorView) {
    this.container = container;
    this.view = editorView;
    this.items = buildToolbarItems();
    this.buttons = [];
    this.linkButton = null;
    this.render();
  }

  render() {
    this.container.innerHTML = '';
    for (const item of this.items) {
      if (item.type === 'separator') {
        const sep = document.createElement('div');
        sep.className = 'separator';
        this.container.appendChild(sep);
        continue;
      }

      if (item.type === 'spacer') {
        const spacer = document.createElement('div');
        spacer.className = 'spacer';
        this.container.appendChild(spacer);
        continue;
      }

      const btn = document.createElement('button');
      btn.textContent = item.label;
      btn.title = item.title || '';
      if (item.style) btn.setAttribute('style', item.style);
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        item.command(this.view.state, this.view.dispatch, this.view);
        this.view.focus();
      });
      this.container.appendChild(btn);
      this.buttons.push({ btn, item });
    }

    // Link button (special: prompts for URL)
    const sep = document.createElement('div');
    sep.className = 'separator';
    this.container.appendChild(sep);

    const linkBtn = document.createElement('button');
    linkBtn.textContent = '\ud83d\udd17';
    linkBtn.title = 'Link (Mod+K)';
    linkBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this.toggleLink();
    });
    this.container.appendChild(linkBtn);
    this.linkButton = linkBtn;
  }

  toggleLink() {
    const { state, dispatch } = this.view;
    const { link: linkMark } = schema.marks;

    if (markActive(state, linkMark)) {
      toggleMark(linkMark)(state, dispatch);
      this.view.focus();
      return;
    }

    const href = prompt('Enter URL:');
    if (!href) return;

    const title = null;
    toggleMark(linkMark, { href, title })(state, dispatch);
    this.view.focus();
  }

  update(state) {
    for (const { btn, item } of this.buttons) {
      if (item.active) {
        btn.classList.toggle('active', item.active(state));
      }
      if (item.enabled) {
        btn.disabled = !item.enabled(state);
      }
    }
    // Link button active state
    if (this.linkButton) {
      this.linkButton.classList.toggle('active', markActive(state, schema.marks.link));
    }
  }
}
