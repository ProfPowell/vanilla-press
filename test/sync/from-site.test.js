import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveWorkspace, openWorkspaceDb } from '../../src/workspace/workspace.js';
import { syncDocument, changedOnDisk } from '../../src/sync/to-site.js';
import { saveDocument, getDocument } from '../../src/store/content.js';
import { syncFromSite, reloadFromSite } from '../../src/sync/from-site.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixture = (n) => JSON.parse(readFileSync(join(repoRoot, 'test', 'fixtures', n), 'utf8'));
const mk = (base, meta) => ({ ...base, meta: { ...base.meta, ...meta } });

let tmp, ws, db;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'vp-sync-'));
  ws = resolveWorkspace({ site: tmp, repoRoot });
  db = openWorkspaceDb(ws);
  mock.method(console, 'warn', () => {});
});
afterEach(() => {
  mock.restoreAll();
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

const simple = () => mk(fixture('simple-post.json'), { collection: 'posts', slug: 'hello', status: 'draft' });
const REL = 'content/posts/hello.json';
const editTitle = (title) => {
  const f = join(tmp, REL);
  const d = JSON.parse(readFileSync(f, 'utf8'));
  d.meta.title = title;
  writeFileSync(f, JSON.stringify(d, null, 2) + '\n');
};

describe('syncFromSite', () => {
  it('imports a new file', () => {
    const doc = simple();
    syncDocument(ws, doc, {});
    const res = syncFromSite(ws, db);
    assert.deepEqual(res, { imported: [doc.id], skipped: [], removed: [], adopted: [] });
    assert.equal(getDocument(db, doc.id).meta.title, doc.meta.title);
    assert.equal(changedOnDisk(ws, doc.id, REL), false);
  });

  it('imports a file changed on disk', () => {
    const doc = simple();
    saveDocument(db, doc);
    syncDocument(ws, doc, {});
    editTitle('Edited elsewhere');
    const res = syncFromSite(ws, db);
    assert.deepEqual(res.imported, [doc.id]);
    assert.equal(getDocument(db, doc.id).meta.title, 'Edited elsewhere');
  });

  it('skips an unchanged synced file', () => {
    const doc = simple();
    saveDocument(db, doc);
    syncDocument(ws, doc, {});
    const res = syncFromSite(ws, db);
    assert.deepEqual(res, { imported: [], skipped: [doc.id], removed: [], adopted: [] });
  });

  it('skips invalid and unparseable files without throwing', () => {
    mkdirSync(join(tmp, 'content/posts'), { recursive: true });
    writeFileSync(join(tmp, 'content/posts/bad.json'), '{ nope');
    writeFileSync(join(tmp, 'content/posts/inv.json'), JSON.stringify({ id: 'x', meta: {} }));
    writeFileSync(join(tmp, 'content/media.json'), '[]');
    const res = syncFromSite(ws, db);
    assert.equal(res.imported.length, 0);
    assert.equal(res.skipped.length, 2);
    assert.equal(console.warn.mock.callCount(), 2);
  });

  it('keeps store-only docs unless replace', () => {
    const only = mk(fixture('simple-post.json'), { collection: 'posts', slug: 'only-here' });
    saveDocument(db, only);
    assert.deepEqual(syncFromSite(ws, db).removed, []);
    assert.ok(getDocument(db, only.id));
    assert.deepEqual(syncFromSite(ws, db, { replace: true }).removed, [only.id]);
    assert.equal(getDocument(db, only.id), null);
  });
});

describe('reloadFromSite', () => {
  it('loads the file unconditionally and records it', () => {
    const doc = simple();
    saveDocument(db, doc);
    syncDocument(ws, doc, {});
    editTitle('From disk');
    assert.equal(changedOnDisk(ws, doc.id, REL), true);
    const saved = reloadFromSite(ws, db, doc.id);
    assert.equal(saved.meta.title, 'From disk');
    assert.equal(getDocument(db, doc.id).meta.title, 'From disk');
    assert.equal(changedOnDisk(ws, doc.id, REL), false);
  });

  it('throws when there is no file', () => {
    assert.throws(() => reloadFromSite(ws, db, 'nope'), /No content file for document nope/);
  });
});

describe('sync safety (fix round 1)', () => {
  const put = (rel, text) => {
    mkdirSync(dirname(join(tmp, rel)), { recursive: true });
    writeFileSync(join(tmp, rel), typeof text === 'string' ? text : JSON.stringify(text, null, 2) + '\n');
  };

  it('replace removes nothing when a file is unparseable', () => {
    const doc = simple();
    saveDocument(db, doc);
    syncDocument(ws, doc, {});
    put(REL, '<<<<<<< HEAD\n{}\n=======\n');
    const res = syncFromSite(ws, db, { replace: true });
    assert.deepEqual(res.removed, []);
    assert.ok(getDocument(db, doc.id));
  });

  it('replace keeps a doc whose file is invalid but has an id', () => {
    const doc = simple();
    saveDocument(db, doc);
    put('content/posts/other.json', { id: doc.id, meta: {} });
    assert.deepEqual(syncFromSite(ws, db, { replace: true }).removed, []);
    assert.ok(getDocument(db, doc.id));
  });

  it('duplicate ids: first imported, duplicate skipped, then stable', () => {
    const doc = simple();
    put('content/posts/a.json', doc);
    put('content/posts/b.json', mk(doc, { slug: 'b' }));
    const r1 = syncFromSite(ws, db);
    assert.deepEqual(r1.imported, [doc.id]);
    assert.deepEqual(r1.skipped, [doc.id]);
    assert.equal(console.warn.mock.callCount(), 1);
    assert.deepEqual(syncFromSite(ws, db).imported, []);
  });

  it('reloadFromSite ignores a manifest path holding a different document', () => {
    const a = simple();
    const b = { ...mk(fixture('simple-post.json'), { collection: 'posts', slug: 'b' }), id: 'other-id' };
    syncDocument(ws, a, {});
    put(REL, b);
    assert.throws(() => reloadFromSite(ws, db, a.id), /No content file for document/);
    assert.equal(getDocument(db, 'other-id'), null);
    put('content/posts/real-a.json', a);
    assert.equal(reloadFromSite(ws, db, a.id).id, a.id);
  });

  it('slug collision with another id is skipped, not thrown', () => {
    const x = simple();
    saveDocument(db, x);
    put('content/posts/hello.json', { ...x, id: 'different-id' });
    const res = syncFromSite(ws, db);
    assert.deepEqual(res.imported, []);
    assert.deepEqual(res.skipped, ['different-id']);
    assert.equal(getDocument(db, x.id).meta.title, x.meta.title);
    assert.equal(console.warn.mock.callCount(), 1);
  });
});

describe('regions through site files', () => {
  it('syncDocument writes regions to the content JSON and syncFromSite restores them', () => {
    const d = { ...simple(), regions: { aside: [{ type: 'paragraph', children: [{ type: 'text', value: 'side note' }] }] } };
    d.meta.layout = 'sidebar-right';
    const saved = saveDocument(db, d);
    syncDocument(ws, saved, { collectionsConfig: {} });
    const onDisk = JSON.parse(readFileSync(join(tmp, REL), 'utf8'));
    assert.deepEqual(onDisk.regions, d.regions);
    assert.equal(onDisk.meta.layout, 'sidebar-right');
    db.prepare('DELETE FROM documents WHERE id = ?').run(d.id);
    const res = syncFromSite(ws, db);
    assert.deepEqual(res.imported, [d.id]);
    const back = getDocument(db, d.id);
    assert.deepEqual(back.regions, d.regions);
    assert.equal(back.meta.layout, 'sidebar-right');
  });
});
