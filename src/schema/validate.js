/**
 * Schema validator for Vanilla Press documents.
 *
 * Validates documents against the content schema, collecting all errors
 * rather than failing on the first one.
 *
 * @module schema/validate
 */

import { blockTypes, inlineTypes, validMarks, requiredMeta, validStatuses } from './content-schema.js';

/**
 * Validate a document against the content schema.
 * @param {Object} doc
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validate(doc) {
  const errors = [];

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
    for (const field of requiredMeta) {
      if (!doc.meta[field]) {
        errors.push(`meta is missing required field "${field}"`);
      }
    }
    if (doc.meta.status && !validStatuses.includes(doc.meta.status)) {
      errors.push(`meta.status "${doc.meta.status}" is not valid (expected: ${validStatuses.join(', ')})`);
    }
  }

  // Block validation
  if (Array.isArray(doc.blocks)) {
    for (let i = 0; i < doc.blocks.length; i++) {
      validateBlock(doc.blocks[i], `blocks[${i}]`, errors);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a single block node.
 * @param {Object} block
 * @param {string} path - dot-path for error messages
 * @param {string[]} errors - accumulator
 */
function validateBlock(block, path, errors) {
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

  // Non-leaf blocks must have children
  if (!Array.isArray(block.children)) {
    errors.push(`${path}: block "${type}" must have a "children" array`);
    return;
  }

  // Validate children based on content model
  const model = def.children;

  if (model === 'inline') {
    for (let i = 0; i < block.children.length; i++) {
      validateInline(block.children[i], `${path}.children[${i}]`, errors);
    }
  } else if (model === 'block') {
    for (let i = 0; i < block.children.length; i++) {
      validateBlock(block.children[i], `${path}.children[${i}]`, errors);
    }
  } else if (typeof model === 'string') {
    // Specific child type (e.g., 'list_item', 'tab', 'step')
    for (let i = 0; i < block.children.length; i++) {
      const child = block.children[i];
      if (child && child.type !== model) {
        errors.push(`${path}.children[${i}]: expected type "${model}", got "${child.type}"`);
      }
      validateBlock(block.children[i], `${path}.children[${i}]`, errors);
    }
  } else if (Array.isArray(model)) {
    // Array of allowed child types (e.g., figure allows ['figcaption'])
    for (let i = 0; i < block.children.length; i++) {
      const child = block.children[i];
      if (child && !model.includes(child.type)) {
        errors.push(`${path}.children[${i}]: type "${child.type}" not allowed (expected: ${model.join(', ')})`);
      }
      validateBlock(block.children[i], `${path}.children[${i}]`, errors);
    }
  }
}

/**
 * Validate an inline node.
 * @param {Object} node
 * @param {string} path
 * @param {string[]} errors
 */
function validateInline(node, path, errors) {
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
        validateInline(node.children[i], `${path}.children[${i}]`, errors);
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
