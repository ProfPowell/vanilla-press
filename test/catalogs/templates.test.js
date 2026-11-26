import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES, designFromTemplate } from '../../src/catalogs/templates.js';
import { AGENCIES, compareGrades } from '../../src/catalogs/grading.js';
import { validateDesign } from '../../src/catalogs/model.js';

const IDS = ['us-coins', 'retro-games', 'retro-hardware', 'trading-cards', 'comics', 'books', 'blank'];
const byLabel = (arr, label) => arr.find((x) => x.label === label);

test('templates list the expected ids', () => {
  assert.deepEqual(TEMPLATES.map((t) => t.id), IDS);
  for (const t of TEMPLATES) assert.ok(t.label && t.description);
});

test('every template passes validateDesign', () => {
  for (const id of IDS) assert.deepEqual(validateDesign(designFromTemplate(id)), [], id);
});

test('us-coins denomination list nests series and varieties', () => {
  const d = designFromTemplate('us-coins');
  const denom = byLabel(d.lists, 'Denomination');
  const cent = byLabel(denom.choices, '1¢');
  for (const s of ['Indian Head', 'Lincoln']) assert.ok(byLabel(cent.children, s), s);
  const lincoln = byLabel(cent.children, 'Lincoln');
  for (const v of ['Wheat', 'Memorial', 'Shield']) assert.ok(byLabel(lincoln.children, v), v);
  const nickel = byLabel(denom.choices, '5¢');
  for (const s of ['Liberty "V"', 'Buffalo', 'Jefferson']) assert.ok(byLabel(nickel.children, s), s);
  for (const l of ['10¢', '25¢', '50¢', '$1']) assert.ok(byLabel(denom.choices, l), l);
});

test('non-blank templates share five private fields', () => {
  const want = [['Price paid', 'money', false], ['Date acquired', 'date'], ['Where/how acquired', 'text'], ['Private notes', 'text'], ['Estimated value', 'money', true]];
  for (const id of IDS.filter((i) => i !== 'blank')) {
    const d = designFromTemplate(id);
    for (const [label, type, total] of want) {
      const f = byLabel(d.fields, label);
      assert.ok(f, `${id}: ${label}`);
      assert.equal(f.type, type);
      assert.equal(f.level, 'private');
      if (type === 'money') assert.equal(!!f.total, total);
    }
  }
});

test('blank has no fields, lists or grading', () => {
  const d = designFromTemplate('blank');
  assert.deepEqual([d.fields, d.lists, d.grading], [[], [], null]);
});

test('ids are fresh on every call', () => {
  const ids = (d) => JSON.stringify(d).match(/"(?:f|l|c)_[a-z0-9]{10}"/g);
  const a = ids(designFromTemplate('us-coins'));
  const b = ids(designFromTemplate('us-coins'));
  assert.ok(a.length > 20);
  assert.ok(!a.some((x) => b.includes(x)));
});

test('template agencies exist; grading follows the spec', () => {
  for (const id of IDS) {
    const g = designFromTemplate(id).grading;
    for (const a of g?.agencies ?? []) assert.ok(AGENCIES[a], `${id}:${a}`);
  }
  assert.deepEqual(designFromTemplate('us-coins').grading.agencies, ['pcgs', 'ngc', 'anacs', 'cac']);
  assert.deepEqual(designFromTemplate('retro-games').grading.agencies, ['wata', 'vga']);
  assert.equal(designFromTemplate('retro-hardware').grading, null);
  assert.deepEqual(designFromTemplate('comics').grading.agencies, ['cgc-comics', 'cbcs']);
  assert.deepEqual(designFromTemplate('books').grading.agencies, ['raw']);
});

test('designFromTemplate rejects unknown ids', () => {
  assert.throws(() => designFromTemplate('nope'));
});

test('agencies have ordered scales and the required extras', () => {
  for (const id of ['pcgs', 'ngc', 'anacs', 'cac', 'psa', 'bgs', 'cgc-cards', 'sgc', 'cgc-comics', 'cbcs', 'wata', 'vga', 'raw']) {
    assert.ok(AGENCIES[id].label && AGENCIES[id].scale.length > 1, id);
  }
  assert.equal(AGENCIES.pcgs.scale[0], 'P-1');
  assert.equal(AGENCIES.pcgs.scale.at(-1), 'PR-70');
  assert.equal(AGENCIES.ngc.scale.at(-1), 'PF-70');
  assert.ok(AGENCIES.pcgs.scale.includes('MS-70') && AGENCIES.pcgs.scale.includes('PR-65'));
  assert.deepEqual(AGENCIES.bgs.extras.map((e) => e.id), ['centering', 'corners', 'edges', 'surface']);
  assert.ok(AGENCIES.pcgs.extras.some((e) => e.id === 'cac' && e.type === 'bool'));
  assert.ok(AGENCIES['cgc-comics'].extras.some((e) => e.id === 'pages'));
  assert.equal(AGENCIES['cgc-comics'].scale[0], '0.5');
  assert.equal(AGENCIES['cgc-comics'].scale.at(-1), '10.0');
  assert.deepEqual(AGENCIES.raw.scale, ['Poor', 'Fair', 'Good', 'Very Good', 'Fine', 'Very Fine', 'Near Mint', 'Mint']);
});

test('compareGrades', () => {
  const g = (agency, value) => ({ agency, value });
  assert.ok(compareGrades(g('pcgs', 'MS-65'), g('pcgs', 'MS-63')) > 0);
  assert.ok(compareGrades(g('pcgs', 'MS-63'), g('pcgs', 'MS-65')) < 0);
  assert.equal(compareGrades(g('psa', '9'), g('psa', '9')), 0);
  assert.ok(compareGrades(g('psa', '10'), g('raw', 'Mint')) >= 0);
  assert.ok(compareGrades(g('psa', '1'), g('raw', 'Mint')) < 0);
  assert.ok(compareGrades(g('other', 'whatever'), g('psa', '1')) > 0);
  assert.ok(compareGrades(g('psa', '1'), g('other', 'x')) < 0);
  assert.ok(compareGrades(null, g('psa', '1')) > 0);
});

test('coin proofs are parallel to business strikes, ranked by number', () => {
  const g = (agency, value) => ({ agency, value });
  assert.ok(compareGrades(g('pcgs', 'PR-65'), g('pcgs', 'MS-70')) < 0);
  assert.ok(compareGrades(g('pcgs', 'PR-70'), g('pcgs', 'MS-69')) > 0);
  assert.ok(compareGrades(g('pcgs', 'PR-60'), g('pcgs', 'MS-70')) < 0);
  // same number: business strike sorts just below the proof, consistently
  assert.ok(compareGrades(g('pcgs', 'MS-65'), g('pcgs', 'PR-65')) < 0);
  assert.ok(compareGrades(g('pcgs', 'PR-65'), g('pcgs', 'MS-65')) > 0);
  assert.ok(compareGrades(g('pcgs', 'MS-65'), g('pcgs', 'MS-63')) > 0);
  assert.ok(compareGrades(g('pcgs', 'AU-58'), g('pcgs', 'PR-60')) < 0);
  assert.ok(compareGrades(g('ngc', 'PF-65'), g('pcgs', 'MS-70')) < 0);
});

test('WATA scale has the real half-steps', () => {
  const s = AGENCIES.wata.scale;
  for (const v of ['0.5', '8.5', '9.0', '9.2', '9.4', '9.6', '9.8', '10']) assert.ok(s.includes(v), v);
  assert.equal(s.at(-1), '10');
  assert.ok(compareGrades({ agency: 'wata', value: '9.8' }, { agency: 'wata', value: '9.6' }) > 0);
  assert.ok(compareGrades({ agency: 'wata', value: '10' }, { agency: 'wata', value: '9.8' }) > 0);
});

test('trading cards nest game -> set -> subset', () => {
  const l = designFromTemplate('trading-cards').lists[0];
  const deep = (cs, n = 1) => cs.some((c) => (n >= 3 ? true : deep(c.children, n + 1)));
  assert.ok(deep(l.choices));
});
