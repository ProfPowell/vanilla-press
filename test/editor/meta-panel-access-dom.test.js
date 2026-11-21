import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { registerHooks } from 'node:module';

// editor.js pulls in ProseMirror through the browser's import map; the panel only
// needs its save hooks, so they are stubbed (resolve hook, panel-only).
const EDITOR_STUB = 'data:text/javascript,' + encodeURIComponent(
  'const n = () => {}; export const saveDocument = n, loadDocument = n, handleSaveError = n, loadVersionOnDisk = n,'
  + ' setSlugHandEdited = n, refreshMetaLine = n, metaEdited = n, deleteDoc = n, exportDocument = n, getEditorDoc = n,'
  + ' getPostVersions = async () => [], versionDifferences = () => [], canRestoreVersion = () => true, restoreVersion = n;');
registerHooks({
  resolve(specifier, context, next) {
    if (/\/editor\.js$/.test(specifier)) {
      return { url: EDITOR_STUB, shortCircuit: true };
    }
    return next(specifier, context);
  },
});

// The Who can see this select in <meta-panel>, in a real DOM (linkedom), with fetch stubbed.
const win = parseHTML('<!doctype html><html><body></body></html>');
const GLOBALS = ['document', 'window', 'HTMLElement', 'customElements', 'CustomEvent', 'Event', 'Node'];
const saved = {};
let getCurrentMeta, resetCurrentMeta;
let sections;
// linkedom's select.value is read-only; give it the browser's setter (select the matching option)
{
  const proto = Object.getPrototypeOf(win.document.createElement('select'));
  Object.defineProperty(proto, 'value', {
    configurable: true,
    get() { return (this.querySelector('option[selected]') ?? this.options[0])?.value; },
    set(v) { for (const o of this.options) { if (o.value === v) o.setAttribute('selected', ''); else o.removeAttribute('selected'); } },
  });
}

before(async () => {
  for (const k of GLOBALS) { saved[k] = globalThis[k]; globalThis[k] = win[k]; }
  saved.fetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/sections')) return Response.json({ sections });
    if (String(url).includes('/layouts')) return Response.json({ supported: false, message: '', layouts: [] });
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
async function mount(meta, list = []) {
  sections = list;
  resetCurrentMeta({ collection: 'posts', ...meta });
  const panel = document.createElement('meta-panel');
  document.body.replaceChildren(panel);
  await tick();
  return panel;
}
const enabled = (panel) => [...panel.querySelectorAll('#meta-access option')].filter((o) => !o.disabled).map((o) => o.value);

describe('meta-panel Who can see this', () => {
  it('Public by default, all three choices, no section line', async () => {
    const panel = await mount({});
    assert.equal(panel.querySelector('label[for="meta-access"]').textContent, 'Who can see this');
    assert.deepEqual([...panel.querySelectorAll('#meta-access option')].map((o) => o.textContent), ['Public', 'Friends', 'Private']);
    assert.equal(panel.querySelector('#meta-access').value, 'public');
    assert.equal(panel.querySelector('[data-access-line]').hidden, true);
    assert.equal(panel.querySelector('[data-access-note]').hidden, true);
  });

  it("a friends section: the line shows, Public is disabled, and a lower stored level shows the section's with a note, unrewritten", async () => {
    const panel = await mount({ section: 'art', access: undefined }, [{ id: 'art', label: 'Art', access: 'friends' }]);
    const line = panel.querySelector('[data-access-line]');
    assert.equal(line.hidden, false);
    assert.equal(line.textContent, 'Section: Art — 🔒 Friends');
    assert.deepEqual(enabled(panel), ['friends', 'private']);
    assert.equal(panel.querySelector('#meta-access').value, 'friends');
    assert.equal(panel.querySelector('[data-access-note]').hidden, false);
    assert.equal(getCurrentMeta().access, undefined);
  });

  it('a public or unknown section shows nothing', async () => {
    const panel = await mount({ section: 'news' }, [{ id: 'news', label: 'News', access: null }]);
    assert.equal(panel.querySelector('[data-access-line]').hidden, true);
    const other = await mount({ section: 'gone' }, []);
    assert.equal(other.querySelector('[data-access-line]').hidden, true);
  });

  it('choosing a level sets meta.access', async () => {
    const panel = await mount({});
    const select = panel.querySelector('#meta-access');
    select.value = 'friends';
    select.dispatchEvent(new win.Event('change', { bubbles: true }));
    assert.equal(getCurrentMeta().access, 'friends');
  });
});
