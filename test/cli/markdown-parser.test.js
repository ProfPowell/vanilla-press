/**
 * Markdown parser unit tests.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown, parseInline } from '../../src/cli/markdown-parser.js';

/** Build markdown from lines */
const md = (...lines) => lines.join('\n');

// --- Frontmatter ---

describe('parseMarkdown — frontmatter', () => {
  it('parses simple key-value pairs', () => {
    const doc = parseMarkdown(md(
      '---', 'title: My Post', 'slug: my-post',
      'collection: posts', 'status: draft', '---', '', 'Hello world.', '',
    ));
    assert.equal(doc.meta.title, 'My Post');
    assert.equal(doc.meta.slug, 'my-post');
    assert.equal(doc.meta.collection, 'posts');
    assert.equal(doc.meta.status, 'draft');
  });

  it('parses array values', () => {
    const doc = parseMarkdown(md(
      '---', 'title: Tagged Post', 'slug: tagged',
      'collection: posts', 'tags: [css, tutorial, testing]',
      '---', '', 'Content.',
    ));
    assert.deepEqual(doc.meta.tags, ['css', 'tutorial', 'testing']);
  });

  it('parses quoted values', () => {
    const doc = parseMarkdown(md(
      '---', 'title: "Quoted Title"', 'slug: quoted',
      'collection: posts', '---', '', 'Content.',
    ));
    assert.equal(doc.meta.title, 'Quoted Title');
  });

  it('handles no frontmatter', () => {
    const doc = parseMarkdown('Just a paragraph.');
    assert.equal(doc.meta.title, '');
    assert.equal(doc.meta.slug, '');
    assert.equal(doc.blocks.length, 1);
    assert.equal(doc.blocks[0].type, 'paragraph');
  });

  it('sets default status to draft', () => {
    const doc = parseMarkdown(md(
      '---', 'title: No Status', 'slug: no-status',
      'collection: posts', '---', '', 'Content.',
    ));
    assert.equal(doc.meta.status, 'draft');
  });

  it('preserves date field as created', () => {
    const doc = parseMarkdown(md(
      '---', 'title: Dated', 'slug: dated',
      'collection: posts', 'date: 2026-01-15',
      '---', '', 'Content.',
    ));
    assert.equal(doc.meta.created, '2026-01-15');
  });

  it('preserves description', () => {
    const doc = parseMarkdown(md(
      '---', 'title: Described', 'slug: described',
      'collection: posts', 'description: A longer description here',
      '---', '', 'Content.',
    ));
    assert.equal(doc.meta.description, 'A longer description here');
  });
});

// --- Block parsing ---

describe('parseMarkdown — blocks', () => {
  it('parses paragraphs', () => {
    const doc = parseMarkdown(md(
      '---', 'title: Test', 'slug: test', 'collection: posts', '---',
      '', 'First paragraph.', '', 'Second paragraph.',
    ));
    assert.equal(doc.blocks.length, 2);
    assert.equal(doc.blocks[0].type, 'paragraph');
    assert.equal(doc.blocks[0].children[0].value, 'First paragraph.');
    assert.equal(doc.blocks[1].type, 'paragraph');
    assert.equal(doc.blocks[1].children[0].value, 'Second paragraph.');
  });

  it('parses headings', () => {
    const doc = parseMarkdown('## Level Two\n\n### Level Three\n\n#### Level Four');
    assert.equal(doc.blocks.length, 3);
    assert.equal(doc.blocks[0].type, 'heading');
    assert.equal(doc.blocks[0].attrs.level, 2);
    assert.equal(doc.blocks[0].children[0].value, 'Level Two');
    assert.equal(doc.blocks[1].attrs.level, 3);
    assert.equal(doc.blocks[2].attrs.level, 4);
  });

  it('clamps h1 to level 2', () => {
    const doc = parseMarkdown('# Top Level');
    assert.equal(doc.blocks[0].type, 'heading');
    assert.equal(doc.blocks[0].attrs.level, 2);
    assert.equal(doc.blocks[0].children[0].value, 'Top Level');
  });

  it('parses fenced code blocks', () => {
    const fence = '`'.repeat(3);
    const doc = parseMarkdown(fence + 'js\nconst x = 1;\nconsole.log(x);\n' + fence);
    assert.equal(doc.blocks.length, 1);
    assert.equal(doc.blocks[0].type, 'code_block');
    assert.equal(doc.blocks[0].attrs.language, 'js');
    assert.equal(doc.blocks[0].value, 'const x = 1;\nconsole.log(x);');
  });

  it('parses code blocks with filename', () => {
    const fence = '`'.repeat(3);
    const doc = parseMarkdown(fence + 'css styles.css\n.foo { color: red; }\n' + fence);
    assert.equal(doc.blocks[0].type, 'code_block');
    assert.equal(doc.blocks[0].attrs.language, 'css');
    assert.equal(doc.blocks[0].attrs.filename, 'styles.css');
  });

  it('parses code blocks without language', () => {
    const fence = '`'.repeat(3);
    const doc = parseMarkdown(fence + '\nplain text\n' + fence);
    assert.equal(doc.blocks[0].attrs.language, 'text');
    assert.equal(doc.blocks[0].value, 'plain text');
  });

  it('parses unordered lists', () => {
    const doc = parseMarkdown('- Item one\n- Item two\n- Item three');
    assert.equal(doc.blocks.length, 1);
    assert.equal(doc.blocks[0].type, 'list');
    assert.equal(doc.blocks[0].attrs.ordered, false);
    assert.equal(doc.blocks[0].children.length, 3);
    assert.equal(doc.blocks[0].children[0].type, 'list_item');
    assert.equal(doc.blocks[0].children[0].children[0].children[0].value, 'Item one');
  });

  it('parses ordered lists', () => {
    const doc = parseMarkdown('1. First\n2. Second\n3. Third');
    assert.equal(doc.blocks.length, 1);
    assert.equal(doc.blocks[0].type, 'list');
    assert.equal(doc.blocks[0].attrs.ordered, true);
    assert.equal(doc.blocks[0].children.length, 3);
  });

  it('parses blockquotes', () => {
    const doc = parseMarkdown('> This is a quote.\n> With two lines.');
    assert.equal(doc.blocks.length, 1);
    assert.equal(doc.blocks[0].type, 'blockquote');
    assert.equal(doc.blocks[0].children.length, 1);
    assert.equal(doc.blocks[0].children[0].type, 'paragraph');
  });

  it('parses horizontal rules', () => {
    const doc = parseMarkdown('Some text.\n\n---\n\nMore text.');
    assert.equal(doc.blocks.length, 3);
    assert.equal(doc.blocks[0].type, 'paragraph');
    assert.equal(doc.blocks[1].type, 'hr');
    assert.equal(doc.blocks[2].type, 'paragraph');
  });

  it('parses figures (images)', () => {
    const doc = parseMarkdown('![Alt text](https://example.com/img.png)');
    assert.equal(doc.blocks.length, 1);
    assert.equal(doc.blocks[0].type, 'figure');
    assert.equal(doc.blocks[0].attrs.src, 'https://example.com/img.png');
    assert.equal(doc.blocks[0].attrs.alt, 'Alt text');
  });

  it('parses figures with captions', () => {
    const doc = parseMarkdown('![Alt](img.png)\n*Caption text*');
    assert.equal(doc.blocks[0].type, 'figure');
    assert.equal(doc.blocks[0].children.length, 1);
    assert.equal(doc.blocks[0].children[0].type, 'figcaption');
    assert.equal(doc.blocks[0].children[0].children[0].value, 'Caption text');
  });

  it('handles mixed block types', () => {
    const fence = '`'.repeat(3);
    const input = [
      '## Heading', '', 'A paragraph.', '', '- List item', '',
      '> Quote', '', '---', '', fence + 'js', 'code()', fence,
    ].join('\n');
    const doc = parseMarkdown(input);
    const types = doc.blocks.map(b => b.type);
    assert.deepEqual(types, ['heading', 'paragraph', 'list', 'blockquote', 'hr', 'code_block']);
  });

  it('handles empty input', () => {
    const doc = parseMarkdown('');
    assert.equal(doc.blocks.length, 0);
  });

  it('handles multi-line paragraphs', () => {
    const doc = parseMarkdown('Line one\nline two\nline three.');
    assert.equal(doc.blocks.length, 1);
    assert.equal(doc.blocks[0].type, 'paragraph');
    assert.equal(doc.blocks[0].children[0].value, 'Line one line two line three.');
  });
});

// --- Inline parsing ---

describe('parseInline', () => {
  it('parses plain text', () => {
    const nodes = parseInline('Hello world');
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].type, 'text');
    assert.equal(nodes[0].value, 'Hello world');
  });

  it('parses bold text', () => {
    const nodes = parseInline('Some **bold** text');
    assert.equal(nodes.length, 3);
    assert.equal(nodes[0].value, 'Some ');
    assert.equal(nodes[1].value, 'bold');
    assert.deepEqual(nodes[1].marks, ['strong']);
    assert.equal(nodes[2].value, ' text');
  });

  it('parses italic text', () => {
    const nodes = parseInline('Some *italic* text');
    assert.equal(nodes.length, 3);
    assert.equal(nodes[1].value, 'italic');
    assert.deepEqual(nodes[1].marks, ['em']);
  });

  it('parses inline code', () => {
    const nodes = parseInline('Use `console.log` here');
    assert.equal(nodes.length, 3);
    assert.equal(nodes[1].value, 'console.log');
    assert.deepEqual(nodes[1].marks, ['code']);
  });

  it('parses strikethrough', () => {
    const nodes = parseInline('This is ~~deleted~~ text');
    assert.equal(nodes.length, 3);
    assert.equal(nodes[1].value, 'deleted');
    assert.deepEqual(nodes[1].marks, ['strikethrough']);
  });

  it('parses links', () => {
    const nodes = parseInline('Click [here](https://example.com) now');
    assert.equal(nodes.length, 3);
    assert.equal(nodes[0].value, 'Click ');
    assert.equal(nodes[1].type, 'link');
    assert.equal(nodes[1].attrs.href, 'https://example.com');
    assert.equal(nodes[1].children[0].value, 'here');
    assert.equal(nodes[2].value, ' now');
  });

  it('parses links with titles', () => {
    const nodes = parseInline('[Example](https://example.com "A title")');
    assert.equal(nodes[0].type, 'link');
    assert.equal(nodes[0].attrs.href, 'https://example.com');
    assert.equal(nodes[0].attrs.title, 'A title');
  });

  it('parses footnote references', () => {
    const nodes = parseInline('See this[^note1] reference');
    assert.equal(nodes.length, 3);
    assert.equal(nodes[1].type, 'footnote_ref');
    assert.equal(nodes[1].attrs.id, 'note1');
  });

  it('parses multiple inline styles', () => {
    const nodes = parseInline('**bold** and *italic* and `code`');
    assert.ok(nodes.length >= 5);
    assert.deepEqual(nodes[0].marks, ['strong']);
    assert.equal(nodes[0].value, 'bold');
  });

  it('handles empty string', () => {
    const nodes = parseInline('');
    assert.equal(nodes.length, 0);
  });
});

// --- Full round-trip ---

describe('parseMarkdown — full document', () => {
  it('produces valid document structure', () => {
    const fence = '`'.repeat(3);
    const input = [
      '---', 'title: Full Test', 'slug: full-test',
      'collection: posts', 'status: published',
      'description: A complete test document',
      'tags: [test, parser]', 'published: 2026-02-14', '---',
      '', '## Introduction', '',
      'This is a **test** document with *various* elements.',
      '', '### Code', '',
      fence + 'js', 'function hello() {', "  return 'world';", '}', fence,
      '', '- Item one', '- Item two', '',
      '> A quote.', '', '---', '',
      '![Screenshot](screenshot.png)', '*A caption*', '',
      'Final paragraph with a [link](https://example.com).',
    ].join('\n');
    const doc = parseMarkdown(input);

    assert.equal(doc.meta.title, 'Full Test');
    assert.equal(doc.meta.slug, 'full-test');
    assert.equal(doc.meta.collection, 'posts');
    assert.equal(doc.meta.status, 'published');
    assert.equal(doc.meta.description, 'A complete test document');
    assert.deepEqual(doc.meta.tags, ['test', 'parser']);
    assert.equal(doc.meta.published, '2026-02-14');

    const types = doc.blocks.map(b => b.type);
    assert.deepEqual(types, [
      'heading', 'paragraph', 'heading', 'code_block',
      'list', 'blockquote', 'hr', 'figure', 'paragraph',
    ]);

    // Verify inline parsing in paragraph
    const introPara = doc.blocks[1];
    assert.ok(introPara.children.some(n => n.marks?.includes('strong')));
    assert.ok(introPara.children.some(n => n.marks?.includes('em')));

    // Verify code block
    assert.equal(doc.blocks[3].attrs.language, 'js');
    assert.ok(doc.blocks[3].value.includes('function hello'));

    // Verify figure
    assert.equal(doc.blocks[7].attrs.src, 'screenshot.png');
    assert.equal(doc.blocks[7].children[0].type, 'figcaption');
  });
});
