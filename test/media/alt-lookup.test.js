import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrate } from '../../src/store/migrate.js';
import { mediaAltLookup } from '../../src/media/alt-lookup.js';

function mkDb() {
  const db = new Database(':memory:');
  migrate(db);
  const ins = db.prepare('INSERT INTO media (id, filename, original_name, mime_type, size, alt, url, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  ins.run('m1', 'hero-aaaaaa.jpg', 'hero.jpg', 'image/jpeg', 1, 'A red barn', null, '2026-01-01');
  ins.run('m2', 'blank-bbbbbb.jpg', 'blank.jpg', 'image/jpeg', 1, '', null, '2026-01-01');
  ins.run('m3', 'photo-cccccc.jpg', 'photo.jpg', 'image/jpeg', 1, 'A lake', 'https://images.unsplash.com/photo-123?ixid=abc&w=800', '2026-01-01');
  return db;
}

test('resolves /media files and linked URLs (query ignored)', () => {
  const alt = mediaAltLookup(mkDb());
  assert.equal(alt('/media/hero-aaaaaa.jpg'), 'A red barn');
  assert.equal(alt('https://images.unsplash.com/photo-123?w=200'), 'A lake');
});

test('empty, unknown or absent gives null', () => {
  const alt = mediaAltLookup(mkDb());
  assert.equal(alt('/media/blank-bbbbbb.jpg'), null);
  assert.equal(alt('/media/nope.jpg'), null);
  assert.equal(alt('https://example.com/x.jpg'), null);
  assert.equal(alt(undefined), null);
  assert.equal(alt(''), null);
});
