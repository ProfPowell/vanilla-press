/**
 * What inserting a library file puts in a post: pure, no DOM. Tested in Node.
 *
 * `insertPlan` decides the block for a MediaItem; `nodesFor` builds its
 * ProseMirror nodes with the schema it is given.
 *
 * @module editor/media-insert
 */

import { enabledDescriptors } from './component-model.js';

export const PDF_LINK_NOTE = 'Inserted as a link. Turn on the PDF viewer in Components to show PDFs in the page.';

/**
 * The block a chosen file becomes.
 * @param {object} item MediaItem
 * @param {{ pdfViewer: boolean }} opts whether the site has the pdf-viewer component on
 */
export function insertPlan(item, { pdfViewer }) {
  const src = item.src || `/media/${item.filename}`;
  if (item.kind === 'image') {
    return { kind: 'figure', attrs: { src, alt: item.alt ?? '' }, focusAlt: item.alt == null };
  }
  if (item.kind === 'video' || item.kind === 'audio') {
    return { kind: 'embed', attrs: { url: src, type: item.kind } };
  }
  if (pdfViewer) return { kind: 'component', tag: 'pdf-viewer', attrs: { src } };
  return { kind: 'link', href: src, text: item.original_name || item.filename, note: PDF_LINK_NOTE };
}

/**
 * The nodes for a plan.
 * @param {ReturnType<typeof insertPlan>} plan
 * @param {import('prosemirror-model').Schema} schema
 * @returns {import('prosemirror-model').Node[]}
 */
export function nodesFor(plan, schema) {
  switch (plan.kind) {
    case 'figure':
      return [schema.nodes.figure.create({ src: plan.attrs.src, alt: plan.attrs.alt })];
    case 'embed':
      return [schema.nodes.embed.create({ url: plan.attrs.url, type: plan.attrs.type })];
    case 'component':
      return [schema.nodes.component_leaf.create({ tag: plan.tag, attrs: { ...plan.attrs } })];
    case 'link': {
      const text = schema.text(plan.text, [schema.marks.link.create({ href: plan.href })]);
      return [schema.nodes.paragraph.create(null, text)];
    }
    default:
      throw new Error(`Unknown insert plan: ${plan.kind}`);
  }
}

/**
 * Which files a component attribute's Choose… button offers.
 * @param {string} tag
 * @param {string} attrName
 * @returns {'image'|'pdf'|'all'}
 */
export function pickerKind(tag, attrName) {
  if (attrName === 'poster') return 'image';
  if (attrName === 'src' && tag === 'pdf-viewer') return 'pdf';
  if (attrName === 'src' && tag === 'image-editor') return 'image';
  return 'all';
}

/**
 * Whether the site has the pdf-viewer component on.
 * @param {object|null} componentsResponse api.listComponents()
 */
export function pdfViewerEnabled(componentsResponse) {
  return enabledDescriptors(componentsResponse).some((d) => d.tag === 'pdf-viewer');
}
