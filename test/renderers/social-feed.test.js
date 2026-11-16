import { readFileSync } from 'node:fs';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { DOMParser } from 'prosemirror-model';
import { render } from '../../src/renderers/html.js';
import { render as renderMd } from '../../src/renderers/markdown.js';
import { schema } from '../../editor/assets/js/schema.js';
import { fromBlockAst, toBlockAst } from '../../editor/assets/js/ast.js';
import { createComponentElement } from '../../editor/assets/js/component-loader.js';
import {
  SOCIAL_FEED_TAG, FEED_EMPTY_COPY, FEED_OLD_COOK_COPY, socialFeedQuery, applyFeedPreview,
} from '../../editor/assets/js/social-feed-preview.js';
import { previewPlan } from '../../editor/assets/js/social-links-preview.js';
import { CATALOG } from '../../src/components/catalog.js';
import { describeComponents, componentIndex } from '../../src/components/describe.js';
import { normalizeComponents } from '../../src/components/normalize.js';
import { validate } from '../../src/schema/validate.js';

const block = (b) => render(b, { scope: 'block' });
const { document } = parseHTML('<!doctype html><html><body></body></html>');
let saved;
before(() => { saved = globalThis.document; globalThis.document = document; });
after(() => { globalThis.document = saved; });

const KEYS = 'bluesky:alice.example.com,github:carol-dev';
// What Cook would write inside the element (enough of it to prove it never reaches the save).
const FILLED = '<activity-feed aria-label="Recent posts" data-infinite><article data-activity data-id="bluesky:1" data-service="bluesky"><p class="social-feed-text">hi</p></article></activity-feed>'
  + '<script type="application/json" class="social-feed-state">{"accounts":[]}</script>';
const index = () => componentIndex(describeComponents({ siteDir: null, vpRoot: process.cwd() }), { enabledOnly: false });
/** Save path: PM doc → block AST → server normalization (drops undeclared attrs) → HTML. */
const savedHtml = (pmDoc) => {
  const { doc } = normalizeComponents({ type: 'document', meta: {}, blocks: toBlockAst(pmDoc) }, index());
  return doc.blocks.map(block).join('\n');
};

describe('social-feed: always saved empty (Review Focus 1)', () => {
  it('rendered <social-feed> is empty even after the editor preview filled it', () => {
    const attrs = { accounts: KEYS, items: 12, height: '20rem', 'hide-counts': true, tags: 'webdev' };
    const pmDoc = fromBlockAst([{ type: 'component', tag: 'social-feed', attrs }], schema);
    const node = pmDoc.child(1);
    assert.equal(node.type.name, 'component_leaf');

    // The live element as the editor shows it: preview filled, then VB's runtime marks it.
    const el = createComponentElement('social-feed', node.attrs.attrs);
    applyFeedPreview(el, { kind: 'html', html: FILLED }, 'site');
    el.setAttribute('style', '--social-feed-height: 20rem');
    el.setAttribute('data-upgraded', '');
    assert.ok(el.querySelector('activity-feed'), 'the preview filled the live element');

    const html = savedHtml(pmDoc);
    assert.equal(html, `<social-feed accounts="${KEYS}" height="20rem" hide-counts items="12" tags="webdev"></social-feed>`);
    assert.doesNotMatch(html, /style=|data-upgraded|activity-feed|social-feed-state/);
  });

  it('a node that somehow carries runtime attributes, children or a value still saves only the authored attributes, empty', () => {
    const p = { type: 'paragraph', children: [{ type: 'text', value: 'x' }] };
    const ast = {
      type: 'document', meta: {},
      blocks: [{ type: 'component', tag: 'social-feed', attrs: { accounts: KEYS, style: '--social-feed-height: 32rem', 'data-upgraded': true }, children: [p], value: FILLED }],
    };
    const { doc, dropped } = normalizeComponents(ast, index());
    assert.deepEqual(dropped.map((d) => d.attr).sort(), ['data-upgraded', 'style']);
    assert.equal(block(doc.blocks[0]), `<social-feed accounts="${KEYS}"></social-feed>`);
    assert.equal(renderMd({ type: 'document', meta: {}, blocks: [{ type: 'component', tag: 'social-feed', attrs: {}, value: 'z' }] })
      .includes('<social-feed></social-feed>'), true);
  });

  it('a filled <social-feed> pasted as HTML does not become a node with content', () => {
    const el = document.createElement('div');
    el.innerHTML = `<social-feed accounts="${KEYS}" style="--social-feed-height: 32rem" data-upgraded>${FILLED}</social-feed>`;
    const found = [];
    DOMParser.fromSchema(schema).parseSlice(el).content.descendants((n) => { found.push(n); });
    for (const n of found) if (n.type.name === 'component_leaf') assert.equal(n.attrs.value, null);
    assert.equal(block({ type: 'component', tag: 'social-feed', attrs: { accounts: KEYS }, value: FILLED }), `<social-feed accounts="${KEYS}"></social-feed>`);
  });
});

describe('social-feed: catalog', () => {
  const vb = CATALOG.find((e) => e.package === 'vanilla-breeze');
  const entry = vb.elements.find((e) => e.tag === 'social-feed');
  it('catalog has social-feed with the five attributes', () => {
    assert.equal(entry.label, 'Social feed');
    assert.equal(entry.group, 'Embeds');
    assert.equal(entry.kind, 'none');
    assert.equal(entry.description, 'Recent posts and releases from your accounts, from Social.');
    assert.equal(entry.icon, vb.elements.find((e) => e.tag === 'social-links').icon);
    assert.deepEqual(entry.defaults, { items: 12 });
    assert.deepEqual(entry.advanced, ['height', 'hide-counts']);
    assert.deepEqual(entry.attributes.map((a) => [a.name, a.type]), [
      ['accounts', 'accounts'], ['tags', 'string'], ['items', 'number'], ['height', 'string'], ['hide-counts', 'boolean'],
    ]);
  });
  it('its descriptor lists the five attributes with their types', () => {
    const el = index().get('social-feed');
    assert.deepEqual(Object.fromEntries(el.attributes.map((a) => [a.name, a.type])),
      { accounts: 'accounts', tags: 'string', items: 'number', height: 'string', 'hide-counts': 'boolean' });
  });
});

describe('social-feed: a save validates', () => {
  it('an accounts list is a string attribute to the server (normalized and validated)', () => {
    const ast = { id: 'p', type: 'document', meta: { title: 'T', slug: 'p', collection: 'posts', status: 'draft' }, blocks: [{ type: 'component', tag: 'social-feed', attrs: { accounts: KEYS, items: '5', 'hide-counts': 'true' } }] };
    const { doc } = normalizeComponents(ast, index());
    assert.deepEqual(doc.blocks[0].attrs, { accounts: KEYS, items: 5, 'hide-counts': true });
    const r = validate(doc, { components: index() });
    assert.deepEqual(r.errors, []);
    const bad = validate({ ...doc, blocks: [{ type: 'component', tag: 'social-feed', attrs: { accounts: 3 } }] }, { components: index() });
    assert.match(bad.errors.join('\n'), /attr "accounts" must be a string/);
  });
});

describe('social-feed preview', () => {
  it('is the social-feed tag', () => assert.equal(SOCIAL_FEED_TAG, 'social-feed'));
  it('builds the route query from the node attrs', () => {
    assert.deepEqual(socialFeedQuery({ accounts: KEYS, tags: 'a,b', items: 5, height: '9rem', 'hide-counts': true }),
      { accounts: KEYS, tags: 'a,b', items: '5', 'hide-counts': 'true' });
    assert.deepEqual(socialFeedQuery({ accounts: ' ', items: 12 }), { items: '12' });
    assert.deepEqual(socialFeedQuery(null), {});
  });
  it('no feed accounts: the exact copy, linking to the Social section', () => {
    const el = document.createElement('social-feed');
    applyFeedPreview(el, previewPlan({ html: '' }), 'my site');
    const a = el.querySelector('a');
    assert.equal(a.textContent, 'No accounts yet: add them in Social');
    assert.equal(FEED_EMPTY_COPY, 'No accounts yet: add them in Social');
    assert.equal(a.getAttribute('href'), '/app/site.html?site=my%20site&section=social');
    assert.equal(el.hasAttribute('data-preview-note'), true);
  });
  it('Cook too old: the exact copy', () => {
    const el = document.createElement('social-feed');
    applyFeedPreview(el, previewPlan(null, Object.assign(new Error('x'), { status: 409 })), 's');
    assert.equal(el.textContent, "This site's Cook is too old to preview the social feed: update Cook");
    assert.equal(FEED_OLD_COOK_COPY, el.textContent);
  });
  it('puts Cook\'s html in the element; an error clears it', () => {
    const el = document.createElement('social-feed');
    applyFeedPreview(el, { kind: 'html', html: FILLED }, 's');
    assert.ok(el.querySelector('activity-feed article[data-id="bluesky:1"]'));
    assert.equal(el.hasAttribute('data-preview-note'), false);
    applyFeedPreview(el, previewPlan(null, new Error('boom')), 's');
    assert.equal(el.innerHTML, '');
  });
  it('the filled preview is inert: no state script and no data-infinite, so the live element never fetches (even after a reconnect)', () => {
    const el = document.createElement('social-feed');
    applyFeedPreview(el, { kind: 'html', html: FILLED }, 's');
    assert.ok(el.querySelector('activity-feed article[data-id="bluesky:1"]'), 'the entries still show');
    assert.ok(!el.querySelector('script.social-feed-state'), 'VB reads its state (and so its accounts) from this script');
    assert.equal(el.querySelector('activity-feed').hasAttribute('data-infinite'), false, 'no load-more');
  });
  it('the editor CSS displays a noted element', () => {
    const css = readFileSync(new URL('../../editor/assets/css/_component-settings.css', import.meta.url), 'utf8');
    assert.match(css, /social-feed\[data-preview-note\][^{]*\{[^}]*display:\s*block/);
  });
});
