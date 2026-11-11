/**
 * `<web-image-search for="picker|library">`: search the web image services
 * the app has turned on, and choose a result.
 *
 * Typing searches after a 400ms pause (Enter searches at once). Each result
 * card shows its thumbnail and credit, an "Insert" button ("Add" when
 * `for="library"`) and, for a result that can be copied, "Edit first".
 * Choosing fires `web-image-choose` (bubbles) with `{ result, edit }`; what
 * happens next is the host's (web-image-flow.js). A source that failed shows
 * as one line above the results; the others' results still show.
 *
 * @module editor/components/web-image-search
 */

import { api } from '../api-client.js';
import { creditText } from '../../../../src/media/credit.js';

const DEBOUNCE_MS = 400;
/** The server refuses a longer query. */
const MAX_QUERY = 100;

let seq = 0;

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  node.append(...children.filter((c) => c != null && c !== false));
  return node;
}

export class WebImageSearch extends HTMLElement {
  constructor() {
    super();
    this.uid = `web-image-search-${++seq}`;
    this.query = '';
    this.page = 1;
    this.results = [];
    this.request = 0; // the newest search; older answers are dropped
    this.timer = null;
  }

  /** 'library' (copy-mode sources only, "Add") or 'picker'. */
  get purpose() {
    return this.getAttribute('for') === 'library' ? 'library' : 'picker';
  }

  connectedCallback() {
    if (this.input) return;
    const inputId = `${this.uid}-q`;
    this.input = el('input', {
      // Not type=search: its first Escape clears the box (and the results) instead of closing the dialog
      type: 'text', role: 'searchbox', id: inputId, class: 'web-image-search-input', maxlength: MAX_QUERY,
      placeholder: 'A red barn in snow', autocomplete: 'off',
      oninput: () => this.schedule(),
    });
    this.status = el('p', { class: 'web-image-search-status', role: 'status' });
    // A source that failed is announced, like the count in the status line
    this.errors = el('div', { class: 'web-image-search-errors', 'aria-live': 'polite' });
    this.grid = el('ul', { class: 'web-image-search-grid', 'aria-label': 'Web images' });
    this.more = el('button', { type: 'button', class: 'web-image-search-more', hidden: true, onclick: () => this.loadMore() }, 'Load more');
    const form = el('form', {
      class: 'web-image-search-form', role: 'search',
      // Enter always searches, even the same words again (after "Search again")
      onsubmit: (e) => { e.preventDefault(); this.searchNow({ force: true }); },
    },
    el('label', { for: inputId }, 'Search the web for images'),
    this.input);
    this.append(form, this.status, this.errors, this.grid, this.more);
  }

  disconnectedCallback() {
    clearTimeout(this.timer);
  }

  focus(options) {
    this.input?.focus(options);
  }

  /** Search once typing pauses. */
  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.searchNow(), DEBOUNCE_MS);
  }

  /** Search now. Typing that ends where it started repeats nothing, unless `force`. */
  searchNow({ force = false } = {}) {
    clearTimeout(this.timer);
    const q = this.input.value.trim();
    if (!force && q === this.query && this.results.length) return;
    this.query = q;
    this.page = 1;
    this.results = [];
    this.grid.replaceChildren();
    this.errors.replaceChildren();
    this.more.hidden = true;
    if (!q) {
      this.request++;
      this.status.textContent = '';
      return;
    }
    this.fetchPage();
  }

  loadMore() {
    this.page += 1;
    this.fetchPage();
  }

  async fetchPage() {
    const request = ++this.request;
    const { query, page } = this;
    this.more.disabled = true;
    this.status.textContent = page === 1 ? 'Searching…' : 'Loading more…';
    let answer;
    try {
      answer = await api.searchWebImages(query, { page, for: this.purpose });
    } catch (err) {
      if (request !== this.request) return;
      this.status.textContent = '';
      this.errors.replaceChildren(el('p', { class: 'web-image-search-error', role: 'alert' },
        `Couldn't search: ${err.message}`));
      if (page > 1) this.page -= 1; // Load more tries the same page again
      this.more.disabled = false;
      return;
    }
    if (request !== this.request) return;
    const { results = [], errors = [], hasMore = false, ready } = answer || {};
    // A result already shown (a source's pages can overlap) shows once
    const seen = new Set(this.results.map((r) => `${r.source}|${r.id}`));
    const fresh = results.filter((r) => !seen.has(`${r.source}|${r.id}`));
    this.results.push(...fresh);
    this.errors.replaceChildren(...errors.map((e) => el('p', { class: 'web-image-search-error' }, e.message)));
    const cards = fresh.map((r, i) => this.card(r, `${this.uid}-${request}-${i}`));
    this.grid.append(...cards);
    // Load more, pressed for the last page, goes away: focus goes to what it brought
    const moreHadFocus = page > 1 && !hasMore;
    this.more.hidden = !hasMore;
    this.more.disabled = false;
    if (moreHadFocus && cards.length) cards[0].querySelector('button')?.focus();
    if (ready === 0) {
      this.status.replaceChildren('Turn on an image source in ',
        el('a', { href: '/app/services.html' }, 'Services'), ' to search the web.');
    } else if (!this.results.length) this.status.textContent = `No images found for “${query}”.`;
    else this.status.textContent = `${this.results.length} image${this.results.length === 1 ? '' : 's'} found.`;
  }

  card(result, id) {
    const choose = (edit) => this.dispatchEvent(new CustomEvent('web-image-choose', {
      bubbles: true, detail: { result, edit },
    }));
    const creditId = `${id}-credit`;
    const label = this.purpose === 'library' ? 'Add' : 'Insert';
    // Each button's own name: which picture it is
    const what = result.description || creditText(result.credit) || `${result.source} ${result.id}`;
    return el('li', { class: 'web-image-card', 'data-source': result.source },
      el('span', { class: 'web-image-thumb' },
        el('img', { src: result.thumb, alt: result.description || '', loading: 'lazy', referrerpolicy: 'no-referrer' })),
      el('p', { class: 'web-image-credit', id: creditId }, creditText(result.credit)),
      el('span', { class: 'web-image-actions' },
        el('button', { type: 'button', class: 'primary', 'data-action': 'insert', 'aria-label': `${label}: ${what}`, 'aria-describedby': creditId, onclick: () => choose(false) }, label),
        result.mode === 'link'
          ? null
          : el('button', { type: 'button', 'data-action': 'edit', 'aria-label': `Edit first: ${what}`, 'aria-describedby': creditId, onclick: () => choose(true) }, 'Edit first')));
  }
}

if (!customElements.get('web-image-search')) customElements.define('web-image-search', WebImageSearch);
