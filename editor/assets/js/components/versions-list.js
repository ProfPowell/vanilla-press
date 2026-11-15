/**
 * <versions-list> — the recent versions of a post kept in this browser
 * (Post settings › Versions). One row per version, newest first: when it was
 * kept, a label for a copy that was never saved ("Unsaved copy") or was
 * discarded ("Discarded copy"), Look (how it differs from the post now, shown
 * inline) and Restore.
 *
 * `render(versions, { onLook, onRestore, canRestore, now })`
 * - onLook(version) → string[] of plain difference lines
 * - onRestore(version) — the caller puts it in the editor (undoable) and saves
 * - canRestore() → false disables Restore (another tab is editing)
 * All text is set with textContent.
 *
 * @module editor/components/versions-list
 */

import { relativeTime } from './save-bar.js';

const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children);
  return node;
};

export class VersionsList extends HTMLElement {
  /**
   * @param {object[]} versions newest first
   * @param {{ onLook?: Function, onRestore?: Function, canRestore?: () => boolean, now?: number }} [handlers]
   */
  render(versions, { onLook, onRestore, canRestore, now } = {}) {
    this.replaceChildren();
    if (!versions?.length) {
      this.append(el('p', { class: 'meta-note' }, 'No earlier versions in this browser yet'));
      return;
    }
    const ul = el('ul', { class: 'versions' });
    for (const version of versions) {
      const li = el('li', { class: 'version' });
      const label = version.discarded ? 'Discarded copy' : version.offered ? 'Unsaved copy' : '';
      li.append(el('span', { class: 'version-when' }, relativeTime(version.at, now)));
      if (label) li.append(' ', el('span', { class: 'version-label' }, label));
      const look = el('button', { type: 'button', class: 'btn', 'aria-expanded': 'false' }, 'Look');
      const restore = el('button', { type: 'button', class: 'btn' }, 'Restore');
      const locked = canRestore ? !canRestore() : false;
      if (locked) restore.disabled = true;
      look.addEventListener('click', () => {
        const open = li.querySelector('[data-differences]');
        if (open) {
          open.remove();
          look.setAttribute('aria-expanded', 'false');
          return;
        }
        const lines = onLook?.(version) || [];
        const box = lines.length
          ? el('ul', { 'data-differences': '' }, ...lines.map((t) => el('li', {}, t)))
          : el('p', { 'data-differences': '', class: 'meta-note' }, 'Same as the post now');
        li.append(box);
        look.setAttribute('aria-expanded', 'true');
      });
      restore.addEventListener('click', () => {
        if (restore.disabled) return;
        onRestore?.(version);
      });
      li.append(' ', look, ' ', restore);
      ul.append(li);
    }
    this.append(ul);
  }
}

if (!customElements.get('versions-list')) customElements.define('versions-list', VersionsList);
