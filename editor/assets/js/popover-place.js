/**
 * placePopover — where to put a popover so it stays on screen. Pure: no DOM,
 * no ProseMirror. All coordinates are viewport coordinates.
 *
 * It goes on the preferred side of the anchor when it fits there, else on the
 * other side when it fits there. When it fits neither way it goes on the side
 * with more room and `maxHeight` is the height left (the list scrolls).
 * `left` is clamped to `[margin, viewport.width - size.width - margin]`.
 *
 * @module editor/popover-place
 */

/**
 * @param {{ top: number, bottom: number, left: number, right: number }} anchor
 * @param {{ width: number, height: number }} size
 * @param {{ width: number, height: number }} viewport
 * @param {{ gap?: number, margin?: number, prefer?: 'below'|'above' }} [opts]
 * @returns {{ top: number, left: number, maxHeight: number|null, side: 'below'|'above' }}
 */
export function placePopover(anchor, size, viewport, { gap = 4, margin = 8, prefer = 'below' } = {}) {
  const roomAbove = anchor.top;
  const roomBelow = viewport.height - anchor.bottom;
  const fitsAbove = roomAbove >= size.height + gap;
  const fitsBelow = roomBelow >= size.height + gap;

  let side = prefer;
  if (prefer === 'below' ? !fitsBelow : !fitsAbove) {
    if (prefer === 'below' ? fitsAbove : fitsBelow) {
      side = prefer === 'below' ? 'above' : 'below';
    } else if (roomAbove !== roomBelow) {
      side = roomAbove > roomBelow ? 'above' : 'below';
    }
  }

  const fits = side === 'above' ? fitsAbove : fitsBelow;
  const room = side === 'above' ? roomAbove : roomBelow;
  const maxHeight = fits ? null : Math.max(0, room - gap - margin);
  const height = maxHeight == null ? size.height : Math.min(size.height, maxHeight);
  const top = side === 'above' ? anchor.top - gap - height : anchor.bottom + gap;
  const centeredLeft = anchor.left;
  const left = Math.max(margin, Math.min(centeredLeft, viewport.width - size.width - margin));
  return { top, left, maxHeight, side };
}
