import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { DOMParser, DOMSerializer } from 'prosemirror-model';
import { schema } from '../../editor/assets/js/schema.js';
import { render } from '../../src/renderers/html.js';

// A real DOM (linkedom) for the schema's parseDOM and toDOM. The schema's
// contentElement uses the global `document`.
const { document } = parseHTML('<!doctype html><html><body></body></html>');
let savedDocument;
before(() => { savedDocument = globalThis.document; globalThis.document = document; });
after(() => { globalThis.document = savedDocument; });

/** The first figure parsed from `html`, as a paste would parse it. */
function parseFigure(html) {
  const el = document.createElement('div');
  el.innerHTML = html;
  let fig = null;
  DOMParser.fromSchema(schema).parseSlice(el).content.descendants((n) => {
    if (!fig && n.type.name === 'figure') fig = n;
  });
  return fig;
}

/** A figure through the editor's own clipboard: toDOM, then parseDOM. */
function copyPaste(credit, caption = 'Cap') {
  const node = schema.nodes.figure.create({ src: '/media/a.jpg', alt: 'A', credit },
    caption ? schema.nodes.figcaption.create(null, schema.text(caption)) : null);
  const el = document.createElement('div');
  el.appendChild(DOMSerializer.fromSchema(schema).serializeNode(node, { document }));
  return parseFigure(el.innerHTML);
}

const published = (credit, caption) => render({
  type: 'figure',
  attrs: { src: '/media/a.jpg', alt: 'Boats', credit },
  ...(caption ? { children: [{ type: 'figcaption', children: [{ type: 'text', value: caption }] }] } : {}),
}, { scope: 'block' });

const PEXELS = { name: 'Jane', url: 'https://p.example/jane', site: 'Pexels', siteUrl: 'https://p.example' };

describe('figure credit through the editor clipboard (toDOM, parseDOM)', () => {
  const credits = [
    { name: 'Smith, John' },
    { name: 'Smith, John', site: 'Pexels', siteUrl: 'https://p.example' },
    { name: 'Jane on Mars', site: 'Pexels' },
    { name: 'Jane', site: 'Flickr, Inc', siteUrl: 'https://f.example' },
    { license: 'Photo by Bob' },
    { ...PEXELS, license: 'CC BY 4.0', licenseUrl: 'https://l.example', adapted: true },
  ];
  for (const credit of credits) {
    it(`keeps ${JSON.stringify(credit)} unchanged`, () => {
      const fig = copyPaste(credit);
      assert.deepEqual(fig.attrs.credit, credit);
      assert.equal(fig.textContent, 'Cap');
    });
  }

  it('keeps the credit of a figure with no caption, and adds no caption', () => {
    const fig = copyPaste({ name: 'Smith, John' }, '');
    assert.deepEqual(fig.attrs.credit, { name: 'Smith, John' });
    assert.equal(fig.childCount, 0);
  });

  it('data-credit goes through normalizeCredit: an unsafe link is dropped', () => {
    const fig = parseFigure(`<figure><img src="/media/a.jpg" alt="A"><small class="credit" data-credit='{"name":"Jane","url":"javascript:alert(1)"}'>Photo by Jane</small></figure>`);
    assert.deepEqual(fig.attrs.credit, { name: 'Jane' });
  });
});

describe('figure credit parsed from published HTML', () => {
  it('gives the same credit, and caption text without the credit words', () => {
    const fig = parseFigure(published(PEXELS, 'Harbor at dawn'));
    assert.deepEqual(fig.attrs.credit, PEXELS);
    assert.equal(fig.textContent, 'Harbor at dawn');
    for (const word of ['Photo', 'Jane', 'Pexels']) assert.ok(!fig.textContent.includes(word), fig.textContent);
  });

  it('a credit with no caption gives no figcaption', () => {
    const fig = parseFigure(published(PEXELS));
    assert.deepEqual(fig.attrs.credit, PEXELS);
    assert.equal(fig.childCount, 0);
  });

  it('a figure without a credit parses as before', () => {
    const fig = parseFigure(published(null, 'Cap'));
    assert.equal(fig.attrs.credit, null);
    assert.equal(fig.textContent, 'Cap');
  });

  it('a small.credit inside the caption text stays caption text', () => {
    const fig = parseFigure('<figure><img src="/media/a.jpg" alt="A"><figcaption>See <small class="credit">this</small> here</figcaption></figure>');
    assert.equal(fig.attrs.credit, null);
    assert.equal(fig.textContent, 'See this here');
  });

  it('a small.credit nested deeper in the caption stays caption text', () => {
    const fig = parseFigure('<figure><img src="/media/a.jpg" alt="A"><figcaption>See <em><small class="credit">this</small></em></figcaption></figure>');
    assert.equal(fig.attrs.credit, null);
    assert.equal(fig.textContent, 'See this');
  });
});
