/**
 * The Theme section's questions, in native <dialog>s: open one with a submit
 * that runs while it stays open (busy: both buttons disabled, Escape
 * ignored), and the name dialog (Save as a new theme, Rename). Escape and
 * Cancel close it; on close, focus goes back to the opener.
 *
 * @module app/theme-dialogs
 */

/**
 * Open a dialog. `submit` runs on the form's submit; it returns an error text
 * to show in the dialog, or nothing to close it.
 * @param {HTMLDialogElement} dialog - holds a <form> and a [data-dialog-cancel] button
 * @param {{ opener?: HTMLElement|null, refocus?: () => HTMLElement|null, fallback?: HTMLElement|null,
 *   first: HTMLElement, error: HTMLElement, ok: HTMLButtonElement, busyText: string,
 *   submit: () => Promise<string|void> }} opts - refocus finds the opener again when it was
 *   re-rendered meanwhile (a card's menu); fallback when neither is there
 */
export function openDialog(dialog, { opener, refocus, fallback, first, error, ok, busyText, submit }) {
  const form = dialog.querySelector('form');
  const cancel = dialog.querySelector('[data-dialog-cancel]');
  const okText = ok.textContent;
  error.textContent = '';
  const busy = (on) => {
    ok.disabled = on;
    cancel.disabled = on;
    ok.textContent = on ? busyText : okText;
  };
  // However it closes (Cancel, Escape, the browser), focus goes back and the handlers go.
  dialog.addEventListener('close', () => {
    form.onsubmit = null;
    cancel.onclick = null;
    dialog.oncancel = null;
    ((opener?.isConnected ? opener : refocus?.()) || fallback)?.focus();
  }, { once: true });
  cancel.onclick = () => dialog.close();
  dialog.oncancel = (e) => { if (ok.disabled) e.preventDefault(); };
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (ok.disabled) return;
    busy(true);
    error.textContent = '';
    let problem;
    try {
      problem = await submit();
    } catch (err) {
      problem = err.message;
    } finally {
      busy(false);
    }
    if (!dialog.open) return;
    if (problem) {
      error.textContent = problem;
      first.focus();
    } else {
      dialog.close();
    }
  };
  dialog.showModal();
  first.focus();
}

/**
 * Ask for a theme name in the name dialog (#theme-name-dialog).
 * @param {(id: string) => HTMLElement} $ - the section's element lookup
 * @param {{ opener?: HTMLElement|null, refocus?: () => HTMLElement|null, fallback?: HTMLElement|null,
 *   title: string, description: string, value?: string, ok: string, busyText: string,
 *   submit: (name: string) => Promise<string|void> }} opts
 */
export function askName($, { opener, refocus, fallback, title, description, value = '', ok, busyText, submit }) {
  $('theme-name-title').textContent = title;
  $('theme-name-desc').textContent = description;
  $('theme-name-ok').textContent = ok;
  const input = $('theme-name-input');
  input.value = value;
  openDialog($('theme-name-dialog'), {
    opener, refocus, fallback, first: input, error: $('theme-name-error'), ok: $('theme-name-ok'), busyText,
    submit: () => {
      const name = input.value.trim();
      if (!name) return Promise.resolve('Give the theme a name.');
      return submit(name);
    },
  });
  input.select();
}
