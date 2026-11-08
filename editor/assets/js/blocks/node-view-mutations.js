/**
 * Which DOM mutations a node view keeps from ProseMirror.
 *
 * A node view owns its outer element's attributes (it sets them in update())
 * and its controls (title fields, selects). Page scripts also touch the outer
 * element: Vanilla Breeze's theme sync sets `theme` on every <code-block>
 * added to the page. Reporting those to ProseMirror makes it redraw the node,
 * the redrawn element gets touched again, and the editor loops forever.
 *
 * @module editor/blocks/node-view-mutations
 */

/**
 * Whether a mutation belongs to the node view's chrome (its controls, or an
 * attribute of its outer element) rather than to the content ProseMirror
 * manages. Selection changes always go to ProseMirror.
 * @param {MutationRecord | { type: string, target: Node, attributeName?: string }} mutation
 * @param {Node} dom the node view's outer element
 * @param {Node} chrome the element holding the view's controls
 */
export function isChromeMutation(mutation, dom, chrome) {
  if (mutation.type === 'selection') return false;
  if (chrome.contains(mutation.target)) return true;
  return mutation.type === 'attributes' && mutation.target === dom;
}
