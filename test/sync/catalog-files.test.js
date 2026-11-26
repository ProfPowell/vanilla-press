import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveWorkspace, openWorkspaceDb } from '../../src/workspace/workspace.js';
import { createCatalog, createItem } from '../../src/store/catalogs.js';
import { designFromTemplate } from '../../src/catalogs/templates.js';
import { saveDocument } from '../../src/store/content.js';
import {
  catalogFilePath, writeCatalogFile, removeCatalogFile, photoAccessWarnings,
} from '../../src/sync/catalog-files.js';

const repoRoot = join(import.meta.dirname, '..', '..');

let root, ws, db, catalog;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'vp-catalog-files-'));
  const site = join(root, 'site');
  mkdirSync(join(site, 'src'), { recursive: true });
  ws = resolveWorkspace({ site, env: {}, repoRoot });
  db = openWorkspaceDb(ws);
  catalog = createCatalog(db, { title: 'Retro games', template: 'retro-games', design: designFromTemplate('retro-games') });
});
afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

const addMedia = (filename, access = 'public') => db.prepare(
  `INSERT INTO media (id, filename, mime_type, size, created, access) VALUES (?, ?, 'image/jpeg', 1, '2026-11-01T00:00:00.000Z', ?)`,
).run(`m_${filename}`, filename, access);

describe('catalog files', () => {
  test('catalogFilePath is content/catalogs/<slug>.json', () => {
    assert.equal(catalogFilePath(ws, 'retro-games'), join(ws.siteDir, 'content', 'catalogs', 'retro-games.json'));
  });

  test('drafts are not written; items sorted by title; every field present', () => {
    const field = catalog.design.fields[0].id;
    createItem(db, catalog.id, { title: 'zelda', status: 'published' });
    createItem(db, catalog.id, { title: 'Draft one' });
    createItem(db, catalog.id, {
      title: 'Earthbound', status: 'published', access: 'private', rating: 5,
      description: 'Mine', fields: { [field]: 'secret' }, tags: ['childhood copy'],
    });
    const path = writeCatalogFile(ws, db, catalog.id);
    assert.equal(path, catalogFilePath(ws, 'retro-games'));
    const data = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(data.version, 1);
    assert.equal(data.catalog.id, catalog.id);
    assert.deepEqual(data.catalog.design, catalog.design);
    assert.deepEqual(data.items.map((i) => i.title), ['Earthbound', 'zelda']);
    const eb = data.items[0];
    assert.equal(eb.access, 'private');
    assert.equal(eb.rating, 5);
    assert.equal(eb.fields[field], 'secret');
    assert.deepEqual(eb.tags, ['childhood copy']);
    for (const key of ['id', 'slug', 'status', 'description', 'video', 'links', 'categories', 'grade', 'photos', 'created', 'updated', 'published']) {
      assert.ok(key in eb, key);
    }
  });

  test('the write is atomic: no temp file is left', () => {
    createItem(db, catalog.id, { title: 'A', status: 'published' });
    writeCatalogFile(ws, db, catalog.id);
    assert.deepEqual(readdirSync(join(ws.siteDir, 'content', 'catalogs')), ['retro-games.json']);
  });

  test('removeCatalogFile removes it (and is quiet when there is none)', () => {
    writeCatalogFile(ws, db, catalog.id);
    removeCatalogFile(ws, 'retro-games');
    assert.equal(existsSync(catalogFilePath(ws, 'retro-games')), false);
    removeCatalogFile(ws, 'retro-games');
  });

  test('photoAccessWarnings lists photos below the item level, with the published posts using them', () => {
    addMedia('a.jpg', 'public');
    addMedia('b.jpg', 'friends');
    addMedia('c.jpg', 'public');
    saveDocument(db, {
      id: 'doc_pub', meta: { title: 'Holiday', slug: 'holiday', collection: 'posts', status: 'published' },
      blocks: [{ type: 'figure', attrs: { src: '/media/a.jpg' }, children: [] }],
    });
    saveDocument(db, {
      id: 'doc_img', meta: { title: 'Cover', slug: 'cover', collection: 'posts', status: 'published', image: '/media/a.jpg' }, blocks: [],
    });
    saveDocument(db, {
      id: 'doc_draft', meta: { title: 'Draft', slug: 'draft', collection: 'posts', status: 'draft', image: '/media/a.jpg' }, blocks: [],
    });
    const item = createItem(db, catalog.id, {
      title: 'Mine', access: 'friends', photos: [{ file: 'a.jpg', main: true }, { file: 'b.jpg' }],
    });
    const pub = createItem(db, catalog.id, { title: 'Public', photos: [{ file: 'c.jpg' }] });
    const warnings = photoAccessWarnings(db, catalog, [item, pub]);
    assert.deepEqual(warnings, [{ item: { id: item.id, title: 'Mine' }, file: 'a.jpg', access: 'public', needed: 'friends', posts: ['Cover', 'Holiday'] }]);
  });

  test('photoAccessWarnings follows the collection level', () => {
    addMedia('a.jpg', 'friends');
    const item = createItem(db, catalog.id, { title: 'Mine', photos: [{ file: 'a.jpg' }] });
    const warnings = photoAccessWarnings(db, { ...catalog, access: 'private' }, [item]);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].needed, 'private');
    assert.deepEqual(warnings[0].posts, []);
  });
});
