/**
 * Component normalization: drop attrs a component does not declare, and
 * coerce values to the declared type where that is lossless.
 *
 * @module components/normalize
 */

/**
 * `value` as the declared `type`, or `undefined` to leave the attribute out.
 * Values that cannot be coerced come back unchanged for `validate` to report.
 * A string attribute takes numbers and `true` as their text; `false` (which
 * renders as no attribute) leaves it out. Number and boolean attributes take
 * their text forms ("60", "true", "false").
 * @param {'string'|'number'|'boolean'|undefined} type
 * @param {unknown} value
 * @returns {unknown}
 */
export function coerceAttr(type, value) {
  if (type === 'string') {
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (value === true) return 'true';
    if (value === false) return undefined;
    return value;
  }
  if (type === 'number' && typeof value === 'string' && value.trim() !== '') {
    const n = Number(value.trim());
    return Number.isFinite(n) ? n : value;
  }
  if (type === 'boolean' && typeof value === 'string') {
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  return value;
}

/**
 * Return a copy of `doc` with undeclared component attrs removed (reported in
 * `dropped`) and declared ones coerced to their type (see `coerceAttr`; not reported).
 * Tags missing from the index are left untouched for `validate` to report.
 * @param {Object} doc
 * @param {Map<string, import('./describe.js').ComponentDescriptor>} components
 * @returns {{ doc: Object, dropped: Array<{ path: string, tag: string, attr: string }> }}
 */
export function normalizeComponents(doc, components) {
  const dropped = [];
  const out = structuredClone(doc);

  const visit = (node, path) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'component') {
      const desc = components.get(node.tag);
      if (desc && node.attrs && typeof node.attrs === 'object') {
        const declared = new Map((desc.attributes || []).map(a => [a.name, a]));
        for (const name of Object.keys(node.attrs)) {
          const def = declared.get(name);
          if (!def) {
            delete node.attrs[name];
            dropped.push({ path, tag: node.tag, attr: name });
            continue;
          }
          const value = coerceAttr(def.type, node.attrs[name]);
          if (value === undefined) delete node.attrs[name];
          else node.attrs[name] = value;
        }
      }
    }
    if (Array.isArray(node.children)) {
      node.children.forEach((c, i) => visit(c, `${path}.children[${i}]`));
    }
  };

  if (Array.isArray(out.blocks)) out.blocks.forEach((b, i) => visit(b, `blocks[${i}]`));
  return { doc: out, dropped };
}
