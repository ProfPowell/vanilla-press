import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { schema } from '../../editor/assets/js/schema.js';
import { FigureView } from '../../editor/assets/js/blocks/figure-view.js';
import { EmbedView } from '../../editor/assets/js/blocks/embed-view.js';

// A minimal DOM: just what the node views build with. No parsing, no layout.
class FakeElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.style = {};
    this.textContent = '';
    this.parentNode = null;
    const classes = new Set();
    this.classList = {
      add: (...c) => c.forEach((x) => classes.add(x)),
      remove: (...c) => c.forEach((x) => classes.delete(x)),
      contains: (c) => classes.has(c),
      toggle: (c, on = !classes.has(c)) => (on ? classes.add(c) : classes.delete(c), on),
    };
    Object.defineProperty(this, 'className', {
      get: () => [...classes].join(' '),
      set: (v) => { classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach((x) => classes.add(x)); },
    });
  }
  setAttribute(k, v) { this.attributes.set(k, String(v)); }
  getAttribute(k) { return this.attributes.has(k) ? this.attributes.get(k) : null; }
  hasAttribute(k) { return this.attributes.has(k); }
  removeAttribute(k) { this.attributes.delete(k); }
  toggleAttribute(k, on = !this.attributes.has(k)) {
    if (on) this.attributes.set(k, ''); else this.attributes.delete(k);
    return on;
  }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  append(...cs) {
    for (const c of cs) {
      if (typeof c === 'string') this.textContent += c;
      else this.appendChild(c);
    }
  }
  replaceChildren(...cs) {
    this.children = [];
    this.textContent = '';
    this.append(...cs);
  }
  contains(el) {
    for (let n = el; n; n = n.parentNode) if (n === this) return true;
    return false;
  }
  addEventListener() {}
}

let savedDocument;
before(() => {
  savedDocument = globalThis.document;
  globalThis.document = { createElement: (tag) => new FakeElement(tag) };
});
after(() => { globalThis.document = savedDocument; });

const figureNode = (attrs) => schema.node('figure', attrs);
const fakeView = { state: null, dispatch() {} };
const figureView = (attrs) => new FigureView(figureNode(attrs), fakeView, () => 0);

describe('FigureView DOM contract', () => {
  it('puts the media display, then the fields row, then the caption in the figure', () => {
    const v = figureView({ src: '/media/a.jpg', alt: 'A' });
    const order = v.dom.children.filter((c) => [v.display, v.fields, v.contentDOM].includes(c));
    assert.deepEqual(order, [v.display, v.fields, v.contentDOM]);
  });

  it('the display wrapper is not editable and holds the image and the placeholder', () => {
    const v = figureView({ src: '/media/a.jpg', alt: 'A' });
    assert.equal(v.display.getAttribute('contenteditable'), 'false');
    assert.ok(v.display.contains(v.img));
    assert.ok(v.display.contains(v.placeholder));
  });

  it('the fields row is not editable, and the caption wrapper is', () => {
    const v = figureView({ src: '/media/a.jpg', alt: 'A' });
    assert.equal(v.fields.getAttribute('contenteditable'), 'false');
    assert.ok(v.fields.classList.contains('media-fields'));
    assert.notEqual(v.contentDOM.getAttribute('contenteditable'), 'false');
  });

  it('selectNode sets data-selected and deselectNode removes it', () => {
    const v = figureView({ src: '/media/a.jpg', alt: 'A' });
    assert.equal(v.dom.hasAttribute('data-selected'), false);
    v.selectNode();
    assert.equal(v.dom.hasAttribute('data-selected'), true);
    v.deselectNode();
    assert.equal(v.dom.hasAttribute('data-selected'), false);
  });

  it('shows the alt badge when alt is empty, not when alt is set', () => {
    const noAlt = figureView({ src: '/media/a.jpg', alt: '' });
    assert.ok(noAlt.badge.classList.contains('figure-alt-missing'));
    assert.equal(noAlt.badge.getAttribute('contenteditable'), 'false');
    assert.equal(noAlt.badge.hasAttribute('hidden'), false);
    assert.ok(noAlt.dom.contains(noAlt.badge));

    const withAlt = figureView({ src: '/media/a.jpg', alt: 'A cat' });
    assert.equal(withAlt.badge.hasAttribute('hidden'), true);
  });

  it('update keeps the badge in step with alt', () => {
    const v = figureView({ src: '/media/a.jpg', alt: '' });
    v.update(figureNode({ src: '/media/a.jpg', alt: 'A cat' }));
    assert.equal(v.badge.hasAttribute('hidden'), true);
    v.update(figureNode({ src: '/media/a.jpg', alt: '' }));
    assert.equal(v.badge.hasAttribute('hidden'), false);
  });

  it('ignores mutations in its chrome, not in the caption', () => {
    const v = figureView({ src: '/media/a.jpg', alt: '' });
    for (const el of [v.display, v.placeholder, v.fields, v.badge]) {
      assert.equal(v.ignoreMutation({ target: el }), true);
    }
    assert.equal(v.ignoreMutation({ target: v.contentDOM }), false);
  });
});

describe('FigureView credit', () => {
  const credit = { name: 'Jane', url: 'https://p.example/jane', site: 'Pexels' };

  it('shows the credit after the caption, not editable', () => {
    const v = figureView({ src: '/media/a.jpg', alt: 'A', credit });
    const i = v.dom.children.indexOf(v.contentDOM);
    assert.ok(i >= 0);
    assert.equal(v.dom.children.indexOf(v.credit), i + 1);
    assert.equal(v.credit.getAttribute('contenteditable'), 'false');
    assert.ok(v.credit.classList.contains('credit'));
    assert.ok(!v.contentDOM.contains(v.credit));
    assert.equal(v.credit.hasAttribute('hidden'), false);
  });

  it('renders the credit parts as text and links', () => {
    const v = figureView({ src: '/media/a.jpg', alt: 'A', credit });
    const [link] = v.credit.children;
    assert.equal(link.tagName, 'A');
    assert.equal(link.getAttribute('href'), 'https://p.example/jane');
    assert.equal(link.textContent, 'Jane');
    assert.ok(v.credit.textContent.includes('Photo by '));
    assert.ok(v.credit.textContent.includes(' on Pexels'));
  });

  it('is hidden with no credit, and follows the node on update', () => {
    const v = figureView({ src: '/media/a.jpg', alt: 'A' });
    assert.equal(v.credit.hasAttribute('hidden'), true);
    v.update(figureNode({ src: '/media/a.jpg', alt: 'A', credit }));
    assert.equal(v.credit.hasAttribute('hidden'), false);
    assert.equal(v.credit.children[0].textContent, 'Jane');
    v.update(figureNode({ src: '/media/a.jpg', alt: 'A' }));
    assert.equal(v.credit.hasAttribute('hidden'), true);
  });

  it('ignores mutations in the credit', () => {
    const v = figureView({ src: '/media/a.jpg', alt: 'A', credit });
    assert.equal(v.ignoreMutation({ target: v.credit }), true);
    assert.equal(v.ignoreMutation({ target: v.credit.children[0] }), true);
  });
});

describe('EmbedView DOM contract', () => {
  const embedView = (attrs) => new EmbedView(schema.node('embed', attrs), fakeView, () => 0);

  it('shows its display, then a URL field row, both not editable', () => {
    const v = embedView({ url: 'https://example.com/a.mp4', type: 'video' });
    const order = v.dom.children.filter((c) => [v.display, v.fields].includes(c));
    assert.deepEqual(order, [v.display, v.fields]);
    assert.equal(v.dom.getAttribute('contenteditable'), 'false');
    assert.equal(v.display.getAttribute('contenteditable'), 'false');
    assert.equal(v.fields.getAttribute('contenteditable'), 'false');
    assert.ok(v.fields.classList.contains('media-fields'));
    assert.equal(v.urlInput.value, 'https://example.com/a.mp4');
    assert.equal(v.display.textContent, '[video: https://example.com/a.mp4]');
  });

  it('keeps data-embed, data-url and data-type on its dom', () => {
    const v = embedView({ url: 'https://example.com/a.mp4', type: 'video' });
    assert.equal(v.dom.hasAttribute('data-embed'), true);
    assert.equal(v.dom.getAttribute('data-url'), 'https://example.com/a.mp4');
    assert.equal(v.dom.getAttribute('data-type'), 'video');
  });

  it('selectNode sets data-selected and deselectNode removes it', () => {
    const v = embedView({ url: 'https://example.com/a.mp4', type: 'video' });
    v.selectNode();
    assert.equal(v.dom.hasAttribute('data-selected'), true);
    v.deselectNode();
    assert.equal(v.dom.hasAttribute('data-selected'), false);
  });

  it('update syncs the URL field and the display', () => {
    const v = embedView({ url: 'https://example.com/a.mp4', type: 'video' });
    v.update(schema.node('embed', { url: 'https://example.com/b.mp3', type: 'audio' }));
    assert.equal(v.urlInput.value, 'https://example.com/b.mp3');
    assert.equal(v.display.textContent, '[audio: https://example.com/b.mp3]');
  });
});
