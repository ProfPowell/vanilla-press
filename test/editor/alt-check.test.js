import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { altWarnings, altWarningText } from '../../editor/assets/js/alt-check.js';

const fig = (src, alt) => ({ type: 'figure', attrs: alt === undefined ? { src } : { src, alt } });
const lib = (filename, alt) => ({ id: `m-${filename}`, filename, src: `/media/${filename}`, kind: 'image', alt });

describe('altWarnings', () => {
  it('a figure with alt text: none', () => {
    assert.deepEqual(altWarnings([fig('/media/a.jpg', 'A cat')], [lib('a.jpg', null)]), []);
  });

  it('alt "" with the library entry decorative: none', () => {
    assert.deepEqual(altWarnings([fig('/media/a.jpg', '')], [lib('a.jpg', '')]), []);
  });

  it('alt "" with the library alt never written: warns', () => {
    assert.deepEqual(altWarnings([fig('/media/a.jpg', '')], [lib('a.jpg', null)]), [{ src: '/media/a.jpg', name: 'a.jpg' }]);
  });

  it('alt "" with the library alt text: warns', () => {
    assert.deepEqual(altWarnings([fig('/media/a.jpg', '')], [lib('a.jpg', 'A cat')]), [{ src: '/media/a.jpg', name: 'a.jpg' }]);
  });

  it('alt absent warns too', () => {
    assert.deepEqual(altWarnings([fig('/media/a.jpg')], []), [{ src: '/media/a.jpg', name: 'a.jpg' }]);
  });

  it('an external src with alt "": warns, named by its src', () => {
    const src = 'https://example.com/x.png';
    assert.deepEqual(altWarnings([fig(src, '')], [lib('x.png', '')]), [{ src, name: src }]);
  });

  it('a linked (Unsplash) item marked decorative: none; otherwise warns, named by its filename', () => {
    const U = 'https://images.unsplash.com/photo-1?w=2400';
    const linked = (alt) => ({ id: 'u', filename: 'unsplash-u1', src: U, linked: true, kind: 'image', alt });
    assert.deepEqual(altWarnings([fig(U, '')], [linked('')]), []);
    assert.deepEqual(altWarnings([fig(U, '')], [linked(null)]), [{ src: U, name: 'unsplash-u1' }]);
  });

  it('a file not in the library warns', () => {
    assert.deepEqual(altWarnings([fig('/media/gone.jpg', '')], [lib('a.jpg', '')]), [{ src: '/media/gone.jpg', name: 'gone.jpg' }]);
  });

  it('a figure nested in a callout is found', () => {
    const blocks = [{ type: 'callout', attrs: { variant: 'info' }, children: [{ type: 'paragraph', children: [] }, fig('/media/b.jpg', '')] }];
    assert.deepEqual(altWarnings(blocks, []), [{ src: '/media/b.jpg', name: 'b.jpg' }]);
  });

  it('two figures with the same src: one warning', () => {
    assert.deepEqual(altWarnings([fig('/media/a.jpg', ''), fig('/media/a.jpg')], []), [{ src: '/media/a.jpg', name: 'a.jpg' }]);
  });

  it('no blocks: none', () => {
    assert.deepEqual(altWarnings(undefined, []), []);
  });

  it('no library list (the fetch failed or answered something else): none, publish goes ahead', () => {
    const blocks = [fig('/media/a.jpg', '')];
    assert.deepEqual(altWarnings(blocks, undefined), []);
    assert.deepEqual(altWarnings(blocks, null), []);
    assert.deepEqual(altWarnings(blocks, { error: 'Not found' }), []);
    // An empty library is a real answer: the file is not in it, so it warns
    assert.deepEqual(altWarnings(blocks, []), [{ src: '/media/a.jpg', name: 'a.jpg' }]);
  });
});

describe('altWarningText', () => {
  const BODY = 'Screen readers will announce only the file name. Add alt text in the image block, or mark the image decorative in Media.';

  it('one image, publish', () => {
    assert.deepEqual(altWarningText([{ src: '/media/a.jpg', name: 'a.jpg' }], 'publish'), {
      heading: 'An image has no alt text', body: BODY, items: ['a.jpg'], confirm: 'Publish anyway', tone: 'primary',
    });
  });

  it('several images, update', () => {
    const w = [{ src: '/media/a.jpg', name: 'a.jpg' }, { src: 'https://x.test/b.png', name: 'https://x.test/b.png' }];
    assert.deepEqual(altWarningText(w, 'update'), {
      heading: '2 images have no alt text', body: BODY, items: ['a.jpg', 'https://x.test/b.png'], confirm: 'Update anyway', tone: 'primary',
    });
  });
});
