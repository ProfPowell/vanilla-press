import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newId, slugify, uniqueSlug, validateDesign, validateItem, effectiveLevel,
  findChoice, ancestorIds, addChoice, renameChoice, removeChoice, ChoiceInUseError,
} from '../../src/catalogs/model.js';

const coins = () => ({
  fields: [
    { id: 'f_year', label: 'Year', type: 'number', level: 'public' },
    { id: 'f_paid', label: 'Paid', type: 'money', level: 'private', total: true },
    { id: 'f_region', label: 'Region', type: 'choice', level: 'public', options: ['NTSC-U', 'PAL'] },
    { id: 'f_when', label: 'Acquired', type: 'date', level: 'friends' },
    { id: 'f_cib', label: 'Complete', type: 'bool', level: 'public' },
    { id: 'f_site', label: 'Site', type: 'url', level: 'public' },
    { id: 'f_note', label: 'Note', type: 'text', level: 'public' },
  ],
  lists: [{
    id: 'l_den', label: 'Denomination',
    choices: [{
      id: 'c_1', label: '1¢', children: [
        { id: 'c_lin', label: 'Lincoln', children: [{ id: 'c_wheat', label: 'Wheat', children: [] }] },
      ],
    }, { id: 'c_5', label: '5¢', children: [{ id: 'c_buf', label: 'Buffalo', children: [] }] }],
  }],
  grading: { level: 'public', agencies: ['pcgs', 'ngc'] },
  sort: ['title', 'added'],
});

test('newId uses prefix and 10 base36 chars', () => {
  for (const p of ['cat', 'item', 'f', 'l', 'c']) assert.match(newId(p), new RegExp(`^${p}_[0-9a-z]{10}$`));
  assert.notEqual(newId('item'), newId('item'));
});

test('slugify', () => {
  assert.equal(slugify('Super Mario Bros. 3'), 'super-mario-bros-3');
  assert.equal(slugify('  Café  Déjà vu! '), 'cafe-deja-vu');
  assert.equal(slugify('!!!'), 'item');
});

test('uniqueSlug', () => {
  assert.equal(uniqueSlug('x', new Set(['x', 'x-2'])), 'x-3');
  assert.equal(uniqueSlug('y', new Set(['x'])), 'y');
});

test('effectiveLevel is the higher of catalog and item; unknown is private', () => {
  assert.equal(effectiveLevel({ access: 'friends' }, { access: 'public' }), 'friends');
  assert.equal(effectiveLevel({ access: 'public' }, { access: 'private' }), 'private');
  assert.equal(effectiveLevel({ access: 'public' }, { access: 'bogus' }), 'private');
  assert.equal(effectiveLevel({ access: 'public' }, {}), 'public');
});

test('findChoice returns the label path', () => {
  const d = coins();
  const hit = findChoice(d, 'l_den', 'c_wheat');
  assert.deepEqual(hit.path, ['1¢', 'Lincoln', 'Wheat']);
  assert.equal(hit.choice.id, 'c_wheat');
  assert.equal(findChoice(d, 'l_den', 'nope'), null);
  assert.equal(findChoice(d, 'nolist', 'c_1'), null);
});

test('ancestorIds is self first, then parents', () => {
  assert.deepEqual(ancestorIds(coins(), 'l_den', 'c_wheat'), ['c_wheat', 'c_lin', 'c_1']);
  assert.deepEqual(ancestorIds(coins(), 'l_den', 'nope'), []);
});

test('addChoice, renameChoice are pure', () => {
  const d = coins();
  const snap = JSON.stringify(d);
  const { design: d2, id } = addChoice(d, 'l_den', 'c_5', 'Jefferson');
  assert.match(id, /^c_/);
  assert.deepEqual(findChoice(d2, 'l_den', id).path, ['5¢', 'Jefferson']);
  const { design: d3, id: top } = addChoice(d2, 'l_den', null, '10¢');
  assert.deepEqual(findChoice(d3, 'l_den', top).path, ['10¢']);
  const d4 = renameChoice(d3, 'l_den', id, 'Jeff');
  assert.deepEqual(findChoice(d4, 'l_den', id).path, ['5¢', 'Jeff']);
  assert.equal(JSON.stringify(d), snap);
});

test('removeChoice refuses a choice in use', () => {
  const d = coins();
  const items = [{ categories: { l_den: ['c_wheat'] } }, { categories: {} }];
  assert.throws(() => removeChoice(d, 'l_den', 'c_1', items), (e) => e instanceof ChoiceInUseError && e.count === 1);
  assert.throws(() => removeChoice(d, 'l_den', 'c_wheat', items), (e) => e instanceof ChoiceInUseError && e.count === 1);
  const d2 = removeChoice(d, 'l_den', 'c_5', items);
  assert.equal(findChoice(d2, 'l_den', 'c_5'), null);
  assert.notEqual(findChoice(d, 'l_den', 'c_5'), null);
});

test('validateDesign', () => {
  assert.deepEqual(validateDesign(coins()), []);
  assert.ok(validateDesign(null).length);
  const bad = coins();
  bad.fields[0].type = 'blob';
  bad.fields[1].level = 'secret';
  bad.fields[2].options = [];
  assert.ok(validateDesign(bad).length >= 3);
  const dup = coins();
  dup.fields[1].id = 'f_year';
  assert.ok(validateDesign(dup).some((m) => /duplicate/i.test(m)));
});

test('validateItem', () => {
  const d = coins();
  const ok = { title: 'A', rating: 3, fields: { f_year: 1909, f_paid: 12.5, f_region: 'PAL', f_when: '2026-01-02', f_cib: true, f_site: 'https://x.test/', f_note: 'hi' }, grade: { agency: 'pcgs', value: 'MS-65' } };
  assert.deepEqual(validateItem(ok, d), []);
  assert.ok(validateItem({ ...ok, rating: 6 }, d).length);
  assert.ok(validateItem({ ...ok, rating: 2.5 }, d).length);
  assert.deepEqual(validateItem({ ...ok, rating: null }, d), []);
  assert.ok(validateItem({ ...ok, fields: { f_year: 'nineteen' } }, d).length);
  assert.ok(validateItem({ ...ok, fields: { f_region: 'JP' } }, d).length);
  assert.ok(validateItem({ ...ok, fields: { f_when: 'yesterday' } }, d).length);
  assert.ok(validateItem({ ...ok, fields: { f_site: 'javascript:alert(1)' } }, d).length);
  assert.ok(validateItem({ ...ok, grade: { agency: 'xyz', value: '1' } }, d).length);
  assert.ok(validateItem({ ...ok, grade: { agency: 'pcgs', value: '1' } }, { ...d, grading: null }).length);
  assert.ok(validateItem({ title: '' }, d).length);
});
