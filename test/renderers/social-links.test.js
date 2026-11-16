import { readFileSync } from 'node:fs';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { DOMParser } from 'prosemirror-model';
import { render } from '../../src/renderers/html.js';
import { render as renderMd } from '../../src/renderers/markdown.js';
import { schema } from '../../editor/assets/js/schema.js';
import {
  EMPTY_COPY, socialPreviewQuery, previewPlan, applyPreview,
} from '../../editor/assets/js/social-links-preview.js';
import { CATALOG } from '../../src/components/catalog.js';
import { describeComponents } from '../../src/components/describe.js';

const block = (b) => render(b, { scope: 'block' });
const { document } = parseHTML('<!doctype html><html><body></body></html>');
let saved;
before(() => { saved = globalThis.document; globalThis.document = document; });
after(() => { globalThis.document = saved; });

describe('social-links: always saved empty', () => {
  it('renders empty with its attributes', () => {
    assert.equal(block({ type: 'component', tag: 'social-links', attrs: { variant: 'icon-label' } }),
      '<social-links variant="icon-label"></social-links>');
  });
  it('stays empty even if the stored node carries children or a value', () => {
    const p = { type: 'paragraph', children: [{ type: 'text', value: 'x' }] };
    assert.equal(block({ type: 'component', tag: 'social-links', attrs: { variant: 'icon' }, children: [p], value: '<ul></ul>' }),
      '<social-links variant="icon"></social-links>');
    assert.equal(renderMd({ type: 'document', meta: {}, blocks: [{ type: 'component', tag: 'social-links', attrs: {}, value: 'z' }] }).includes('<social-links></social-links>'), true);
  });
  it('a filled <social-links> pasted or loaded as HTML does not become a node with content', () => {
    const el = document.createElement('div');
    el.innerHTML = '<social-links variant="icon"><ul><li><a href="https://x.test">X</a></li></ul></social-links>';
    const found = [];
    DOMParser.fromSchema(schema).parseSlice(el).content.descendants((n) => { found.push(n); });
    for (const n of found) if (n.type.name === 'component_leaf') assert.equal(n.attrs.value, null);
    const doc = render({ type: 'component', tag: 'social-links', attrs: { variant: 'icon' }, value: found.map(n => n.textContent).join('') }, { scope: 'block' });
    assert.equal(doc, '<social-links variant="icon"></social-links>');
  });
});

describe('social-links: catalog', () => {
  const vb = CATALOG.find((e) => e.package === 'vanilla-breeze');
  const entry = vb.elements.find((e) => e.tag === 'social-links');
  it('has the Profile links entry', () => {
    assert.equal(entry.label, 'Profile links');
    assert.equal(entry.group, 'Embeds');
    assert.equal(entry.kind, 'none');
    assert.deepEqual(entry.defaults, { variant: 'icon-label' });
    assert.deepEqual(entry.advanced, ['color']);
  });
  it('carries services, variant and color without the manifest', () => {
    const by = Object.fromEntries(entry.attributes.map((a) => [a.name, a]));
    assert.equal(by.services.type, 'string');
    assert.deepEqual(by.variant.enum, ['icon', 'label', 'icon-label']);
    assert.equal(by.color.type, 'boolean');
  });
  it('its descriptor lists the three attributes', () => {
    const el = describeComponents({ siteDir: null, vpRoot: process.cwd() })
      .flatMap((p) => p.elements).find((e) => e.tag === 'social-links');
    assert.deepEqual(el.attributes.map((a) => a.name).sort(), ['color', 'services', 'variant']);
  });
});

describe('social-links preview', () => {
  it('builds the query from the node attrs', () => {
    assert.deepEqual(socialPreviewQuery({ variant: 'icon', services: 'github, bluesky' }), { services: 'github, bluesky', variant: 'icon' });
    assert.deepEqual(socialPreviewQuery({}), {});
  });
  it('plans: html, empty, too old, nothing', () => {
    assert.deepEqual(previewPlan({ html: '<ul></ul>' }), { kind: 'html', html: '<ul></ul>' });
    assert.deepEqual(previewPlan({ html: '' }), { kind: 'empty' });
    assert.deepEqual(previewPlan(null, Object.assign(new Error('x'), { status: 409 })), { kind: 'old' });
    assert.deepEqual(previewPlan(null, new Error('boom')), { kind: 'none' });
  });
  it('shows the empty copy as a link to the Social section', () => {
    const el = document.createElement('social-links');
    applyPreview(el, { kind: 'empty' }, 'my site');
    const a = el.querySelector('a');
    assert.equal(a.textContent, "No accounts yet: add them in Social");
    assert.equal(a.textContent, EMPTY_COPY);
    assert.equal(a.getAttribute('href'), '/app/site.html?site=my%20site&section=social');
  });
  it('puts the html in the element; none clears it', () => {
    const el = document.createElement('social-links');
    applyPreview(el, { kind: 'html', html: '<ul><li>a</li></ul>' }, 's');
    assert.equal(el.innerHTML, '<ul><li>a</li></ul>');
    applyPreview(el, { kind: 'none' }, 's');
    assert.equal(el.innerHTML, '');
  });
  it('marks the element while a note shows, so the editor CSS can display it (VB hides an element with no li)', () => {
    const el = document.createElement('social-links');
    applyPreview(el, { kind: 'empty' }, 's');
    assert.equal(el.hasAttribute('data-preview-note'), true);
    applyPreview(el, { kind: 'html', html: '<ul><li>a</li></ul>' }, 's');
    assert.equal(el.hasAttribute('data-preview-note'), false);
    applyPreview(el, { kind: 'old' }, 's');
    assert.equal(el.hasAttribute('data-preview-note'), true);
    applyPreview(el, { kind: 'none' }, 's');
    assert.equal(el.hasAttribute('data-preview-note'), false);
  });
  it('the editor CSS displays a noted element', () => {
    const css = readFileSync(new URL('../../editor/assets/css/_component-settings.css', import.meta.url), 'utf8');
    assert.match(css, /social-links\[data-preview-note\]\s*\{[^}]*display:\s*block/);
  });
  it('a too-old Cook gets a short note', () => {
    const el = document.createElement('social-links');
    applyPreview(el, { kind: 'old' }, 's');
    assert.match(el.textContent, /update Cook/i);
  });
});
