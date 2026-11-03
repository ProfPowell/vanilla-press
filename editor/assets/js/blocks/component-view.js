/**
 * Live web components in the editor.
 *
 * - `ComponentView`: NodeView for `component_leaf` (none/text/code kinds: the
 *   element holds `value` the way the renderer writes it) and
 *   `component_blocks` (the element itself is the contentDOM, so its block
 *   children sit directly inside it, as on the published page).
 * - `InlineComponentView`: NodeView for `component_inline`.
 * - `componentSettingsPlugin()`: shows `<component-settings>` for the
 *   selected component (or the one the cursor is in) and applies its edits.
 * - `setComponentDescriptors(res)`: the `api.listComponents()` response,
 *   loaded once by editor.js; views waiting for it refresh.
 *
 * The real element is rendered and its package's script loaded. When the
 * script fails to load, or the component is not on for this site, a labeled
 * frame says so; the node keeps all its data either way.
 *
 * @module editor/blocks/component-view
 */

import { Plugin, NodeSelection } from 'prosemirror-state';
import { enabledDescriptors } from '../component-model.js';
import {
  loadComponent, createComponentElement, syncAttributes, setComponentValue,
} from '../component-loader.js';

const COMPONENT_TYPES = new Set(['component_leaf', 'component_blocks', 'component_inline']);

// --- Descriptors (shared by every view) ---

/** tag → descriptor, for every catalog package (on or off). */
let allByTag = new Map();
/** Tags of the packages that are on for this site. */
let enabledTags = new Set();
let known = false;
const views = new Set();

/**
 * Store the descriptors and refresh the views already on the page.
 * @param {{ packages?: Array<{ enabled: boolean, elements: object[] }> }} res
 */
export function setComponentDescriptors(res) {
  allByTag = new Map((res?.packages || []).flatMap(p => p.elements || []).map(d => [d.tag, d]));
  enabledTags = new Set(enabledDescriptors(res).map(d => d.tag));
  known = true;
  for (const view of views) view.refresh();
}

/** @returns {object|null} the descriptor for `tag` (on or off) */
export function descriptorFor(tag) {
  return allByTag.get(tag) || null;
}

/** 'pending' until descriptors arrive, then 'on' or 'off'. */
export function componentAvailability(tag) {
  if (!known) return 'pending';
  return enabledTags.has(tag) ? 'on' : 'off';
}

/** A component's display name: its catalog label, else `<tag>`. */
export function componentLabel(tag) {
  return descriptorFor(tag)?.label || `<${tag}>`;
}

const NOTES = {
  failed: (label) => `${label} couldn't load`,
  off: (label) => `${label} is not on for this site`,
};

// --- Node views ---

/**
 * A node the element put in its own light DOM: an element PM didn't draw.
 * Text and <br> are never counted as the element's (typing can make them).
 */
const ownNode = (n) => !n.pmViewDesc && n.nodeType === 1 && n.nodeName !== 'BR';

class BaseComponentView {
  /**
   * @param {import('prosemirror-model').Node} node
   * @param {import('prosemirror-view').EditorView} view
   * @param {() => number|undefined} getPos
   * @param {'leaf'|'blocks'|'inline'} kind
   */
  constructor(node, view, getPos, kind) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.kind = kind;
    this.state = 'loading';

    this.dom = document.createElement(kind === 'inline' ? 'span' : 'div');
    this.dom.className = `pm-component-live pm-component-live-${kind}`;

    // The frame's label: shown only when the element can't be shown live
    this.note = document.createElement('span');
    this.note.className = 'pm-component-note';
    this.note.contentEditable = 'false';

    this.el = createComponentElement(node.attrs.tag, node.attrs.attrs);
    if (kind === 'leaf') {
      this.dom.contentEditable = 'false';
      setComponentValue(this.el, node.attrs.value, node.attrs.wrap);
    } else {
      this.contentDOM = this.el;
    }
    this.dom.append(this.note, this.el);

    views.add(this);
    this.refresh();
  }

  /** Recompute on/off and (when on) load the package's script. */
  refresh() {
    const tag = this.node.attrs.tag;
    const availability = componentAvailability(tag);
    if (availability === 'pending') return this.setState('loading');
    if (availability === 'off') return this.setState('off');
    this.setState('loading');
    loadComponent(descriptorFor(tag)).then((result) => {
      if (views.has(this) && this.node.attrs.tag === tag) this.setState(result);
    });
  }

  /** @param {'loading'|'ready'|'failed'|'off'} state */
  setState(state) {
    this.state = state;
    this.dom.dataset.state = state;
    const note = NOTES[state];
    this.note.textContent = note ? note(componentLabel(this.node.attrs.tag)) : '';
  }

  update(node) {
    if (node.type !== this.node.type || node.attrs.tag !== this.node.attrs.tag) return false;
    syncAttributes(this.el, this.node.attrs.attrs, node.attrs.attrs);
    if (this.kind === 'leaf' && (node.attrs.value !== this.node.attrs.value || node.attrs.wrap !== this.node.attrs.wrap)) {
      setComponentValue(this.el, node.attrs.value, node.attrs.wrap);
    }
    this.node = node;
    if (this.contentDOM) this.keepOwnNodes();
    return true;
  }

  /**
   * Nodes the element adds to its own light DOM (an effect overlay, say) are
   * not PM content, and PM removes them when it redraws the children. Put
   * them back once it has.
   */
  keepOwnNodes() {
    const own = [...this.el.childNodes].filter(ownNode);
    if (!own.length) return;
    queueMicrotask(() => {
      for (const n of own) if (!n.parentNode) this.el.append(n);
    });
  }

  stopEvent(event) {
    // A leaf element's own controls (inputs, buttons) keep their events;
    // mousedown and drags still select and move the node.
    if (this.kind === 'leaf' && this.el.contains(event.target)) {
      return !(event.type === 'mousedown' || event.type.startsWith('drag'));
    }
    return false;
  }

  ignoreMutation(mutation) {
    if (this.kind === 'leaf') return true;
    if (mutation.type === 'selection') return false;
    if (this.note.contains(mutation.target) || mutation.target === this.dom) return true;
    if (mutation.target === this.el) {
      // The element sets its own attributes (state, roles)
      if (mutation.type === 'attributes') return true;
      // ...and adds or removes its own nodes; PM's content nodes have a view desc
      return [...mutation.addedNodes, ...mutation.removedNodes].every(ownNode);
    }
    // Changes inside a node the element added itself
    let child = mutation.target;
    while (child && child.parentNode !== this.el) child = child.parentNode;
    return Boolean(child) && ownNode(child);
  }

  destroy() {
    views.delete(this);
  }
}

export class ComponentView extends BaseComponentView {
  constructor(node, view, getPos) {
    super(node, view, getPos, node.type.name === 'component_blocks' ? 'blocks' : 'leaf');
  }
}

export class InlineComponentView extends BaseComponentView {
  constructor(node, view, getPos) {
    super(node, view, getPos, 'inline');
  }
}

// --- Settings panel wiring ---

/**
 * The selected component node: a node selection on one, else the innermost
 * component the selection is in.
 * @param {import('prosemirror-state').EditorState} state
 * @returns {{ pos: number, node: import('prosemirror-model').Node }|null}
 */
export function selectedComponent(state) {
  const sel = state.selection;
  if (sel instanceof NodeSelection && COMPONENT_TYPES.has(sel.node.type.name)) {
    return { pos: sel.from, node: sel.node };
  }
  const { $from } = sel;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (COMPONENT_TYPES.has(node.type.name)) return { pos: $from.before(depth), node };
  }
  return null;
}

/**
 * Show `<component-settings>` for the selected component; apply its edits
 * with setNodeMarkup (keeping a node selection on the node).
 * @returns {Plugin}
 */
export function componentSettingsPlugin() {
  return new Plugin({
    view(editorView) {
      const panel = () => document.querySelector('component-settings');

      const apply = (patch) => {
        const current = selectedComponent(editorView.state);
        if (!current) return;
        const { state } = editorView;
        const tr = state.tr.setNodeMarkup(current.pos, null, { ...current.node.attrs, ...patch });
        if (state.selection instanceof NodeSelection) tr.setSelection(NodeSelection.create(tr.doc, current.pos));
        editorView.dispatch(tr);
      };

      const sync = (view) => {
        const current = selectedComponent(view.state);
        const el = panel();
        if (!el?.show) return;
        if (!current) return el.hide();
        const { tag } = current.node.attrs;
        el.show({
          key: `${current.pos}:${tag}:${componentAvailability(tag)}`,
          node: current.node,
          descriptor: descriptorFor(tag),
          availability: componentAvailability(tag),
          label: componentLabel(tag),
        }, apply);
      };

      sync(editorView);
      return {
        update: sync,
        destroy() { panel()?.hide?.(); },
      };
    },
  });
}
