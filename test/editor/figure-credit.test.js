import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from 'prosemirror-state';
import { schema, readCredit } from '../../editor/assets/js/schema.js';
import { toBlockAst, fromBlockAst } from '../../editor/assets/js/ast.js';
import { creditParts, creditFromParts } from '../../src/media/credit.js';

const PEXELS = { name: 'Jane', url: 'https://p.example/jane', site: 'Pexels', siteUrl: 'https://p.example' };

const figure = (credit, caption) => ({
  type: 'figure',
  attrs: { src: '/media/a.jpg', alt: 'Boats', ...(credit ? { credit } : {}) },
  ...(caption != null
    ? { children: [{ type: 'figcaption', children: caption ? [{ type: 'text', value: caption }] : [] }] }
    : {}),
});

const roundTrip = (blocks) => toBlockAst(fromBlockAst(blocks, schema, { title: 'T' }));

describe('figure credit in the editor', () => {
  it('the figure node has a credit attr, null by default', () => {
    assert.equal(schema.nodes.figure.create().attrs.credit, null);
  });

  it('round-trips a credit unchanged', () => {
    const [fig] = roundTrip([figure(PEXELS, 'Harbor at dawn')]);
    assert.deepEqual(fig.attrs.credit, PEXELS);
    assert.deepEqual(fig.children, [{ type: 'figcaption', children: [{ type: 'text', value: 'Harbor at dawn' }] }]);
  });

  it('round-trips every credit field', () => {
    const credit = { ...PEXELS, license: 'CC BY 4.0', licenseUrl: 'https://l.example', adapted: true };
    assert.deepEqual(roundTrip([figure(credit)])[0].attrs.credit, credit);
  });

  it('a figure without a credit gets no credit attr', () => {
    const [fig] = roundTrip([figure(null, 'Cap')]);
    assert.ok(!('credit' in fig.attrs), JSON.stringify(fig));
  });

  it('keeps the credit when the caption is empty', () => {
    assert.deepEqual(roundTrip([figure(PEXELS, '')])[0].attrs.credit, PEXELS);
    assert.deepEqual(roundTrip([figure(PEXELS)])[0].attrs.credit, PEXELS);
  });

  it('keeps the credit when all the caption text is deleted', () => {
    const doc = fromBlockAst([figure(PEXELS, 'Harbor at dawn')], schema, { title: 'T' });
    let state = EditorState.create({ doc });
    let from = null;
    let to = null;
    state.doc.descendants((n, pos) => {
      if (n.type.name === 'figcaption') { from = pos + 1; to = pos + n.nodeSize - 1; }
    });
    state = state.apply(state.tr.delete(from, to));
    const [fig] = toBlockAst(state.doc);
    assert.deepEqual(fig.attrs.credit, PEXELS);
    assert.ok(!JSON.stringify(fig.children || []).includes('Jane'));
  });

  it('a credit that is not valid is dropped on the way in', () => {
    const [fig] = roundTrip([figure({ name: 'Jane', url: 'javascript:alert(1)' })]);
    assert.deepEqual(fig.attrs.credit, { name: 'Jane' });
  });
});

describe('reading a credit back from rendered HTML', () => {
  const credits = [
    PEXELS,
    { name: 'Jane' },
    { name: 'Jane', site: 'Pexels' },
    { name: 'Jane Q. Public', url: 'u1', site: 'Openverse', siteUrl: 'u2', license: 'CC BY-SA 4.0', licenseUrl: 'u3', adapted: true },
    { name: 'Jane', site: 'Pexels', license: 'CC0', adapted: true },
    { name: 'Jane', url: 'u1', license: 'CC0' },
    { site: 'Pixabay', siteUrl: 'u2' },
    { site: 'Pixabay', license: 'Pixabay License', licenseUrl: 'u3', adapted: true },
    { license: 'CC0', licenseUrl: 'u3' },
    { license: 'Public domain', adapted: true },
    { name: 'Smith, Jones & Co', url: 'u1', site: 'Flickr, Inc', siteUrl: 'u2' },
  ];

  for (const credit of credits) {
    it(`creditFromParts inverts creditParts: ${JSON.stringify(credit)}`, () => {
      assert.deepEqual(creditFromParts(creditParts(credit)), credit);
    });
  }

  it('creditFromParts keeps the words of a field that mixes a link and text, without the link', () => {
    const parts = [{ text: 'Photo by ' }, { text: 'Jane', href: 'u1' }, { text: ' & Bob on Pexels' }];
    assert.deepEqual(creditFromParts(parts), { name: 'Jane & Bob', site: 'Pexels' });
  });

  it('creditFromParts gives null for nothing', () => {
    assert.equal(creditFromParts([]), null);
  });

  // A stand-in for the DOM `small.credit` that the renderer writes.
  const text = (t) => ({ nodeType: 3, textContent: t });
  const link = (t, href) => ({ nodeType: 1, nodeName: 'A', textContent: t, getAttribute: (k) => (k === 'href' ? href : null) });

  it('readCredit reads the rendered text and links', () => {
    const small = { getAttribute: () => null, childNodes: [text('Photo by '), link('Jane', 'u1'), text(' on '), link('Pexels', 'u2')] };
    assert.deepEqual(readCredit(small), { name: 'Jane', url: 'u1', site: 'Pexels', siteUrl: 'u2' });
  });

  it('readCredit gives null without an element', () => {
    assert.equal(readCredit(null), null);
  });
});
