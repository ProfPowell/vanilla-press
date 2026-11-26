import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrate } from '../../src/store/migrate.js';
import {
  listCatalogs, getCatalog, getCatalogBySlug, createCatalog, updateCatalog, deleteCatalog,
  listItems, getItem, createItem, updateItem, deleteItem, usedTags, CatalogHasPublishedError,
} from '../../src/store/catalogs.js';

const design = { fields: [{ id: 'f_a', label: 'A', type: 'text', level: 'public' }], lists: [], grading: null, sort: ['title'] };

function mk() {
  const db = new Database(':memory:');
  migrate(db);
  const cat = createCatalog(db, { title: 'Retro games', template: 'retro-games', design, access: 'friends' });
  return { db, cat };
}

test('catalog round-trip with JSON design', () => {
  const { db, cat } = mk();
  assert.match(cat.id, /^cat_/);
  assert.equal(cat.slug, 'retro-games');
  assert.equal(cat.access, 'friends');
  assert.deepEqual(getCatalog(db, cat.id).design, design);
  assert.equal(getCatalogBySlug(db, 'retro-games').id, cat.id);
  assert.equal(getCatalog(db, 'nope'), null);
  assert.equal(createCatalog(db, { title: 'Retro games', design }).slug, 'retro-games-2');
  assert.equal(listCatalogs(db).length, 2);
  const up = updateCatalog(db, cat.id, { title: 'Games', description: 'd', access: 'public' });
  assert.equal(up.title, 'Games');
  assert.equal(up.description, 'd');
  assert.equal(up.slug, 'retro-games');
  deleteCatalog(db, cat.id);
  assert.equal(getCatalog(db, cat.id), null);
});

test('item round-trip with JSON fields intact', () => {
  const { db, cat } = mk();
  const it = createItem(db, cat.id, {
    title: 'Super Mario Bros. 3', rating: 5, description: 'x\n\ny', video: 'https://v.test/',
    links: [{ label: 'L', url: 'https://l.test/' }], tags: ['b', 'a'], categories: { l_x: ['c_1'] },
    grade: { agency: 'pcgs', value: 'MS-65', extras: { cac: true }, other: '' },
    fields: { f_a: 'hello' }, photos: [{ file: 'a.jpg', main: true }],
  });
  assert.match(it.id, /^item_/);
  assert.equal(it.slug, 'super-mario-bros-3');
  assert.equal(it.catalogId, cat.id);
  assert.equal(it.status, 'draft');
  assert.equal(it.published, null);
  const got = getItem(db, it.id);
  assert.deepEqual(got, it);
  assert.deepEqual(got.links, [{ label: 'L', url: 'https://l.test/' }]);
  assert.deepEqual(got.categories, { l_x: ['c_1'] });
  assert.deepEqual(got.grade.extras, { cac: true });
  assert.deepEqual(got.photos, [{ file: 'a.jpg', main: true }]);
  assert.equal(createItem(db, cat.id, { title: 'Super Mario Bros. 3' }).slug, 'super-mario-bros-3-2');
  assert.equal(listItems(db, cat.id).length, 2);
  const up = updateItem(db, it.id, { rating: 4, grade: null, tags: ['z'] });
  assert.equal(up.rating, 4);
  assert.equal(up.grade, null);
  assert.deepEqual(up.tags, ['z']);
  assert.equal(up.title, 'Super Mario Bros. 3');
  deleteItem(db, it.id);
  assert.equal(getItem(db, it.id), null);
});

test('publishing stamps published; slug cannot change once published', () => {
  const { db, cat } = mk();
  const it = createItem(db, cat.id, { title: 'Zelda' });
  assert.equal(updateItem(db, it.id, { slug: 'zelda-1' }).slug, 'zelda-1');
  const pub = updateItem(db, it.id, { status: 'published' });
  assert.ok(pub.published);
  assert.throws(() => updateItem(db, it.id, { slug: 'other' }), /slug/i);
  assert.equal(updateItem(db, it.id, { slug: 'zelda-1', title: 'Zelda 2' }).title, 'Zelda 2');
  assert.throws(() => updateCatalog(db, cat.id, { slug: 'other' }), /slug/i);
  assert.equal(updateCatalog(db, cat.id, { slug: cat.slug, title: 'T' }).title, 'T');
});

test('deleteCatalog and deleteItem refuse published items', () => {
  const { db, cat } = mk();
  const it = createItem(db, cat.id, { title: 'A', status: 'published' });
  assert.ok(getItem(db, it.id).published);
  assert.throws(() => deleteCatalog(db, cat.id), CatalogHasPublishedError);
  assert.throws(() => deleteItem(db, it.id), CatalogHasPublishedError);
  updateItem(db, it.id, { status: 'draft' });
  deleteCatalog(db, cat.id);
  assert.equal(getCatalog(db, cat.id), null);
  assert.equal(listItems(db, cat.id).length, 0);
});

test('usedTags returns distinct sorted tags', () => {
  const { db, cat } = mk();
  createItem(db, cat.id, { title: 'A', tags: ['b', 'a'] });
  createItem(db, cat.id, { title: 'B', tags: ['a', 'c'] });
  assert.deepEqual(usedTags(db, cat.id), ['a', 'b', 'c']);
});
