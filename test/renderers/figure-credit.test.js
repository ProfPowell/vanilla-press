import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { render as renderHtml } from '../../src/renderers/html.js';
import { render as renderMd } from '../../src/renderers/markdown.js';

const PEXELS = { name: 'Jane', url: 'u1', site: 'Pexels', siteUrl: 'u2' };
const CREDIT_HTML = '<small class="credit">Photo by <a href="u1" rel="noopener">Jane</a> on <a href="u2" rel="noopener">Pexels</a></small>';

const figure = (credit, caption) => ({
  type: 'figure',
  attrs: { src: '/media/a.jpg', alt: 'Boats', ...(credit ? { credit } : {}) },
  ...(caption != null
    ? { children: [{ type: 'figcaption', children: caption ? [{ type: 'text', value: caption }] : [] }] }
    : {}),
});

const html = (block) => renderHtml(block, { scope: 'block' });
const md = (block) => renderMd({ meta: {}, blocks: [block] });

describe('figure credit: HTML', () => {
  it('follows the caption, after one space, inside the figcaption', () => {
    assert.equal(html(figure(PEXELS, 'Harbor at dawn')),
      `<figure>\n<img src="/media/a.jpg" alt="Boats"/>\n<figcaption>Harbor at dawn ${CREDIT_HTML}</figcaption>\n</figure>`);
  });

  it('is the whole figcaption when there is no caption', () => {
    assert.equal(html(figure(PEXELS)),
      `<figure>\n<img src="/media/a.jpg" alt="Boats"/>\n<figcaption>${CREDIT_HTML}</figcaption>\n</figure>`);
  });

  it('is the whole figcaption when the caption is empty', () => {
    assert.equal(html(figure(PEXELS, '')),
      `<figure>\n<img src="/media/a.jpg" alt="Boats"/>\n<figcaption>${CREDIT_HTML}</figcaption>\n</figure>`);
  });

  it('escapes the credit text and link', () => {
    const out = html(figure({ name: '<b>', url: 'https://x.example/?a=1&b="2"' }));
    assert.ok(out.includes('Photo by <a href="https://x.example/?a=1&amp;b=&quot;2&quot;" rel="noopener">&lt;b&gt;</a>'), out);
    assert.ok(!out.includes('<b>'), out);
  });

  it('drops a javascript: link and keeps its text', () => {
    const out = html(figure({ name: 'Jane', url: 'javascript:alert(1)', site: 'Pexels' }));
    assert.ok(out.includes('<small class="credit">Photo by Jane on Pexels</small>'), out);
    assert.ok(!out.includes('javascript'), out);
  });

  it('renders every part creditParts gives, license and adapted too', () => {
    const out = html(figure({ site: 'Openverse', siteUrl: 'u2', license: 'CC BY 4.0', licenseUrl: 'u3', adapted: true }, 'Cap'));
    assert.ok(out.includes('<figcaption>Cap <small class="credit">Photo from <a href="u2" rel="noopener">Openverse</a>, <a href="u3" rel="noopener">CC BY 4.0</a>, adapted</small></figcaption>'), out);
  });

  it('a figure without a credit renders as before', () => {
    assert.equal(html(figure(null, 'Cap')),
      '<figure>\n<img src="/media/a.jpg" alt="Boats"/>\n<figcaption>Cap</figcaption>\n</figure>');
    assert.equal(html(figure(null)), '<figure>\n<img src="/media/a.jpg" alt="Boats"/>\n</figure>');
  });

  it('an invalid credit renders nothing', () => {
    assert.equal(html(figure({ name: 5 })), '<figure>\n<img src="/media/a.jpg" alt="Boats"/>\n</figure>');
  });
});

describe('figure credit: Markdown', () => {
  it('goes on its own line after the caption line', () => {
    assert.ok(md(figure(PEXELS, 'Harbor at dawn')).includes(
      `![Boats](/media/a.jpg)\n\n*Harbor at dawn*\n${CREDIT_HTML}`));
  });

  it('goes on its own line after the image when there is no caption', () => {
    const out = md(figure(PEXELS));
    assert.ok(out.includes(`![Boats](/media/a.jpg)\n${CREDIT_HTML}`), out);
  });

  it('goes after the image when the caption is empty, with no empty emphasis', () => {
    const out = md(figure(PEXELS, ''));
    assert.ok(out.includes(`![Boats](/media/a.jpg)\n${CREDIT_HTML}`), out);
    assert.ok(!out.includes('**'), out);
  });

  it('escapes the credit text and drops a javascript: link', () => {
    const out = md(figure({ name: '<b>', url: 'javascript:alert(1)' }));
    assert.ok(out.includes('<small class="credit">Photo by &lt;b&gt;</small>'), out);
    assert.ok(!out.includes('javascript'), out);
  });

  it('a figure without a credit renders as before', () => {
    const out = md(figure(null, 'Cap'));
    assert.ok(out.includes('![Boats](/media/a.jpg)\n\n*Cap*\n'), out);
    assert.ok(!out.includes('credit'), out);
  });
});
