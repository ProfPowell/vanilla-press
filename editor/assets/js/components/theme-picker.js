/**
 * <theme-picker> — dropdown to select and preview themes.
 *
 * Loads current theme from the config API, sets `data-theme` on the
 * editor content pane (not the whole page), loads the theme stylesheet
 * + bridge CSS, and persists the choice.
 *
 * Only the content preview area is themed — the editor chrome
 * (toolbar, sidebar, inspector) stays consistent.
 *
 * @module editor/components/theme-picker
 */

import { api } from '../api-client.js';
import { themes } from '../../../../src/build/assets/css/themes/_registry.js';

const CATEGORY_LABELS = {
  default: '',
  color: 'Color',
  personality: 'Personality',
  extreme: 'Extreme',
};

export class ThemePicker extends HTMLElement {
  connectedCallback() {
    // Group themes by category for <optgroup>
    const groups = {};
    for (const t of themes) {
      const cat = t.category || 'default';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(t);
    }

    const optionsHtml = Object.entries(groups).map(([cat, items]) => {
      const label = CATEGORY_LABELS[cat];
      const options = items.map(t =>
        `<option value="${t.id}">${t.name}</option>`
      ).join('');
      if (!label) return options;
      return `<optgroup label="${label}">${options}</optgroup>`;
    }).join('');

    this.innerHTML = `
      <div class="theme-picker-field">
        <label for="theme-select">Theme</label>
        <select id="theme-select">${optionsHtml}</select>
      </div>
    `;

    this._select = this.querySelector('#theme-select');
    this._select.addEventListener('change', () => this.applyTheme(this._select.value));

    this.loadCurrent();
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
    const theme = themes.find(t => t.id === themeId);

    // Scope data-theme to the content pane only — editor chrome stays unthemed
    const pane = document.querySelector('.editor-pane');
    if (pane) {
      if (!theme || !theme.file) {
        pane.removeAttribute('data-theme');
      } else {
        pane.setAttribute('data-theme', themeId);
      }
    }

    // Load theme stylesheet
    const themeLink = document.getElementById('theme-link');
    if (themeLink) {
      themeLink.href = theme && theme.file
        ? `/src/build/assets/css/themes/${theme.file}`
        : '';
    }

    // Load bridge stylesheet (maps VB tokens → VP tokens)
    let bridgeLink = document.getElementById('theme-bridge');
    if (theme && theme.file) {
      if (!bridgeLink) {
        bridgeLink = document.createElement('link');
        bridgeLink.id = 'theme-bridge';
        bridgeLink.rel = 'stylesheet';
        bridgeLink.href = '/src/build/assets/css/themes/_bridge.css';
        document.head.appendChild(bridgeLink);
      }
    } else if (bridgeLink) {
      bridgeLink.remove();
    }
  }
}

customElements.define('theme-picker', ThemePicker);
