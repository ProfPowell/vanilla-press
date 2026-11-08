import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validate } from '../../src/schema/validate.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));

describe('validate', () => {

  describe('valid fixtures', () => {
    const fixtures = ['minimal.json', 'simple-post.json', 'component-rich.json', 'inline-marks.json', 'edge-cases.json',
      'ks-prose.json', 'ks-tables.json', 'ks-definitions.json', 'ks-components.json', 'ks-media.json', 'ks-code.json', 'ks-nesting.json'];

    for (const name of fixtures) {
      it(`${name} passes validation`, () => {
        const doc = fixture(name);
        const result = validate(doc);
        assert.equal(result.valid, true, `Errors: ${result.errors.join(', ')}`);
      });
    }
  });

  describe('document structure', () => {
    it('rejects non-object', () => {
      const result = validate(null);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('object')));
    });

    it('requires id', () => {
      const result = validate({ meta: { title: 't', slug: 's', collection: 'c', status: 'draft' }, blocks: [] });
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('"id"')));
    });

    it('requires meta', () => {
      const result = validate({ id: 'x', blocks: [] });
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('"meta"')));
    });

    it('requires blocks', () => {
      const result = validate({ id: 'x', meta: { title: 't', slug: 's', collection: 'c', status: 'draft' } });
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('"blocks"')));
    });
  });

  describe('meta validation', () => {
    const baseMeta = { title: 't', slug: 's', collection: 'c', status: 'draft' };

    it('requires title', () => {
      const { title, ...rest } = baseMeta;
      const result = validate({ id: 'x', meta: rest, blocks: [] });
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('"title"')));
    });

    it('accepts a page theme and scope', () => {
      const d = (extra) => ({ id: 'x', meta: { ...baseMeta, ...extra }, blocks: [] });
      assert.equal(validate(d({ theme: '8bit', themeScope: 'article' })).valid, true);
    });

    it('refuses an unsafe theme id, a bad scope, a scope without a theme', () => {
      const d = (extra) => ({ id: 'x', meta: { ...baseMeta, ...extra }, blocks: [] });
      assert.ok(validate(d({ theme: 'Retro!' })).errors.includes('meta.theme must be a theme id (a-z, 0-9, -)'));
      assert.ok(validate(d({ theme: '8bit', themeScope: 'sidebar' })).errors.includes('meta.themeScope must be "page" or "article"'));
      assert.ok(validate(d({ themeScope: 'page' })).errors.includes('meta.themeScope needs meta.theme'));
    });

    it('meta.image must be a string', () => {
      const bad = validate({ id: 'x', meta: { ...baseMeta, image: 3 }, blocks: [] });
      assert.equal(bad.valid, false);
      assert.ok(bad.errors.includes('meta.image must be a string'));
      assert.equal(validate({ id: 'x', meta: { ...baseMeta, image: '/media/a.jpg' }, blocks: [] }).valid, true);
      assert.equal(validate({ id: 'x', meta: { ...baseMeta, image: null }, blocks: [] }).valid, true);
    });

    it('allows an empty title on a draft', () => {
      const result = validate({ id: 'x', meta: { ...baseMeta, title: '' }, blocks: [] });
      assert.equal(result.valid, true, result.errors.join('; '));
    });

    it('requires a title on a published post', () => {
      const result = validate({ id: 'x', meta: { ...baseMeta, title: '', status: 'published' }, blocks: [] });
      assert.equal(result.valid, false);
      assert.deepEqual(result.errors, ['a published post needs a title']);
    });

    it('requires slug', () => {
      const { slug, ...rest } = baseMeta;
      const result = validate({ id: 'x', meta: rest, blocks: [] });
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('"slug"')));
    });

    it('requires collection', () => {
      const { collection, ...rest } = baseMeta;
      const result = validate({ id: 'x', meta: rest, blocks: [] });
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('"collection"')));
    });

    it('requires status', () => {
      const { status, ...rest } = baseMeta;
      const result = validate({ id: 'x', meta: rest, blocks: [] });
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('"status"')));
    });

    it('rejects invalid status', () => {
      const result = validate({ id: 'x', meta: { ...baseMeta, status: 'deleted' }, blocks: [] });
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('not valid')));
    });
  });

  describe('block validation', () => {
    const validDoc = (blocks) => ({
      id: 'x',
      meta: { title: 't', slug: 's', collection: 'c', status: 'draft' },
      blocks,
    });

    it('a figure without a caption is valid', () => {
      const result = validate(validDoc([{ type: 'figure', attrs: { src: '/media/a.jpg', alt: 'x' } }]));
      assert.equal(result.valid, true, result.errors.join('; '));
    });

    it('embed type audio is valid', () => {
      const result = validate(validDoc([{ type: 'embed', attrs: { url: '/media/a.mp3', type: 'audio' } }]));
      assert.equal(result.valid, true, result.errors.join('; '));
    });

    it('embed type podcast is invalid', () => {
      const result = validate(validDoc([{ type: 'embed', attrs: { url: '/media/a.mp3', type: 'podcast' } }]));
      assert.equal(result.valid, false);
    });

    it('rejects unknown block type', () => {
      const result = validate(validDoc([{ type: 'widget' }]));
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('unknown block type "widget"')));
    });

    it('rejects heading without level', () => {
      const result = validate(validDoc([{ type: 'heading', children: [{ type: 'text', value: 'hi' }] }]));
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('"level"')));
    });

    it('rejects heading with out-of-range level', () => {
      const result = validate(validDoc([{ type: 'heading', attrs: { level: 1 }, children: [{ type: 'text', value: 'hi' }] }]));
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('>=')));
    });

    it('rejects callout without variant', () => {
      const result = validate(validDoc([{ type: 'callout', children: [{ type: 'paragraph', children: [] }] }]));
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('"variant"')));
    });

    it('rejects callout with invalid variant', () => {
      const result = validate(validDoc([{ type: 'callout', attrs: { variant: 'info' }, children: [{ type: 'paragraph', children: [] }] }]));
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('not in allowed')));
    });

    it('rejects leaf block with children', () => {
      const result = validate(validDoc([{ type: 'code_block', attrs: { language: 'js' }, value: 'x', children: [{ type: 'text', value: 'bad' }] }]));
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('must not have children')));
    });

    it('rejects wrong child types for tabs', () => {
      const result = validate(validDoc([{
        type: 'tabs',
        children: [{ type: 'paragraph', children: [{ type: 'text', value: 'wrong' }] }],
      }]));
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('expected type "tab"')));
    });

    it('validates a table with header and cells', () => {
      const result = validate(validDoc([{
        type: 'table',
        attrs: { striped: true },
        children: [{
          type: 'table_row',
          children: [
            { type: 'table_header', children: [{ type: 'text', value: 'Col A' }] },
            { type: 'table_header', children: [{ type: 'text', value: 'Col B' }] },
          ],
        }, {
          type: 'table_row',
          children: [
            { type: 'table_cell', children: [{ type: 'text', value: '1' }] },
            { type: 'table_cell', children: [{ type: 'text', value: '2' }] },
          ],
        }],
      }]));
      assert.equal(result.valid, true, `Errors: ${result.errors.join(', ')}`);
    });

    it('rejects wrong child types for table', () => {
      const result = validate(validDoc([{
        type: 'table',
        children: [{ type: 'paragraph', children: [{ type: 'text', value: 'wrong' }] }],
      }]));
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('expected type "table_row"')));
    });

    it('rejects wrong child types for table_row', () => {
      const result = validate(validDoc([{
        type: 'table',
        children: [{
          type: 'table_row',
          children: [{ type: 'paragraph', children: [{ type: 'text', value: 'wrong' }] }],
        }],
      }]));
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('not allowed')));
    });

    it('validates a definition list', () => {
      const result = validate(validDoc([{
        type: 'definition_list',
        children: [
          { type: 'definition_term', children: [{ type: 'text', value: 'Term' }] },
          { type: 'definition_desc', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Desc' }] }] },
        ],
      }]));
      assert.equal(result.valid, true, `Errors: ${result.errors.join(', ')}`);
    });

    it('rejects wrong child types for definition_list', () => {
      const result = validate(validDoc([{
        type: 'definition_list',
        children: [{ type: 'paragraph', children: [{ type: 'text', value: 'wrong' }] }],
      }]));
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('not allowed')));
    });

    it('validates hr with decorative variant', () => {
      const result = validate(validDoc([{ type: 'hr', attrs: { variant: 'decorative' } }]));
      assert.equal(result.valid, true, `Errors: ${result.errors.join(', ')}`);
    });

    it('rejects hr with invalid variant', () => {
      const result = validate(validDoc([{ type: 'hr', attrs: { variant: 'fancy' } }]));
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('not in allowed')));
    });
  });

  describe('inline validation', () => {
    const validDoc = (inlineChildren) => ({
      id: 'x',
      meta: { title: 't', slug: 's', collection: 'c', status: 'draft' },
      blocks: [{ type: 'paragraph', children: inlineChildren }],
    });

    it('rejects unknown inline type', () => {
      const result = validate(validDoc([{ type: 'emoji', value: ':)' }]));
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('unknown inline type')));
    });

    it('rejects invalid marks', () => {
      const result = validate(validDoc([{ type: 'text', value: 'hi', marks: ['underline'] }]));
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('invalid mark "underline"')));
    });

    it('rejects link without href', () => {
      const result = validate(validDoc([{
        type: 'link',
        attrs: {},
        children: [{ type: 'text', value: 'click' }],
      }]));
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('"href"')));
    });

    it('rejects footnote_ref without id', () => {
      const result = validate(validDoc([{ type: 'footnote_ref', attrs: {} }]));
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('"id"')));
    });

    it('accepts new marks: mark, kbd, sub, sup', () => {
      const result = validate(validDoc([
        { type: 'text', value: 'highlighted', marks: ['mark'] },
        { type: 'text', value: 'key', marks: ['kbd'] },
        { type: 'text', value: '2', marks: ['sub'] },
        { type: 'text', value: '2', marks: ['sup'] },
      ]));
      assert.equal(result.valid, true, `Errors: ${result.errors.join(', ')}`);
    });
  });

  describe('error collection', () => {
    it('collects multiple errors', () => {
      const result = validate({
        meta: { status: 'invalid' },
        blocks: [{ type: 'unknown' }, { type: 'heading' }],
      });
      assert.equal(result.valid, false);
      assert.ok(result.errors.length >= 3, `Expected >=3 errors, got ${result.errors.length}`);
    });
  });
});
