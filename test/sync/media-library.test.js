import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveWorkspace, openWorkspaceDb } from '../../src/workspace/workspace.js';
import { writeMediaJson } from '../../src/sync/site-files.js';
import { syncFromSite } from '../../src/sync/from-site.js';
import {
  MEDIA_FIELDS, loadMediaJson, adoptStrayFiles, syncMediaFromSite, isMissing,
} from '../../src/sync/media-library.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PNG_3X2 = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000030000000208060000007301' + '0000', 'hex');
// 3x2 PNG header + IHDR; inspectFile only reads the header.

let tmp, ws, db;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'vp-medialib-'));
  ws = resolveWorkspace({ site: tmp, repoRoot });
  db = openWorkspaceDb(ws);
  mock.method(console, 'warn', () => {});
});
afterEach(() => {
  mock.restoreAll();
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

const entry = (o = {}) => ({
  id: 'aaaa1111', filename: 'a-aaaa11.png', original_name: 'a.png', mime_type: 'image/png',
  size: 10, width: 3, height: 2, alt: 'An a', edited_from: null, created: '2026-01-01T00:00:00.000Z', ...o,
});
const writeJson = (entries) => {
  mkdirSync(ws.contentDir, { recursive: true });
  writeFileSync(join(ws.contentDir, 'media.json'), JSON.stringify(entries));
};
const rows = () => db.prepare('SELECT * FROM media ORDER BY created, id').all();

describe('media.json -> store', () => {
  it('loads media.json into an empty store', () => {
    const e = entry();
    writeJson([e]);
    assert.deepEqual(loadMediaJson(ws, db), { loaded: 1 });
    assert.deepEqual(rows(), [e]);
    assert.deepEqual(Object.keys(rows()[0]).sort(), [...MEDIA_FIELDS].sort());
  });

  it('legacy entries: empty alt becomes never written', () => {
    writeJson([{ id: 'old00001', filename: 'old.png', mime_type: 'image/png', size: 5, alt: '', created: '2025-01-01T00:00:00.000Z' }]);
    loadMediaJson(ws, db);
    const [r] = rows();
    assert.equal(r.alt, null);
    assert.equal(r.original_name, 'old.png');
    assert.equal(r.width, null);
    assert.equal(r.edited_from, null);
  });

  it('decorative survives a round trip', () => {
    writeJson([entry({ alt: '' })]);
    loadMediaJson(ws, db);
    writeMediaJson(ws, db);
    db.prepare('DELETE FROM media').run();
    loadMediaJson(ws, db);
    assert.equal(rows()[0].alt, '');
  });

  it('media.json replaces the store', () => {
    db.prepare('INSERT INTO media (id, filename, mime_type, size, created) VALUES (?, ?, ?, ?, ?)')
      .run('gone0001', 'gone.png', 'image/png', 1, '2026-01-01T00:00:00.000Z');
    writeJson([entry()]);
    loadMediaJson(ws, db);
    assert.deepEqual(rows().map((r) => r.id), ['aaaa1111']);
  });

  it('absent media.json keeps the store', () => {
    db.prepare('INSERT INTO media (id, filename, mime_type, size, created) VALUES (?, ?, ?, ?, ?)')
      .run('keep0001', 'keep.png', 'image/png', 1, '2026-01-01T00:00:00.000Z');
    assert.equal(loadMediaJson(ws, db), null);
    assert.equal(rows().length, 1);
  });

  it('an unparsable media.json warns, returns null and changes nothing', () => {
    db.prepare('INSERT INTO media (id, filename, mime_type, size, created) VALUES (?, ?, ?, ?, ?)')
      .run('keep0001', 'keep.png', 'image/png', 1, '2026-01-01T00:00:00.000Z');
    mkdirSync(ws.contentDir, { recursive: true });
    writeFileSync(join(ws.contentDir, 'media.json'), '{nope');
    assert.equal(loadMediaJson(ws, db), null);
    assert.equal(rows().length, 1);
    assert.equal(console.warn.mock.callCount(), 1);
  });

  it('skips entries with a bad id or a path in the filename, with a warning', () => {
    writeJson([entry({ filename: '../x.png' }), entry({ id: '' }), entry({ id: 'bbbb2222', filename: 'b.png' })]);
    assert.deepEqual(loadMediaJson(ws, db), { loaded: 1 });
    assert.equal(console.warn.mock.callCount(), 2);
  });
});

describe('stray files', () => {
  it('adopts a stray file', () => {
    mkdirSync(ws.mediaDir, { recursive: true });
    writeFileSync(join(ws.mediaDir, 'stray.png'), PNG_3X2);
    const res = syncMediaFromSite(ws, db);
    assert.deepEqual(res, { adopted: ['stray.png'] });
    const [r] = rows();
    assert.match(r.id, /^[0-9a-f]{8}$/);
    assert.equal(r.original_name, 'stray.png');
    assert.equal(r.alt, null);
    assert.equal(r.edited_from, null);
    assert.equal(r.width, 3);
    assert.equal(r.height, 2);
    assert.equal(r.mime_type, 'image/png');
    assert.equal(r.size, PNG_3X2.length);
    const json = JSON.parse(readFileSync(join(ws.contentDir, 'media.json'), 'utf8'));
    assert.equal(json[0].filename, 'stray.png');
    assert.deepEqual(Object.keys(json[0]), MEDIA_FIELDS);
  });

  it('adopts nothing and writes nothing when there are no strays', () => {
    assert.deepEqual(syncMediaFromSite(ws, db), { adopted: [] });
    assert.throws(() => readFileSync(join(ws.contentDir, 'media.json')), /ENOENT/);
  });

  it('unsupported stray files are not adopted', () => {
    mkdirSync(ws.mediaDir, { recursive: true });
    writeFileSync(join(ws.mediaDir, 'notes.txt'), 'hello');
    writeFileSync(join(ws.mediaDir, '.hidden.png'), PNG_3X2);
    assert.deepEqual(adoptStrayFiles(db, ws.mediaDir), []);
    assert.equal(rows().length, 0);
    assert.equal(console.warn.mock.callCount(), 1);
    assert.match(console.warn.mock.calls[0].arguments[0], /notes\.txt/);
  });

  it('an entry whose file is gone stays', () => {
    writeJson([entry()]);
    syncMediaFromSite(ws, db);
    assert.equal(rows().length, 1);
    assert.equal(isMissing(ws.mediaDir, 'a-aaaa11.png'), true);
    mkdirSync(ws.mediaDir, { recursive: true });
    writeFileSync(join(ws.mediaDir, 'a-aaaa11.png'), PNG_3X2);
    assert.equal(isMissing(ws.mediaDir, 'a-aaaa11.png'), false);
  });

  it('syncFromSite reports adopted files', () => {
    mkdirSync(ws.mediaDir, { recursive: true });
    writeFileSync(join(ws.mediaDir, 'stray.png'), PNG_3X2);
    assert.deepEqual(syncFromSite(ws, db).adopted, ['stray.png']);
    assert.deepEqual(syncFromSite(ws, db).adopted, []);
  });
});
