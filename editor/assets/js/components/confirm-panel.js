/**
 * <confirm-panel> — an in-page confirmation (no browser dialogs).
 *
 * `ask({ heading, body, confirm, items?, tone? })` shows a `role="alertdialog"`
 * and resolves true on the confirm button, false on Cancel or Escape. `items`
 * are listed under the body (part of the description); `tone: 'primary'`
 * makes the confirm button a primary one instead of the default danger. Focus starts on
 * Cancel and returns to where it was. Tab stays inside the panel.
 *
 * @module editor/components/confirm-panel
 */

let counter = 0;

export class ConfirmPanel extends HTMLElement {
  connectedCallback() {
    if (this.panel) return;
    const n = ++counter;
    this.hidden = true;
    this.panel = document.createElement('div');
    this.panel.className = 'confirm-box';
    this.panel.setAttribute('role', 'alertdialog');
    this.panel.setAttribute('aria-modal', 'true');
    this.panel.setAttribute('aria-labelledby', `confirm-h-${n}`);
    this.panel.setAttribute('aria-describedby', `confirm-b-${n}`);
    this.headingEl = document.createElement('h2');
    this.headingEl.id = `confirm-h-${n}`;
    this.descEl = document.createElement('div');
    this.descEl.id = `confirm-b-${n}`;
    this.bodyEl = document.createElement('p');
    this.listEl = document.createElement('ul');
    this.listEl.className = 'confirm-items';
    this.listEl.hidden = true;
    this.descEl.append(this.bodyEl, this.listEl);
    const actions = document.createElement('div');
    actions.className = 'confirm-actions';
    this.cancelBtn = document.createElement('button');
    this.cancelBtn.type = 'button';
    this.cancelBtn.textContent = 'Cancel';
    this.confirmBtn = document.createElement('button');
    this.confirmBtn.type = 'button';
    this.confirmBtn.className = 'danger';
    actions.append(this.cancelBtn, this.confirmBtn);
    this.panel.append(this.headingEl, this.descEl, actions);
    this.append(this.panel);

    this.cancelBtn.addEventListener('click', () => this.finish(false));
    this.confirmBtn.addEventListener('click', () => this.finish(true));
    this.addEventListener('keydown', (e) => {
      if (this.hidden) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.finish(false);
      } else if (e.key === 'Tab') {
        const [first, last] = [this.cancelBtn, this.confirmBtn];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    // The backdrop (the host, outside the box) cancels
    this.addEventListener('click', (e) => { if (e.target === this) this.finish(false); });
  }

  /**
   * @param {{ heading: string, body: string, confirm: string, items?: string[], tone?: 'danger'|'primary' }} text
   * @returns {Promise<boolean>}
   */
  ask({ heading, body, confirm, items = [], tone = 'danger' }) {
    if (this.resolve) this.finish(false);
    this.returnTo = document.activeElement;
    this.headingEl.textContent = heading;
    this.bodyEl.textContent = body;
    this.listEl.replaceChildren(...items.map((item) => {
      const li = document.createElement('li');
      li.textContent = item;
      return li;
    }));
    this.listEl.hidden = !items.length;
    this.confirmBtn.textContent = confirm;
    this.confirmBtn.className = tone === 'primary' ? 'primary' : 'danger';
    this.hidden = false;
    this.cancelBtn.focus();
    return new Promise((resolve) => { this.resolve = resolve; });
  }

  finish(answer) {
    const resolve = this.resolve;
    if (!resolve) return;
    this.resolve = null;
    this.hidden = true;
    if (this.returnTo?.isConnected) this.returnTo.focus();
    resolve(answer);
  }
}

customElements.define('confirm-panel', ConfirmPanel);
