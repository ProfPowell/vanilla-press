/**
 * Seed script: loads all test fixtures into content.db
 * and copies sample media files.
 *
 * Usage: node scripts/seed.js
 */

import { readdirSync, readFileSync, cpSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { migrate } from '../src/store/migrate.js';
import { saveDocument } from '../src/store/content.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const FIXTURES_DIR = join(ROOT, 'test', 'fixtures');
const DB_PATH = join(ROOT, 'content.db');
const MEDIA_DIR = join(ROOT, 'media');
const SAMPLE_MEDIA_DIR = join(__dirname, 'sample-media');

const db = new Database(DB_PATH);
migrate(db);

// --- Seed documents ---
const files = readdirSync(FIXTURES_DIR).filter(f => f.endsWith('.json'));
let count = 0;

for (const file of files) {
  const doc = JSON.parse(readFileSync(join(FIXTURES_DIR, file), 'utf-8'));

  saveDocument(db, doc);
  count++;
  console.log(`  seeded: ${doc.meta.collection}/${doc.meta.slug} [${doc.meta.status}] (${doc.id})`)
}

// --- Seed sample media ---
mkdirSync(MEDIA_DIR, { recursive: true });

const mediaFiles = readdirSync(SAMPLE_MEDIA_DIR);
const insertMedia = db.prepare(`
  INSERT OR REPLACE INTO media (id, filename, mime_type, size, alt, created)
  VALUES (?, ?, ?, ?, ?, ?)
`);

let mediaCount = 0;
for (const filename of mediaFiles) {
  const src = join(SAMPLE_MEDIA_DIR, filename);
  const dest = join(MEDIA_DIR, filename);
  cpSync(src, dest);

  const size = statSync(dest).size;
  const ext = filename.split('.').pop();
  const mimeType = ext === 'svg' ? 'image/svg+xml' : `image/${ext}`;
  const id = filename.replace(/\.[^.]+$/, '');

  insertMedia.run(id, filename, mimeType, size, '', new Date().toISOString());
  mediaCount++;
  console.log(`  media: ${filename}`);
}

db.close();
console.log(`\nSeeded ${count} documents and ${mediaCount} media files into ${DB_PATH}`);
