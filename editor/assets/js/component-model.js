/**
 * Editor content model for web components: pure helpers that turn component
 * descriptors (from `api.listComponents()`) into ProseMirror node types,
 * initial node attrs, settings-form fields and palette entries.
 * No ProseMirror imports and no DOM: tested in Node.
 *
 * @module editor/component-model
 */

/** @typedef {import('../../../src/components/describe.js').ComponentDescriptor} ComponentDescriptor */
/** @typedef {import('../../../src/components/manifest.js').AttrDef} AttrDef */

import { blockTypes } from '../../../src/schema/content-schema.js';

/** Attribute names whose values are URLs: text inputs with `inputmode="url"`. */
const URL_NAMES = new Set(['src', 'url', 'href', 'poster']);

/**
 * The elements of the enabled packages in an `api.listComponents()` response.
 * @param {{ packages?: Array<{ enabled: boolean, elements: ComponentDescriptor[] }> }|null} res
 * @returns {ComponentDescriptor[]}
 */
export function enabledDescriptors(res) {
  const packages = Array.isArray(res?.packages) ? res.packages : [];
  return packages.filter(p => p.enabled).flatMap(p => p.elements || []);
}

/**
 * The ProseMirror node type a component is edited as.
 * @param {ComponentDescriptor} descriptor
 * @returns {'component_leaf'|'component_blocks'|'component_inline'}
 */
export function nodeTypeFor(descriptor) {
  if (descriptor.kind === 'inline') return 'component_inline';
  if (descriptor.kind === 'blocks') return 'component_blocks';
  return 'component_leaf';
}

/**
 * Attrs for a newly inserted node. `value` only for kinds that hold one
 * (text, code); `wrap` only for code. A `none` leaf has neither, so its
 * node keeps the schema's null defaults and the AST carries no `value`.
 * @param {ComponentDescriptor} descriptor
 * @returns {{ tag: string, attrs: Record<string, string|number|boolean>, value?: string, wrap?: string }}
 */
export function initialAttrs(descriptor) {
  const out = { tag: descriptor.tag, attrs: { ...(descriptor.defaults || {}) } };
  if (descriptor.kind === 'text' || descriptor.kind === 'code') out.value = '';
  if (descriptor.kind === 'code') out.wrap = descriptor.codeWrap;
  return out;
}

/** 'video-id' → 'Video id' */
function labelFor(name) {
  const words = name.replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Settings-form fields, one per declared attribute, in declaration order.
 * @param {ComponentDescriptor} descriptor
 * @returns {Array<{ name: string, label: string, control: 'text'|'number'|'checkbox'|'select',
 *   options?: string[], advanced: boolean, description?: string, inputmode?: 'url' }>}
 */
export function formFields(descriptor) {
  const advanced = new Set(descriptor.advanced || []);
  return (descriptor.attributes || []).map(attr => {
    let control = 'text';
    if (attr.type === 'boolean') control = 'checkbox';
    else if (attr.type === 'number') control = 'number';
    else if (Array.isArray(attr.enum) && attr.enum.length) control = 'select';

    const field = { name: attr.name, label: labelFor(attr.name), control, advanced: advanced.has(attr.name) };
    if (control === 'select') field.options = [...attr.enum];
    if (control === 'text' && URL_NAMES.has(attr.name)) field.inputmode = 'url';
    if (attr.description) field.description = attr.description;
    return field;
  });
}

/** The attribute type a value implies. */
const typeOf = (v) => (typeof v === 'boolean' ? 'boolean' : typeof v === 'number' ? 'number' : 'string');

/**
 * The settings panel's fields: `formFields` (declared attributes) plus a
 * field for each undeclared name in the catalog defaults, the node's own
 * attrs and the catalog's advanced list (some packages ship no manifest),
 * typed by its value. Each field carries the `attrDef` to `coerce` with.
 * @param {ComponentDescriptor} descriptor
 * @param {Record<string, string|number|boolean>} nodeAttrs
 * @returns {Array<ReturnType<typeof formFields>[number] & { attrDef: AttrDef }>}
 */
export function settingsFields(descriptor, nodeAttrs) {
  const declared = new Map((descriptor.attributes || []).map(a => [a.name, a]));
  const fields = formFields(descriptor).map(f => ({ ...f, attrDef: declared.get(f.name) }));
  const advanced = new Set(descriptor.advanced || []);
  const values = { ...(descriptor.defaults || {}), ...(nodeAttrs || {}) };
  const extra = [...new Set([...Object.keys(values), ...advanced])].filter(name => !declared.has(name));
  const synth = extra.map(name => {
    const attrDef = { name, type: typeOf(values[name]) };
    const [field] = formFields({ attributes: [attrDef], advanced: [...advanced] });
    return { ...field, attrDef };
  });
  // Basic fields first, as declared; advanced after
  return [...fields, ...synth.filter(f => !f.advanced), ...synth.filter(f => f.advanced)];
}

/**
 * A form value as an AST attr value. `''` (and anything unparseable or
 * outside the enum) is undefined, meaning "leave the attribute out".
 * @param {AttrDef} attrDef
 * @param {string|boolean} raw
 * @returns {string|number|boolean|undefined}
 */
export function coerce(attrDef, raw) {
  if (raw === '' || raw === undefined || raw === null) return undefined;
  if (attrDef.type === 'boolean') {
    if (typeof raw === 'boolean') return raw;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return undefined;
  }
  if (attrDef.type === 'number') {
    const text = String(raw).trim();
    if (text === '') return undefined;
    const n = Number(text);
    return Number.isFinite(n) ? n : undefined;
  }
  const value = String(raw);
  if (Array.isArray(attrDef.enum) && attrDef.enum.length && !attrDef.enum.includes(value)) return undefined;
  return value;
}

/**
 * Slash-palette entries for the block-level components (inline kinds are
 * offered by the toolbar's wrap select instead), sorted by group then label.
 * @param {ComponentDescriptor[]} descriptors
 * @returns {Array<{ id: string, label: string, description: string, icon: string, category: string, tag: string }>}
 */
export function paletteEntries(descriptors) {
  return descriptors
    .filter(desc => desc.kind !== 'inline')
    .map(desc => ({
      id: `component:${desc.tag}`,
      label: desc.label || desc.tag,
      description: desc.description || '',
      icon: desc.icon || '',
      category: desc.group || 'Components',
      tag: desc.tag,
    }))
    .sort((a, b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label));
}

/** Block types whose children are inline nodes. */
const INLINE_PARENTS = new Set(Object.entries(blockTypes)
  .filter(([, def]) => def.children === 'inline').map(([name]) => name));

/**
 * Paths of nodes in a block AST that the editor cannot hold as written, so
 * saving after loading would change them. The editor refuses to auto-save
 * such a post rather than drop content silently. Covers:
 * - a block component with a `children` array that is empty, or that also
 *   has `value` or `wrap` (it becomes a component_blocks node);
 * - an inline component with `value` or `wrap` (component_inline has neither);
 * - a link inside a link (PM links are marks; one link per run of content).
 * @param {Object[]} blocks
 * @returns {string[]}
 */
export function unrepresentable(blocks) {
  const found = [];

  const walk = (node, path, { inline, inLink }) => {
    if (!node || typeof node !== 'object') return;
    let childCtx = { inline: INLINE_PARENTS.has(node.type), inLink: false };

    if (node.type === 'link') {
      if (inLink) found.push(path);
      childCtx = { inline: true, inLink: true };
    } else if (node.type === 'component' && inline) {
      if (node.value !== undefined || node.wrap !== undefined) found.push(path);
      childCtx = { inline: true, inLink: false };
    } else if (node.type === 'component' && Array.isArray(node.children)) {
      if (node.children.length === 0 || node.value !== undefined || node.wrap !== undefined) found.push(path);
      childCtx = { inline: false, inLink: false };
    }

    if (Array.isArray(node.children)) {
      node.children.forEach((c, i) => walk(c, `${path}.children[${i}]`, childCtx));
    }
  };

  (blocks || []).forEach((b, i) => walk(b, `blocks[${i}]`, { inline: false, inLink: false }));
  return found;
}
