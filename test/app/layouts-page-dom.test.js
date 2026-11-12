import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';

// The Layouts section in a real DOM (linkedom), with fetch stubbed. Never hand a linkedom node to assert.
const page = readFileSync(new URL('../../app/site.html', import.meta.url), 'utf8');
const win = parseHTML(page.replace(/<script[^>]*><\/script>/g, ''));
const GLOBALS = ['window', 'document', 'HTMLElement', 'Event'];
const saved = {};
let initLayoutsSection, listing, calls, responders;

const entry = (o) => ({
  name: 'post', kind: 'layout', label: 'Post', status: 'editable', problems: [], parent: null,
  baseFor: [], usedBy: [], unpublished: false, ...o,
});
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const settle = async () => { for (let i = 0; i < 5; i++) await tick(); };

before(async () => {
  for (const k of GLOBALS) { saved[k] = globalThis[k]; globalThis[k] = k === 'window' ? win : win[k]; }
  // linkedom has no modal dialogs
  const proto = Object.getPrototypeOf(win.document.createElement('dialog'));
  proto.showModal = function showModal() { this.setAttribute('open', ''); };
  proto.close = function close() { this.removeAttribute('open'); this.dispatchEvent(new win.Event('close')); };
  Object.defineProperty(proto, 'open', { configurable: true, get() { return this.hasAttribute('open'); } });
  saved.fetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method, url: String(url), body });
    const r = responders[`${method} ${String(url).replace(/^.*layout-files/, '')}`];
    if (r) return r(body);
    if (method === 'GET') return Response.json(listing);
    return Response.json({});
  };
  ({ initLayoutsSection } = await import('../../app/assets/js/layouts-page.js'));
});
after(() => {
  for (const k of GLOBALS) globalThis[k] = saved[k];
  globalThis.fetch = saved.fetch;
});

const $ = (id) => win.document.getElementById(id);
const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();
const rows = () => [...$('layouts-list').querySelectorAll('li')];
const button = (scope, label) => [...scope.querySelectorAll('button, a')].find((b) => text(b) === label);

let section;
beforeEach(async () => {
  calls = [];
  responders = {};
  listing = {
    supported: true, message: null, deleted: [],
    layouts: [entry({ name: 'base', label: 'Base', baseFor: ['post'] }), entry({ name: 'post', parent: 'base', usedBy: ['src/posts/a.html'] })],
    includes: [],
  };
  section = await initLayoutsSection({ siteId: 'my site', root: $('layouts-section') });
  await section.show();
  await settle();
});

describe('Layouts section', () => {
  it('lists layouts with Open linking to the editor', () => {
    assert.equal(rows().length, 2);
    assert.match(text(rows()[1]), /Post/);
    assert.match(text(rows()[1]), /Used by 1 page/);
    assert.match(text(rows()[1]), /Built on base/);
    const open = button(rows()[1], 'Open');
    assert.equal(open.getAttribute('href'), '/editor/layout.html?site=my%20site&kind=layout&name=post');
  });

  it('shows Publish layout only when something is unpublished, and marks the file', async () => {
    assert.equal($('layouts-publish').hidden, true);
    listing.layouts[0].unpublished = true;
    await section.refresh();
    assert.equal($('layouts-publish').hidden, false);
    assert.match(text(rows()[0]), /Not published/);
    assert.doesNotMatch(text(rows()[1]), /Not published/);
  });

  it('shows a deleted file as deleted and not published, with no actions', async () => {
    listing.deleted = [{ kind: 'layout', name: 'gone' }];
    await section.refresh();
    const gone = rows().find((r) => /gone/.test(text(r)));
    assert.match(text(gone), /gone — deleted, Not published/);
    assert.equal(gone.querySelectorAll('button, a').length, 0);
    assert.equal($('layouts-publish').hidden, false);
  });

  it('refuses Delete for a used layout and names the users', () => {
    const del = button(rows()[0], 'Delete');
    assert.equal(del.hasAttribute('disabled'), true);
    assert.match(text(rows()[0]), /Base for: post/);
    assert.match(text(rows()[0]), /can't be deleted/);
    assert.equal(button(rows()[1], 'Delete').hasAttribute('disabled'), true);
  });

  it('shows a server refusal when a delete turns out to be blocked', async () => {
    listing.layouts = [entry({})];
    await section.refresh();
    responders['DELETE /layout/post'] = () => Response.json({ error: 'in use', usedBy: ['src/posts/z.html'], baseFor: [] }, { status: 409 });
    button(rows()[0], 'Delete').click();
    assert.match(text($('layouts-confirm-title')), /Delete Post/);
    $('layouts-confirm-form').onsubmit(new win.Event('submit'));
    await settle();
    assert.match(text($('layouts-confirm-error')), /Used by 1 page \(src\/posts\/z\.html\)/);
    assert.equal($('layouts-confirm-dialog').open, true);
  });

  it('deletes after the dialog confirms', async () => {
    listing.layouts = [entry({})];
    await section.refresh();
    button(rows()[0], 'Delete').click();
    $('layouts-confirm-form').onsubmit(new win.Event('submit'));
    await settle();
    assert.ok(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/layout-files/layout/post')));
    assert.equal($('layouts-confirm-dialog').open, false);
  });

  it('creates a layout from the New layout dialog', async () => {
    responders['POST '] = () => Response.json({ name: 'my-page', hash: 'h' }, { status: 201 });
    $('layouts-new').click();
    assert.equal($('layouts-new-dialog').open, true);
    assert.deepEqual([...$('layouts-new-start').querySelectorAll('option')].map((o) => text(o)),
      ['Built on Base', 'Built on Post', 'Copy of Base', 'Copy of Post', 'Blank base']);
    $('layouts-new-label').value = 'My Page';
    $('layouts-new-label').dispatchEvent(new win.Event('input'));
    assert.equal($('layouts-new-name').value, 'my-page');
    for (const o of $('layouts-new-start').querySelectorAll('option')) { if (o.value === 'child:post') o.setAttribute('selected', ''); else o.removeAttribute('selected'); }
    $('layouts-new-form').onsubmit(new win.Event('submit'));
    await settle();
    const post = calls.find((c) => c.method === 'POST');
    assert.deepEqual(post.body, { kind: 'layout', name: 'my-page', label: 'My Page', start: { type: 'child', from: 'post' } });
    assert.equal($('layouts-new-dialog').open, false);
  });

  it('refuses a bad name without calling the server, and shows an existing-name conflict', async () => {
    $('layouts-new').click();
    $('layouts-new-label').value = 'X';
    $('layouts-new-name').value = '-bad';
    $('layouts-new-form').onsubmit(new win.Event('submit'));
    await settle();
    assert.match(text($('layouts-new-error')), /name/);
    assert.equal(calls.some((c) => c.method === 'POST'), false);
    responders['POST '] = () => Response.json({ error: 'A layout named x already exists' }, { status: 409 });
    $('layouts-new-name').value = 'x';
    $('layouts-new-form').onsubmit(new win.Event('submit'));
    await settle();
    assert.match(text($('layouts-new-error')), /already exists/);
  });

  it('duplicates as a copy of that file', async () => {
    button(rows()[1], 'Duplicate').click();
    assert.equal([...$('layouts-new-start').querySelectorAll('option')].find((o) => o.selected).value, 'copy:post');
    assert.equal($('layouts-new-label').value, 'Post copy');
    assert.equal($('layouts-new-name').value, 'post-copy');
  });

  it('publishes with explicit names after the dialog lists each file', async () => {
    listing.layouts[1].unpublished = true;
    listing.deleted = [{ kind: 'include', name: 'old' }];
    await section.refresh();
    responders['POST /publish'] = () => Response.json({ status: 'pushed', sha: 'abc' });
    $('layouts-publish').click();
    assert.match(text($('layouts-confirm-list')), /Post/);
    assert.match(text($('layouts-confirm-list')), /Used by 1 page/);
    assert.match(text($('layouts-confirm-list')), /old/);
    $('layouts-confirm-form').onsubmit(new win.Event('submit'));
    await settle();
    const pub = calls.find((c) => c.url.endsWith('/publish'));
    assert.deepEqual(pub.body, { files: [{ kind: 'layout', name: 'post' }, { kind: 'include', name: 'old' }] });
    assert.match(text($('layouts-result')), /Published/);
    assert.equal($('layouts-confirm-dialog').open, false);
  });

  it('says the layout was committed when the push fails', async () => {
    listing.layouts[1].unpublished = true;
    await section.refresh();
    responders['POST /publish'] = () => Response.json({ committed: true, error: 'offline', sha: 'abc' }, { status: 502 });
    $('layouts-publish').click();
    $('layouts-confirm-form').onsubmit(new win.Event('submit'));
    await settle();
    assert.match(text($('layouts-result')), /committed/i);
    assert.match(text($('layouts-result')), /next backup/);
  });

  it('keeps the dialog open with the problems when publish is refused', async () => {
    listing.layouts[1].unpublished = true;
    await section.refresh();
    responders['POST /publish'] = () => Response.json({ error: 'Fix these layouts before publishing', problems: [{ name: 'post', message: 'bad slot' }] }, { status: 409 });
    $('layouts-publish').click();
    $('layouts-confirm-form').onsubmit(new win.Event('submit'));
    await settle();
    assert.match(text($('layouts-confirm-error')), /Fix these layouts before publishing/);
    assert.equal($('layouts-confirm-dialog').open, true);
  });

  it('shows problems for a layout that cannot be edited', async () => {
    listing.layouts = [entry({ status: 'problems', problems: [{ line: 2, message: 'one' }, { line: 4, message: 'two' }] })];
    await section.refresh();
    assert.match(text(rows()[0]), /Can't be edited here: one/);
    assert.equal(button(rows()[0], 'Open'), undefined);
    const show = button(rows()[0], 'Show all problems');
    const list = rows()[0].querySelector('.layouts-problems');
    assert.equal(list.hidden, true);
    show.click();
    assert.equal(list.hidden, false);
    assert.match(text(list), /Line 4: two/);
  });

  it('shows the old-Cook message for an unsupported site', async () => {
    listing = { supported: false, message: "This site's Cook is too old to edit layouts; update cook-ssg", deleted: [],
      layouts: [entry({ name: 'page', label: 'page', status: 'plain', unpublished: true })], includes: [] };
    await section.refresh();
    assert.match(text($('layouts-old')), /too old to edit layouts; update cook-ssg/);
    assert.equal($('layouts-old').hidden, false);
    assert.equal($('layouts-new').hidden, true);
    assert.equal(rows().length, 1);
    assert.equal(rows()[0].querySelectorAll('button, a').length, 0);
    assert.equal($('layouts-publish').hidden, true);
  });

  it('offers Duplicate only on layouts that can be opened', async () => {
    listing.layouts = [entry({ status: 'plain' })];
    await section.refresh();
    assert.equal(button(rows()[0], 'Duplicate'), undefined);
  });

  it('does not print undefined when a failed push has no error text', async () => {
    listing.layouts[1].unpublished = true;
    await section.refresh();
    responders['POST /publish'] = () => Response.json({ committed: true }, { status: 502 });
    $('layouts-publish').click();
    $('layouts-confirm-form').onsubmit(new win.Event('submit'));
    await settle();
    assert.doesNotMatch(text($('layouts-result')), /undefined/);
    assert.match(text($('layouts-result')), /next backup/);
  });
});
