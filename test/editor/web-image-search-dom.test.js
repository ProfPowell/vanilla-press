import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

// <web-image-search> in a real DOM (linkedom), with fetch stubbed.
const win = parseHTML('<!doctype html><html><body></body></html>');
const GLOBALS = ['document', 'HTMLElement', 'customElements', 'CustomEvent', 'Event', 'Node'];
const saved = {};
let calls, answers, focused;

before(async () => {
  for (const k of GLOBALS) { saved[k] = globalThis[k]; globalThis[k] = win[k]; }
  saved.fetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const answer = answers.shift();
    return answer instanceof Response ? answer : Response.json(answer);
  };
  await import('../../editor/assets/js/components/web-image-search.js');
  // Record focus: linkedom has no focus model
  const proto = win.HTMLElement.prototype;
  const realFocus = proto.focus;
  proto.focus = function focus() { focused = this; return realFocus?.call(this); };
});
after(() => {
  for (const k of GLOBALS) globalThis[k] = saved[k];
  globalThis.fetch = saved.fetch;
});
beforeEach(() => { calls = []; answers = []; focused = null; win.document.body.replaceChildren(); });

const CREDIT = { name: 'Ana Lee', site: 'Pexels' };
const result = (id, over) => ({ source: 'pexels', id, mode: 'copy', thumb: 't.jpg', url: 'u.jpg', width: 800, height: 600, description: `Barn ${id}`, credit: CREDIT, ...over });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function mount(attrs = {}) {
  const el = win.document.createElement('web-image-search');
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  win.document.body.append(el);
  return el;
}

async function submit(el, q) {
  const input = el.querySelector('input');
  input.value = q;
  el.querySelector('form').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await tick(); await tick();
}

const names = (el) => [...el.querySelectorAll('.web-image-card button')].map((b) => b.getAttribute('aria-label'));

describe('<web-image-search>', () => {
  it('Escape in a filled box is left to the dialog: the box is a text input with the searchbox role', () => {
    // A type=search input clears itself on the first Escape (and the results with it) instead of closing the dialog
    const input = mount().querySelector('input');
    assert.equal(input.getAttribute('type'), 'text');
    assert.equal(input.getAttribute('role'), 'searchbox');
    assert.equal(input.closest('form').getAttribute('role'), 'search');
    assert.equal(input.labels?.[0]?.textContent ?? input.closest('form').querySelector(`label[for="${input.id}"]`).textContent, 'Search the web for images');
  });

  it('each card\'s buttons have their own accessible names', async () => {
    const el = mount();
    answers.push({ results: [result('1'), result('2', { description: '' }), result('3', { source: 'unsplash', mode: 'link', description: 'Hill' })], errors: [], hasMore: false });
    await submit(el, 'barn');
    assert.deepEqual(names(el), [
      'Insert: Barn 1', 'Edit first: Barn 1',
      'Insert: Photo by Ana Lee on Pexels', 'Edit first: Photo by Ana Lee on Pexels',
      'Insert: Hill',
    ]);
  });

  it('"Add" for the library, and credit as text', async () => {
    const el = mount({ for: 'library' });
    answers.push({ results: [result('1', { credit: { name: '<b>x</b>', site: 'Pexels' } })], errors: [], hasMore: false });
    await submit(el, 'barn');
    assert.ok(calls[0].includes('for=library'));
    assert.deepEqual(names(el), ['Add: Barn 1', 'Edit first: Barn 1']);
    const credit = el.querySelector('.web-image-credit');
    assert.equal(credit.textContent, 'Photo by <b>x</b> on Pexels');
    assert.equal(credit.querySelector('b'), null);
  });

  it('with no source ready, it says to turn one on in Services, with a link', async () => {
    const el = mount();
    answers.push({ results: [], errors: [], hasMore: false, ready: 0 });
    await submit(el, 'barn');
    const status = el.querySelector('.web-image-search-status');
    assert.equal(status.textContent, 'Turn on an image source in Services to search the web.');
    const link = status.querySelector('a');
    assert.equal(link.getAttribute('href'), '/app/services.html');
    // Opens in a new tab: the editor has no unsaved-changes guard, so navigating away could lose work.
    assert.equal(link.getAttribute('target'), '_blank');
    assert.equal(link.getAttribute('rel'), 'noopener');
    assert.equal(link.textContent, 'Services');
  });

  it('with sources ready and nothing found, it says no images found', async () => {
    const el = mount();
    answers.push({ results: [], errors: [], hasMore: false, ready: 2 });
    await submit(el, 'barn');
    const status = el.querySelector('.web-image-search-status');
    assert.equal(status.textContent, 'No images found for “barn”.');
    assert.equal(status.querySelector('a'), null);
  });

  it('when every source failed, it does not claim nothing was found', async () => {
    const el = mount();
    answers.push({ results: [], errors: [{ source: 'openverse', label: 'Openverse', message: "Openverse didn't answer in time. Try again in a moment." }], hasMore: false, ready: 1 });
    await submit(el, 'cat');
    const status = el.querySelector('.web-image-search-status');
    assert.equal(status.textContent, 'No images came back this time.');
  });

  it('per-source errors are announced, in a polite live region', async () => {
    const el = mount();
    answers.push({ results: [result('1')], errors: [{ source: 'pixabay', label: 'Pixabay', message: "Pixabay didn't accept the key" }], hasMore: false });
    await submit(el, 'barn');
    const lines = [...el.querySelectorAll('.web-image-search-error')];
    assert.deepEqual(lines.map((l) => l.textContent), ["Pixabay didn't accept the key"]);
    const region = lines[0].closest('[aria-live]');
    assert.equal(region?.getAttribute('aria-live'), 'polite');
  });

  it('Enter on the same query searches again (after an expired result)', async () => {
    const el = mount();
    answers.push({ results: [result('1')], errors: [], hasMore: false }, { results: [result('1')], errors: [], hasMore: false });
    await submit(el, 'barn');
    await submit(el, 'barn');
    assert.equal(calls.length, 2);
  });

  it('when Load more hides itself, focus moves to the first new result', async () => {
    const el = mount();
    answers.push({ results: [result('1')], errors: [], hasMore: true }, { results: [result('2')], errors: [], hasMore: false });
    await submit(el, 'barn');
    el.querySelector('.web-image-search-more').dispatchEvent(new win.Event('click'));
    await tick(); await tick();
    assert.ok(calls[1].includes('page=2'));
    assert.equal(el.querySelector('.web-image-search-more').hidden, true);
    assert.equal(focused?.getAttribute('aria-label'), 'Insert: Barn 2');
  });
});
