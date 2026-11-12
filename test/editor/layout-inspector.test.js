/**
 * Layout editor inspector: the fields for each kind of block
 * (inspectorFields), the attrs a change gives (applyField), mark editing
 * that never nests a link and removes one instance, and the panel in a real
 * DOM (linkedom) putting its changes through the editor's transactions.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { EditorState, TextSelection, NodeSelection } from 'prosemirror-state';
import { layoutSchema } from '../../editor/assets/js/layout-editor/schema.js';
import { treeToDoc, docToTree } from '../../editor/assets/js/layout-editor/convert.js';
import {
  inspectorFields, applyField, fieldError, repeatsAt, markRange, linkWouldNest, COMPONENT_TAG_MESSAGE,
} from '../../editor/assets/js/layout-editor/inspector-model.js';
import { layoutRulesPlugin } from '../../editor/assets/js/layout-editor/palette.js';

const s = layoutSchema;
const keys = (fields) => fields.map(f => f.key);
const field = (fields, key) => fields.find(f => f.key === key);

const CONTEXT = {
  siteFields: ['siteTitle', 'navItems'],
  documentFields: ['title', 'url', 'date'],
  declaredFields: ['subtitle'],
  lists: ['collections.posts', 'programs', 'programAreas.courses', 'navItems'],
  slots: ['aside'],
  components: {
    'site-search': { attributes: [{ name: 'placeholder', type: 'string' }, { name: 'open', type: 'boolean' }, { name: 'size', type: 'string', enum: ['s', 'm'] }] },
  },
  layoutElements: { 'layout-stack': [{ name: 'data-layout-gap', type: 'string', enum: ['s', 'm', 'l'] }] },
};

const fragment = (body) => ({ kind: 'fragment', info: null, parent: null, vars: [], pageLayout: null, htmlAttrs: [], head: [], body, slots: [] });

describe('inspectorFields', () => {
  it('a text block: its tag, the repeat, Show only when and id/class/aria-label', () => {
    const node = s.nodes.text_block.create({ tag: 'h2' });
    const fields = inspectorFields(node, CONTEXT);
    const tag = field(fields, 'tag');
    assert.deepEqual(tag.options.map(o => o.value), ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'small', 'figcaption', 'blockquote']);
    assert.equal(tag.value, 'h2');
    for (const k of ['repeat.source', 'repeat.limit', 'repeat.offset', 'repeat.alias', 'repeat.index', 'show.key', 'show.mode', 'attr:id', 'attr:class', 'attr:aria-label']) {
      assert.ok(keys(fields).includes(k), k);
    }
    assert.equal(field(fields, 'show.key').label, 'Show only when');
    assert.deepEqual(field(fields, 'repeat.source').options.map(o => o.value), ['', ...CONTEXT.lists]);
  });

  it('a repeated li: the repeat as set, limit and alias read back', () => {
    const node = s.nodes.menu_item.create({ repeat: { source: 'collections.posts', pipes: ['limit:5'], alias: 'post' } });
    const fields = inspectorFields(node, CONTEXT);
    assert.equal(field(fields, 'repeat.source').value, 'collections.posts');
    assert.equal(field(fields, 'repeat.limit').value, '5');
    assert.equal(field(fields, 'repeat.offset').value, '');
    assert.equal(field(fields, 'repeat.alias').value, 'post');
    assert.equal(field(fields, 'repeat.alias').disabled, false);
    assert.ok(!keys(fields).includes('tag'));
  });

  it('a component with a known manifest: its attributes typed, the rest as pairs', () => {
    const node = s.nodes.component.create({ tag: 'site-search', attrs: [['placeholder', 'Find'], ['open', ''], ['data-x', '1'], ['id', 'q']] });
    const fields = inspectorFields(node, CONTEXT);
    assert.equal(field(fields, 'tag').value, 'site-search');
    assert.ok(field(fields, 'tag').options.some(o => o.value === 'site-search'));
    assert.equal(field(fields, 'attr:placeholder').value, 'Find');
    assert.equal(field(fields, 'attr:open').type, 'checkbox');
    assert.equal(field(fields, 'attr:open').value, true);
    assert.equal(field(fields, 'attr:size').type, 'select');
    assert.deepEqual(field(fields, 'attrs').value, [['data-x', '1']]);
    assert.equal(field(fields, 'attr:id').value, 'q');
  });

  it('an unknown component: raw name/value pairs; a tag without a hyphen is refused', () => {
    const node = s.nodes.component.create({ tag: 'my-thing', attrs: [['mode', 'x']] });
    const fields = inspectorFields(node, CONTEXT);
    assert.deepEqual(field(fields, 'attrs').value, [['mode', 'x']]);
    assert.equal(fieldError(node, 'tag', 'thing'), COMPONENT_TAG_MESSAGE);
    assert.deepEqual(applyField(node, 'tag', 'thing'), { ...node.attrs });
    assert.equal(applyField(node, 'tag', 'other-thing').tag, 'other-thing');
  });

  it('a container: tag, data-layout and the VB layout attributes', () => {
    const node = s.nodes.container.create({ tag: 'layout-stack', attrs: [['data-layout-gap', 'm']] });
    const fields = inspectorFields(node, CONTEXT);
    assert.ok(field(fields, 'tag').options.some(o => o.value === 'layout-stack'));
    assert.equal(field(fields, 'attr:data-layout-gap').value, 'm');
    assert.deepEqual(field(fields, 'attrs').value, []);
    const div = s.nodes.container.create({ tag: 'div', attrs: [['data-layout', 'stack']] });
    const divFields = inspectorFields(div, CONTEXT);
    assert.equal(field(divFields, 'data-layout').value, 'stack');
    assert.ok(field(divFields, 'attr:data-layout-gap'));
  });

  it('a region and a slot piece do not repeat; an inline component has conditions but no repeat', () => {
    assert.ok(!keys(inspectorFields(s.nodes.region.create({ tag: 'main' }), CONTEXT)).includes('repeat.source'));
    assert.ok(!keys(inspectorFields(s.nodes.slot_piece.create({ name: 'aside' }), CONTEXT)).includes('repeat.source'));
    const inline = inspectorFields(s.nodes.inline_component.create({ tag: 'site-search' }), CONTEXT);
    assert.ok(!keys(inline).includes('repeat.source'));
    assert.ok(keys(inline).includes('show.key'));
  });

  it('an item-field key is offered only inside a repeat', () => {
    const { doc } = treeToDoc(fragment([
      { type: 'menu', tag: 'ul', attrs: [], items: [{ attrs: [], repeat: { source: 'collections.posts', pipes: [], alias: 'post' }, inline: [{ field: 'post.title' }] }] },
      { type: 'text', tag: 'p', attrs: [], inline: [{ field: 'title' }] },
    ]), s);
    const found = [];
    doc.descendants((node, pos) => { if (node.type.name === 'field') found.push({ node, pos }); });
    const inside = inspectorFields(found[0].node, { ...CONTEXT, repeats: repeatsAt(doc, found[0].pos) });
    const outside = inspectorFields(found[1].node, { ...CONTEXT, repeats: repeatsAt(doc, found[1].pos) });
    const values = (fields) => field(fields, 'name').options.map(o => o.value);
    assert.ok(values(inside).includes('post.title'));
    assert.ok(values(inside).includes('post'));
    assert.ok(!values(outside).includes('post.title'));
    assert.ok(values(outside).includes('title'));
    assert.ok(values(outside).includes('siteTitle'));
    assert.ok(values(outside).includes('subtitle'));
  });

  it('Show only when offers fields and slot:<name>', () => {
    const options = field(inspectorFields(s.nodes.text_block.create(), CONTEXT), 'show.key').options.map(o => o.value);
    assert.ok(options.includes('slot:aside'));
    assert.ok(options.includes('title'));
  });
});

describe('applyField', () => {
  it('setting the repeat source and limit gives { source, pipes: [limit:5], alias }', () => {
    let node = s.nodes.menu_item.create();
    node = node.type.create(applyField(node, 'repeat.source', 'collections.posts'));
    node = node.type.create(applyField(node, 'repeat.limit', '5'));
    assert.deepEqual(node.attrs.repeat, { source: 'collections.posts', pipes: ['limit:5'], alias: 'post' });
    node = node.type.create(applyField(node, 'repeat.offset', '2'));
    node = node.type.create(applyField(node, 'repeat.alias', 'entry'));
    node = node.type.create(applyField(node, 'repeat.index', 'i'));
    assert.deepEqual(node.attrs.repeat, { source: 'collections.posts', pipes: ['limit:5', 'offset:2'], alias: 'entry', index: 'i' });
    node = node.type.create(applyField(node, 'repeat.limit', ''));
    assert.deepEqual(node.attrs.repeat.pipes, ['offset:2']);
    assert.equal(applyField(node, 'repeat.source', '').repeat, null);
    assert.equal(applyField(node, 'repeat.limit', 'x').repeat.pipes[0], 'offset:2');
  });

  it('Show only when with slot:aside sets if: slot:aside; the mode moves it to unless', () => {
    let node = s.nodes.container.create({ tag: 'aside' });
    node = node.type.create(applyField(node, 'show.key', 'slot:aside'));
    assert.equal(node.attrs.if, 'slot:aside');
    assert.equal(node.attrs.unless, null);
    node = node.type.create(applyField(node, 'show.mode', 'unless'));
    assert.equal(node.attrs.if, null);
    assert.equal(node.attrs.unless, 'slot:aside');
    assert.equal(applyField(node, 'show.key', '').unless, null);
  });

  it('an inline component keeps its condition as data-if pairs', () => {
    const node = s.nodes.inline_component.create({ tag: 'site-search', attrs: [['id', 'q']] });
    assert.deepEqual(applyField(node, 'show.key', 'siteTitle').attrs, [['id', 'q'], ['data-if', 'siteTitle']]);
  });

  it('id/class/aria-label set and clear attribute pairs; alt keeps an empty value', () => {
    const node = s.nodes.image.create({ attrs: [['src', 'a.png'], ['alt', 'A']] });
    assert.deepEqual(applyField(node, 'attr:class', 'wide').attrs, [['src', 'a.png'], ['alt', 'A'], ['class', 'wide']]);
    assert.deepEqual(applyField(node, 'attr:alt', '').attrs, [['src', 'a.png'], ['alt', '']]);
    const withId = node.type.create(applyField(node, 'attr:id', 'hero'));
    assert.deepEqual(applyField(withId, 'attr:id', '').attrs, [['src', 'a.png'], ['alt', 'A']]);
    const comp = s.nodes.component.create({ tag: 'site-search', attrs: [['open', '']] });
    assert.deepEqual(applyField(comp, 'attr:open', false).attrs, []);
    assert.deepEqual(applyField(comp, 'attr:open', true).attrs, [['open', '']]);
  });

  it('the remaining pairs replace only the attributes without a field of their own', () => {
    const node = s.nodes.component.create({ tag: 'site-search', attrs: [['id', 'q'], ['placeholder', 'Find'], ['data-x', '1']] });
    const rest = field(inspectorFields(node, CONTEXT), 'attrs');
    assert.deepEqual(applyField(node, rest, [['data-y', '2']]).attrs, [['id', 'q'], ['placeholder', 'Find'], ['data-y', '2']]);
  });

  it('a field atom takes a new key; a slot ref a new name', () => {
    assert.equal(applyField(s.nodes.field.create({ name: 'title' }), 'name', 'post.url').name, 'post.url');
    assert.equal(applyField(s.nodes.slot_ref.create({ name: 'aside' }), 'name', 'extra').name, 'extra');
    assert.equal(applyField(s.nodes.slot_ref.create({ name: 'aside' }), 'name', 'a b').name, 'aside');
  });
});

describe('validation (fix round 1)', () => {
  const p = s.nodes.text_block.create();
  it('Show only when takes one plain key or slot:<name>, and a known one', () => {
    assert.match(fieldError(p, 'show.key', 'foo bar', CONTEXT), /must name one field/);
    assert.match(fieldError(p, 'show.key', 'nope', CONTEXT), /unknown field "nope"/);
    assert.match(fieldError(p, 'show.key', 'slot:nowhere', CONTEXT), /slot "nowhere"/);
    assert.match(fieldError(p, 'show.key', 'slot:a b', CONTEXT), /must name one field/);
    assert.equal(fieldError(p, 'show.key', 'slot:aside', CONTEXT), null);
    assert.equal(fieldError(p, 'show.key', 'siteTitle', CONTEXT), null);
    assert.equal(fieldError(p, 'show.key', 'title', CONTEXT), null);
    assert.equal(fieldError(p, 'show.key', '', CONTEXT), null);
    assert.equal(fieldError(p, 'show.key', 'post.title', { ...CONTEXT, repeats: [{ source: 'collections.posts', alias: 'post', pipes: [] }] }), null);
    // An unknown current value shows inline
    const shown = field(inspectorFields(s.nodes.text_block.create({ if: 'nope' }), CONTEXT), 'show.key');
    assert.match(shown.error, /unknown field "nope"/);
  });

  it('a field atom takes a Cook plain key that is known', () => {
    const f = s.nodes.field.create({ name: 'title' });
    assert.match(fieldError(f, 'name', 'foo bar', CONTEXT), /isn't a field name|one field/);
    assert.match(fieldError(f, 'name', 'nope', CONTEXT), /unknown field "nope"/);
    assert.match(fieldError(f, 'name', 'x.1', CONTEXT), /field/);
    assert.equal(fieldError(f, 'name', 'subtitle', CONTEXT), null);
    assert.equal(fieldError(f, 'name', 'siteTitle.x', CONTEXT), null);
  });

  it('raw attribute pairs refuse event handlers and reserved names', () => {
    const c = s.nodes.component.create({ tag: 'my-thing' });
    for (const name of ['onclick', 'ONLOAD', 'data-if', 'data-unless', 'data-repeat', 'data-include', 'data-layout-info', 'data-template']) {
      assert.ok(fieldError(c, 'attrs', [[name, 'x']]), name);
      assert.deepEqual(applyField(c, 'attrs', [[name, 'x']]).attrs, [], name);
    }
    assert.equal(fieldError(c, 'attrs', [['data-mode', 'x']]), null);
    assert.ok(fieldError(c, 'attr:onclick', 'x'));
  });

  it('alias and index are one \\w word (Cook\'s repeat grammar)', () => {
    const li = s.nodes.menu_item.create({ repeat: { source: 'programs', pipes: [], alias: 'program' } });
    assert.ok(fieldError(li, 'repeat.alias', '$x'));
    assert.ok(fieldError(li, 'repeat.index', '$i'));
    assert.equal(fieldError(li, 'repeat.alias', '_x1'), null);
  });

  it('an unnamed component shows that it needs a name', () => {
    const tag = field(inspectorFields(s.nodes.component.create({ tag: '' }), CONTEXT), 'tag');
    assert.match(tag.error, /needs a name/);
    assert.match(field(inspectorFields(s.nodes.inline_component.create({ tag: '' }), CONTEXT), 'tag').error, /needs a name/);
  });
});

describe('marks', () => {
  /** A doc with "one <a>two</a> three <a>four</a>" (two links with equal attrs). */
  function linked() {
    const { doc } = treeToDoc(fragment([{
      type: 'text', tag: 'p', attrs: [], inline: [
        { text: 'one ' }, { tag: 'a', attrs: [['href', '/x']], inline: [{ text: 'two' }] },
        { text: ' three ' }, { tag: 'a', attrs: [['href', '/x']], inline: [{ text: 'four' }] },
      ],
    }]), s);
    return doc;
  }

  it('markRange finds the one instance around the caret', () => {
    const doc = linked();
    const $pos = doc.resolve(8); // inside "two"
    const mark = doc.nodeAt(8).marks.find(m => m.type.name === 'a');
    const range = markRange($pos, mark);
    assert.equal(doc.textBetween(range.from, range.to), 'two');
  });

  it('a link would nest inside or around an existing link', () => {
    const doc = linked();
    assert.equal(linkWouldNest(doc, 3, 12), true); // "one two thr…" holds a link
    assert.equal(linkWouldNest(doc, 7, 8), true); // inside "two"
    assert.equal(linkWouldNest(doc, 2, 4), false); // "ne"
  });
});

// THE PANEL
// -----------------------------
const PAGE = readFileSync(new URL('../../editor/layout.html', import.meta.url), 'utf8');
const GLOBALS = ['window', 'document', 'Node', 'HTMLElement', 'customElements', 'CustomEvent', 'Event', 'getComputedStyle', 'MutationObserver'];

describe('inspector panel', () => {
  const saved = {};
  let win;
  let createInspector;
  before(async () => {
    win = parseHTML(PAGE);
    for (const k of GLOBALS) { saved[k] = globalThis[k]; globalThis[k] = k === 'window' ? win : win[k]; }
    ({ createInspector } = await import('../../editor/assets/js/layout-editor/inspector.js'));
  });
  after(() => { for (const k of GLOBALS) globalThis[k] = saved[k]; });

  /** A fake view: dispatch applies through the rules plugin and records. */
  function harness(tree, select) {
    const { doc, meta } = treeToDoc(tree, s);
    let state = EditorState.create({ doc, plugins: [layoutRulesPlugin()] });
    state = state.apply(state.tr.setSelection(select(state.doc)));
    const view = {
      get state() { return state; },
      dispatched: 0,
      dispatch(tr) { this.dispatched++; state = state.applyTransaction(tr).state; inspector.update(state); },
      focus() {},
    };
    const el = win.document.createElement('aside');
    win.document.body.append(el);
    const metaChanges = [];
    const inspector = createInspector({
      el, getView: () => view, getMeta: () => meta, getContext: () => CONTEXT,
      onMetaChange: (what) => metaChanges.push(what),
    });
    inspector.update(state);
    return { el, view, inspector, meta, metaChanges, doc: () => state.doc };
  }

  const nodeSel = (type, nth = 0) => (doc) => {
    const found = [];
    doc.descendants((node, pos) => { if (node.type.name === type) found.push(pos); });
    return NodeSelection.create(doc, found[nth]);
  };
  const change = (input, value) => {
    if (input.type === 'checkbox') input.checked = value;
    else if (input.tagName === 'SELECT') {
      // linkedom: choose the option by its attribute
      for (const o of input.querySelectorAll('option')) {
        if (o.value === value) o.setAttribute('selected', '');
        else o.removeAttribute('selected');
      }
    } else input.value = value;
    input.dispatchEvent(new win.Event('change', { bubbles: true }));
  };

  it('shows the selected block\'s fields and applies a repeat through a transaction', () => {
    const h = harness(fragment([{ type: 'menu', tag: 'ul', attrs: [], items: [{ attrs: [], inline: [{ text: 'Home' }] }] }]), nodeSel('menu_item'));
    const source = h.el.querySelector('[data-field="repeat.source"]');
    assert.ok(source, h.el.innerHTML);
    change(source, 'collections.posts');
    assert.equal(h.view.dispatched, 1);
    change(h.el.querySelector('[data-field="repeat.limit"]'), '5');
    const tree = docToTree(h.doc(), h.meta);
    assert.deepEqual(tree.body[0].items[0].repeat, { source: 'collections.posts', pipes: ['limit:5'], alias: 'post' });
    assert.match(h.el.textContent, /Show only when/);
    h.inspector.destroy();
  });

  it('a refused change (a second main) shows why and changes nothing', () => {
    const base = {
      kind: 'base', info: { format: 1, label: 'B', slots: {} }, parent: null, vars: [], pageLayout: null, htmlAttrs: [], head: [],
      body: [{ type: 'container', tag: 'main', attrs: [], body: [{ type: 'content', attrs: [] }] }, { type: 'container', tag: 'aside', attrs: [], body: [] }],
      slots: [],
    };
    const h = harness(base, nodeSel('region', 1));
    change(h.el.querySelector('[data-field="tag"]'), 'main');
    assert.equal(docToTree(h.doc(), h.meta).body[1].tag, 'aside');
    assert.match(h.el.textContent, /exactly one <main>/);
    h.inspector.destroy();
  });

  it('a slot label goes into meta and is reported, not into the doc', () => {
    const base = {
      kind: 'base', info: { format: 1, label: 'B', slots: { aside: { label: 'Sidebar', hint: 'x' } } }, parent: null, vars: [], pageLayout: null, htmlAttrs: [], head: [],
      body: [{ type: 'container', tag: 'main', attrs: [], body: [{ type: 'content', attrs: [] }] }, { type: 'container', tag: 'aside', attrs: [], body: [{ type: 'slot', name: 'aside', attrs: [] }] }],
      slots: [],
    };
    const h = harness(base, nodeSel('slot_ref'));
    const label = h.el.querySelector('[data-field="slot.label"]');
    assert.equal(label.value, 'Sidebar');
    change(label, 'Extras');
    assert.deepEqual(h.meta.info.slots.aside, { label: 'Extras', hint: 'x' });
    assert.equal(h.metaChanges.length, 1);
    // Renaming keeps the entry under the new name
    change(h.el.querySelector('[data-field="name"]'), 'extras');
    assert.deepEqual(docToTree(h.doc(), h.meta).info.slots, { extras: { label: 'Extras', hint: 'x' } });
    h.inspector.destroy();
  });

  it('renaming the starter base\'s aside slot rewrites slot:aside conditions; Cook accepts the result', async () => {
    const cook = await import('/Users/tpowell/src/cook/scripts/layouts.js');
    const src = readFileSync('/Users/tpowell/src/cook/starters/vanilla-breeze/src/layouts/base.html', 'utf8');
    const opts = { fields: ['siteTitle', 'siteTagline', 'navItems'], lists: ['programs', 'programAreas', 'navItems'] };
    const parsed = cook.parseLayout(src, opts);
    assert.ok(parsed.ok, JSON.stringify(parsed.problems));
    const h = harness(parsed.tree, (doc) => {
      let at = null;
      doc.descendants((node, pos) => { if (at === null && node.type.name === 'slot_ref' && node.attrs.name === 'aside') at = pos; });
      return NodeSelection.create(doc, at);
    });
    change(h.el.querySelector('[data-field="name"]'), 'side');
    const out = cook.serializeLayout(docToTree(h.doc(), h.meta));
    assert.match(out, /data-if="slot:side"/);
    assert.doesNotMatch(out, /slot:aside/);
    const checked = cook.checkLayout(out, opts);
    assert.ok(checked.ok, JSON.stringify(checked.problems));
    assert.equal(h.view.dispatched, 1);
    h.inspector.destroy();
  });

  it('removing a link removes the selected instance only; Add link never nests', () => {
    const tree = fragment([{
      type: 'text', tag: 'p', attrs: [], inline: [
        { text: 'one ' }, { tag: 'a', attrs: [['href', '/x']], inline: [{ text: 'two' }] },
        { text: ' three ' }, { tag: 'a', attrs: [['href', '/x']], inline: [{ text: 'four' }] },
      ],
    }]);
    const h = harness(tree, (doc) => TextSelection.create(doc, 8));
    const remove = h.el.querySelector('[data-mark-remove]');
    assert.ok(remove, h.el.innerHTML);
    remove.click();
    const runs = docToTree(h.doc(), h.meta).body[0].inline;
    assert.deepEqual(runs, [{ text: 'one two three ' }, { tag: 'a', attrs: [['href', '/x']], inline: [{ text: 'four' }] }]);

    // A range across the remaining link: no Add link
    h.view.dispatch(h.view.state.tr.setSelection(TextSelection.create(h.doc(), 12, 19)));
    assert.equal(h.el.querySelector('[data-mark-add-link]'), null);
    // A plain range: Add link wraps it once
    h.view.dispatch(h.view.state.tr.setSelection(TextSelection.create(h.doc(), 3, 5)));
    const add = h.el.querySelector('[data-mark-add-link]');
    assert.ok(add);
    h.el.querySelector('[data-mark-new-href]').value = '/y';
    add.click();
    const after = docToTree(h.doc(), h.meta).body[0].inline;
    assert.deepEqual(after[1], { tag: 'a', attrs: [['href', '/y']], inline: [{ text: 'ne' }] });
    h.inspector.destroy();
  });

  it('editing a link\'s href changes that instance only', () => {
    const tree = fragment([{
      type: 'text', tag: 'p', attrs: [], inline: [
        { tag: 'a', attrs: [['href', '/x']], inline: [{ text: 'two' }] }, { text: ' ' },
        { tag: 'a', attrs: [['href', '/x']], inline: [{ text: 'four' }] },
      ],
    }]);
    const h = harness(tree, (doc) => TextSelection.create(doc, 3));
    change(h.el.querySelector('[data-mark-attr="href"]'), '/z');
    const runs = docToTree(h.doc(), h.meta).body[0].inline;
    assert.deepEqual(runs.map(r => r.attrs?.[0]?.[1]), ['/z', undefined, '/x']);
    h.inspector.destroy();
  });
});
