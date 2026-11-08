import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { schema } from '../../editor/assets/js/schema.js';
import { toBlockAst } from '../../editor/assets/js/ast.js';
import { validate } from '../../src/schema/validate.js';
import { insertPlan, nodesFor, pickerKind, pdfViewerEnabled, PDF_LINK_NOTE } from '../../editor/assets/js/media-insert.js';

const item = (over) => ({
  id: 'm1', filename: 'photo.jpg', original_name: 'Photo.JPG', mime_type: 'image/jpeg', kind: 'image',
  size: 10, width: 4, height: 3, alt: 'A cat', edited_from: null, created: '2026-11-07T00:00:00Z',
  src: '/media/photo.jpg', missing: false, usedIn: [], ...over,
});
const mp3 = item({ id: 'm2', filename: 'song.mp3', original_name: 'Song.mp3', mime_type: 'audio/mpeg', kind: 'audio', alt: null, src: '/media/song.mp3' });
const mp4 = item({ id: 'm3', filename: 'clip.mp4', original_name: 'clip.mp4', mime_type: 'video/mp4', kind: 'video', alt: null, src: '/media/clip.mp4' });
const pdf = item({ id: 'm4', filename: 'report-2.pdf', original_name: 'Annual report.pdf', mime_type: 'application/pdf', kind: 'pdf', alt: null, src: '/media/report-2.pdf' });

/** The AST of a doc holding `nodes`, and whether it validates. */
function astOf(nodes) {
  const doc = schema.node('doc', null, [schema.node('title'), ...nodes]);
  const blocks = toBlockAst(doc);
  const result = validate({ id: 't', meta: { title: 'T', slug: 't', collection: 'posts', status: 'draft' }, blocks });
  return { blocks, result };
}

describe('insertPlan', () => {
  it('an image with alt inserts a figure with it', () => {
    assert.deepEqual(insertPlan(item(), { pdfViewer: false }),
      { kind: 'figure', attrs: { src: '/media/photo.jpg', alt: 'A cat' }, focusAlt: false });
  });

  it('a decorative image inserts alt ""', () => {
    assert.deepEqual(insertPlan(item({ alt: '' }), { pdfViewer: false }),
      { kind: 'figure', attrs: { src: '/media/photo.jpg', alt: '' }, focusAlt: false });
  });

  it('an image with no alt opens the alt field', () => {
    assert.deepEqual(insertPlan(item({ alt: null }), { pdfViewer: false }),
      { kind: 'figure', attrs: { src: '/media/photo.jpg', alt: '' }, focusAlt: true });
  });

  it('video and audio insert embeds', () => {
    assert.deepEqual(insertPlan(mp4, { pdfViewer: false }), { kind: 'embed', attrs: { url: '/media/clip.mp4', type: 'video' } });
    assert.deepEqual(insertPlan(mp3, { pdfViewer: false }), { kind: 'embed', attrs: { url: '/media/song.mp3', type: 'audio' } });
  });

  it('a pdf becomes a pdf-viewer when enabled', () => {
    assert.deepEqual(insertPlan(pdf, { pdfViewer: true }),
      { kind: 'component', tag: 'pdf-viewer', attrs: { src: '/media/report-2.pdf' } });
  });

  it('a pdf becomes a link otherwise', () => {
    const note = 'Inserted as a link. Turn on the PDF viewer in Components to show PDFs in the page.';
    assert.equal(PDF_LINK_NOTE, note);
    assert.deepEqual(insertPlan(pdf, { pdfViewer: false }),
      { kind: 'link', href: '/media/report-2.pdf', text: 'Annual report.pdf', note });
    assert.equal(insertPlan({ ...pdf, original_name: '' }, { pdfViewer: false }).text, 'report-2.pdf');
  });
});

describe('nodesFor round-trips through toBlockAst', () => {
  it('figure: no caption', () => {
    const { blocks, result } = astOf(nodesFor(insertPlan(item(), { pdfViewer: false }), schema));
    assert.deepEqual(blocks, [{ type: 'figure', attrs: { src: '/media/photo.jpg', alt: 'A cat' } }]);
    assert.deepEqual(result.errors, []);
  });

  it('embed audio', () => {
    const { blocks, result } = astOf(nodesFor(insertPlan(mp3, { pdfViewer: false }), schema));
    assert.deepEqual(blocks, [{ type: 'embed', attrs: { url: '/media/song.mp3', type: 'audio' } }]);
    assert.deepEqual(result.errors, []);
  });

  it('component pdf-viewer', () => {
    const { blocks, result } = astOf(nodesFor(insertPlan(pdf, { pdfViewer: true }), schema));
    assert.deepEqual(blocks, [{ type: 'component', tag: 'pdf-viewer', attrs: { src: '/media/report-2.pdf' } }]);
    assert.deepEqual(result.errors, []);
  });

  it('link: a paragraph with an inline link to the file', () => {
    const { blocks, result } = astOf(nodesFor(insertPlan(pdf, { pdfViewer: false }), schema));
    assert.deepEqual(blocks, [{
      type: 'paragraph',
      children: [{ type: 'link', attrs: { href: '/media/report-2.pdf' }, children: [{ type: 'text', value: 'Annual report.pdf' }] }],
    }]);
    assert.deepEqual(result.errors, []);
  });
});

describe('pickerKind', () => {
  it('poster is an image on any tag', () => {
    assert.equal(pickerKind('video-player', 'poster'), 'image');
    assert.equal(pickerKind('pdf-viewer', 'poster'), 'image');
  });
  it('pdf-viewer src is a pdf, image-editor src an image', () => {
    assert.equal(pickerKind('pdf-viewer', 'src'), 'pdf');
    assert.equal(pickerKind('image-editor', 'src'), 'image');
  });
  it('anything else is all', () => {
    assert.equal(pickerKind('browser-window', 'src'), 'all');
    assert.equal(pickerKind('image-editor', 'href'), 'all');
  });
});

describe('pdfViewerEnabled', () => {
  const res = (enabled) => ({
    packages: [
      { name: '@profpowell/code-block', enabled: true, elements: [{ tag: 'code-block' }] },
      { name: '@profpowell/pdf-viewer', enabled, elements: [{ tag: 'pdf-viewer' }] },
    ],
  });
  it('true with the package enabled', () => assert.equal(pdfViewerEnabled(res(true)), true));
  it('false with it disabled, or no response', () => {
    assert.equal(pdfViewerEnabled(res(false)), false);
    assert.equal(pdfViewerEnabled(null), false);
  });
});
