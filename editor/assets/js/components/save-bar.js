/**
 * <save-bar> — a full-width strip under the editor header that keeps a save
 * problem (or an offer to restore unsaved local work) on screen until it is
 * resolved.
 *
 * `show({ tone, text, actions })` — tone is 'error' (role="alert"), 'warn' or
 * 'info' (role="status"). Each action is `{ label, run }`; the bar stays up
 * after an action unless its `run` calls `clear()`.
 * `showRestore(offer, { differences, onRestore, onRestoreAsNew, onDiscard })`
 * — offer is `{ kind: 'restore' | 'stale', at }`. Its buttons run once and
 * then hide the bar. "Show differences" toggles a list of `differences`.
 * `clear()` hides and empties the bar. All text is set with textContent.
 *
 * @module editor/components/save-bar
 */

const UNITS = [['day', 86400], ['hour', 3600], ['minute', 60], ['second', 1]];

/**
 * "2 minutes ago" for an ISO time.
 * @param {string} iso
 * @param {number} [now] ms since epoch (for tests)
 * @returns {string}
 */
export function relativeTime(iso, now = Date.now()) {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  if (Number.isNaN(seconds)) return 'earlier';
  const fmt = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size || unit === 'second') return fmt.format(Math.round(seconds / size), unit);
  }
  return 'earlier';
}

export class SaveBar extends HTMLElement {
  /** @param {{tone: 'error'|'warn'|'info', text: string, actions?: {label: string, run: () => void}[]}} spec */
  show({ tone, text, actions = [] }) {
    this.#render(tone, text, actions.map((a) => ({ label: a.label, run: a.run, hide: false })));
  }

  /**
   * @param {{kind: 'restore'|'stale', at: string}} offer
   * @param {{differences?: string[], onRestore?: Function, onRestoreAsNew?: Function, onDiscard?: Function, now?: number}} handlers
   */
  showRestore(offer, { differences = [], onRestore, onRestoreAsNew, onDiscard, now } = {}) {
    const when = relativeTime(offer.at, now);
    const act = (label, run) => ({ label, run, hide: true });
    if (offer.kind === 'stale') {
      this.#render('warn', `Unsaved changes from ${when}, made before this post was changed elsewhere`,
        [act('Restore as a new draft', onRestoreAsNew), act('Discard', onDiscard)]);
      return;
    }
    const actions = [act('Restore', onRestore)];
    if (differences.length) actions.push({ label: 'Show differences', diff: true });
    actions.push(act('Discard', onDiscard));
    this.#render('info', `Unsaved changes from ${when}`, actions, differences);
  }

  clear() {
    this.hidden = true;
    this.replaceChildren();
    this.removeAttribute('role');
    this.removeAttribute('data-tone');
  }

  #render(tone, text, actions, differences = []) {
    this.replaceChildren();
    this.setAttribute('role', tone === 'error' ? 'alert' : 'status');
    this.setAttribute('data-tone', tone);
    const row = document.createElement('div');
    row.className = 'save-bar-row';
    const p = document.createElement('p');
    p.className = 'save-bar-text';
    p.textContent = text;
    row.append(p);
    let list = null;
    if (differences.length) {
      list = document.createElement('ul');
      list.className = 'save-bar-differences';
      list.hidden = true;
      for (const line of differences) {
        const li = document.createElement('li');
        li.textContent = line;
        list.append(li);
      }
    }
    for (const a of actions) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'secondary';
      btn.textContent = a.label;
      if (a.diff) {
        btn.setAttribute('aria-expanded', 'false');
        btn.addEventListener('click', () => {
          const open = list.hidden;
          list.hidden = !open;
          btn.setAttribute('aria-expanded', String(open));
        });
      } else {
        btn.addEventListener('click', () => {
          a.run?.();
          if (a.hide) this.clear();
        });
      }
      row.append(btn);
    }
    this.append(row);
    if (list) this.append(list);
    this.hidden = false;
  }
}

if (!customElements.get('save-bar')) customElements.define('save-bar', SaveBar);
