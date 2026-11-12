/**
 * Block-list helpers shared by everything that walks a document's blocks.
 *
 * @module schema/blocks
 */

/**
 * Every list of body blocks in a document: the main `blocks`, then each
 * region's blocks (`doc.regions`, a name -> Block[] map). Walkers use this so
 * a region is never missed.
 * @param {{ blocks?: Object[], regions?: Record<string, Object[]> }} doc
 * @returns {Object[][]}
 */
export function allBlockLists(doc) {
  const regions = doc && doc.regions && typeof doc.regions === 'object' && !Array.isArray(doc.regions)
    ? Object.values(doc.regions)
    : [];
  return [doc && doc.blocks, ...regions].filter(Array.isArray);
}
