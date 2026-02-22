/**
 * Markdown-style input rules for the editor.
 *
 * - ``` → code block (with optional language: ```js)
 * - ## → heading 2, ### → heading 3, etc.
 * - > → blockquote
 * - - or * → bullet list
 * - 1. → ordered list
 * - --- or *** → horizontal rule
 *
 * @module editor/input-rules
 */

import { inputRules, wrappingInputRule, textblockTypeInputRule,
  InputRule } from 'prosemirror-inputrules';
import { schema } from './schema.js';

/**
 * Code block: ``` optionally followed by language → code_block
 */
function codeBlockRule() {
  return new InputRule(
    /^```(\w+)?\s$/,
    (state, match, start, end) => {
      const language = match[1] || 'text';
      const nodeType = schema.nodes.code_block;
      const tr = state.tr.delete(start, end);
      const $pos = tr.doc.resolve(tr.mapping.map(start));
      if (!$pos.parent.canReplaceWith($pos.index(), $pos.index(), nodeType)) return null;
      return tr.setBlockType(tr.mapping.map(start), tr.mapping.map(start), nodeType, { language });
    }
  );
}

/**
 * Heading: ## → h2, ### → h3, etc.
 */
function headingRules() {
  return [2, 3, 4, 5, 6].map(level =>
    textblockTypeInputRule(
      new RegExp(`^(#{${level}})\\s$`),
      schema.nodes.heading,
      () => ({ level })
    )
  );
}

/**
 * Blockquote: > → blockquote
 */
function blockquoteRule() {
  return wrappingInputRule(/^\s*>\s$/, schema.nodes.blockquote);
}

/**
 * Bullet list: - or * → bullet_list
 */
function bulletListRule() {
  return wrappingInputRule(/^\s*[-*]\s$/, schema.nodes.bullet_list);
}

/**
 * Ordered list: 1. → ordered_list
 */
function orderedListRule() {
  return wrappingInputRule(
    /^\s*(\d+)\.\s$/,
    schema.nodes.ordered_list,
    match => ({ start: +match[1] }),
    (match, node) => node.childCount + node.attrs.start === +match[1]
  );
}

/**
 * Horizontal rule: --- or *** or ___ → hr
 */
function hrRule() {
  return new InputRule(
    /^(?:---|___|\*\*\*)\s$/,
    (state, match, start, end) => {
      const hr = schema.nodes.hr.create();
      const tr = state.tr.delete(start, end).replaceSelectionWith(hr);
      return tr;
    }
  );
}

export function buildInputRules() {
  return inputRules({
    rules: [
      codeBlockRule(),
      ...headingRules(),
      blockquoteRule(),
      bulletListRule(),
      orderedListRule(),
      hrRule(),
    ],
  });
}
