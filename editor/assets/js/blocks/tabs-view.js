/**
 * TabsView — NodeView for <ui-tabs> elements.
 *
 * Design: All tab children exist in the DOM simultaneously.
 * CSS toggles visibility (display: block/none). ProseMirror sees
 * all tab content contiguously, avoiding the single-contentDOM limitation.
 *
 * Features:
 * - Tab bar with clickable labels
 * - Active tab shown, others hidden via CSS
 * - Add/remove/rename tabs
 * - Each tab has its own contentDOM for PM editing
 *
 * @module editor/blocks/tabs-view
 */

export class TabsView {
  constructor(node, view, getPos) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.activeTab = 0;

    // Outer wrapper: <ui-tabs>
    this.dom = document.createElement('ui-tabs');
    this.dom.classList.add('pm-node-view', 'pm-tabs');

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

      // Double-click to rename
      btn.addEventListener('dblclick', (e) => {
        e.preventDefault();
        const newLabel = prompt('Tab label:', child.attrs.label);
        if (newLabel === null) return;
        const pos = this.getPos();
        if (pos == null) return;

        // Find the position of the tab node
        let tabPos = pos + 1; // Skip past the tabs node itself
        for (let i = 0; i < index; i++) {
          tabPos += node.child(i).nodeSize;
        }
        this.view.dispatch(
          this.view.state.tr.setNodeMarkup(tabPos, null, {
            ...child.attrs,
            label: newLabel,
          })
        );
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

    // Set initial visibility after a tick (content may not be rendered yet)
    requestAnimationFrame(() => this.updateTabVisibility());
  }

  updateTabBarActive() {
    const buttons = this.tabBar.querySelectorAll('.tab-btn');
    buttons.forEach((btn, i) => {
      btn.classList.toggle('active', i === this.activeTab);
    });
  }

  updateTabVisibility() {
    // Each tab child in contentDOM is a div.tab-panel (from tab toDOM)
    const panels = this.contentDOM.children;
    for (let i = 0; i < panels.length; i++) {
      panels[i].style.display = i === this.activeTab ? 'block' : 'none';
    }
  }

  update(node) {
    if (node.type.name !== 'tabs') return false;
    this.node = node;
    if (this.activeTab >= node.childCount) {
      this.activeTab = Math.max(0, node.childCount - 1);
    }
    this.buildTabBar(node);
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
