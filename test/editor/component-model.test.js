import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  nodeTypeFor, initialAttrs, formFields, coerce, paletteEntries, enabledDescriptors,
} from '../../editor/assets/js/component-model.js';

const d = (tag, kind, extra = {}) => ({
  tag, label: tag, icon: 'box', description: `${tag} desc`, group: 'G', kind,
  defaults: {}, advanced: [], package: 'p', attributes: [], bundled: false, scriptPath: null, ...extra,
});

describe('nodeTypeFor', () => {
  it('maps kinds to node types', () => {
    assert.equal(nodeTypeFor(d('x-a', 'none')), 'component_leaf');
    assert.equal(nodeTypeFor(d('x-a', 'text')), 'component_leaf');
    assert.equal(nodeTypeFor(d('x-a', 'code')), 'component_leaf');
    assert.equal(nodeTypeFor(d('x-a', 'blocks')), 'component_blocks');
    assert.equal(nodeTypeFor(d('x-a', 'inline')), 'component_inline');
  });
});

describe('initialAttrs', () => {
  it('copies defaults and adds value/wrap by kind', () => {
    const defaults = { title: 'T', zoom: 3 };
    const none = initialAttrs(d('x-n', 'none', { defaults }));
    assert.deepEqual(none, { tag: 'x-n', attrs: { title: 'T', zoom: 3 } });
    assert.notEqual(none.attrs, defaults, 'defaults are copied');
    assert.deepEqual(initialAttrs(d('x-t', 'text')), { tag: 'x-t', attrs: {}, value: '' });
    assert.deepEqual(initialAttrs(d('x-c', 'code', { codeWrap: 'template' })),
      { tag: 'x-c', attrs: {}, value: '', wrap: 'template' });
    assert.deepEqual(initialAttrs(d('x-b', 'blocks')), { tag: 'x-b', attrs: {} });
    assert.deepEqual(initialAttrs(d('x-i', 'inline')), { tag: 'x-i', attrs: {} });
  });
});

describe('formFields', () => {
  const desc = d('x-f', 'none', {
    advanced: ['theme'],
    attributes: [
      { name: 'video-id', type: 'string', description: 'The id' },
      { name: 'count', type: 'number' },
      { name: 'open', type: 'boolean' },
      { name: 'theme', type: 'string', enum: ['light', 'dark'] },
      { name: 'src', type: 'string' },
    ],
  });
  const fields = formFields(desc);

  it('builds one field per attribute with a control by type', () => {
    assert.deepEqual(fields.map(f => [f.name, f.control]), [
      ['video-id', 'text'], ['count', 'number'], ['open', 'checkbox'], ['theme', 'select'], ['src', 'text'],
    ]);
    assert.equal(fields[0].label, 'Video id');
    assert.equal(fields[0].description, 'The id');
    assert.equal('description' in fields[1], false);
  });
  it('marks advanced attributes', () => {
    assert.deepEqual(fields.map(f => f.advanced), [false, false, false, true, false]);
  });
  it('builds a select for an enum', () => {
    assert.deepEqual(fields[3].options, ['light', 'dark']);
    assert.equal('options' in fields[0], false);
  });
  it('gives URL-like names inputmode url', () => {
    assert.equal(fields[4].inputmode, 'url');
    assert.equal('inputmode' in fields[0], false);
    for (const name of ['url', 'href', 'poster']) {
      const [f] = formFields(d('x-u', 'none', { attributes: [{ name, type: 'string' }] }));
      assert.deepEqual([f.control, f.inputmode], ['text', 'url'], name);
    }
  });
});

describe('coerce', () => {
  it('parses numbers', () => {
    assert.equal(coerce({ type: 'number' }, '3'), 3);
    assert.equal(coerce({ type: 'number' }, ' 2.5 '), 2.5);
    assert.equal(coerce({ type: 'number' }, 'x'), undefined);
  });
  it('passes booleans', () => {
    assert.equal(coerce({ type: 'boolean' }, true), true);
    assert.equal(coerce({ type: 'boolean' }, false), false);
    assert.equal(coerce({ type: 'boolean' }, 'true'), true);
  });
  it('turns empty into undefined', () => {
    for (const type of ['string', 'number', 'boolean']) assert.equal(coerce({ type }, ''), undefined, type);
  });
  it('keeps strings and checks enums', () => {
    assert.equal(coerce({ type: 'string' }, 'hi'), 'hi');
    assert.equal(coerce({ type: 'string', enum: ['a'] }, 'a'), 'a');
    assert.equal(coerce({ type: 'string', enum: ['a'] }, 'b'), undefined);
  });
});

describe('paletteEntries', () => {
  it('excludes inline kinds and sorts by group then label', () => {
    const entries = paletteEntries([
      d('x-z', 'none', { group: 'B', label: 'Zed' }),
      d('x-i', 'inline', { group: 'A' }),
      d('x-b', 'blocks', { group: 'B', label: 'Alpha' }),
      d('x-c', 'code', { group: 'A', label: 'Code' }),
    ]);
    assert.deepEqual(entries.map(e => e.tag), ['x-c', 'x-b', 'x-z']);
    assert.deepEqual(entries[0], {
      id: 'component:x-c', label: 'Code', description: 'x-c desc', icon: 'box', category: 'A', tag: 'x-c',
    });
  });
});

describe('enabledDescriptors', () => {
  it('keeps only enabled packages’ elements', () => {
    const res = { cookSupportsPackages: true, packages: [
      { package: 'a', enabled: true, elements: [d('x-a', 'none')] },
      { package: 'b', enabled: false, elements: [d('x-b', 'none')] },
    ] };
    assert.deepEqual(enabledDescriptors(res).map(e => e.tag), ['x-a']);
    assert.deepEqual(enabledDescriptors(null), []);
    assert.deepEqual(enabledDescriptors({}), []);
  });
});
