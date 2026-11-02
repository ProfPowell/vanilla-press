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
    it('wraps output in <article> with stack layout', () => {
      const doc = fixture('minimal.json');
      const html = render(doc, { scope: 'content' });
      assert.ok(html.startsWith('<article'));
      assert.ok(html.includes('data-layout="stack"'));
      assert.ok(html.includes('data-doc="doc_min01"'));
      assert.ok(html.endsWith('</article>'));
    });

    it('with bare:true returns blocks without article wrapper', () => {
      const doc = fixture('minimal.json');
      const html = render(doc, { scope: 'content', bare: true });
      assert.ok(!html.includes('<article'));
      assert.ok(html.includes('<p>'));
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
    it('produces <code-block> with language and label attrs (@profpowell/code-block)', () => {
      const doc = fixture('simple-post.json');
      const html = render(doc);
      assert.ok(html.includes('<code-block language="css" label="main.css">'));
      assert.ok(html.includes('</code-block>'));
      assert.ok(!html.includes('<pre data-language='));
    });
  });

  describe('callouts', () => {
    it('produces <status-message> with mapped variant and content slot', () => {
      const doc = fixture('component-rich.json');
      const html = render(doc);
      // tip → success, warning → warning
      assert.ok(html.includes('<status-message data-variant="success">'));
      assert.ok(html.includes('<status-message data-variant="warning">'));
      assert.ok(html.includes('<div data-content>'));
      assert.ok(!html.includes('<ui-callout'));
    });
  });

  describe('tabs', () => {
    it('produces <tab-set> wrapping <details name>/<summary> siblings (per VB api)', () => {
      const doc = fixture('component-rich.json');
      const html = render(doc);
      assert.ok(html.includes('<tab-set>'));
      assert.ok(html.includes('</tab-set>'));
      assert.match(html, /<details name="ts-[a-z0-9]+" open>/);
      assert.match(html, /<details name="ts-[a-z0-9]+">/);
      assert.ok(html.includes('<summary>'));
      assert.ok(!html.includes('<ui-tabs'));
      assert.ok(!html.includes('role="tab"'));
      assert.ok(!html.includes('type="radio"'));
    });

    it('is deterministic: rendering twice gives equal output', () => {
      const doc = fixture('component-rich.json');
      assert.equal(render(doc), render(doc));
    });
  });

  describe('steps', () => {
    it('produces <ol class="steps"> with title in <strong>', () => {
      const doc = fixture('component-rich.json');
      const html = render(doc);
      assert.ok(html.includes('<ol class="steps">'));
      assert.ok(html.includes('<strong class="step-title">'));
      assert.ok(!html.includes('data-steps'));
      assert.ok(!html.includes('data-step-title'));
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

    it('renders codepen embed as <social-embed>', () => {
      const doc = fixture('edge-cases.json');
      const html = render(doc);
      assert.ok(html.includes('<social-embed url="https://codepen.io/example/pen/abc123">'));
      assert.ok(!html.includes('data-embed'));
      assert.ok(!html.includes('<iframe'));
    });

    it('renders collapsible as <details>', () => {
      const doc = fixture('component-rich.json');
      const html = render(doc);
      assert.ok(html.includes('<details>'));
      assert.ok(html.includes('<summary>'));
    });

    it('renders card as <layout-card> wrapped in anchor when href present', () => {
      const doc = fixture('component-rich.json');
      const html = render(doc);
      assert.ok(html.includes('<a href='));
      assert.ok(html.includes('class="card-link"'));
      assert.ok(html.includes('<layout-card data-variant="elevated">'));
      assert.ok(!html.includes('<content-card'));
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
    it('produces a responsive grid of <article> entries with linked title', () => {
      const docs = [fixture('minimal.json'), fixture('simple-post.json')];
      const html = render(docs, { scope: 'collection' });
      assert.ok(html.includes('data-layout="grid"'));
      assert.ok(html.includes('data-layout-min='));
      assert.ok(html.includes('<article data-layout="stack"'));
      assert.match(html, /<h3><a href="\/[^"]+\/">Hello World<\/a><\/h3>/);
      assert.ok(html.includes('Getting Started'));
      assert.ok(!html.includes('<content-card'));
      assert.ok(!html.includes('<layout-card'));
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
