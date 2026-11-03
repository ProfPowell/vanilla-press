/**
 * Component normalization: drop attrs a component does not declare.
 *
 * @module components/normalize
 */

/**
 * Return a copy of `doc` with undeclared component attrs removed.
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
        const declared = new Set((desc.attributes || []).map(a => a.name));
        for (const name of Object.keys(node.attrs)) {
          if (!declared.has(name)) {
            delete node.attrs[name];
            dropped.push({ path, tag: node.tag, attr: name });
          }
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
