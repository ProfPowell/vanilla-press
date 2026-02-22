import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { render } from '../../src/renderers/html.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));

describe('html renderer', () => {

  describe('fixtures render without throwing', () => {
    const fixtures = ['minimal.json', 'simple-post.json', 'component-rich.json', 'inline-marks.json', 'edge-cases.json',
      'ks-prose.json', 'ks-tables.json', 'ks-definitions.json', 'ks-components.json', 'ks-media.json', 'ks-code.json', 'ks-nesting.json'];

    for (const name of fixtures) {
      it(`renders ${name} at content scope`, () => {
        const doc = fixture(name);
        const html = render(doc);
        assert.ok(typeof html === 'string');
        assert.ok(html.length > 0);
      });
    }
  });

  describe('content scope', () => {
    it('wraps output in <article>', () => {
      const doc = fixture('minimal.json');
      const html = render(doc, { scope: 'content' });
      assert.ok(html.startsWith('<article'));
      assert.ok(html.includes('data-doc="doc_min01"'));
      assert.ok(html.endsWith('</article>'));
    });
  });

  describe('paragraphs', () => {
    it('produces <p> tags', () => {
      const doc = fixture('minimal.json');
      const html = render(doc);
      assert.ok(html.includes('<p>'));
      assert.ok(html.includes('</p>'));
    });
  });

  describe('headings', () => {
    it('produces correct <h{n}> tags', () => {
      const doc = fixture('simple-post.json');
      const html = render(doc);
      assert.ok(html.includes('<h2>'));
      assert.ok(html.includes('</h2>'));
    });

    it('renders all heading levels', () => {
      const doc = fixture('edge-cases.json');
      const html = render(doc);
      for (let n = 2; n <= 6; n++) {
        assert.ok(html.includes(`<h${n}>`), `Missing <h${n}>`);
        assert.ok(html.includes(`</h${n}>`), `Missing </h${n}>`);
      }
    });
  });

  describe('code blocks', () => {
    it('produces <code-block> custom elements', () => {
      const doc = fixture('simple-post.json');
      const html = render(doc);
      assert.ok(html.includes('<code-block'));
      assert.ok(html.includes('data-language="css"'));
      assert.ok(html.includes('data-filename="main.css"'));
      assert.ok(html.includes('<pre><code>'));
    });
  });

  describe('callouts', () => {
    it('produces <ui-callout> with variant', () => {
      const doc = fixture('component-rich.json');
      const html = render(doc);
      assert.ok(html.includes('<ui-callout data-variant="tip">'));
      assert.ok(html.includes('<ui-callout data-variant="warning">'));
    });
  });

  describe('tabs', () => {
    it('produces <ui-tabs> with radio inputs', () => {
      const doc = fixture('component-rich.json');
      const html = render(doc);
      assert.ok(html.includes('<ui-tabs>'));
      assert.ok(html.includes('</ui-tabs>'));
      assert.ok(html.includes('type="radio"'));
      assert.ok(html.includes('class="tab-panel"'));
      assert.ok(html.includes('checked'));
    });
  });

  describe('steps', () => {
    it('produces <ol data-steps>', () => {
      const doc = fixture('component-rich.json');
      const html = render(doc);
      assert.ok(html.includes('<ol data-steps>'));
      assert.ok(html.includes('data-step-title='));
    });
  });

  describe('links', () => {
    it('produces <a> with href', () => {
      const doc = fixture('simple-post.json');
      const html = render(doc);
      assert.ok(html.includes('<a href="/docs/css-author"'));
      assert.ok(html.includes('</a>'));
    });

    it('renders title attribute when present', () => {
      const doc = fixture('inline-marks.json');
      const html = render(doc);
      assert.ok(html.includes('title="Example Site"'));
    });
  });

  describe('marks', () => {
    it('renders strong as <strong>', () => {
      const doc = fixture('simple-post.json');
      const html = render(doc);
      assert.ok(html.includes('<strong>explicit control</strong>'));
    });

    it('renders code as <code>', () => {
      const doc = fixture('simple-post.json');
      const html = render(doc);
      assert.ok(html.includes('<code>main.css</code>'));
    });

    it('renders em as <em>', () => {
      const doc = fixture('inline-marks.json');
      const html = render(doc);
      assert.ok(html.includes('<em>italic text</em>'));
    });

    it('renders strikethrough as <s>', () => {
      const doc = fixture('inline-marks.json');
      const html = render(doc);
      assert.ok(html.includes('<s>struck through</s>'));
    });

    it('renders combined marks', () => {
      const doc = fixture('inline-marks.json');
      const html = render(doc);
      // strong + em nesting
      assert.ok(html.includes('<strong>') && html.includes('<em>'));
    });
  });

  describe('escaping', () => {
    it('escapes special characters in text', () => {
      const doc = fixture('edge-cases.json');
      const html = render(doc);
      assert.ok(html.includes('&lt;script&gt;'));
      assert.ok(!html.includes('<script>alert'));
    });

    it('escapes HTML in code blocks', () => {
      const doc = fixture('edge-cases.json');
      const html = render(doc);
      assert.ok(html.includes('&lt;div class='));
    });
  });

  describe('other blocks', () => {
    it('renders figures', () => {
      const doc = fixture('simple-post.json');
      const html = render(doc);
      assert.ok(html.includes('<figure>'));
      assert.ok(html.includes('<img src='));
      assert.ok(html.includes('<figcaption>'));
    });

    it('renders lists', () => {
      const doc = fixture('simple-post.json');
      const html = render(doc);
      assert.ok(html.includes('<ul>'));
      assert.ok(html.includes('<li>'));
    });

    it('renders blockquotes', () => {
      const doc = fixture('edge-cases.json');
      const html = render(doc);
      assert.ok(html.includes('<blockquote>'));
    });

    it('renders hr', () => {
      const doc = fixture('edge-cases.json');
      const html = render(doc);
      assert.ok(html.includes('<hr/>'));
    });

    it('renders embed', () => {
      const doc = fixture('edge-cases.json');
      const html = render(doc);
      assert.ok(html.includes('data-embed'));
      assert.ok(html.includes('data-url="https://codepen.io/example/pen/abc123"'));
    });

    it('renders collapsible as <details>', () => {
      const doc = fixture('component-rich.json');
      const html = render(doc);
      assert.ok(html.includes('<details>'));
      assert.ok(html.includes('<summary>'));
    });

    it('renders card as <content-card>', () => {
      const doc = fixture('component-rich.json');
      const html = render(doc);
      assert.ok(html.includes('<content-card href='));
    });

    it('renders footnote refs', () => {
      const doc = fixture('inline-marks.json');
      const html = render(doc);
      assert.ok(html.includes('href="#fn-1"'));
      assert.ok(html.includes('id="fnref-1"'));
    });
  });

  describe('page scope', () => {
    it('produces full HTML document', () => {
      const doc = fixture('minimal.json');
      const html = render(doc, { scope: 'page', site: { title: 'Test Site' } });
      assert.ok(html.includes('<!doctype html>'));
      assert.ok(html.includes('<html'));
      assert.ok(html.includes('<head>'));
      assert.ok(html.includes('<title>'));
      assert.ok(html.includes('<body>'));
      assert.ok(html.includes('</html>'));
      assert.ok(html.includes('Test Site'));
    });
  });

  describe('collection scope', () => {
    it('produces card list for array of docs', () => {
      const docs = [fixture('minimal.json'), fixture('simple-post.json')];
      const html = render(docs, { scope: 'collection' });
      assert.ok(html.includes('data-collection'));
      assert.ok(html.includes('<content-card'));
      assert.ok(html.includes('Hello World'));
      assert.ok(html.includes('Getting Started'));
    });
  });

  describe('meta scope', () => {
    it('produces metadata header', () => {
      const doc = fixture('simple-post.json');
      const html = render(doc, { scope: 'meta' });
      assert.ok(html.includes('data-doc-meta'));
      assert.ok(html.includes('<h1>'));
      assert.ok(html.includes('CSS Layers'));
      assert.ok(html.includes('class="tag"'));
      assert.ok(html.includes('<time'));
    });
  });

  describe('block scope', () => {
    it('renders a single block directly', () => {
      const block = { type: 'paragraph', children: [{ type: 'text', value: 'Hello' }] };
      const html = render(block, { scope: 'block' });
      assert.equal(html, '<p>Hello</p>');
    });
  });

  describe('tables', () => {
    it('renders table with header row', () => {
      const block = {
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
      };
      const html = render(block, { scope: 'block' });
      assert.ok(html.includes('<table>'));
      assert.ok(html.includes('<th>Name</th>'));
      assert.ok(html.includes('<td>A</td>'));
      assert.ok(html.includes('</table>'));
    });

    it('renders table with striped/bordered/compact classes', () => {
      const block = {
        type: 'table',
        attrs: { striped: true, bordered: true, compact: true },
        children: [{
          type: 'table_row',
          children: [{ type: 'table_cell', children: [{ type: 'text', value: 'X' }] }],
        }],
      };
      const html = render(block, { scope: 'block' });
      assert.ok(html.includes('class="striped bordered compact"'));
    });

    it('renders table with caption', () => {
      const block = {
        type: 'table',
        attrs: { caption: 'Test Caption' },
        children: [{
          type: 'table_row',
          children: [{ type: 'table_cell', children: [{ type: 'text', value: 'X' }] }],
        }],
      };
      const html = render(block, { scope: 'block' });
      assert.ok(html.includes('<caption>Test Caption</caption>'));
    });

    it('renders alignment and numeric attrs', () => {
      const block = {
        type: 'table',
        children: [{
          type: 'table_row',
          children: [
            { type: 'table_header', attrs: { align: 'center' }, children: [{ type: 'text', value: 'H' }] },
            { type: 'table_cell', attrs: { align: 'right', numeric: true }, children: [{ type: 'text', value: '42' }] },
          ],
        }],
      };
      const html = render(block, { scope: 'block' });
      assert.ok(html.includes('data-align="center"'));
      assert.ok(html.includes('data-align="right"'));
      assert.ok(html.includes('data-numeric'));
    });
  });

  describe('definition lists', () => {
    it('renders dl/dt/dd', () => {
      const block = {
        type: 'definition_list',
        children: [
          { type: 'definition_term', children: [{ type: 'text', value: 'HTML' }] },
          { type: 'definition_desc', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Markup language' }] }] },
        ],
      };
      const html = render(block, { scope: 'block' });
      assert.ok(html.includes('<dl>'));
      assert.ok(html.includes('<dt>HTML</dt>'));
      assert.ok(html.includes('<dd><p>Markup language</p></dd>'));
      assert.ok(html.includes('</dl>'));
    });
  });

  describe('hr variants', () => {
    it('renders plain hr', () => {
      const block = { type: 'hr' };
      const html = render(block, { scope: 'block' });
      assert.equal(html, '<hr/>');
    });

    it('renders decorative hr', () => {
      const block = { type: 'hr', attrs: { variant: 'decorative' } };
      const html = render(block, { scope: 'block' });
      assert.equal(html, '<hr class="decorative"/>');
    });
  });

  describe('figure variants', () => {
    it('renders figure with variant class', () => {
      const block = {
        type: 'figure',
        attrs: { src: '/img.jpg', alt: 'test', variant: 'full' },
        children: [],
      };
      const html = render(block, { scope: 'block' });
      assert.ok(html.includes('<figure class="full">'));
    });

    it('renders figure without class when variant is default', () => {
      const block = {
        type: 'figure',
        attrs: { src: '/img.jpg', alt: 'test', variant: 'default' },
        children: [],
      };
      const html = render(block, { scope: 'block' });
      assert.ok(html.includes('<figure>'));
      assert.ok(!html.includes('class='));
    });
  });

  describe('new marks', () => {
    it('renders mark as <mark>', () => {
      const block = { type: 'paragraph', children: [{ type: 'text', value: 'highlighted', marks: ['mark'] }] };
      const html = render(block, { scope: 'block' });
      assert.ok(html.includes('<mark>highlighted</mark>'));
    });

    it('renders kbd as <kbd>', () => {
      const block = { type: 'paragraph', children: [{ type: 'text', value: 'Ctrl', marks: ['kbd'] }] };
      const html = render(block, { scope: 'block' });
      assert.ok(html.includes('<kbd>Ctrl</kbd>'));
    });

    it('renders sub as <sub>', () => {
      const block = { type: 'paragraph', children: [{ type: 'text', value: '2', marks: ['sub'] }] };
      const html = render(block, { scope: 'block' });
      assert.ok(html.includes('<sub>2</sub>'));
    });

    it('renders sup as <sup>', () => {
      const block = { type: 'paragraph', children: [{ type: 'text', value: '2', marks: ['sup'] }] };
      const html = render(block, { scope: 'block' });
      assert.ok(html.includes('<sup>2</sup>'));
    });
  });
});
