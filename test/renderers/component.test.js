import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../../src/renderers/html.js';
import { render as renderMd } from '../../src/renderers/markdown.js';

const block = (b) => render(b, { scope: 'block' });

describe('html renderer: component', () => {
  it('renders a none-kind block with typed attrs', () => {
    assert.equal(block({ type: 'component', tag: 'pdf-viewer', attrs: { src: '/media/a.pdf', toolbar: true, hidden: false, page: 2 } }),
      '<pdf-viewer page="2" src="/media/a.pdf" toolbar></pdf-viewer>');
  });
  it('escapes attribute values', () => {
    assert.equal(block({ type: 'component', tag: 'browser-window', attrs: { title: `a"b<c&d\ne` } }),
      '<browser-window title="a&quot;b&lt;c&amp;d\ne"></browser-window>');
  });
  it('renders text content escaped', () => {
    assert.equal(block({ type: 'component', tag: 'marquee-wc', attrs: {}, value: 'Hi <b>' }),
      '<marquee-wc>Hi &lt;b&gt;</marquee-wc>');
  });
  it('renders code content by wrap', () => {
    assert.equal(block({ type: 'component', tag: 'x-code', attrs: {}, value: '<p>a</p>', wrap: 'text' }), '<x-code>&lt;p&gt;a&lt;/p&gt;</x-code>');
    assert.equal(block({ type: 'component', tag: 'x-code', attrs: {}, value: '<p>a</p>', wrap: 'template' }), '<x-code><template>&lt;p&gt;a&lt;/p&gt;</template></x-code>');
    assert.equal(block({ type: 'component', tag: 'x-code', attrs: {}, value: 'a</script>b' }), '<x-code>a&lt;/script&gt;b</x-code>');
    assert.equal(block({ type: 'component', tag: 'x-code', attrs: {}, value: 'a</script>b', wrap: 'script' }),
      '<x-code><script type="text/plain">a<\\/script>b</script></x-code>');
  });
  it('renders blocks children joined by newline', () => {
    const p = (t) => ({ type: 'paragraph', children: [{ type: 'text', value: t }] });
    assert.equal(block({ type: 'component', tag: 'x-blocks', attrs: {}, children: [p('a'), p('b')] }),
      '<x-blocks><p>a</p>\n<p>b</p></x-blocks>');
  });
  it('renders inline components inside a paragraph', () => {
    assert.equal(block({ type: 'paragraph', children: [{ type: 'text', value: 'a ' },
      { type: 'component', tag: 'blink-wc', attrs: {}, children: [{ type: 'text', value: 'new' }] }] }),
      '<p>a <blink-wc>new</blink-wc></p>');
  });
});

describe('markdown renderer: component', () => {
  const doc = (...blocks) => ({ meta: {}, blocks });
  it('emits the same HTML for blocks', () => {
    const c = { type: 'component', tag: 'pdf-viewer', attrs: { src: 'a.pdf', toolbar: true } };
    assert.ok(renderMd(doc(c)).includes('<pdf-viewer src="a.pdf" toolbar></pdf-viewer>'));
  });
  it('emits raw inline HTML', () => {
    const p = { type: 'paragraph', children: [{ type: 'text', value: 'a ' }, { type: 'component', tag: 'blink-wc', attrs: {}, children: [{ type: 'text', value: 'new' }] }] };
    assert.ok(renderMd(doc(p)).includes('a <blink-wc>new</blink-wc>'));
  });
});
