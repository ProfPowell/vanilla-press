/**
 * The Theme section's Apply to site: run it (the button disabled, "Applying…"
 * in the header's status), then watch for the live site every 10 s for up
 * to 5 min ("Live ↗"). A failure is shown once: in the error report (a build
 * log or conflicting files) or in the header status. `stop()` ends the live
 * check (when the section is left).
 *
 * @module app/theme-apply-ui
 */
import { api, h } from './app-api.js';
import {
  applyBody, applyOutcome, applyFailureView, baselineOf, liveStep, LIVE_POLL_MS, LIVE_STOPPED_TEXT,
} from './theme-view.js';
import { actionPendingText } from '../../../editor/assets/js/site-context.js';

/**
 * @param {{ $: (id: string) => HTMLElement, base: string,
 *   currentDraft: () => Promise<object>, setApplied: (baseline: object) => void,
 *   load: () => Promise<void>, showError: (text: string) => void, showNotice: (text: string) => void }} ctx
 * @returns {{ stop: () => void }}
 */
export function initApplyUi(ctx) {
  const { $, base } = ctx;
  const btn = $('theme-apply');
  let applying = false;
  let liveTimer = null;
  let liveToken = 0;
  let polling = false;

  /** The header's status slot: `tone` 'error' or 'done' colors it. */
  function setApplyState(text, tone = '') {
    const el = $('theme-apply-state');
    el.replaceChildren(text || '');
    if (tone) el.dataset.tone = tone;
    else delete el.dataset.tone;
  }

  function showReport({ message, log, files }) {
    const body = [h('p', {}, message)];
    if (log) body.push(h('details', {}, h('summary', {}, 'Build log'), h('pre', {}, log)));
    if (files?.length) body.push(h('ul', {}, ...files.map((f) => h('li', {}, f))));
    $('theme-report-body').replaceChildren(...body);
    $('theme-report').hidden = false;
  }

  function clearReport() {
    $('theme-report').hidden = true;
    $('theme-report-body').replaceChildren();
  }

  $('theme-report-close').addEventListener('click', () => {
    clearReport();
    btn.focus();
  });

  function cancelLive() {
    clearTimeout(liveTimer);
    liveTimer = null;
    liveToken++;
    polling = false;
  }

  function showLive(url) {
    const el = $('theme-apply-state');
    el.dataset.tone = 'done';
    el.replaceChildren(h('a', { href: url, target: '_blank', rel: 'noopener' },
      'Live ↗', h('span', { class: 'visually-hidden' }, ' (opens the site in a new tab)')));
  }

  /** Poll GET /theme/live every 10 s for up to 5 min. */
  function watchLive(url) {
    const token = ++liveToken;
    const started = Date.now();
    polling = true;
    const tick = async () => {
      liveTimer = null;
      if (token !== liveToken) return;
      let res = null;
      try { res = await api(`${base}/theme/live`); } catch { /* try again */ }
      if (token !== liveToken) return;
      const step = liveStep(res, url, started, Date.now());
      if (step.done) polling = false;
      if (step.done === 'live') return showLive(step.url);
      if (step.done === 'timeout') return setApplyState(step.text);
      liveTimer = setTimeout(tick, LIVE_POLL_MS);
    };
    tick();
  }

  async function apply() {
    const d = await ctx.currentDraft();
    let result;
    try {
      result = await api(`${base}/theme/apply`, { method: 'POST', body: applyBody(d, d.adjustments.colors) });
    } catch (err) {
      const view = applyFailureView(err);
      setApplyState(view.state, view.state ? 'error' : '');
      if (view.baseline) ctx.setApplied(baselineOf(d)); // committed here; only the push failed
      if (view.report) showReport(view.report);
      if (view.reload) await ctx.load();
      return;
    }
    ctx.setApplied(baselineOf(d));
    const out = applyOutcome(result);
    setApplyState(out.text, out.liveUrl ? '' : 'done');
    if (out.liveUrl) watchLive(out.liveUrl);
  }

  btn.addEventListener('click', async () => {
    if (applying) return;
    applying = true;
    const hadFocus = document.activeElement === btn;
    btn.disabled = true;
    clearReport();
    cancelLive();
    ctx.showError('');
    ctx.showNotice('');
    setApplyState(actionPendingText('apply'));
    try {
      await apply();
    } catch (err) {
      // Not the request (that is handled in apply): reading the draft, or an odd answer.
      setApplyState(err.message || 'Apply failed', 'error');
    } finally {
      applying = false;
      btn.disabled = false;
      // A disabled button loses focus: give it back to a keyboard user.
      if (hadFocus && (document.activeElement === document.body || !document.activeElement)) btn.focus();
    }
  });

  return {
    /** End the live check: the section was left. */
    stop() {
      if (!polling) return;
      cancelLive();
      setApplyState(LIVE_STOPPED_TEXT, 'done');
    },
  };
}
