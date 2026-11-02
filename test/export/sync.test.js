import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveWorkspace, openWorkspaceDb } from '../../src/workspace/workspace.js';
import { exportDocument, changedOnDisk } from '../../src/export/export.js';
import { saveDocument, getDocument } from '../../src/store/content.js';
import { syncFromContent, importOne } from '../../src/export/sync.js';

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

describe('syncFromContent', () => {
  it('imports a new file', () => {
    const doc = simple();
    exportDocument(ws, doc, {});
    const res = syncFromContent(ws, db);
    assert.deepEqual(res, { imported: [doc.id], skipped: [], removed: [] });
    assert.equal(getDocument(db, doc.id).meta.title, doc.meta.title);
    assert.equal(changedOnDisk(ws, doc.id, REL), false);
  });

  it('imports a file changed on disk', () => {
    const doc = simple();
    saveDocument(db, doc);
    exportDocument(ws, doc, {});
    editTitle('Edited elsewhere');
    const res = syncFromContent(ws, db);
    assert.deepEqual(res.imported, [doc.id]);
    assert.equal(getDocument(db, doc.id).meta.title, 'Edited elsewhere');
  });

  it('skips an unchanged exported file', () => {
    const doc = simple();
    saveDocument(db, doc);
    exportDocument(ws, doc, {});
    const res = syncFromContent(ws, db);
    assert.deepEqual(res, { imported: [], skipped: [doc.id], removed: [] });
  });

  it('skips invalid and unparseable files without throwing', () => {
    mkdirSync(join(tmp, 'content/posts'), { recursive: true });
    writeFileSync(join(tmp, 'content/posts/bad.json'), '{ nope');
    writeFileSync(join(tmp, 'content/posts/inv.json'), JSON.stringify({ id: 'x', meta: {} }));
    writeFileSync(join(tmp, 'content/media.json'), '[]');
    const res = syncFromContent(ws, db);
    assert.equal(res.imported.length, 0);
    assert.equal(res.skipped.length, 2);
    assert.equal(console.warn.mock.callCount(), 2);
  });

  it('keeps store-only docs unless replace', () => {
    const only = mk(fixture('simple-post.json'), { collection: 'posts', slug: 'only-here' });
    saveDocument(db, only);
    assert.deepEqual(syncFromContent(ws, db).removed, []);
    assert.ok(getDocument(db, only.id));
    assert.deepEqual(syncFromContent(ws, db, { replace: true }).removed, [only.id]);
    assert.equal(getDocument(db, only.id), null);
  });
});

describe('importOne', () => {
  it('loads the file unconditionally and records it', () => {
    const doc = simple();
    saveDocument(db, doc);
    exportDocument(ws, doc, {});
    editTitle('From disk');
    assert.equal(changedOnDisk(ws, doc.id, REL), true);
    const saved = importOne(ws, db, doc.id);
    assert.equal(saved.meta.title, 'From disk');
    assert.equal(getDocument(db, doc.id).meta.title, 'From disk');
    assert.equal(changedOnDisk(ws, doc.id, REL), false);
  });

  it('throws when there is no file', () => {
    assert.throws(() => importOne(ws, db, 'nope'), /No content file for document nope/);
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
    exportDocument(ws, doc, {});
    put(REL, '<<<<<<< HEAD\n{}\n=======\n');
    const res = syncFromContent(ws, db, { replace: true });
    assert.deepEqual(res.removed, []);
    assert.ok(getDocument(db, doc.id));
  });

  it('replace keeps a doc whose file is invalid but has an id', () => {
    const doc = simple();
    saveDocument(db, doc);
    put('content/posts/other.json', { id: doc.id, meta: {} });
    assert.deepEqual(syncFromContent(ws, db, { replace: true }).removed, []);
    assert.ok(getDocument(db, doc.id));
  });

  it('duplicate ids: first imported, duplicate skipped, then stable', () => {
    const doc = simple();
    put('content/posts/a.json', doc);
    put('content/posts/b.json', mk(doc, { slug: 'b' }));
    const r1 = syncFromContent(ws, db);
    assert.deepEqual(r1.imported, [doc.id]);
    assert.deepEqual(r1.skipped, [doc.id]);
    assert.equal(console.warn.mock.callCount(), 1);
    assert.deepEqual(syncFromContent(ws, db).imported, []);
  });

  it('importOne ignores a manifest path holding a different document', () => {
    const a = simple();
    const b = { ...mk(fixture('simple-post.json'), { collection: 'posts', slug: 'b' }), id: 'other-id' };
    exportDocument(ws, a, {});
    put(REL, b);
    assert.throws(() => importOne(ws, db, a.id), /No content file for document/);
    assert.equal(getDocument(db, 'other-id'), null);
    put('content/posts/real-a.json', a);
    assert.equal(importOne(ws, db, a.id).id, a.id);
  });

  it('slug collision with another id is skipped, not thrown', () => {
    const x = simple();
    saveDocument(db, x);
    put('content/posts/hello.json', { ...x, id: 'different-id' });
    const res = syncFromContent(ws, db);
    assert.deepEqual(res.imported, []);
    assert.deepEqual(res.skipped, ['different-id']);
    assert.equal(getDocument(db, x.id).meta.title, x.meta.title);
    assert.equal(console.warn.mock.callCount(), 1);
  });
});
