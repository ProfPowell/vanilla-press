import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { parseHTML } from 'linkedom';

// "Edit first" in a real DOM (linkedom): the <image-editor> module is an empty
// stand-in (its element is never defined, so each test gives it a getBlob),
// fetch serves the result's bytes, and XMLHttpRequest records the upload.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '/assets/image-editor/image-editor.js') {
      return { url: 'data:text/javascript,export {}', shortCircuit: true };
    }
    return next(specifier, context);
  },
});

const win = parseHTML('<!doctype html><html><body></body></html>');
const GLOBALS = ['document', 'HTMLElement', 'customElements', 'CustomEvent', 'Event', 'Node'];
const saved = {};
let uploads;

class FakeXHR {
  constructor() { this.upload = {}; }
  open(method, url) { this.method = method; this.url = url; }
  send(form) {
    uploads.push(form);
    this.status = 201;
    this.responseText = JSON.stringify({ id: 'm9', filename: 'openverse-1.jpg', kind: 'image' });
    queueMicrotask(() => this.onload());
  }
}

let chooseWebImage;
before(async () => {
  for (const k of GLOBALS) { saved[k] = globalThis[k]; globalThis[k] = win[k]; }
  for (const k of ['fetch', 'createImageBitmap', 'XMLHttpRequest']) saved[k] = globalThis[k];
  globalThis.fetch = async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/jpeg' } });
  // Small enough that it is never re-encoded on a canvas
  globalThis.createImageBitmap = async () => ({ width: 100, height: 80, close() {} });
  globalThis.XMLHttpRequest = FakeXHR;
  ({ chooseWebImage } = await import('../../editor/assets/js/web-image-flow.js'));
});
after(() => {
  for (const k of [...GLOBALS, 'fetch', 'createImageBitmap', 'XMLHttpRequest']) globalThis[k] = saved[k];
});
beforeEach(() => { uploads = []; win.document.body.replaceChildren(); });

const CREDIT = { name: 'Jane', site: 'Flickr', license: 'CC BY 2.0' };
const result = { source: 'openverse', id: '1', mode: 'copy', width: 100, height: 80, description: 'A fox', credit: CREDIT };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Start "Edit first" in a slot inside a picker; resolves once the editor shows. */
async function editFirst() {
  const picker = win.document.createElement('dialog');
  const slot = win.document.createElement('div');
  picker.append(slot);
  win.document.body.append(picker);
  let settled = false;
  const done = chooseWebImage(result, { edit: true, editIn: slot }).finally(() => { settled = true; });
  for (let i = 0; i < 50 && !slot.querySelector('image-editor'); i++) await tick();
  const editor = slot.querySelector('image-editor');
  assert.ok(editor, 'the image editor shows');
  editor.getBlob = async () => new Blob([new Uint8Array([4, 5, 6])], { type: 'image/jpeg' });
  return { picker, slot, editor, done, settled: () => settled };
}

function escape(target) {
  const e = new win.Event('keydown', { bubbles: true, cancelable: true });
  e.key = 'Escape';
  target.dispatchEvent(e);
  return e;
}

const click = (el) => el.dispatchEvent(new win.Event('click', { bubbles: true }));
const fields = (form) => Object.fromEntries([...form.keys()].filter((k) => k !== 'file').map((k) => [k, form.get(k)]));

describe('Edit first: Escape', () => {
  it('Escape in the editor never reaches the picker, and goes back to the results', async () => {
    const { picker, slot, editor, done } = await editFirst();
    let pickerSawEscape = false;
    picker.addEventListener('keydown', (e) => { if (!e.defaultPrevented) pickerSawEscape = true; });
    const e = escape(editor);
    assert.equal(e.defaultPrevented, true, "the dialog's own Escape (close the picker) is prevented");
    assert.equal(pickerSawEscape, false);
    assert.equal(await done, null);
    assert.equal(slot.hidden, true);
    assert.equal(slot.querySelector('image-editor'), null);
    assert.equal(uploads.length, 0);
  });

  it('with an editor tool open, Escape is the tool\'s: the editor stays', async () => {
    const { slot, editor, settled } = await editFirst();
    editor.currentTool = 'crop';
    assert.equal(escape(editor).defaultPrevented, true);
    await tick();
    assert.equal(settled(), false);
    assert.ok(slot.querySelector('image-editor'));
  });
});

describe('Edit first: Save', () => {
  it('the result, edited, uploads with its credit marked adapted, its alt and source', async () => {
    const { slot, editor, done } = await editFirst();
    editor.dispatchEvent(new win.Event('image-load'));
    click(slot.querySelector('[data-action="save-edit"]'));
    assert.equal((await done).id, 'm9');
    assert.equal(uploads.length, 1);
    assert.deepEqual(fields(uploads[0]), {
      alt: 'A fox', credit: JSON.stringify({ ...CREDIT, adapted: true }), source: 'openverse',
    });
  });

  it('a second picture loaded in the editor uploads with no credit, alt or source', async () => {
    const { slot, editor, done } = await editFirst();
    editor.dispatchEvent(new win.Event('image-load')); // the result
    editor.dispatchEvent(new win.Event('image-load')); // a picture the writer opened or dropped
    assert.match(slot.querySelector('.web-image-edit-note').textContent, /different picture/);
    click(slot.querySelector('[data-action="save-edit"]'));
    assert.equal((await done).id, 'm9');
    assert.equal(uploads.length, 1);
    assert.deepEqual(fields(uploads[0]), {});
    assert.ok(uploads[0].get('file'));
  });
});
