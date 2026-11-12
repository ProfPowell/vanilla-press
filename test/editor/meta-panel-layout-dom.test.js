import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { registerHooks } from 'node:module';

// editor.js pulls in ProseMirror through the browser's import map; the panel only
// needs its save hooks, so they are stubbed (resolve hook, panel-only).
const EDITOR_STUB = 'data:text/javascript,' + encodeURIComponent(
  'const n = () => {}; export const saveDocument = n, loadDocument = n, handleSaveError = n, loadVersionOnDisk = n,'
  + ' setSlugHandEdited = n, refreshMetaLine = n, metaEdited = n, deleteDoc = n, exportDocument = n, getEditorDoc = n;');
registerHooks({
  resolve(specifier, context, next) {
    if (/\/editor\.js$/.test(specifier)) {
      return { url: EDITOR_STUB, shortCircuit: true };
    }
    return next(specifier, context);
  },
});

// The Layout select in <meta-panel>, in a real DOM (linkedom), with fetch stubbed.
const win = parseHTML('<!doctype html><html><body></body></html>');
const GLOBALS = ['document', 'window', 'HTMLElement', 'customElements', 'CustomEvent', 'Event', 'Node'];
const saved = {};
let getCurrentMeta, resetCurrentMeta;
let layouts;
// linkedom's select.value is read-only; give it the browser's setter (select the matching option)
{
  const proto = Object.getPrototypeOf(win.document.createElement('select'));
  Object.defineProperty(proto, 'value', {
    configurable: true,
    get() { return (this.querySelector('option[selected]') ?? this.options[0])?.value; },
    set(v) { for (const o of this.options) { if (o.value === v) o.setAttribute('selected', ''); else o.removeAttribute('selected'); } },
  });
}
const OLD = "This site's Cook is too old for layouts built on other layouts; update cook-ssg";

before(async () => {
  for (const k of GLOBALS) { saved[k] = globalThis[k]; globalThis[k] = win[k]; }
  saved.fetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/layouts')) {
      if (layouts instanceof Error) throw layouts;
      return Response.json(layouts);
    }
    return Response.json({ value: '{}' });
  };
  ({ getCurrentMeta, resetCurrentMeta } = await import('../../editor/assets/js/meta-state.js'));
  await import('../../editor/assets/js/components/meta-panel.js');
});
after(() => {
  for (const k of GLOBALS) globalThis[k] = saved[k];
  globalThis.fetch = saved.fetch;
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
const LIST = {
  supported: true, message: '',
  layouts: [
    { name: 'wide', label: 'Wide', abstract: false, usable: true, editable: true, missing: false, slots: [] },
    { name: 'article', label: 'Article', abstract: false, usable: true, editable: true, missing: false, slots: [] },
    { name: 'kid', label: 'Kid', abstract: false, usable: false, editable: true, missing: false, slots: [] },
    { name: 'base', label: 'Base', abstract: true, usable: true, editable: true, missing: false, slots: [] },
  ],
};

async function mount(meta, listing) {
  layouts = listing;
  resetCurrentMeta({ collection: 'posts', ...meta });
  const panel = document.createElement('meta-panel');
  document.body.replaceChildren(panel);
  await tick();
  return panel;
}
const opts = (panel) => [...panel.querySelectorAll('#meta-layout option')];

describe('meta-panel Layout select', () => {
  it('follows Collection: default first, then layouts by label, unusable disabled', async () => {
    const panel = await mount({}, LIST);
    assert.equal(panel.querySelector('label[for="meta-layout"]').textContent, 'Layout');
    assert.deepEqual(opts(panel).map((o) => o.textContent), ['Collection default (post)', 'Article', 'Kid', 'Wide']);
    assert.equal(opts(panel)[2].disabled, true);
    assert.equal(panel.querySelector('#meta-layout').value, '');
    assert.equal(panel.querySelector('[data-layout-note]').hidden, true);
  });

  it('selects the document\'s layout; a deleted one shows as (missing) and is kept', async () => {
    const panel = await mount({ layout: 'gone' }, LIST);
    const select = panel.querySelector('#meta-layout');
    assert.equal(select.value, 'gone');
    assert.equal(opts(panel).at(-1).textContent, 'gone (missing)');
    assert.equal(getCurrentMeta().layout, 'gone');
  });

  it('shows the listing\'s message in a meta-note', async () => {
    const panel = await mount({}, { ...LIST, message: OLD });
    const note = panel.querySelector('p.meta-note');
    assert.equal(note.textContent, OLD);
    assert.equal(note.hidden, false);
  });

  it('a failed fetch leaves the default and the current value; the panel still works', async () => {
    const panel = await mount({ layout: 'wide' }, new Error('down'));
    assert.deepEqual(opts(panel).map((o) => o.textContent), ['Collection default (post)', 'wide (missing)']);
    assert.equal(panel.querySelector('#meta-layout').value, 'wide');
  });

  it('choosing a layout sets meta.layout and fires vp-layout-change with the listing', async () => {
    const panel = await mount({}, LIST);
    let detail = null;
    document.body.addEventListener('vp-layout-change', (e) => { detail = e.detail; });
    const select = panel.querySelector('#meta-layout');
    select.value = 'wide';
    select.dispatchEvent(new win.Event('change', { bubbles: true }));
    assert.equal(getCurrentMeta().layout, 'wide');
    assert.equal(detail.layout, 'wide');
    assert.equal(detail.listing.layouts.length, 4);
  });

  it('choosing the default clears it', async () => {
    const panel = await mount({ layout: 'wide' }, LIST);
    let detail = null;
    document.body.addEventListener('vp-layout-change', (e) => { detail = e.detail; });
    const select = panel.querySelector('#meta-layout');
    select.value = '';
    select.dispatchEvent(new win.Event('change', { bubbles: true }));
    assert.equal(getCurrentMeta().layout, '');
    assert.equal(detail.layout, '');
  });
});
