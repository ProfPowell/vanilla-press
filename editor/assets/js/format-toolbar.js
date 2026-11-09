/**
 * The floating format toolbar: appears over a non-empty text selection
 * (never in the title) with Bold, Italic, Code, Highlight, Link and a More
 * menu. Alt+F10 moves focus into it; Escape returns to the editor with the
 * selection kept.
 *
 * @module editor/format-toolbar
 */

import { Plugin, TextSelection } from 'prosemirror-state';
import { formatItems, wrapInComponent, linkHref, setLink, removeLink } from './menu.js';
import { initialAttrs } from './component-model.js';
import { normalizeLinkUrl } from './link-url.js';

export { normalizeLinkUrl };

/**
 * Where to put a toolbar of `size` for a selection `sel` (all viewport coordinates).
 * Above the selection when it fits, else below; centered, kept inside the viewport.
 * @param {{ top: number, bottom: number, left: number, right: number }} sel
 * @param {{ width: number, height: number }} size
 * @param {{ width: number, height: number }} viewport
 * @param {number} [gap]
 * @returns {{ top: number, left: number, placement: 'above'|'below' }}
 */
export function toolbarPosition(sel, size, viewport, gap = 8) {
  const above = sel.top - size.height - gap >= 0;
  const top = above ? sel.top - size.height - gap : sel.bottom + gap;
  const centered = (sel.left + sel.right) / 2 - size.width / 2;
  const left = Math.max(gap, Math.min(centered, viewport.width - size.width - gap));
  return { top, left, placement: above ? 'above' : 'below' };
}

/**
 * The index to focus after `key` in a row of `count` controls, or null when
 * the key is not a navigation key.
 * @param {number} index
 * @param {number} count
 * @param {string} key
 * @returns {number|null}
 */
export function toolbarKeyNav(index, count, key) {
  switch (key) {
    case 'ArrowRight': return (index + 1) % count;
    case 'ArrowLeft': return (index - 1 + count) % count;
    case 'Home': return 0;
    case 'End': return count - 1;
    default: return null;
  }
}

const svg = (paths) => '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" '
  + 'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + paths + '</svg>';

/** Button faces: text for B, i and code (styled in CSS), icons for the rest. */
const ICONS = {
  highlight: svg('<path d="m9 11-6 6v3h9l3-3"></path><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"></path>'),
  link: svg('<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"></path><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"></path>'),
};

let inlineComponents = [];
let refreshMenu = null;

/**
 * Offer these inline components under More as "Wrap in <label>".
 * @param {Array} descriptors - enabled descriptors of kind 'inline'
 */
export function setFormatToolbarComponents(descriptors) {
  inlineComponents = descriptors;
  refreshMenu?.();
}

/** The selection is a non-empty text selection whose ends are both outside the title. */
function showsToolbar(state) {
  const sel = state.selection;
  if (sel.empty || !(sel instanceof TextSelection)) return false;
  return [sel.$from, sel.$to].every(($p) => $p.parent.type.name !== 'title' && !$p.parent.type.spec.code);
}

class FormatToolbarView {
  constructor(view) {
    this.view = view;
    const { primary, more } = formatItems();
    this.primary = primary;
    this.more = more;

    this.el = document.createElement('div');
    this.el.className = 'format-toolbar';
    this.el.setAttribute('role', 'toolbar');
    this.el.setAttribute('aria-label', 'Format selection');
    this.el.hidden = true;

    this.buttons = primary.map((item) => this.buildButton(item));
    const rule = document.createElement('span');
    rule.className = 'format-toolbar-rule';
    rule.setAttribute('aria-hidden', 'true');

    this.moreButton = document.createElement('button');
    this.moreButton.type = 'button';
    this.moreButton.className = 'format-toolbar-more';
    this.moreButton.textContent = 'More';
    this.moreButton.setAttribute('aria-label', 'More formatting');
    this.moreButton.setAttribute('aria-haspopup', 'menu');
    this.moreButton.setAttribute('aria-expanded', 'false');
    this.menu = document.createElement('div');
    this.menu.className = 'format-toolbar-menu';
    this.menu.setAttribute('role', 'menu');
    this.menu.setAttribute('aria-label', 'More formatting');
    this.menu.hidden = true;
    this.moreWrap = document.createElement('div');
    this.moreWrap.className = 'format-toolbar-more-wrap';
    this.moreWrap.append(this.moreButton, this.menu);

    this.buildLinkForm();
    this.chrome = [...this.buttons, rule, this.moreWrap];
    this.el.append(...this.chrome, this.linkForm);
    document.body.append(this.el);
    this.controls = [...this.buttons, this.moreButton];
    for (const c of this.controls) c.tabIndex = -1;

    this.bind();
    refreshMenu = () => this.renderMenu();
    this.renderMenu();
    this.update(view);
  }

  buildLinkForm() {
    const form = document.createElement('form');
    form.className = 'format-toolbar-link';
    form.hidden = true;
    form.noValidate = true;
    this.linkInput = document.createElement('input');
    this.linkInput.type = 'text';
    this.linkInput.inputMode = 'url';
    this.linkInput.autocomplete = 'off';
    this.linkInput.placeholder = 'https://';
    this.linkInput.setAttribute('aria-label', 'Link address');
    this.linkInput.setAttribute('aria-describedby', 'format-toolbar-link-error');
    this.linkError = document.createElement('span');
    this.linkError.id = 'format-toolbar-link-error';
    this.linkError.className = 'format-toolbar-link-error';
    this.linkError.setAttribute('role', 'alert');
    const apply = document.createElement('button');
    apply.type = 'submit';
    apply.textContent = 'Apply';
    this.linkRemove = document.createElement('button');
    this.linkRemove.type = 'button';
    this.linkRemove.textContent = 'Remove';
    this.linkRemove.addEventListener('click', () => {
      removeLink(this.view.state, this.view.dispatch);
      this.closeLink();
    });
    this.linkInput.addEventListener('input', () => this.setLinkError(''));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const raw = this.linkInput.value;
      const href = normalizeLinkUrl(raw);
      if (!href) {
        this.setLinkError(raw.trim() ? 'Enter a web address, path or email link' : 'Enter an address');
        return;
      }
      setLink(href)(this.view.state, this.view.dispatch);
      this.closeLink();
    });
    form.append(this.linkInput, apply, this.linkRemove, this.linkError);
    this.linkForm = form;
  }

  setLinkError(text) {
    this.linkError.textContent = text;
    this.linkInput.setAttribute('aria-invalid', text ? 'true' : 'false');
  }

  /** Swap the buttons for the link address field, prefilled when the selection is a link. */
  openLink() {
    if (this.el.hidden) return false;
    this.closeMenu();
    const href = linkHref(this.view.state);
    this.linkInput.value = href;
    this.linkRemove.hidden = !href;
    this.setLinkError('');
    for (const c of this.chrome) c.hidden = true;
    this.linkForm.hidden = false;
    this.place();
    this.linkInput.focus();
    this.linkInput.select();
    return true;
  }

  /** Back to the buttons; focus returns to the editor with its selection. */
  closeLink() {
    this.view.focus();
    this.linkForm.hidden = true;
    for (const c of this.chrome) c.hidden = false;
    this.update(this.view);
  }

  buildButton(item) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.id = item.id;
    btn.setAttribute('aria-label', item.title.replace(/ \(.*\)$/, ''));
    btn.title = item.title;
    btn.setAttribute('aria-pressed', 'false');
    if (ICONS[item.id]) btn.innerHTML = ICONS[item.id];
    else btn.textContent = item.label;
    btn.addEventListener('click', () => (item.id === 'link' ? this.openLink() : this.run(item)));
    return btn;
  }

  bind() {
    // Mouse use never takes focus from the editor, so the selection stays
    this.el.addEventListener('mousedown', (e) => {
      if (!e.target.closest('input')) e.preventDefault();
    });
    this.el.addEventListener('keydown', (e) => this.onKey(e));
    this.el.addEventListener('focusout', (e) => {
      const next = e.relatedTarget;
      if (!next || (!this.el.contains(next) && !this.view.dom.contains(next))) this.hide();
      else if (!this.el.contains(next)) this.closeMenu();
    });
    this.view.dom.addEventListener('blur', (e) => {
      if (!e.relatedTarget || !this.el.contains(e.relatedTarget)) this.hide();
    });
    this.moreButton.addEventListener('click', () => (this.menu.hidden ? this.openMenu() : this.closeMenu()));
    this.menu.addEventListener('keydown', (e) => this.onMenuKey(e));
    this.menu.addEventListener('click', (e) => {
      const entry = e.target.closest('[role^=menuitem]');
      if (!entry || entry.getAttribute('aria-disabled') === 'true') return;
      this.closeMenu();
      this.runMenuEntry(entry);
    });
    this.onScroll = () => { if (!this.el.hidden) this.place(); };
    window.addEventListener('scroll', this.onScroll, true);
    window.addEventListener('resize', this.onScroll);
  }

  run(item) {
    item.command(this.view.state, this.view.dispatch, this.view);
    this.view.focus();
  }

  runMenuEntry(entry) {
    const id = entry.dataset.id;
    if (id.startsWith('wrap:')) {
      const desc = inlineComponents.find((d) => d.tag === id.slice(5));
      if (desc) {
        const { tag, attrs } = initialAttrs(desc);
        wrapInComponent({ tag, attrs })(this.view.state, this.view.dispatch);
      }
      this.view.focus();
      return;
    }
    this.run(this.more.find((i) => i.id === id));
  }

  /** Menu entries: the More items, with "Wrap in component" expanded to one per inline component. */
  menuEntries() {
    return this.more.flatMap((item) => {
      if (item.id !== 'wrap') return [{ id: item.id, text: item.label, title: item.title, item }];
      return inlineComponents.map((d) => ({
        id: `wrap:${d.tag}`, text: `Wrap in ${d.label || d.tag}`, title: item.title,
        item: { command: (state) => wrapInComponent({ tag: '', attrs: {} })(state) },
      }));
    });
  }

  renderMenu() {
    const entries = this.menuEntries();
    const focused = this.menu.hidden ? -1 : this.menuItems().indexOf(document.activeElement);
    this.menu.replaceChildren(...entries.map((e) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', e.item.active ? 'menuitemcheckbox' : 'menuitem');
      b.tabIndex = -1;
      b.dataset.id = e.id;
      b.title = e.title;
      b.textContent = e.text;
      b.entry = e;
      return b;
    }));
    this.syncMenu();
    if (focused >= 0) this.menuItems()[Math.min(focused, entries.length - 1)]?.focus();
  }

  /** Mark entries that do not apply to the selection, and active marks. */
  syncMenu() {
    const state = this.view.state;
    for (const b of this.menuItems()) {
      const { item } = b.entry;
      b.setAttribute('aria-disabled', item.command(state) ? 'false' : 'true');
      if (item.active) b.setAttribute('aria-checked', String(item.active(state)));
    }
  }

  menuItems() {
    return [...this.menu.querySelectorAll('[role^=menuitem]')];
  }

  openMenu(at = 0) {
    const items = this.menuItems();
    if (!items.length) return;
    this.syncMenu();
    this.menu.hidden = false;
    this.moreButton.setAttribute('aria-expanded', 'true');
    // Open away from the selection: up when the toolbar sits above it, if it fits
    const room = this.el.getBoundingClientRect().top;
    const up = this.placement === 'above' && room >= this.menu.offsetHeight + 8;
    this.menu.dataset.dir = up ? 'up' : 'down';
    items.at(at).focus();
  }

  closeMenu(restoreFocus = false) {
    this.menu.hidden = true;
    this.moreButton.setAttribute('aria-expanded', 'false');
    if (restoreFocus || this.menu.contains(document.activeElement)) this.moreButton.focus();
  }

  onMenuKey(e) {
    const items = this.menuItems();
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
        this.closeMenu(true);
        return;
      default:
    }
  }

  onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (!this.linkForm.hidden) { this.closeLink(); return; }
      this.closeMenu();
      this.view.focus();
      return;
    }
    if (e.target === this.moreButton && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      this.openMenu(e.key === 'ArrowUp' ? -1 : 0);
      return;
    }
    if (!this.controls.includes(e.target)) return;
    const next = toolbarKeyNav(this.controls.indexOf(e.target), this.controls.length, e.key);
    if (next === null) return;
    e.preventDefault();
    this.controls[next].focus();
  }

  /** Alt+F10: focus the first button, when the toolbar is showing. */
  focusFirst() {
    if (this.el.hidden) return false;
    this.controls[0].focus();
    return true;
  }

  update(view) {
    this.view = view;
    const state = view.state;
    if (!showsToolbar(state) || !(view.hasFocus() || this.el.contains(document.activeElement))) {
      this.hide();
      return;
    }
    this.el.hidden = false;
    this.primary.forEach((item, i) => {
      this.buttons[i].setAttribute('aria-pressed', String(!!item.active?.(state)));
    });
    if (!this.menu.hidden) this.syncMenu();
    this.place();
  }

  place() {
    const { from, to } = this.view.state.selection;
    const a = this.view.coordsAtPos(from);
    const b = this.view.coordsAtPos(to);
    const sel = {
      top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom),
      left: Math.min(a.left, b.left), right: Math.max(a.right, b.right),
    };
    const rect = this.el.getBoundingClientRect();
    const pos = toolbarPosition(
      sel,
      { width: rect.width, height: rect.height },
      { width: document.documentElement.clientWidth, height: window.innerHeight },
    );
    this.placement = pos.placement;
    this.el.dataset.placement = pos.placement;
    this.el.style.top = `${pos.top}px`;
    this.el.style.left = `${pos.left}px`;
  }

  hide() {
    if (this.el.hidden) return;
    this.closeMenu();
    this.linkForm.hidden = true;
    for (const c of this.chrome) c.hidden = false;
    this.el.hidden = true;
  }

  destroy() {
    window.removeEventListener('scroll', this.onScroll, true);
    window.removeEventListener('resize', this.onScroll);
    if (refreshMenu) refreshMenu = null;
    this.el.remove();
  }
}

/** @returns {Plugin} */
export function formatToolbarPlugin() {
  let toolbar = null;
  return new Plugin({
    view(view) {
      toolbar = new FormatToolbarView(view);
      return {
        update: (v) => toolbar.update(v),
        destroy: () => toolbar.destroy(),
      };
    },
    props: {
      handleKeyDown(view, event) {
        if (event.altKey && event.key === 'F10' && toolbar?.focusFirst()) {
          event.preventDefault();
          return true;
        }
        if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key === 'k') {
          event.preventDefault();
          toolbar?.openLink();
          return true;
        }
        return false;
      },
      handleDOMEvents: {
        // A selection made with the mouse shows once the button is released
        focus: () => { requestAnimationFrame(() => toolbar?.update(toolbar.view)); return false; },
      },
    },
  });
}
