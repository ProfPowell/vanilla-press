/**
 * <appearance-section> — Post settings › Appearance (site mode): the post
 * keeps the site theme, or takes its own theme (a theme card) for the whole
 * page or just the article. See settings-view.js `appearanceModel`.
 *
 * - Hidden until the site's themes have loaded (GET /theme), and in `vp serve`.
 * - The first 8 cards (current theme, custom themes, then the list), with
 *   "All N themes" to expand in place. Only shown cards load their stylesheet.
 * - Every change sets the meta, re-themes the writing area and saves (a
 *   published post then shows "Saved · not live yet" until Update).
 *
 * <meta-panel> places it and calls `render(meta)` when the meta changes.
 *
 * @module editor/components/appearance-section
 */

import { getCurrentMeta, setCurrentMeta, clearPageTheme } from '../meta-state.js';
import { saveDocument } from '../editor.js';
import { loadThemeData, getThemeData, refreshPaneTheme } from '../site-mode.js';
import { appearanceModel, pageThemeChoices, APPEARANCE_CARD_LIMIT } from '../settings-view.js';
import { addThemeLinks } from '../pane-theme.js';
import { SITE } from '../site-context.js';

/** An element with attributes and text or child nodes (text via textContent only). */
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) node.setAttribute(k, v);
  node.append(...children);
  return node;
}

/**
 * One theme card: a swatch in the theme's own CSS (`data-theme`), and its name.
 * @param {{ id: string, name: string, only: 'light'|'dark'|null }} card
 * @returns {HTMLLIElement}
 */
function appearanceCard(card) {
  const swatch = el('span', { class: 'appearance-swatch', 'aria-hidden': 'true', 'data-theme': card.id, 'data-mode': card.only },
    el('span', { class: 'appearance-swatch-aa' }, 'Aa'),
    el('span', { class: 'appearance-swatch-bar' }));
  return el('li', {},
    el('button', { type: 'button', class: 'appearance-card', 'data-theme-id': card.id, 'aria-pressed': 'false' },
      swatch, el('span', { class: 'appearance-card-name' }, card.name)));
}

export class AppearanceSection extends HTMLElement {
  connectedCallback() {
    if (this._ready) return;
    this._ready = true;
    /** "All N themes" was chosen (until the post goes back to the site theme). */
    this._expanded = false;
    this.innerHTML = `
      <section class="appearance" aria-labelledby="meta-appearance-title" data-appearance hidden>
        <h3 id="meta-appearance-title">Appearance</h3>
        <fieldset class="appearance-group">
          <legend>Page theme</legend>
          <label class="appearance-option">
            <input type="radio" name="meta-page-theme" value="site" data-appearance-site/>
            <span><span class="appearance-option-title">Site theme</span><span class="appearance-option-hint" data-appearance-site-hint></span></span>
          </label>
          <label class="appearance-option">
            <input type="radio" name="meta-page-theme" value="own" data-appearance-own-radio/>
            <span><span class="appearance-option-title">Its own theme</span><span class="appearance-option-hint">Only this page changes</span></span>
          </label>
        </fieldset>
        <div class="appearance-own" data-appearance-own hidden>
          <p class="appearance-note" data-appearance-unknown hidden></p>
          <ul class="appearance-cards" id="meta-appearance-cards" data-appearance-cards aria-label="Themes"></ul>
          <button type="button" class="appearance-more" data-appearance-more aria-expanded="false" aria-controls="meta-appearance-cards" hidden></button>
          <a class="appearance-adjust" data-appearance-adjust href="/app/site.html">Browse all themes, or adjust this one</a>
          <fieldset class="appearance-group">
            <legend>Apply to</legend>
            <label class="appearance-scope">
              <input type="radio" name="meta-theme-scope" value="page"/>
              <span>Whole page, header and footer too</span>
            </label>
            <label class="appearance-scope">
              <input type="radio" name="meta-theme-scope" value="article"/>
              <span>Article only, keep the site's header and footer</span>
            </label>
          </fieldset>
          <p class="appearance-note" data-appearance-note></p>
        </div>
      </section>
    `;
    this.wire();
    loadThemeData().then(() => this.render(getCurrentMeta()));
  }

  wire() {
    this.querySelector('[data-appearance-site]').addEventListener('change', () => {
      clearPageTheme();
      this._expanded = false;
      this.changed();
    });
    this.querySelector('[data-appearance-own-radio]').addEventListener('change', () => {
      const first = this.firstPageTheme();
      if (!first) return this.render(getCurrentMeta()); // no themes to pick: back to the site theme
      setCurrentMeta({ theme: first, themeScope: 'page' });
      this.changed();
    });
    this.querySelector('[data-appearance-cards]').addEventListener('click', (e) => {
      const card = e.target.closest('button[data-theme-id]');
      if (!card || card.getAttribute('aria-pressed') === 'true') return;
      const scope = getCurrentMeta().themeScope === 'article' ? 'article' : 'page';
      setCurrentMeta({ theme: card.dataset.themeId, themeScope: scope });
      this.changed();
      // The picked theme moves to the front: keep focus on it
      this.querySelector(`button[data-theme-id="${CSS.escape(card.dataset.themeId)}"]`)?.focus();
    });
    this.querySelector('[data-appearance-more]').addEventListener('click', () => {
      this._expanded = !this._expanded;
      this.render(getCurrentMeta());
    });
    for (const radio of this.querySelectorAll('input[name="meta-theme-scope"]')) {
      radio.addEventListener('change', () => {
        if (!getCurrentMeta().theme) return;
        setCurrentMeta({ themeScope: radio.value });
        this.changed();
      });
    }
  }

  /**
   * The theme "Its own theme" starts with: the first card that is not the site
   * theme (the same look would be no change), else the first card.
   * @returns {string|null}
   */
  firstPageTheme() {
    const data = getThemeData();
    if (!data) return null;
    const choices = pageThemeChoices(data);
    const site = data.setting?.name || 'default';
    return (choices.find((t) => t.id !== site) || choices[0])?.id || null;
  }

  /** The post's page theme changed: show it here and in the writing area, and save. */
  changed() {
    this.render(getCurrentMeta());
    refreshPaneTheme();
    saveDocument();
  }

  /** Show `meta`'s page theme (once the site's themes have loaded). */
  render(meta) {
    const section = this.querySelector('[data-appearance]');
    const data = getThemeData();
    if (!section || !meta) return;
    section.hidden = !data;
    if (!data) return;
    const m = appearanceModel(meta, { ...data, siteId: SITE || '', expanded: this._expanded });

    section.querySelector('[data-appearance-site-hint]').textContent = `${m.siteName}, set under Theme`;
    section.querySelector('[data-appearance-site]').checked = !m.own;
    section.querySelector('[data-appearance-own-radio]').checked = m.own;
    section.querySelector('[data-appearance-own]').hidden = !m.own;
    section.querySelector('[data-appearance-adjust]').href = m.adjustHref;
    for (const radio of section.querySelectorAll('input[name="meta-theme-scope"]')) radio.checked = radio.value === m.scope;

    const note = section.querySelector('[data-appearance-note]');
    if (m.note) {
      const at = m.note.indexOf(m.noteKeys); // the key part as code, the copy around it as text
      note.replaceChildren(m.note.slice(0, at), el('code', {}, m.noteKeys), m.note.slice(at + m.noteKeys.length));
    } else {
      note.replaceChildren();
    }

    const unknown = section.querySelector('[data-appearance-unknown]');
    unknown.textContent = m.unknown || '';
    unknown.hidden = !m.unknown;

    const more = section.querySelector('[data-appearance-more]');
    more.hidden = !m.toggleText;
    more.textContent = m.toggleText || '';
    more.setAttribute('aria-expanded', String(this._expanded));

    if (!m.own) return; // the cards (and their stylesheets) only once the post has its own theme
    const list = section.querySelector('[data-appearance-cards]');
    const shown = [...list.querySelectorAll('button[data-theme-id]')];
    const same = shown.length === m.cards.length && m.cards.every((c, i) => shown[i].dataset.themeId === c.id);
    if (!same) {
      addThemeLinks(m.cards.map((c) => data.themes.find((t) => t.id === c.id)?.href));
      list.replaceChildren(...m.cards.map(appearanceCard));
      list.toggleAttribute('data-scroll', m.cards.length > APPEARANCE_CARD_LIMIT);
    }
    for (const button of list.querySelectorAll('button[data-theme-id]')) {
      const card = m.cards.find((c) => c.id === button.dataset.themeId);
      button.setAttribute('aria-pressed', String(!!card?.pressed));
    }
  }
}

customElements.define('appearance-section', AppearanceSection);
