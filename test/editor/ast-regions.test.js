import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { schema } from '../../editor/assets/js/schema.js';
import { toBlockAst, toRegionsAst, fromBlockAst } from '../../editor/assets/js/ast.js';

const para = (value) => ({ type: 'paragraph', children: [{ type: 'text', value }] });

describe('regions in the PM doc', () => {
  it('fromBlockAst puts the regions after the body, in order, with their attrs', () => {
    const doc = fromBlockAst([para('Body')], schema, {
      title: 'T',
      regions: [
        { name: 'aside', label: 'Sidebar', shown: true, blocks: [para('Side')] },
        { name: 'footer', label: 'footer', shown: false, blocks: [] },
      ],
    });
    doc.check();
    const names = [];
    doc.forEach((n) => names.push(n.type.name));
    assert.deepEqual(names, ['title', 'paragraph', 'region', 'region']);
    const aside = doc.child(2);
    assert.deepEqual({ ...aside.attrs }, { name: 'aside', label: 'Sidebar', shown: true });
    assert.equal(aside.textContent, 'Side');
    // An empty region still holds a line to type in
    assert.equal(doc.child(3).childCount, 1);
    assert.equal(doc.child(3).firstChild.type.name, 'paragraph');
    assert.equal(doc.child(3).attrs.shown, false);
  });

  it('round-trips body and regions: the body walk skips regions', () => {
    const body = [para('One'), { type: 'heading', attrs: { level: 2 }, children: [{ type: 'text', value: 'H' }] }];
    const side = [para('Side one'), para('Side two')];
    const doc = fromBlockAst(body, schema, { title: 'T', regions: [{ name: 'aside', label: 'Aside', shown: true, blocks: side }] });
    assert.deepEqual(toBlockAst(doc), body);
    assert.deepEqual(toRegionsAst(doc), { aside: side });
  });

  it('omits a region that holds only one empty paragraph', () => {
    const doc = fromBlockAst([para('Body')], schema, {
      regions: [
        { name: 'aside', label: 'Aside', shown: true, blocks: [] },
        { name: 'footer', label: 'Footer', shown: true, blocks: [para('Foot')] },
      ],
    });
    assert.deepEqual(toRegionsAst(doc), { footer: [para('Foot')] });
  });

  it('a doc without regions gives {}', () => {
    const doc = fromBlockAst([para('Body')], schema, { title: 'T' });
    assert.deepEqual(toRegionsAst(doc), {});
    assert.deepEqual(toBlockAst(doc), [para('Body')]);
  });

  it('the region renders as a labelled section; a hidden one says so in text', () => {
    const spec = schema.nodes.region.spec;
    const shown = spec.toDOM(schema.nodes.region.create({ name: 'aside', label: 'Sidebar', shown: true },
      [schema.nodes.paragraph.create()]));
    assert.deepEqual(shown, ['section', { class: 'pm-region', 'data-region': 'aside' },
      ['p', { class: 'pm-region-label', contenteditable: 'false' }, 'Sidebar'],
      ['div', { class: 'pm-region-body' }, 0]]);
    const hidden = spec.toDOM(schema.nodes.region.create({ name: 'aside', label: 'Sidebar', shown: false },
      [schema.nodes.paragraph.create()]));
    assert.equal(hidden[2][2], 'Sidebar · Not shown by this layout');
    assert.ok(spec.isolating && spec.defining);
  });
});
