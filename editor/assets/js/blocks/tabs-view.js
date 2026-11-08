/**
 * TabsView — editor-only NodeView for tabs (published as VB <tab-set>).
 *
 * Design: All tab children exist in the DOM simultaneously.
 * CSS toggles visibility (display: block/none). ProseMirror sees
 * all tab content contiguously, avoiding the single-contentDOM limitation.
 *
 * Features:
 * - Tab bar with clickable labels
 * - Active tab shown, others hidden via CSS
 * - Add/remove tabs; rename a tab in place (double-click or F2)
 * - Each tab has its own contentDOM for PM editing
 *
 * @module editor/blocks/tabs-view
 */

let tabsCounter = 0;

/**
 * The transaction that renames tab `index` of the tabs node at `tabsPos`: one
 * step, so one undo puts the old label back. Null when nothing would change.
 * @param {import('prosemirror-state').EditorState} state
 * @param {number} tabsPos - position of the tabs node
 * @param {number} index - which tab
 * @param {string} label
 */
export function renameTabTr(state, tabsPos, index, label) {
  const tabs = state.doc.nodeAt(tabsPos);
  if (!tabs || tabs.type.name !== 'tabs' || index >= tabs.childCount) return null;
  const tab = tabs.child(index);
  if ((tab.attrs.label ?? '') === label) return null;
  let tabPos = tabsPos + 1; // inside the tabs node
  for (let i = 0; i < index; i++) tabPos += tabs.child(i).nodeSize;
  return state.tr.setNodeMarkup(tabPos, null, { ...tab.attrs, label });
}

export class TabsView {
  constructor(node, view, getPos) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.activeTab = 0;

    // Neutral wrapper: VB's <tab-set> would take over the panels
    this.dom = document.createElement('div');
    this.dom.classList.add('pm-node-view', 'pm-tabs');
    this.uid = `tabs-${++tabsCounter}`;
    this.dom.setAttribute('data-tabs-id', this.uid);

    // Inactive panels are hidden by this stylesheet, not by styling the
    // panels: they are ProseMirror-managed nodes, and changing them made
    // PM re-render the tabs, which re-applied the styles, in an endless loop.
    this.styleEl = document.createElement('style');

    // Tab bar
    this.tabBar = document.createElement('div');
    this.tabBar.className = 'tab-bar';
    this.dom.appendChild(this.tabBar);

    // Content wrapper — this is where PM will render all tab children
    this.contentDOM = document.createElement('div');
    this.contentDOM.className = 'tabs-content';
    this.dom.appendChild(this.contentDOM);

    this.buildTabBar(node);
  }

  buildTabBar(node) {
    this.tabBar.innerHTML = '';

    node.forEach((child, _offset, index) => {
      const btn = document.createElement('button');
      btn.className = 'tab-btn' + (index === this.activeTab ? ' active' : '');
      btn.textContent = child.attrs.label || `Tab ${index + 1}`;
      btn.type = 'button';

      // Click to switch active tab
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.activeTab = index;
        this.updateTabVisibility();
        this.updateTabBarActive();
      });

      // Double-click (or F2) to rename in place
      btn.addEventListener('dblclick', (e) => {
        e.preventDefault();
        this.startRename(btn, index);
      });
      btn.addEventListener('keydown', (e) => {
        if (e.key !== 'F2') return;
        e.preventDefault();
        this.startRename(btn, index);
      });

      this.tabBar.appendChild(btn);
    });

    // Add tab button
    const addBtn = document.createElement('button');
    addBtn.className = 'add-tab-btn';
    addBtn.textContent = '+';
    addBtn.title = 'Add tab';
    addBtn.type = 'button';
    addBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const pos = this.getPos();
      if (pos == null) return;
      const { schema: s } = this.view.state;
      const newTab = s.nodes.tab.create(
        { label: `Tab ${node.childCount + 1}` },
        [s.nodes.paragraph.create()]
      );
      // Insert at end of tabs
      const insertPos = pos + node.nodeSize - 1;
      this.view.dispatch(
        this.view.state.tr.insert(insertPos, newTab)
      );
      this.activeTab = node.childCount; // Switch to new tab
    });
    this.tabBar.appendChild(addBtn);

    // The stylesheet lives in the tab bar, whose mutations PM ignores
    this.tabBar.appendChild(this.styleEl);
    this.updateTabVisibility();
  }

  /**
   * Swap the tab's label for an input: Enter or leaving it saves (one undo step),
   * Escape puts the old label back.
   */
  startRename(btn, index) {
    if (this.renaming) return;
    const label = this.node.child(index).attrs.label ?? '';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'tab-rename-input';
    input.value = label;
    input.setAttribute('aria-label', `Tab ${index + 1} label`);
    this.renaming = input;
    let finished = false;
    const finish = (save) => {
      if (finished) return;
      finished = true;
      this.renaming = null;
      const pos = this.getPos();
      const tr = save && pos != null ? renameTabTr(this.view.state, pos, index, input.value) : null;
      if (tr) this.view.dispatch(tr); // update() redraws the bar
      else this.buildTabBar(this.node);
      this.view.focus();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
    btn.replaceWith(input);
    input.focus();
    input.select();
  }

  updateTabBarActive() {
    const buttons = this.tabBar.querySelectorAll('.tab-btn');
    buttons.forEach((btn, i) => {
      btn.classList.toggle('active', i === this.activeTab);
    });
  }

  updateTabVisibility() {
    // Each tab child in contentDOM is a div.tab-panel (from tab toDOM)
    this.styleEl.textContent =
      `[data-tabs-id="${this.uid}"] > .tabs-content > .tab-panel:not(:nth-child(${this.activeTab + 1})) { display: none; }`;
  }

  update(node) {
    if (node.type.name !== 'tabs') return false;
    this.node = node;
    if (this.activeTab >= node.childCount) {
      this.activeTab = Math.max(0, node.childCount - 1);
    }
    // Keep the rename input (and what was typed) through unrelated edits
    if (!this.renaming) this.buildTabBar(node);
    return true;
  }

  stopEvent(event) {
    return this.tabBar.contains(event.target);
  }

  ignoreMutation(mutation) {
    return this.tabBar.contains(mutation.target) ||
      (mutation.type === 'attributes' && mutation.attributeName === 'style');
  }
}

