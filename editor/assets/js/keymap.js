/**
 * Keyboard shortcuts for the Vanilla Press editor.
 * @module editor/keymap
 */

import { keymap } from 'prosemirror-keymap';
import { baseKeymap, toggleMark, setBlockType, wrapIn, chainCommands,
  exitCode, joinUp, joinDown, lift, selectParentNode } from 'prosemirror-commands';
import { undo, redo } from 'prosemirror-history';
import { undoInputRule } from 'prosemirror-inputrules';
import { liftListItem, sinkListItem, splitListItem } from 'prosemirror-schema-list';
import { schema } from './schema.js';
import { goToNextCell } from 'prosemirror-tables';

/**
 * Set heading at given level, or toggle back to paragraph if already at that level.
 */
function toggleHeading(level) {
  return (state, dispatch) => {
    const { $from } = state.selection;
    const nodeType = schema.nodes.heading;
    if ($from.parent.type === nodeType && $from.parent.attrs.level === level) {
      return setBlockType(schema.nodes.paragraph)(state, dispatch);
    }
    return setBlockType(nodeType, { level })(state, dispatch);
  };
}

/**
 * Insert a horizontal rule.
 */
function insertHr(state, dispatch) {
  if (dispatch) {
    const { $from } = state.selection;
    const hrNode = schema.nodes.hr.create();
    const tr = state.tr.replaceSelectionWith(hrNode);
    dispatch(tr.scrollIntoView());
  }
  return true;
}

/**
 * Handle Enter inside a code block: insert a newline.
 */
function codeBlockNewline(state, dispatch) {
  const { $from } = state.selection;
  if ($from.parent.type !== schema.nodes.code_block) return false;
  if (dispatch) {
    dispatch(state.tr.replaceSelectionWith(schema.text('\n')).scrollIntoView());
  }
  return true;
}

/**
 * Handle Tab inside a code block: insert two spaces.
 */
function codeBlockTab(state, dispatch) {
  const { $from } = state.selection;
  if ($from.parent.type !== schema.nodes.code_block) return false;
  if (dispatch) {
    dispatch(state.tr.insertText('  ').scrollIntoView());
  }
  return true;
}

const keys = {
  'Mod-z': undo,
  'Mod-y': redo,
  'Mod-Shift-z': redo,

  // Marks
  'Mod-b': toggleMark(schema.marks.strong),
  'Mod-i': toggleMark(schema.marks.em),
  'Mod-e': toggleMark(schema.marks.code),
  'Mod-Shift-x': toggleMark(schema.marks.strikethrough),

  // Headings
  'Mod-Alt-2': toggleHeading(2),
  'Mod-Alt-3': toggleHeading(3),
  'Mod-Alt-4': toggleHeading(4),
  'Mod-Alt-5': toggleHeading(5),
  'Mod-Alt-6': toggleHeading(6),

  // Block types
  'Mod-Shift-b': wrapIn(schema.nodes.blockquote),

  // Horizontal rule
  'Mod-Shift-h': insertHr,

  // Lists
  'Tab': chainCommands(codeBlockTab, goToNextCell(1), sinkListItem(schema.nodes.list_item)),
  'Shift-Tab': chainCommands(goToNextCell(-1), liftListItem(schema.nodes.list_item)),
  'Enter': chainCommands(codeBlockNewline, splitListItem(schema.nodes.list_item)),
  'Backspace': chainCommands(undoInputRule, baseKeymap.Backspace),

  // Structure
  'Mod-[': lift,
  'Alt-ArrowUp': joinUp,
  'Alt-ArrowDown': joinDown,
  'Escape': selectParentNode,

  // Exit code block
  'Mod-Enter': exitCode,
};

export function buildKeymap() {
  return keymap(keys);
}

export function buildBaseKeymap() {
  return keymap(baseKeymap);
}
