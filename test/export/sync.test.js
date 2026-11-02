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
