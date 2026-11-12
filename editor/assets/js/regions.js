/**
 * Layout regions in the editor: the labelled block areas after the body,
 * one per slot the document's layout offers, plus stored regions the layout
 * does not show (kept with a note, never deleted: switching layouts back
 * and forth loses nothing).
 *
 * Pure: imports only prosemirror-state and the AST helpers, so it runs in
 * Node tests.
 *
 * @module editor/regions
 */

import { Plugin } from 'prosemirror-state';
import { regionNode } from './ast.js';

/** Transaction meta: this change rebuilds the regions (a layout change); the guard lets it through. */
export const REGIONS_META = 'vp-regions';

/**
 * The region areas for a layout: its slots first (shown, labelled by the
 * slot's label or name), then stored regions it does not offer (`shown`
 * false), only when they hold something.
 * @param {Array<{ name: string, label?: string }>|undefined} available - the layout's slots
 * @param {Record<string, Object[]>|undefined} stored - the document's regions
 * @returns {Array<{ name: string, label: string, shown: boolean, blocks: Object[] }>}
 */
export function regionPlan(available, stored) {
  const slots = Array.isArray(available) ? available : [];
  const regions = stored && typeof stored === 'object' ? stored : {};
  const plan = slots.map(({ name, label }) => ({
    name, label: label || name, shown: true, blocks: regions[name] || [],
  }));
  const offered = new Set(slots.map((s) => s.name));
  for (const [name, blocks] of Object.entries(regions)) {
    if (offered.has(name) || !Array.isArray(blocks) || blocks.length === 0) continue;
    plan.push({ name, label: name, shown: false, blocks });
  }
  return plan;
}

/**
 * The stored regions shown as they are, when the layout's slots are not
 * known (the layouts listing failed): every non-empty region, shown, no note.
 * @param {Record<string, Object[]>|undefined} stored
 */
export function storedRegionPlan(stored) {
  return regionPlan([], stored).map((r) => ({ ...r, shown: true }));
}

/**
 * The names of the doc's regions, in order.
 * @param {import('prosemirror-model').Node} doc
 * @returns {string[]}
 */
export function regionNames(doc) {
  const names = [];
  doc.forEach((child) => { if (child.type.name === 'region') names.push(child.attrs.name); });
  return names;
}

/**
 * Keeps the regions a writer cannot add, remove or reorder: any
 * transaction that changes the sequence of region names is dropped, unless
 * it carries `vp-regions` (applyRegionPlan). Typing, pasting and moving
 * blocks inside a region go through.
 * @returns {Plugin}
 */
export function regionGuard() {
  return new Plugin({
    filterTransaction(tr, state) {
      if (!tr.docChanged || tr.getMeta(REGIONS_META)) return true;
      const before = regionNames(state.doc);
      const after = regionNames(tr.doc);
      return before.length === after.length && before.every((name, i) => name === after[i]);
    },
  });
}

/**
 * Rebuild the region areas for `plan` in one `vp-regions` transaction (not
 * an undo step). A region already in the doc keeps its content (only its
 * label and `shown` follow the plan); a new one takes the plan's blocks.
 * Regions not in the plan go. The body is never touched.
 * @param {{ state: import('prosemirror-state').EditorState, dispatch: Function }} view
 * @param {Array<{ name: string, label: string, shown: boolean, blocks: Object[] }>} plan
 * @returns {boolean} whether anything changed
 */
export function applyRegionPlan(view, plan) {
  const { state } = view;
  const { doc, schema } = state;
  const existing = [];
  let start = null;
  doc.forEach((child, offset) => {
    if (child.type.name !== 'region') return;
    if (start == null) start = offset;
    existing.push({ node: child, pos: offset });
  });
  if (start == null) start = doc.content.size;

  const byName = new Map(existing.map((r) => [r.node.attrs.name, r.node]));
  const attrsOf = (r) => ({ name: r.name, label: r.label || r.name, shown: r.shown !== false });
  const tr = state.tr;

  // Regions that stay in place keep their nodes (and the cursor in them): only attrs change
  let same = 0;
  while (same < existing.length && same < plan.length && existing[same].node.attrs.name === plan[same].name) same++;
  for (let i = 0; i < same; i++) {
    const { node, pos } = existing[i];
    const attrs = attrsOf(plan[i]);
    if (node.attrs.label !== attrs.label || node.attrs.shown !== attrs.shown) tr.setNodeMarkup(pos, null, attrs);
  }
  // From the first difference on, the tail is rebuilt (kept regions keep their content)
  if (same < existing.length || same < plan.length) {
    const from = same < existing.length ? existing[same].pos : doc.content.size;
    const nodes = plan.slice(same).map((r) => {
      const kept = byName.get(r.name);
      return kept ? schema.nodes.region.create(attrsOf(r), kept.content) : regionNode(schema, attrsOf(r), r.blocks);
    });
    tr.replaceWith(from, doc.content.size, nodes);
  }
  if (!tr.docChanged) return false;
  view.dispatch(tr.setMeta(REGIONS_META, true).setMeta('addToHistory', false));
  return true;
}
