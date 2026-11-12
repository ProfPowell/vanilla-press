/**
 * Layout editor: the layout schema and the tree ↔ ProseMirror conversion.
 * Every tree Cook's parseLayout gives must come back unchanged from
 * docToTree(treeToDoc(tree)) — nothing lost (Review Focus 5) — and
 * serialize to the same bytes. Fixture trees come from the linked Cook.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { EditorState, TextSelection } from 'prosemirror-state';
import { toggleMark } from 'prosemirror-commands';
import { layoutSchema } from '../../editor/assets/js/layout-editor/schema.js';
import { treeToDoc, docToTree, setSlotLabel } from '../../editor/assets/js/layout-editor/convert.js';

const COOK = '/Users/tpowell/src/cook';
const COOK_LAYOUTS = path.join(COOK, 'scripts', 'layouts.js');
const HAVE_COOK = existsSync(COOK_LAYOUTS);
const cook = HAVE_COOK ? await import(COOK_LAYOUTS) : null;

const STARTER = path.join(COOK, 'starters', 'vanilla-breeze');
const TAP = path.join(COOK, 'test', 'fixtures-layouts', 'tap');
// thomasapowell.com's site fields, as Cook's own tree tests declare them
const TAP_OPTS = { fields: ['siteTitle', 'ogImageUrl'], lists: [] };

const htmlFiles = (dir) => readdirSync(dir).filter(f => f.endsWith('.html')).sort();
const read = (file) => readFileSync(file, 'utf8');

// Layouts that reach every tree variant the fixtures don't: nested marks in
// both orders, adjacent equal links, an empty inline element, br and img,
// inline and block components, comments, a literal ${, li holding blocks,
// empty menus and containers, picture, figure, repeats with an index,
// conditions, a head slot piece with script and style, slot labels.
const SYNTHETIC = {
  'synthetic fragment': [`<!-- layout-fragment -->
<!-- a top comment -->
<footer data-if="title">
  <p id="x"><strong><em>a</em></strong><em><strong>b</strong></em> <a href="/">one</a><a href="/">two</a><span class="i"></span><br><img src="/i.png" alt="">&#36;{lit} \${title}&nbsp;&amp; <code>c</code><abbr title="t">T</abbr><time datetime="\${date}">\${date}</time><span><span class="q">nested</span></span></p>
  <p><x-icon name="a" data-if="title"><svg viewBox="0 0 1 1"><path d="M0 0"/></svg>&amp; <b>x</b></x-icon> text \${title}</p>
  <ul data-unless="date"><li><x-icon name="b"></x-icon> Home</li><li><p>One</p><!-- in li --><p>Two</p></li><li></li><li data-repeat="collections.blog | offset:1 | limit:3 as post, i" value="2">\${i} <a href="\${post.url}">\${post.title}</a></li></ul>
  <ol></ol>
  <picture class="p"><source srcset="/a.avif" type="image/avif"><img src="/a.jpg" alt=""></picture>
  <figure data-repeat="collections.blog as post"><!-- f --><img src="\${post.image}" alt=""><figcaption>Cap <em>x</em></figcaption></figure>
  <div data-include="/includes/x.html" data-if="title"></div>
  <layout-grid data-repeat="collections.blog as post" data-gap="s"><h2>\${post.title}</h2></layout-grid>
  <section></section>
  <div data-layout="stack"><figcaption>loose</figcaption><my-card class="c"><template shadowrootmode="open"><p>x</p></template></my-card></div>
  <x-raw data-repeat="collections.blog as post">  <b title='q'>&copy; a&amp;b</b>
      <i>two</i></x-raw>
</footer>
`, { fragment: true }],
  'synthetic child': [`<body data-template="base" data-page-layout="stack" data-hero-title="Hi \${title}">
  <script type="application/json" data-layout-info>{ "format": 1, "label": "Kid", "description": "d", "slots": { "zed": { "label": "Zed", "note": "n" }, "aside": {} }, "custom": 1 }</script>
  <!-- c -->
  <article>\${content}</article>
  <template slot="head" data-if="title"><meta name="x" content="\${title}"><style>a>b{}</style><script type="module">if (a < b) x("</p>");</script></template>
  <template slot="aside" class="k"><section>\${slot:aside}</section><aside>\${slot:zed}</aside></template>
  <template slot="empty"></template>
</body>
`, {}],
  'synthetic base': [`<!doctype html>
<html lang="en" data-x="y">
<head>
  <script type="application/json" data-layout-info>{ "format": 1, "label": "F", "abstract": true, "slots": { "head": { "label": "Head" }, "nav": { "label": "Nav" } } }</script>
  <base href="/">
  <style>a>b{}</style>
  <script type="module">if (a < b && c > d) console.log("</p>");</script>
  \${slot:head}
</head>
<body data-page-layout="\${pageLayout}">
  <!-- top -->
  <header></header>
  <nav data-if="slot:nav">\${slot:nav}</nav>
  <div data-include="/includes/h.html"></div>
  <main>
    \${content}
  </main>
</body>
</html>
`, {}],
};

/** Every fixture: [label, source, parseLayout options]. */
async function fixtures() {
  const names = await cook.loadSiteNames(STARTER);
  const starter = { fields: names.fields, lists: names.lists };
  const out = [];
  for (const f of htmlFiles(path.join(STARTER, 'src', 'layouts'))) {
    out.push([`starter layout ${f}`, read(path.join(STARTER, 'src', 'layouts', f)), starter]);
  }
  for (const f of htmlFiles(path.join(STARTER, 'src', 'includes'))) {
    out.push([`starter include ${f}`, read(path.join(STARTER, 'src', 'includes', f)), { ...starter, fragment: true }]);
  }
  for (const f of htmlFiles(TAP)) out.push([`tap ${f}`, read(path.join(TAP, f)), TAP_OPTS]);
  for (const [label, [src, opts]] of Object.entries(SYNTHETIC)) out.push([label, src, opts]);
  return out;
}

function parse(src, opts, label) {
  const r = cook.parseLayout(src, opts);
  assert.equal(r.ok, true, `${label}: ${JSON.stringify(r.problems)}`);
  return r.tree;
}

/** The tree with info.slots rebuilt in sorted key order (order is not compared). */
function slotsSorted(tree) {
  const copy = structuredClone(tree);
  if (copy.info?.slots) {
    copy.info.slots = Object.fromEntries(Object.entries(copy.info.slots).sort(([a], [b]) => a.localeCompare(b)));
  }
  return copy;
}

const nodesOf = (doc, name) => {
  const found = [];
  doc.descendants((node, pos) => { if (node.type.name === name) found.push({ node, pos }); });
  return found;
};

describe('layout convert: round trips (Review Focus 5)', { skip: !HAVE_COOK && 'Cook not linked' }, async () => {
  const all = HAVE_COOK ? await fixtures() : [];
  for (const [label, src, opts] of all) {
    it(label, () => {
      const tree = parse(src, opts, label);
      const before = structuredClone(tree);
      const { doc, meta } = treeToDoc(tree, layoutSchema);
      doc.check();
      assert.deepEqual(tree, before, 'treeToDoc does not change the tree');
      const back = docToTree(doc, meta);
      assert.deepEqual(slotsSorted(back), slotsSorted(tree));
      assert.equal(cook.serializeLayout(back), cook.serializeLayout(tree));
    });
  }
});

describe('layout convert: schema', () => {
  it('has one node per block kind and marks for the inline elements', () => {
    for (const name of ['region', 'container', 'figure', 'figcaption', 'text_block', 'image', 'menu', 'menu_item',
      'menu_item_blocks', 'include', 'component', 'comment', 'content', 'slot_ref', 'slot_piece', 'head_piece',
      'field', 'hard_break', 'inline_image', 'empty_inline', 'inline_component']) {
      assert.ok(layoutSchema.nodes[name], name);
    }
    for (const name of ['a', 'strong', 'em', 'span', 'time', 'abbr', 'code']) assert.ok(layoutSchema.marks[name], name);
    for (const name of ['content', 'slot_ref', 'include', 'component', 'comment', 'image']) {
      assert.equal(layoutSchema.nodes[name].isAtom, true, name);
    }
  });

  it('enforces nesting: menus hold items, a base body holds regions and includes', () => {
    const s = layoutSchema;
    assert.throws(() => s.nodes.menu.createChecked({ tag: 'ul' }, [s.nodes.text_block.create({ tag: 'p' })]));
    assert.throws(() => s.nodes.base_body.createChecked(null, [s.nodes.text_block.create({ tag: 'p' })]));
    s.nodes.base_body.createChecked(null, [s.nodes.region.create({ tag: 'main' }, [s.nodes.content.create()]),
      s.nodes.include.create({ path: '/includes/x.html' })]);
  });
});

describe('layout convert: inline marks, fields, slots', { skip: !HAVE_COOK && 'Cook not linked' }, () => {
  it('keeps inline marks and field atoms', () => {
    const tree = parse(SYNTHETIC['synthetic fragment'][0], { fragment: true }, 'fragment');
    const { doc } = treeToDoc(tree, layoutSchema);
    const para = nodesOf(doc, 'text_block')[0].node;
    const marks = new Set();
    para.descendants((n) => { n.marks.forEach(m => marks.add(m.type.name)); });
    assert.deepEqual([...marks].sort(), ['a', 'abbr', 'code', 'em', 'span', 'strong', 'time']);
    const fields = [];
    para.descendants((n) => { if (n.type.name === 'field') fields.push(n.attrs.name); });
    assert.deepEqual(fields, ['title', 'date']);
    const time = nodesOf(para, 'field').at(-1).node;
    assert.deepEqual(time.marks.map(m => [m.type.name, m.attrs.attrs]), [['time', [['datetime', '${date}']]]]);
  });

  const fragPara = (html) => {
    const tree = parse(`<!-- layout-fragment -->\n<footer>${html}</footer>\n`, { fragment: true }, html);
    const { doc, meta } = treeToDoc(tree, layoutSchema);
    return { doc, meta, para: nodesOf(doc, 'text_block')[0] };
  };
  const inlineOf = (doc, meta) => docToTree(doc, meta).body[0].body[0].inline;

  it('a mark added across a whole paragraph wraps the elements already there once', () => {
    const { doc, meta, para } = fragPara('<p>x <a href="/">one</a></p>');
    const tr = EditorState.create({ doc }).tr.addMark(para.pos + 1, para.pos + 1 + para.node.content.size, layoutSchema.marks.strong.create());
    assert.deepEqual(inlineOf(tr.doc, meta), [
      { tag: 'strong', attrs: [], inline: [{ text: 'x ' }, { tag: 'a', attrs: [['href', '/']], inline: [{ text: 'one' }] }] },
    ]);
  });

  it('a link added across x <strong>y</strong> z is one <a> around the strong', () => {
    const { doc, meta, para } = fragPara('<p>x <strong>y</strong> z</p>');
    const state = EditorState.create({ doc });
    const from = para.pos + 1;
    const to = from + para.node.content.size;
    const tr = state.tr.setSelection(TextSelection.create(doc, from, to));
    let next = state.apply(tr);
    toggleMark(layoutSchema.marks.a, { attrs: [['href', '/n']] })(next, (t) => { next = next.apply(t); });
    const back = docToTree(next.doc, meta);
    assert.deepEqual(back.body[0].body[0].inline, [{
      tag: 'a', attrs: [['href', '/n']],
      inline: [{ text: 'x ' }, { tag: 'strong', attrs: [], inline: [{ text: 'y' }] }, { text: ' z' }],
    }]);
    assert.ok(cook.serializeLayout(back).includes('<p><a href="/n">x <strong>y</strong> z</a></p>'));
  });

  it('a mark added inside an element nests inside it', () => {
    const { doc, meta } = fragPara('<p>x <a href="/">one</a></p>');
    let at = -1;
    doc.descendants((n, pos) => { if (n.isText && n.text === 'one') at = pos; });
    const tr = EditorState.create({ doc }).tr.addMark(at, at + 3, layoutSchema.marks.strong.create());
    assert.deepEqual(inlineOf(tr.doc, meta), [
      { text: 'x ' },
      { tag: 'a', attrs: [['href', '/']], inline: [{ tag: 'strong', attrs: [], inline: [{ text: 'one' }] }] },
    ]);
  });

  /** A base with a nav slot carrying extra keys; header and main positions. */
  const navBase = () => {
    const info = '<script type="application/json" data-layout-info>{ "format": 1, "label": "K", "slots": {"nav":{"label":"Nav","note":"n"}} }</script>';
    const tree = parse(`<!doctype html><html><head>${info}</head><body><header></header><nav>\${slot:nav}</nav><main>\${content}</main></body></html>`, {}, 'nav base');
    const { doc, meta } = treeToDoc(tree, layoutSchema);
    const region = (tag) => nodesOf(doc, 'region').find(r => r.node.attrs.tag === tag);
    return { tree, doc, meta, region };
  };
  const sectionWith = (name) => layoutSchema.nodes.container.create({ tag: 'section' }, [layoutSchema.nodes.slot_ref.create({ name })]);

  it('a slot_ref inserted before an existing one of that name keeps its entry whole', () => {
    const { doc, meta, region } = navBase();
    const d2 = EditorState.create({ doc }).tr.insert(region('header').pos + 1, sectionWith('nav')).doc;
    assert.deepEqual(docToTree(d2, meta).info.slots, { nav: { label: 'Nav', note: 'n' } });
    // and with the original ref deleted, the copy still carries it
    const nav = nodesOf(d2, 'region').find(r => r.node.attrs.tag === 'nav');
    const d3 = EditorState.create({ doc: d2 }).tr.delete(nav.pos + 1, nav.pos + nav.node.nodeSize - 1).doc;
    const back = docToTree(d3, meta);
    assert.deepEqual(back.info.slots, { nav: { label: 'Nav', note: 'n' } });
    assert.equal(cook.checkLayout(cook.serializeLayout(back)).ok, true);
  });

  it('deleting and re-adding a slot_ref keeps its entry', () => {
    const { doc, meta, region } = navBase();
    const nav = region('nav');
    const deleted = EditorState.create({ doc }).tr.delete(nav.pos + 1, nav.pos + nav.node.nodeSize - 1).doc;
    assert.deepEqual(docToTree(deleted, meta).info.slots, {});
    const header = nodesOf(deleted, 'region').find(r => r.node.attrs.tag === 'header');
    const readded = EditorState.create({ doc: deleted }).tr.insert(header.pos + 1, sectionWith('nav')).doc;
    assert.deepEqual(docToTree(readded, meta).info.slots, { nav: { label: 'Nav', note: 'n' } });
  });

  it('a new slot name gets { label: name }; setSlotLabel sets it; deleting a ref drops it', () => {
    const tree = parse(read(path.join(TAP, 'base.html')), TAP_OPTS, 'tap base');
    const { doc, meta } = treeToDoc(tree, layoutSchema);
    const main = nodesOf(doc, 'region').find(r => r.node.attrs.tag === 'main');
    const state = EditorState.create({ doc });
    // A slot stands alone in its element: wrap it in a section inside main
    const withExtra = state.tr.insert(main.pos + 1, sectionWith('extra')).doc;
    const added = docToTree(withExtra, meta);
    assert.deepEqual(added.info.slots.extra, { label: 'extra' });
    assert.deepEqual(Object.keys(added.info.slots), [...Object.keys(tree.info.slots), 'extra']);
    assert.equal(cook.checkLayout(cook.serializeLayout(added), TAP_OPTS).ok, true);

    assert.equal(setSlotLabel(meta, 'extra', 'Extra'), meta);
    assert.deepEqual(docToTree(withExtra, meta).info.slots.extra, { label: 'Extra' });

    const nav = nodesOf(doc, 'slot_ref').find(r => r.node.attrs.name === 'nav');
    const removed = docToTree(state.tr.delete(nav.pos, nav.pos + nav.node.nodeSize).doc, meta);
    assert.equal('nav' in removed.info.slots, false);
    assert.equal('extra' in removed.info.slots, false);
    assert.deepEqual(Object.keys(removed.info.slots), Object.keys(tree.info.slots).filter(k => k !== 'nav'));
  });

  it('setSlotLabel keeps the entry’s other keys', () => {
    const tree = parse(SYNTHETIC['synthetic child'][0], {}, 'child');
    const { doc, meta } = treeToDoc(tree, layoutSchema);
    setSlotLabel(meta, 'zed', 'Zee');
    const back = docToTree(doc, meta);
    assert.deepEqual(back.info.slots.zed, { label: 'Zee', note: 'n' });
    assert.deepEqual(back.info.slots.aside, {});
  });

  it('meta holds what lives outside ProseMirror', () => {
    const tree = parse(read(path.join(TAP, 'base.html')), TAP_OPTS, 'tap base');
    const { meta } = treeToDoc(tree, layoutSchema);
    for (const key of ['kind', 'info', 'parent', 'vars', 'pageLayout', 'htmlAttrs', 'head']) {
      assert.deepEqual(meta[key], tree[key], key);
    }
  });
});

describe('layout convert: the starter include', { skip: !HAVE_COOK && 'Cook not linked' }, () => {
  it('site-nav round-trips as a fragment and keeps its marker', async () => {
    const names = await cook.loadSiteNames(STARTER);
    const src = read(path.join(STARTER, 'src', 'includes', 'site-nav.html'));
    const tree = parse(src, { fields: names.fields, lists: names.lists, fragment: true }, 'site-nav');
    assert.equal(tree.kind, 'fragment');
    const { doc, meta } = treeToDoc(tree, layoutSchema);
    assert.equal(doc.firstChild.type.name, 'fragment_body');
    const back = docToTree(doc, meta);
    assert.equal(cook.serializeLayout(back), cook.serializeLayout(tree));
    assert.ok(cook.serializeLayout(back).startsWith('<!-- layout-fragment -->'));
  });
});
