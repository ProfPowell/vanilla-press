import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { render } from '../../src/renderers/markdown.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));

describe('markdown renderer', () => {

  describe('fixtures render without throwing', () => {
    const fixtures = ['minimal.json', 'simple-post.json', 'component-rich.json', 'inline-marks.json', 'edge-cases.json',
      'ks-prose.json', 'ks-tables.json', 'ks-definitions.json', 'ks-components.json', 'ks-media.json', 'ks-code.json', 'ks-nesting.json'];

    for (const name of fixtures) {
      it(`renders ${name}`, () => {
        const doc = fixture(name);
        const md = render(doc);
        assert.ok(typeof md === 'string');
        assert.ok(md.length > 0);
      });
    }
  });

  describe('frontmatter', () => {
    it('starts with YAML frontmatter', () => {
      const doc = fixture('minimal.json');
      const md = render(doc);
      assert.ok(md.startsWith('---\n'));
      const secondFence = md.indexOf('---', 4);
      assert.ok(secondFence > 0, 'Missing closing ---');
    });

    it('includes required meta fields', () => {
      const doc = fixture('simple-post.json');
      const md = render(doc);
      assert.ok(md.includes('title:'));
      assert.ok(md.includes('slug:'));
      assert.ok(md.includes('collection:'));
      assert.ok(md.includes('status:'));
    });

    it('includes tags', () => {
      const doc = fixture('simple-post.json');
      const md = render(doc);
      assert.ok(md.includes('tags:'));
      assert.ok(md.includes('  - css'));
      assert.ok(md.includes('  - tutorial'));
    });
  });

  describe('headings', () => {
    it('uses # syntax', () => {
      const doc = fixture('simple-post.json');
      const md = render(doc);
      assert.ok(md.includes('## Declaring Layers'));
    });

    it('uses correct heading levels', () => {
      const doc = fixture('edge-cases.json');
      const md = render(doc);
      assert.ok(md.includes('## Heading Level 2'));
      assert.ok(md.includes('### Heading Level 3'));
      assert.ok(md.includes('#### Heading Level 4'));
      assert.ok(md.includes('##### Heading Level 5'));
      assert.ok(md.includes('###### Heading Level 6'));
    });
  });

  describe('code blocks', () => {
    it('uses fenced syntax', () => {
      const doc = fixture('simple-post.json');
      const md = render(doc);
      assert.ok(md.includes('```css'));
      assert.ok(md.includes('```'));
    });

    it('includes filename in fence', () => {
      const doc = fixture('simple-post.json');
      const md = render(doc);
      assert.ok(md.includes('```css main.css'));
    });
  });

  describe('callouts', () => {
    it('degrades to blockquote with bold label', () => {
      const doc = fixture('component-rich.json');
      const md = render(doc);
      assert.ok(md.includes('> **Tip:**'));
      assert.ok(md.includes('> **Warning:**'));
    });
  });

  describe('tabs', () => {
    it('degrades to sequential sections', () => {
      const doc = fixture('component-rich.json');
      const md = render(doc);
      assert.ok(md.includes('### Block AST'));
      assert.ok(md.includes('### Vanilla Breeze HTML'));
      assert.ok(md.includes('### Markdown'));
    });
  });

  describe('steps', () => {
    it('degrades to numbered list', () => {
      const doc = fixture('component-rich.json');
      const md = render(doc);
      assert.ok(md.includes('1. **Author the block AST**'));
      assert.ok(md.includes('2. **Render to HTML with Vanilla Breeze tags**'));
      assert.ok(md.includes('3. **Browser upgrades the elements**'));
    });
  });

  describe('links', () => {
    it('uses [text](url) syntax', () => {
      const doc = fixture('simple-post.json');
      const md = render(doc);
      assert.ok(md.includes('[CSS authoring guide](/docs/css-author)'));
    });

    it('includes title when present', () => {
      const doc = fixture('inline-marks.json');
      const md = render(doc);
      assert.ok(md.includes('[this site](https://example.com "Example Site")'));
    });
  });

  describe('marks', () => {
    it('renders strong as **', () => {
      const doc = fixture('simple-post.json');
      const md = render(doc);
      assert.ok(md.includes('**explicit control**'));
    });

    it('renders em as *', () => {
      const doc = fixture('inline-marks.json');
      const md = render(doc);
      assert.ok(md.includes('*italic text*'));
    });

    it('renders code as backticks', () => {
      const doc = fixture('simple-post.json');
      const md = render(doc);
      assert.ok(md.includes('`main.css`'));
    });

    it('renders strikethrough as ~~', () => {
      const doc = fixture('inline-marks.json');
      const md = render(doc);
      assert.ok(md.includes('~~struck through~~'));
    });
  });

  describe('other blocks', () => {
    it('renders figures as ![alt](src)', () => {
      const doc = fixture('simple-post.json');
      const md = render(doc);
      assert.ok(md.includes('![Diagram showing CSS layer priority'));
    });

    it('renders lists', () => {
      const doc = fixture('simple-post.json');
      const md = render(doc);
      assert.ok(md.includes('- Resets never'));
    });

    it('renders hr as ---', () => {
      const doc = fixture('edge-cases.json');
      const md = render(doc);
      assert.ok(md.includes('---'));
    });

    it('renders blockquotes with > prefix', () => {
      const doc = fixture('edge-cases.json');
      const md = render(doc);
      // nested blockquotes
      assert.ok(md.includes('> > '));
    });

    it('renders collapsible as bold summary + content', () => {
      const doc = fixture('component-rich.json');
      const md = render(doc);
      assert.ok(md.includes('**Why a typed block AST instead of HTML strings?**'));
    });

    it('renders card with link title', () => {
      const doc = fixture('component-rich.json');
      const md = render(doc);
      assert.ok(md.includes('### [Getting Started Guide](/guides/getting-started/)'));
    });

    it('renders footnote refs', () => {
      const doc = fixture('inline-marks.json');
      const md = render(doc);
      assert.ok(md.includes('[^1]'));
      assert.ok(md.includes('[^2]'));
    });

    it('renders embeds', () => {
      const doc = fixture('edge-cases.json');
      const md = render(doc);
      assert.ok(md.includes('[codepen:'));
      assert.ok(md.includes('codepen.io'));
    });
  });

  describe('tables', () => {
    it('renders GFM table syntax', () => {
      const doc = {
        meta: { title: 't', slug: 's', collection: 'c', status: 'draft' },
        blocks: [{
          type: 'table',
          children: [{
            type: 'table_row',
            children: [
              { type: 'table_header', children: [{ type: 'text', value: 'Name' }] },
              { type: 'table_header', children: [{ type: 'text', value: 'Value' }] },
            ],
          }, {
            type: 'table_row',
            children: [
              { type: 'table_cell', children: [{ type: 'text', value: 'A' }] },
              { type: 'table_cell', children: [{ type: 'text', value: '1' }] },
            ],
          }],
        }],
      };
      const md = render(doc);
      assert.ok(md.includes('| Name | Value |'));
      assert.ok(md.includes('| --- | --- |'));
      assert.ok(md.includes('| A | 1 |'));
    });

    it('renders alignment in separator row', () => {
      const doc = {
        meta: { title: 't', slug: 's', collection: 'c', status: 'draft' },
        blocks: [{
          type: 'table',
          children: [{
            type: 'table_row',
            children: [
              { type: 'table_header', attrs: { align: 'left' }, children: [{ type: 'text', value: 'Left' }] },
              { type: 'table_header', attrs: { align: 'center' }, children: [{ type: 'text', value: 'Center' }] },
              { type: 'table_header', attrs: { align: 'right' }, children: [{ type: 'text', value: 'Right' }] },
            ],
          }],
        }],
      };
      const md = render(doc);
      assert.ok(md.includes('| --- | :---: | ---: |'));
    });
  });

  describe('definition lists', () => {
    it('renders term and definition', () => {
      const doc = {
        meta: { title: 't', slug: 's', collection: 'c', status: 'draft' },
        blocks: [{
          type: 'definition_list',
          children: [
            { type: 'definition_term', children: [{ type: 'text', value: 'HTML' }] },
            { type: 'definition_desc', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Markup language' }] }] },
          ],
        }],
      };
      const md = render(doc);
      assert.ok(md.includes('**HTML**'));
      assert.ok(md.includes(': Markup language'));
    });
  });

  describe('hr variants', () => {
    it('renders decorative hr as * * *', () => {
      const doc = {
        meta: { title: 't', slug: 's', collection: 'c', status: 'draft' },
        blocks: [{ type: 'hr', attrs: { variant: 'decorative' } }],
      };
      const md = render(doc);
      assert.ok(md.includes('* * *'));
    });
  });

  describe('new marks', () => {
    it('renders mark as ==text==', () => {
      const doc = {
        meta: { title: 't', slug: 's', collection: 'c', status: 'draft' },
        blocks: [{ type: 'paragraph', children: [{ type: 'text', value: 'highlighted', marks: ['mark'] }] }],
      };
      const md = render(doc);
      assert.ok(md.includes('==highlighted=='));
    });

    it('renders kbd as <kbd>', () => {
      const doc = {
        meta: { title: 't', slug: 's', collection: 'c', status: 'draft' },
        blocks: [{ type: 'paragraph', children: [{ type: 'text', value: 'Ctrl', marks: ['kbd'] }] }],
      };
      const md = render(doc);
      assert.ok(md.includes('<kbd>Ctrl</kbd>'));
    });

    it('renders sub as <sub>', () => {
      const doc = {
        meta: { title: 't', slug: 's', collection: 'c', status: 'draft' },
        blocks: [{ type: 'paragraph', children: [{ type: 'text', value: '2', marks: ['sub'] }] }],
      };
      const md = render(doc);
      assert.ok(md.includes('<sub>2</sub>'));
    });

    it('renders sup as <sup>', () => {
      const doc = {
        meta: { title: 't', slug: 's', collection: 'c', status: 'draft' },
        blocks: [{ type: 'paragraph', children: [{ type: 'text', value: '2', marks: ['sup'] }] }],
      };
      const md = render(doc);
      assert.ok(md.includes('<sup>2</sup>'));
    });
  });
});
