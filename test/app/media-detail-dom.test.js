import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

// The Media detail panel's Credit fieldset in a real DOM (linkedom), with fetch stubbed.
const win = parseHTML(`<!doctype html><html><body><section id="media">
  <aside id="media-detail"><div id="media-detail-body"></div><p id="media-detail-status"></p></aside>
</section></body></html>`);
const GLOBALS = ['window', 'document', 'HTMLElement'];
const saved = {};
let createMediaDetail, puts, items, errors, timers;

before(async () => {
  for (const k of GLOBALS) { saved[k] = globalThis[k]; globalThis[k] = k === 'window' ? win : win[k]; }
  saved.fetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    if (init.method === 'PUT') {
      puts.push({ url: String(url), body });
      const id = decodeURIComponent(String(url).split('/').pop());
      const item = { ...items.find((i) => i.id === id), ...body };
      return Response.json(item);
    }
    return Response.json({});
  };
  ({ createMediaDetail } = await import('../../app/assets/js/media-detail.js'));
});
after(() => {
  for (const k of GLOBALS) globalThis[k] = saved[k];
  globalThis.fetch = saved.fetch;
});

const item = (id, o) => ({
  id, filename: `${id}.jpg`, original_name: `${id}.jpg`, mime_type: 'image/jpeg', kind: 'image', alt: 'A',
  created: '2026-11-01T00:00:00Z', missing: false, usedIn: [], source: 'pexels', credit: { name: 'Ana Lee', site: 'Pexels' }, ...o,
});
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

let detail;
beforeEach(() => {
  puts = [];
  errors = [];
  items = [item('a'), item('b', { credit: null, source: null })];
  win.document.querySelector('#media-detail-body').replaceChildren();
  detail = createMediaDetail({
    siteId: 's', base: '/api/sites/s', root: win.document.querySelector('#media'),
    host: {
      getItem: (id) => items.find((i) => i.id === id),
      replaceItem: (fresh) => { items = items.map((i) => (i.id === fresh.id ? fresh : i)); },
      showError: (m) => errors.push(m), deleted() {}, copySaved: async () => {}, refresh: async () => {},
    },
  });
});

const $ = (sel) => win.document.querySelector(sel);
function type(id, value) {
  const input = $(`#${id}`);
  input.value = value;
  input.dispatchEvent(new win.Event('input', { bubbles: true }));
}

describe('Credit fieldset autosave', () => {
  it('has no Save button: it saves itself', () => {
    detail.show(items[0]);
    assert.ok(!$('[data-action="save-credit"]'), 'no Save credit button'); // (never inspect a linkedom node)
  });

  it('editing then selecting another tile still sends the PUT', async () => {
    detail.show(items[0]);
    type('media-credit-name', 'Ana Lee-Smith');
    assert.equal(puts.length, 0); // waiting for the pause
    await detail.flush(); // what the page does before it shows another tile
    detail.show(items[1]);
    assert.equal(puts.length, 1);
    assert.equal(puts[0].url, '/api/sites/s/media/a');
    assert.deepEqual(puts[0].body, { credit: { name: 'Ana Lee-Smith', site: 'Pexels' } });
  });

  it('saves after a pause, and says so', async () => {
    detail.show(items[0]);
    type('media-credit-license', 'CC BY 4.0');
    await new Promise((resolve) => setTimeout(resolve, 700));
    await tick();
    assert.deepEqual(puts.map((p) => p.body), [{ credit: { name: 'Ana Lee', site: 'Pexels', license: 'CC BY 4.0' } }]);
    assert.equal($('#media-detail-status').textContent, 'Credit saved');
  });

  it('a refused link shows its message beside that field; the rest still saves', async () => {
    detail.show(items[0]);
    type('media-credit-url', 'javascript:alert(1)');
    type('media-credit-name', 'Ana');
    const input = $('#media-credit-url');
    assert.equal(input.getAttribute('aria-invalid'), 'true');
    const message = $(`#${input.getAttribute('aria-describedby')}`);
    assert.equal(message?.textContent, 'Links must start with http:// or https://');
    assert.ok(message.previousElementSibling === input, 'the message is beside the field');
    await detail.flush();
    assert.deepEqual(puts.map((p) => p.body), [{ credit: { name: 'Ana', site: 'Pexels' } }]);
  });

  it('clearing every field saves credit: null', async () => {
    detail.show(items[0]);
    type('media-credit-name', '');
    type('media-credit-site', '');
    await detail.flush();
    assert.deepEqual(puts.at(-1).body, { credit: null });
    assert.equal($('#media-detail-status').textContent, 'Credit removed');
  });

  it('announce() writes the panel status', () => {
    detail.show(items[0]);
    detail.announce('Added a.jpg to your library.');
    assert.equal($('#media-detail-status').textContent, 'Added a.jpg to your library.');
  });
});
