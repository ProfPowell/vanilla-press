/**
 * <confirm-panel> — an in-page confirmation (no browser dialogs).
 *
 * `ask({ heading, body, confirm })` shows a `role="alertdialog"` and resolves
 * true on the confirm button, false on Cancel or Escape. Focus starts on
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
    this.bodyEl = document.createElement('p');
    this.bodyEl.id = `confirm-b-${n}`;
    const actions = document.createElement('div');
    actions.className = 'confirm-actions';
    this.cancelBtn = document.createElement('button');
    this.cancelBtn.type = 'button';
    this.cancelBtn.textContent = 'Cancel';
    this.confirmBtn = document.createElement('button');
    this.confirmBtn.type = 'button';
    this.confirmBtn.className = 'danger';
    actions.append(this.cancelBtn, this.confirmBtn);
    this.panel.append(this.headingEl, this.bodyEl, actions);
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
   * @param {{ heading: string, body: string, confirm: string }} text
   * @returns {Promise<boolean>}
   */
  ask({ heading, body, confirm }) {
    if (this.resolve) this.finish(false);
    this.returnTo = document.activeElement;
    this.headingEl.textContent = heading;
    this.bodyEl.textContent = body;
    this.confirmBtn.textContent = confirm;
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
