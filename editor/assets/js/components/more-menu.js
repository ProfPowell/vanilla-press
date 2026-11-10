/**
 * <more-menu> — the "⋯" button and its menu (light DOM).
 *
 * `setItems([{ id, text, danger?, disabled?, title? }])` fills the menu. A
 * disabled item stays focusable (`aria-disabled`) so its title can say why.
 * Keys: arrows, Home and End move; Escape closes and focuses the button.
 * Choosing an item closes the menu and fires `more-select` with `detail.id`.
 *
 * @module editor/components/more-menu
 */

import { placePopover } from '../popover-place.js';

const DOTS = '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">'
  + '<circle cx="5" cy="12" r="1.75"></circle><circle cx="12" cy="12" r="1.75"></circle>'
  + '<circle cx="19" cy="12" r="1.75"></circle></svg>';

export class MoreMenu extends HTMLElement {
  connectedCallback() {
    if (this.button) return;
    this.classList.add('more-menu');
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.setAttribute('aria-label', 'More actions');
    this.button.setAttribute('aria-haspopup', 'menu');
    this.button.setAttribute('aria-expanded', 'false');
    this.button.innerHTML = DOTS;
    this.menu = document.createElement('div');
    this.menu.setAttribute('role', 'menu');
    this.menu.setAttribute('aria-label', 'More actions');
    this.menu.hidden = true;
    this.append(this.button, this.menu);

    this.button.addEventListener('click', () => (this.menu.hidden ? this.open() : this.close()));
    this.button.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        this.open(e.key === 'ArrowUp' ? -1 : 0);
      }
    });
    this.menu.addEventListener('keydown', (e) => this.onMenuKey(e));
    this.menu.addEventListener('click', (e) => {
      const item = e.target.closest('[role=menuitem]');
      if (!item || item.getAttribute('aria-disabled') === 'true') return;
      this.close(true);
      this.dispatchEvent(new CustomEvent('more-select', { bubbles: true, detail: { id: item.dataset.id } }));
    });
    document.addEventListener('pointerdown', (e) => {
      if (!this.menu.hidden && !this.contains(e.target)) this.close();
    });
    this.addEventListener('focusout', (e) => {
      if (!this.menu.hidden && e.relatedTarget && !this.contains(e.relatedTarget)) this.close();
    });
  }

  /** @param {Array<{ id: string, text: string, danger?: boolean, disabled?: boolean, title?: string }>} items */
  setItems(items) {
    // Rebuilding while open would detach the focused item: remember its place and restore focus
    const focusedAt = this.menu.hidden ? -1 : this.items.indexOf(document.activeElement);
    const nodes = [];
    for (const item of items) {
      if (item.danger && !nodes.some((n) => n.className === 'menu-rule')) {
        const rule = document.createElement('span');
        rule.className = 'menu-rule';
        rule.setAttribute('role', 'separator');
        nodes.push(rule);
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.tabIndex = -1;
      b.dataset.id = item.id;
      b.textContent = item.text;
      if (item.danger) b.classList.add('danger');
      if (item.disabled) b.setAttribute('aria-disabled', 'true');
      if (item.title) b.title = item.title;
      nodes.push(b);
    }
    this.menu.replaceChildren(...nodes);
    if (focusedAt >= 0) this.items[Math.min(focusedAt, this.items.length - 1)]?.focus();
  }

  get items() {
    return [...this.menu.querySelectorAll('[role=menuitem]')];
  }

  /** @param {number} [at] - index to focus; negative counts from the end */
  open(at = 0) {
    const items = this.items;
    if (!items.length) return;
    this.menu.hidden = false;
    this.button.setAttribute('aria-expanded', 'true');
    this.place();
    this.onReflow = (e) => { if (!e || e.target !== this.menu) this.place(); };
    window.addEventListener('scroll', this.onReflow, true);
    window.addEventListener('resize', this.onReflow);
    items.at(at).focus({ preventScroll: true });
  }

  /** Keep the open menu on screen: below the button, flipping above, scrolling when short. */
  place() {
    const a = this.button.getBoundingClientRect();
    const width = this.menu.offsetWidth;
    // Right-align the menu to the button, like the CSS did
    const left = a.right - width;
    const p = placePopover(
      { top: a.top, bottom: a.bottom, left, right: left },
      { width, height: this.menu.scrollHeight + 2 },
      { width: document.documentElement.clientWidth, height: window.innerHeight },
      { gap: 6 },
    );
    this.menu.style.top = `${p.top}px`;
    this.menu.style.left = `${p.left}px`;
    this.menu.style.maxHeight = p.maxHeight == null ? '' : `${p.maxHeight}px`;
  }

  /** @param {boolean} [restoreFocus] */
  close(restoreFocus = false) {
    const wasOpen = !this.menu.hidden;
    this.menu.hidden = true;
    this.button.setAttribute('aria-expanded', 'false');
    if (this.onReflow) {
      window.removeEventListener('scroll', this.onReflow, true);
      window.removeEventListener('resize', this.onReflow);
      this.onReflow = null;
    }
    if ((restoreFocus || wasOpen) && this.menu.contains(document.activeElement)) this.button.focus();
  }

  onMenuKey(e) {
    const items = this.items;
    const i = items.indexOf(document.activeElement);
    const go = (n) => { e.preventDefault(); items[(n + items.length) % items.length]?.focus(); };
    switch (e.key) {
      case 'ArrowDown': return go(i + 1);
      case 'ArrowUp': return go(i - 1);
      case 'Home': return go(0);
      case 'End': return go(items.length - 1);
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        this.close(true);
        return;
      case 'Tab':
        this.close();
        return;
      default:
    }
  }
}

customElements.define('more-menu', MoreMenu);
