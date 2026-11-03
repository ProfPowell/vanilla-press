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
