/**
 * Markdown → block AST parser.
 *
 * Two-pass architecture:
 *   Pass 1: Block parsing (line-by-line state machine)
 *   Pass 2: Inline parsing (character scanner on paragraph/heading text)
 *
 * Deliberately limited: handles standard markdown (headings, paragraphs,
 * code fences, lists, blockquotes, hr, figures, inline marks/links).
 * Does NOT infer component blocks (callout, tabs, steps).
 *
 * @module cli/markdown-parser
 */

/**
 * Parse a markdown string into a Vanilla Press document.
 * @param {string} markdown
 * @returns {{ id: string, meta: Object, blocks: Object[] }}
 */
export function parseMarkdown(markdown) {
  const { meta, body } = extractFrontmatter(markdown);
  const blocks = parseBlocks(body);

  const now = new Date().toISOString();
  return {
    id: meta.id || '',
    meta: {
      title: meta.title || '',
      slug: meta.slug || '',
      collection: meta.collection || '',
      status: meta.status || 'draft',
      description: meta.description || undefined,
      created: meta.created || meta.date || now,
      updated: meta.updated || now,
      published: meta.published || undefined,
      tags: meta.tags || undefined,
    },
    blocks,
  };
}

// --- Frontmatter ---

/**
 * Extract YAML frontmatter from markdown.
 * Supports simple key: value and key: [array] syntax.
 * @param {string} markdown
 * @returns {{ meta: Object, body: string }}
 */
function extractFrontmatter(markdown) {
  const lines = markdown.split('\n');

  if (lines[0]?.trim() !== '---') {
    return { meta: {}, body: markdown };
  }

  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      endIndex = i;
      break;
    }
  }

  if (endIndex === -1) {
    return { meta: {}, body: markdown };
  }

  const meta = {};
  for (let i = 1; i < endIndex; i++) {
    const line = lines[i];
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const key = line.slice(0, colonIndex).trim();
    let value = line.slice(colonIndex + 1).trim();

    if (!key) continue;

    // Array value: [item1, item2]
    if (value.startsWith('[') && value.endsWith(']')) {
      const inner = value.slice(1, -1);
      meta[key] = inner
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .map(s => s.replace(/^['"]|['"]$/g, ''));
    } else {
      // Strip quotes
      value = value.replace(/^['"]|['"]$/g, '');
      meta[key] = value;
    }
  }

  const body = lines.slice(endIndex + 1).join('\n');
  return { meta, body };
}

// --- Block parsing (Pass 1) ---

const HEADING_RE = /^(#{1,6})\s+(.+)$/;
const HR_RE = /^(---+|\*\*\*+|___+)\s*$/;
const FENCE_RE = /^```(\w*)\s*(.*)$/;
const FENCE_CLOSE_RE = /^```\s*$/;
const UL_RE = /^(\s*)[*+-]\s+(.*)$/;
const OL_RE = /^(\s*)\d+[.)]\s+(.*)$/;
const BQ_RE = /^>\s?(.*)$/;
const FIGURE_RE = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/;

/**
 * Parse markdown body into block AST.
 * @param {string} body
 * @returns {Object[]}
 */
function parseBlocks(body) {
  const lines = body.split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Skip empty lines
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Fenced code block
    const fenceMatch = line.match(FENCE_RE);
    if (fenceMatch) {
      const language = fenceMatch[1] || 'text';
      const filename = fenceMatch[2] || undefined;
      const codeLines = [];
      i++;
      while (i < lines.length && !FENCE_CLOSE_RE.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing fence

      const attrs = { language };
      if (filename) attrs.filename = filename;

      blocks.push({
        type: 'code_block',
        attrs,
        value: codeLines.join('\n'),
      });
      continue;
    }

    // Horizontal rule
    if (HR_RE.test(line)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    // Heading
    const headingMatch = line.match(HEADING_RE);
    if (headingMatch) {
      const level = Math.max(2, headingMatch[1].length);
      const text = headingMatch[2];
      blocks.push({
        type: 'heading',
        attrs: { level },
        children: parseInline(text),
      });
      i++;
      continue;
    }

    // Figure (image on its own line)
    const figureMatch = line.match(FIGURE_RE);
    if (figureMatch) {
      const alt = figureMatch[1];
      const src = figureMatch[2];
      const children = [];

      // Check for caption on next line (italic text: *caption*)
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1]?.trim();
        if (nextLine && /^\*([^*]+)\*$/.test(nextLine)) {
          const captionText = nextLine.match(/^\*([^*]+)\*$/)[1];
          children.push({
            type: 'figcaption',
            children: parseInline(captionText),
          });
          i++; // consume caption line
        }
      }

      blocks.push({
        type: 'figure',
        attrs: { src, alt },
        children,
      });
      i++;
      continue;
    }

    // Blockquote
    if (BQ_RE.test(line)) {
      const bqLines = [];
      while (i < lines.length && BQ_RE.test(lines[i])) {
        bqLines.push(lines[i].match(BQ_RE)[1]);
        i++;
      }
      const innerBlocks = parseBlocks(bqLines.join('\n'));
      blocks.push({
        type: 'blockquote',
        children: innerBlocks,
      });
      continue;
    }

    // Unordered list
    const ulMatch = line.match(UL_RE);
    if (ulMatch) {
      const items = parseListItems(lines, i, false);
      blocks.push({
        type: 'list',
        attrs: { ordered: false },
        children: items.children,
      });
      i = items.endIndex;
      continue;
    }

    // Ordered list
    const olMatch = line.match(OL_RE);
    if (olMatch) {
      const items = parseListItems(lines, i, true);
      blocks.push({
        type: 'list',
        attrs: { ordered: true },
        children: items.children,
      });
      i = items.endIndex;
      continue;
    }

    // Paragraph (default)
    const paraLines = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !HEADING_RE.test(lines[i]) &&
      !HR_RE.test(lines[i]) &&
      !FENCE_RE.test(lines[i]) &&
      !BQ_RE.test(lines[i]) &&
      !UL_RE.test(lines[i]) &&
      !OL_RE.test(lines[i]) &&
      !FIGURE_RE.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }

    if (paraLines.length > 0) {
      blocks.push({
        type: 'paragraph',
        children: parseInline(paraLines.join(' ')),
      });
    }
  }

  return blocks;
}

/**
 * Parse consecutive list items.
 * @param {string[]} lines
 * @param {number} startIndex
 * @param {boolean} ordered
 * @returns {{ children: Object[], endIndex: number }}
 */
function parseListItems(lines, startIndex, ordered) {
  const itemRe = ordered ? OL_RE : UL_RE;
  const items = [];
  let i = startIndex;

  while (i < lines.length) {
    const match = lines[i].match(itemRe);
    if (!match) break;

    const indent = match[1].length;
    const text = match[2];

    // Check for nested items
    const nestedLines = [];
    i++;
    while (i < lines.length) {
      const nextLine = lines[i];
      if (nextLine.trim() === '') break;

      const nextUl = nextLine.match(UL_RE);
      const nextOl = nextLine.match(OL_RE);

      if (nextUl && nextUl[1].length > indent) {
        nestedLines.push(nextLine);
        i++;
      } else if (nextOl && nextOl[1].length > indent) {
        nestedLines.push(nextLine);
        i++;
      } else if (!nextUl && !nextOl && nextLine.match(/^\s+/) && nextLine.trim() !== '') {
        // Continuation line
        nestedLines.push(nextLine);
        i++;
      } else {
        break;
      }
    }

    const itemChildren = [{
      type: 'paragraph',
      children: parseInline(text),
    }];

    if (nestedLines.length > 0) {
      const nested = parseBlocks(nestedLines.join('\n'));
      itemChildren.push(...nested);
    }

    items.push({
      type: 'list_item',
      children: itemChildren,
    });
  }

  return { children: items, endIndex: i };
}

// --- Inline parsing (Pass 2) ---

/**
 * Parse inline markdown text into an array of inline nodes.
 * Handles: **strong**, *em*, `code`, ~~strikethrough~~,
 * [text](url "title"), [^id]
 * @param {string} text
 * @returns {Object[]}
 */
export function parseInline(text) {
  const nodes = [];
  let buf = '';
  let i = 0;

  function flush() {
    if (buf) {
      nodes.push({ type: 'text', value: buf });
      buf = '';
    }
  }

  while (i < text.length) {
    // Footnote reference: [^id]
    if (text[i] === '[' && text[i + 1] === '^') {
      const end = text.indexOf(']', i + 2);
      if (end !== -1) {
        const id = text.slice(i + 2, end);
        flush();
        nodes.push({ type: 'footnote_ref', attrs: { id } });
        i = end + 1;
        continue;
      }
    }

    // Link: [text](url) or [text](url "title")
    if (text[i] === '[') {
      const closeBracket = findMatchingBracket(text, i);
      if (closeBracket !== -1 && text[closeBracket + 1] === '(') {
        const closeParen = text.indexOf(')', closeBracket + 2);
        if (closeParen !== -1) {
          const linkText = text.slice(i + 1, closeBracket);
          const linkTarget = text.slice(closeBracket + 2, closeParen);

          flush();

          // Parse optional title
          const titleMatch = linkTarget.match(/^(\S+)\s+"([^"]*)"$/);
          const href = titleMatch ? titleMatch[1] : linkTarget.trim();
          const title = titleMatch ? titleMatch[2] : undefined;

          const linkNode = {
            type: 'link',
            attrs: { href },
            children: parseInline(linkText),
          };
          if (title) linkNode.attrs.title = title;
          nodes.push(linkNode);
          i = closeParen + 1;
          continue;
        }
      }
    }

    // Inline code: `text`
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1);
      if (end !== -1) {
        flush();
        nodes.push({
          type: 'text',
          value: text.slice(i + 1, end),
          marks: ['code'],
        });
        i = end + 1;
        continue;
      }
    }

    // Strikethrough: ~~text~~
    if (text[i] === '~' && text[i + 1] === '~') {
      const end = text.indexOf('~~', i + 2);
      if (end !== -1) {
        flush();
        const inner = text.slice(i + 2, end);
        nodes.push({
          type: 'text',
          value: inner,
          marks: ['strikethrough'],
        });
        i = end + 2;
        continue;
      }
    }

    // Bold: **text**
    if (text[i] === '*' && text[i + 1] === '*') {
      const end = text.indexOf('**', i + 2);
      if (end !== -1) {
        flush();
        const inner = text.slice(i + 2, end);
        // Check for nested italic inside bold
        const innerNodes = parseMarkCombinations(inner, ['strong']);
        nodes.push(...innerNodes);
        i = end + 2;
        continue;
      }
    }

    // Italic: *text*
    if (text[i] === '*' && text[i + 1] !== '*') {
      const end = findSingleStar(text, i + 1);
      if (end !== -1) {
        flush();
        const inner = text.slice(i + 1, end);
        nodes.push({
          type: 'text',
          value: inner,
          marks: ['em'],
        });
        i = end + 1;
        continue;
      }
    }

    // Plain text — accumulate
    buf += text[i];
    i++;
  }

  flush();
  return nodes;
}

/**
 * Parse text that may contain nested marks.
 * @param {string} text
 * @param {string[]} outerMarks
 * @returns {Object[]}
 */
function parseMarkCombinations(text, outerMarks) {
  // Check for italic inside bold: **some *italic* text**
  if (text.includes('*')) {
    const parts = [];
    let pos = 0;
    while (pos < text.length) {
      const starIdx = text.indexOf('*', pos);
      if (starIdx === -1) {
        if (pos < text.length) {
          parts.push({ type: 'text', value: text.slice(pos), marks: [...outerMarks] });
        }
        break;
      }
      if (starIdx > pos) {
        parts.push({ type: 'text', value: text.slice(pos, starIdx), marks: [...outerMarks] });
      }
      const endStar = text.indexOf('*', starIdx + 1);
      if (endStar !== -1) {
        parts.push({
          type: 'text',
          value: text.slice(starIdx + 1, endStar),
          marks: [...outerMarks, 'em'],
        });
        pos = endStar + 1;
      } else {
        parts.push({ type: 'text', value: text.slice(starIdx), marks: [...outerMarks] });
        break;
      }
    }
    return parts;
  }

  return [{ type: 'text', value: text, marks: [...outerMarks] }];
}

/**
 * Find closing single * that is not part of **.
 * @param {string} text
 * @param {number} start
 * @returns {number}
 */
function findSingleStar(text, start) {
  for (let i = start; i < text.length; i++) {
    if (text[i] === '*' && text[i + 1] !== '*' && (i === 0 || text[i - 1] !== '*')) {
      return i;
    }
  }
  return -1;
}

/**
 * Find the matching ] for a [ at the given position.
 * @param {string} text
 * @param {number} openPos
 * @returns {number}
 */
function findMatchingBracket(text, openPos) {
  let depth = 0;
  for (let i = openPos; i < text.length; i++) {
    if (text[i] === '[') depth++;
    if (text[i] === ']') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

