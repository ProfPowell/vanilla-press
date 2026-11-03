import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { validate } from '../../src/schema/validate.js';
import { normalizeComponents } from '../../src/components/normalize.js';
import { fixtureIndex } from '../components/fixture-index.js';

const docWith = (...blocks) => ({
  id: 'doc_c', meta: { title: 'T', slug: 't', collection: 'posts', status: 'draft' }, blocks,
});
const comp = (over) => ({ type: 'component', tag: 'x-one', attrs: {}, ...over });
const inlineDoc = (node) => docWith({ type: 'paragraph', children: [node] });
const opts = { components: fixtureIndex };

describe('component node: structural', () => {
  it('accepts a valid component without descriptors', () => {
    assert.equal(validate(docWith(comp({ attrs: { a: 'x', b: 1, c: true } }))).valid, true);
  });
  it('rejects unsafe tag', () => {
    for (const tag of ['script', 'img onerror=x', 'font-face', 'X-Y', 'a-', 'annotation-xml']) {
      assert.equal(validate(docWith(comp({ tag }))).valid, false, tag);
    }
  });
  it('rejects on* and malformed attr names', () => {
    for (const name of ['onclick', 'onload', 'Bad', '1a', 'a b', 'a"b']) {
      assert.equal(validate(docWith(comp({ attrs: { [name]: 'x' } }))).valid, false, name);
    }
  });
  it('rejects non-primitive attr values', () => {
    assert.equal(validate(docWith(comp({ attrs: { a: {} } }))).valid, false);
    assert.equal(validate(docWith(comp({ attrs: { a: null } }))).valid, false);
  });
  it('validates inline components', () => {
    assert.equal(validate(inlineDoc({ type: 'component', tag: 'x-inline', attrs: {}, children: [{ type: 'text', value: 'a' }] })).valid, true);
    assert.equal(validate(inlineDoc({ type: 'component', tag: 'script', attrs: {}, children: [] })).valid, false);
  });
  it('existing fixtures still validate without descriptors', () => {
    const dir = new URL('../fixtures/', import.meta.url);
    for (const f of readdirSync(dir).filter(n => n.endsWith('.json'))) {
      const r = validate(JSON.parse(readFileSync(new URL(f, dir), 'utf8')));
      assert.equal(r.valid, true, `${f}: ${r.errors.join('; ')}`);
    }
  });
});

describe('component node: with descriptors', () => {
  it('unknown tag is "not on for this site"', () => {
    const r = validate(docWith(comp({ tag: 'x-zz' })), { components: new Map() });
    assert.match(r.errors[0], /component "x-zz" is not on for this site/);
  });
  it('accepts valid attrs', () => {
    assert.equal(validate(docWith(comp({ attrs: { mode: 'a', count: 2, open: true } })), opts).valid, true);
  });
  it('checks attr declaration, type and enum', () => {
    assert.equal(validate(docWith(comp({ attrs: { bogus: 'z' } })), opts).valid, false);
    assert.equal(validate(docWith(comp({ attrs: { count: '2' } })), opts).valid, false);
    assert.equal(validate(docWith(comp({ attrs: { open: 'yes' } })), opts).valid, false);
    assert.equal(validate(docWith(comp({ attrs: { mode: 'c' } })), opts).valid, false);
  });
  it('checks content against kind', () => {
    assert.equal(validate(docWith(comp({ value: 'x' })), opts).valid, false);
    assert.equal(validate(docWith(comp({ children: [{ type: 'paragraph', children: [] }] })), opts).valid, false);
    assert.equal(validate(docWith(comp({ tag: 'x-text', value: 'hi' })), opts).valid, true);
    assert.equal(validate(docWith(comp({ tag: 'x-text' })), opts).valid, false);
    assert.equal(validate(docWith(comp({ tag: 'x-code', value: 'hi', wrap: 'template' })), opts).valid, true);
    assert.equal(validate(docWith(comp({ tag: 'x-code', value: 'hi', wrap: 'bad' })), opts).valid, false);
    assert.equal(validate(docWith(comp({ tag: 'x-blocks', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'a' }] }] })), opts).valid, true);
    assert.equal(validate(docWith(comp({ tag: 'x-blocks' })), opts).valid, false);
  });
  it('validates nested block children', () => {
    const r = validate(docWith(comp({ tag: 'x-blocks', children: [comp({ tag: 'x-one', attrs: { bogus: 1 } })] })), opts);
    assert.equal(r.valid, false);
    assert.match(r.errors[0], /blocks\[0\]\.children\[0\]/);
  });
  it('checks placement', () => {
    assert.equal(validate(docWith(comp({ tag: 'x-inline', children: [] })), opts).valid, false);
    const inl = (tag, children) => inlineDoc({ type: 'component', tag, attrs: {}, children });
    assert.equal(validate(inl('x-inline', [{ type: 'text', value: 'a' }]), opts).valid, true);
    assert.equal(validate(inl('x-one', []), opts).valid, false);
  });
});

describe('normalizeComponents', () => {
  it('drops undeclared attrs and reports them', () => {
    const src = docWith(comp({ attrs: { mode: 'a', bogus: 'z' } }));
    const { doc, dropped } = normalizeComponents(src, fixtureIndex);
    assert.deepEqual(doc.blocks[0].attrs, { mode: 'a' });
    assert.deepEqual(dropped, [{ path: 'blocks[0]', tag: 'x-one', attr: 'bogus' }]);
    assert.equal(src.blocks[0].attrs.bogus, 'z', 'input untouched');
  });
  it('recurses into children and inline, leaves unknown tags', () => {
    const src = docWith(
      comp({ tag: 'x-blocks', children: [{ type: 'paragraph', children: [{ type: 'component', tag: 'x-inline', attrs: { q: 1 }, children: [] }] }] }),
      comp({ tag: 'x-nope', attrs: { q: 1 } }),
    );
    const { doc, dropped } = normalizeComponents(src, fixtureIndex);
    assert.deepEqual(dropped, [{ path: 'blocks[0].children[0].children[0]', tag: 'x-inline', attr: 'q' }]);
    assert.deepEqual(doc.blocks[1].attrs, { q: 1 });
  });
});
