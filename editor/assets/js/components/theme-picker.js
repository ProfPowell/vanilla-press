/**
 * <theme-picker> — dropdown to select and preview Vanilla Breeze themes.
 *
 * Lists themes from GET /api/themes, sets `data-theme` on the editor
 * content pane (not the whole page), loads the theme's stylesheet from
 * /assets/vb/themes/ when it isn't built into vanilla-breeze.css, and
 * persists the choice in the `theme` config key (which the publisher
 * writes to <html data-theme>).
 *
 * Only the content preview area is themed — the editor chrome
 * (toolbar, sidebar, inspector) stays consistent. VB theme selectors
 * match any [data-theme~=id] element, so scoping to the pane works.
 *
 * @module editor/components/theme-picker
 */

import { api } from '../api-client.js';

const TIER_LABELS = {
  core: '',
  color: 'Color',
  showcase: 'Showcase',
  community: 'Community',
};

export class ThemePicker extends HTMLElement {
  async connectedCallback() {
    this.innerHTML = `
      <div class="theme-picker-field">
        <label for="theme-select">Theme</label>
        <select id="theme-select"><option value="default">Default</option></select>
      </div>
    `;
    this._select = this.querySelector('#theme-select');
    this._select.addEventListener('change', () => this.applyTheme(this._select.value));

    try {
      this._themes = await api.listThemes();
    } catch (err) {
      console.error('Failed to load themes:', err);
      this._themes = [{ id: 'default', name: 'Default', tier: 'core', file: null }];
    }
    this.renderOptions();
    this.loadCurrent();
  }

  renderOptions() {
    const groups = {};
    for (const t of this._themes) (groups[t.tier] ||= []).push(t);
    this._select.innerHTML = Object.entries(groups).map(([tier, items]) => {
      const options = items.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
      const label = TIER_LABELS[tier] ?? tier;
      return label ? `<optgroup label="${label}">${options}</optgroup>` : options;
    }).join('');
  }

  async loadCurrent() {
    try {
      const { value } = await api.getConfig('theme');
      if (value) {
        this._select.value = value;
        this.setTheme(value);
      }
    } catch {
      // No theme set — use default
    }
  }

  async applyTheme(themeId) {
    this.setTheme(themeId);
    try {
      await api.setConfig('theme', themeId);
    } catch (err) {
      console.error('Failed to save theme:', err);
    }
  }

  setTheme(themeId) {
    const theme = (this._themes || []).find(t => t.id === themeId);
    const isDefault = !theme || theme.id === 'default';

    // Scope data-theme to the content pane only — editor chrome stays unthemed
    const pane = document.querySelector('.editor-pane');
    if (pane) {
      if (isDefault) pane.removeAttribute('data-theme');
      else pane.setAttribute('data-theme', themeId);
    }

    // Load the theme stylesheet unless it's built into vanilla-breeze.css
    let link = document.getElementById('theme-link');
    if (theme && theme.file) {
      if (!link) {
        link = document.createElement('link');
        link.id = 'theme-link';
        link.rel = 'stylesheet';
        document.head.appendChild(link);
      }
      link.href = `/assets/vb/themes/${theme.file}`;
    } else if (link) {
      link.remove();
    }
  }
}

customElements.define('theme-picker', ThemePicker);
