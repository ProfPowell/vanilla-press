/**
 * Schema validator for Vanilla Press documents.
 *
 * Validates documents against the content schema, collecting all errors
 * rather than failing on the first one.
 *
 * @module schema/validate
 */

import { SAFE_ID } from '../themes/theme-setting.js';
import { isSafeComponentTag, isSafeAttrName } from './component-names.js';
import { blockTypes, inlineTypes, validMarks, requiredMeta, validStatuses } from './content-schema.js';
import { validCredit } from '../media/credit.js';

const LAYOUT_NAME = /^[a-z0-9][a-z0-9_-]*(\/[a-z0-9_-]+)?$/;
const REGION_NAME = /^[a-z][a-z0-9-]*$/;
const WRAPS = ['text', 'template', 'script'];

/**
 * Validate a document against the content schema.
 *
 * Without `options.components` validation is structural only. With a
 * descriptor index, component nodes are also checked against their descriptors.
 * @param {Object} doc
 * @param {Object} [options]
 * @param {Map<string, import('../components/describe.js').ComponentDescriptor>} [options.components]
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validate(doc, { components } = {}) {
  const errors = [];
  const ctx = { components };

  if (!doc || typeof doc !== 'object') {
    return { valid: false, errors: ['Document must be an object'] };
  }

  // Top-level structure
  if (typeof doc.id !== 'string' || !doc.id) {
    errors.push('Document must have a string "id"');
  }
  if (!doc.meta || typeof doc.meta !== 'object') {
    errors.push('Document must have a "meta" object');
  }
  if (!Array.isArray(doc.blocks)) {
    errors.push('Document must have a "blocks" array');
  }

  // Meta validation
  if (doc.meta && typeof doc.meta === 'object') {
    // A draft may be untitled (title ''); publishing needs a title (plan ruling P1).
    const untitledDraft = doc.meta.title === '' && doc.meta.status === 'draft';
    for (const field of requiredMeta) {
      if (field === 'title' && untitledDraft) continue;
      if (field === 'title' && doc.meta.title === '' && doc.meta.status === 'published') {
        errors.push('a published post needs a title'); // shown as "Not saved: …" in the editor
        continue;
      }
      if (!doc.meta[field]) {
        errors.push(`meta is missing required field "${field}"`);
      }
    }
    if (doc.meta.image !== undefined && doc.meta.image !== null && typeof doc.meta.image !== 'string') {
      errors.push('meta.image must be a string');
    }
    const { theme, themeScope } = doc.meta;
    const hasTheme = theme !== undefined && theme !== null && theme !== '';
    if (hasTheme && !(typeof theme === 'string' && SAFE_ID.test(theme))) {
      errors.push('meta.theme must be a theme id (a-z, 0-9, -)');
    }
    if (themeScope !== undefined && themeScope !== null && themeScope !== '') {
      if (themeScope !== 'page' && themeScope !== 'article') errors.push('meta.themeScope must be "page" or "article"');
      else if (!hasTheme) errors.push('meta.themeScope needs meta.theme');
    }
    const { layout } = doc.meta;
    if (layout !== undefined && layout !== null && layout !== '' && !(typeof layout === 'string' && LAYOUT_NAME.test(layout))) {
      errors.push('meta.layout must be a layout name (a-z, 0-9, -, _, with one optional /child)');
    }
    if (doc.meta.status && !validStatuses.includes(doc.meta.status)) {
      errors.push(`meta.status "${doc.meta.status}" is not valid (expected: ${validStatuses.join(', ')})`);
    }
  }

  // Block validation
  if (Array.isArray(doc.blocks)) {
    for (let i = 0; i < doc.blocks.length; i++) {
      validateBlock(doc.blocks[i], `blocks[${i}]`, errors, ctx);
    }
  }

  // Regions: named lists of body blocks that fill a layout's slots
  if (doc.regions !== undefined && doc.regions !== null) {
    if (typeof doc.regions !== 'object' || Array.isArray(doc.regions)) {
      errors.push('"regions" must be an object of block arrays');
    } else {
      for (const [name, list] of Object.entries(doc.regions)) {
        if (!REGION_NAME.test(name) || name === 'head') {
          errors.push(`regions: "${name}" is not a valid region name (a-z, 0-9, -; not "head")`);
          continue;
        }
        if (!Array.isArray(list)) {
          errors.push(`regions.${name} must be an array of blocks`);
          continue;
        }
        list.forEach((b, i) => validateBlock(b, `regions.${name}[${i}]`, errors, ctx));
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a single block node.
 * @param {Object} block
 * @param {string} path - dot-path for error messages
 * @param {string[]} errors - accumulator
 * @param {{ components?: Map }} ctx
 */
function validateBlock(block, path, errors, ctx) {
  if (!block || typeof block !== 'object') {
    errors.push(`${path}: block must be an object`);
    return;
  }

  const { type } = block;
  if (!type || typeof type !== 'string') {
    errors.push(`${path}: block must have a string "type"`);
    return;
  }

  const def = blockTypes[type];
  if (!def) {
    errors.push(`${path}: unknown block type "${type}"`);
    return;
  }

  if (type === 'component') {
    validateComponent(block, path, errors, ctx, false);
    return;
  }

  // Validate attrs
  if (def.attrs) {
    validateAttrs(block.attrs, def.attrs, path, errors);
  }

  // Leaf blocks
  if (def.leaf) {
    if (block.value !== undefined && typeof block.value !== 'string') {
      errors.push(`${path}: leaf block "${type}" value must be a string`);
    }
    if (block.children && block.children.length > 0) {
      errors.push(`${path}: leaf block "${type}" must not have children`);
    }
    return;
  }

  // A block with optional children (a figure without a caption) may omit them
  if (def.optionalChildren && block.children === undefined) return;

  // Non-leaf blocks must have children
  if (!Array.isArray(block.children)) {
    errors.push(`${path}: block "${type}" must have a "children" array`);
    return;
  }

  // Validate children based on content model
  const model = def.children;

  if (model === 'inline') {
    for (let i = 0; i < block.children.length; i++) {
      validateInline(block.children[i], `${path}.children[${i}]`, errors, ctx);
    }
  } else if (model === 'block') {
    for (let i = 0; i < block.children.length; i++) {
      validateBlock(block.children[i], `${path}.children[${i}]`, errors, ctx);
    }
  } else if (typeof model === 'string') {
    // Specific child type (e.g., 'list_item', 'tab', 'step')
    for (let i = 0; i < block.children.length; i++) {
      const child = block.children[i];
      if (child && child.type !== model) {
        errors.push(`${path}.children[${i}]: expected type "${model}", got "${child.type}"`);
      }
      validateBlock(block.children[i], `${path}.children[${i}]`, errors, ctx);
    }
  } else if (Array.isArray(model)) {
    // Array of allowed child types (e.g., figure allows ['figcaption'])
    for (let i = 0; i < block.children.length; i++) {
      const child = block.children[i];
      if (child && !model.includes(child.type)) {
        errors.push(`${path}.children[${i}]: type "${child.type}" not allowed (expected: ${model.join(', ')})`);
      }
      validateBlock(block.children[i], `${path}.children[${i}]`, errors, ctx);
    }
  }
}

/**
 * Validate an inline node.
 * @param {Object} node
 * @param {string} path
 * @param {string[]} errors
 * @param {{ components?: Map }} ctx
 */
function validateInline(node, path, errors, ctx) {
  if (!node || typeof node !== 'object') {
    errors.push(`${path}: inline node must be an object`);
    return;
  }

  const { type } = node;
  if (!type || typeof type !== 'string') {
    errors.push(`${path}: inline node must have a string "type"`);
    return;
  }

  const def = inlineTypes[type];
  if (!def) {
    errors.push(`${path}: unknown inline type "${type}"`);
    return;
  }

  if (type === 'component') {
    validateComponent(node, path, errors, ctx, true);
    return;
  }

  if (type === 'text') {
    if (typeof node.value !== 'string') {
      errors.push(`${path}: text node must have a string "value"`);
    }
    if (node.marks) {
      if (!Array.isArray(node.marks)) {
        errors.push(`${path}: marks must be an array`);
      } else {
        for (const mark of node.marks) {
          if (!validMarks.includes(mark)) {
            errors.push(`${path}: invalid mark "${mark}" (expected: ${validMarks.join(', ')})`);
          }
        }
      }
    }
  } else if (type === 'link') {
    if (def.attrs) {
      validateAttrs(node.attrs, def.attrs, path, errors);
    }
    if (Array.isArray(node.children)) {
      for (let i = 0; i < node.children.length; i++) {
        validateInline(node.children[i], `${path}.children[${i}]`, errors, ctx);
      }
    }
  } else if (type === 'footnote_ref') {
    if (def.attrs) {
      validateAttrs(node.attrs, def.attrs, path, errors);
    }
  }
}

/**
 * Validate attrs against their definitions.
 * @param {Object|undefined} attrs
 * @param {Object} attrDefs
 * @param {string} path
 * @param {string[]} errors
 */
function validateAttrs(attrs, attrDefs, path, errors) {
  for (const [name, def] of Object.entries(attrDefs)) {
    const value = attrs && attrs[name];

    if (def.required && (value === undefined || value === null)) {
      errors.push(`${path}: missing required attr "${name}"`);
      continue;
    }

    if (value === undefined || value === null) continue;

    // Type check
    if (def.type === 'number' && typeof value !== 'number') {
      errors.push(`${path}: attr "${name}" must be a number`);
    } else if (def.type === 'boolean' && typeof value !== 'boolean') {
      errors.push(`${path}: attr "${name}" must be a boolean`);
    } else if (def.type === 'string' && typeof value !== 'string') {
      errors.push(`${path}: attr "${name}" must be a string`);
    } else if (def.type === 'credit' && !validCredit(value)) {
      errors.push(`${path}: attr "${name}" must be a credit (name, site or license; http(s) links)`);
    }

    // Enum check
    if (def.enum && !def.enum.includes(value)) {
      errors.push(`${path}: attr "${name}" value "${value}" not in allowed values (${def.enum.join(', ')})`);
    }

    // Number range
    if (def.type === 'number' && typeof value === 'number') {
      if (def.min !== undefined && value < def.min) {
        errors.push(`${path}: attr "${name}" must be >= ${def.min}`);
      }
      if (def.max !== undefined && value > def.max) {
        errors.push(`${path}: attr "${name}" must be <= ${def.max}`);
      }
    }
  }
}

/**
 * Validate a generic component node (block or inline).
 * Always checks tag/attr-name safety and value types; with a descriptor index
 * also checks the tag is enabled, placement, declared attrs and content shape.
 * @param {Object} node
 * @param {string} path
 * @param {string[]} errors
 * @param {{ components?: Map }} ctx
 * @param {boolean} inline - true when the node sits in an inline position
 */
function validateComponent(node, path, errors, ctx, inline) {
  const { tag } = node;
  if (!isSafeComponentTag(tag)) {
    errors.push(`${path}: component tag ${JSON.stringify(tag)} is not a valid custom element name`);
    return;
  }

  const attrs = node.attrs === undefined ? {} : node.attrs;
  const attrsOk = attrs && typeof attrs === 'object' && !Array.isArray(attrs);
  if (!attrsOk) {
    errors.push(`${path}: component "${tag}" attrs must be an object`);
  } else {
    for (const [name, value] of Object.entries(attrs)) {
      if (!isSafeAttrName(name)) {
        errors.push(`${path}: component "${tag}" attr name "${name}" is not allowed`);
      } else if (!['string', 'number', 'boolean'].includes(typeof value)) {
        errors.push(`${path}: component "${tag}" attr "${name}" must be a string, number or boolean`);
      }
    }
  }

  if (node.value !== undefined && typeof node.value !== 'string') {
    errors.push(`${path}: component "${tag}" value must be a string`);
  }
  if (node.wrap !== undefined && !WRAPS.includes(node.wrap)) {
    errors.push(`${path}: component "${tag}" wrap must be one of ${WRAPS.join(', ')}`);
  }
  if (node.children !== undefined && !Array.isArray(node.children)) {
    errors.push(`${path}: component "${tag}" children must be an array`);
    return;
  }
  if (inline && !Array.isArray(node.children)) {
    errors.push(`${path}: inline component "${tag}" must have a "children" array`);
  }

  const index = ctx && ctx.components;
  const children = node.children || [];
  const walk = (asInline) => children.forEach((c, i) => {
    const cp = `${path}.children[${i}]`;
    if (asInline) validateInline(c, cp, errors, ctx);
    else validateBlock(c, cp, errors, ctx);
  });

  if (!index) {
    // Structural only: recurse by position.
    walk(inline);
    return;
  }

  const desc = index.get(tag);
  if (!desc) {
    errors.push(`${path}: component "${tag}" is not on for this site`);
    return;
  }

  const kind = desc.kind;
  if (inline && kind !== 'inline') {
    errors.push(`${path}: component "${tag}" (kind ${kind}) cannot be used inline`);
  } else if (!inline && kind === 'inline') {
    errors.push(`${path}: component "${tag}" is inline-only and cannot be used as a block`);
  }

  if (attrsOk) {
    const declared = new Map((desc.attributes || []).map(a => [a.name, a]));
    for (const [name, value] of Object.entries(attrs)) {
      const def = declared.get(name);
      if (!def) {
        if (isSafeAttrName(name)) {
          errors.push(`${path}: component "${tag}" has no attr "${name}"`);
        }
        continue;
      }
      if (typeof value !== def.type) {
        errors.push(`${path}: component "${tag}" attr "${name}" must be a ${def.type}`);
      } else if (def.enum && !def.enum.includes(value)) {
        errors.push(`${path}: component "${tag}" attr "${name}" value "${value}" not in allowed values (${def.enum.join(', ')})`);
      }
    }
  }

  const hasValue = node.value !== undefined;
  const hasChildren = children.length > 0;
  if (kind === 'none') {
    if (hasValue || hasChildren) errors.push(`${path}: component "${tag}" takes no content`);
  } else if (kind === 'text' || kind === 'code') {
    if (typeof node.value !== 'string') errors.push(`${path}: component "${tag}" (${kind}) must have a string "value"`);
    if (hasChildren) errors.push(`${path}: component "${tag}" (${kind}) must not have children`);
  } else if (kind === 'blocks') {
    if (hasValue) errors.push(`${path}: component "${tag}" (blocks) must not have a value`);
    if (!Array.isArray(node.children)) errors.push(`${path}: component "${tag}" (blocks) must have a "children" array`);
    else walk(false);
  } else if (kind === 'inline') {
    if (hasValue) errors.push(`${path}: component "${tag}" (inline) must not have a value`);
    walk(true);
  }
}
