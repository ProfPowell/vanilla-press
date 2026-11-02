/**
 * CLI integration tests.
 *
 * Runs the CLI as a subprocess with a temp database via VP_DB.
 */

import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { migrate } from '../../src/store/migrate.js';
import { saveDocument, getDocument } from '../../src/store/content.js';

const BIN = join(import.meta.dirname, '..', '..', 'bin', 'vp.js');
const FIXTURES = join(import.meta.dirname, '..', 'fixtures');

/** Run the CLI with given args and return { stdout, stderr, status }. */
function vp(args, opts = {}) {
  const env = { ...process.env, VP_DB: opts.db || process.env.VP_DB, ...opts.env };
  const result = spawnSync('node', [BIN, ...args], {
    encoding: 'utf-8',
    env,
    timeout: 10000,
  });
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status ?? 1,
  };
}

/** Create a fresh temp DB path. */
function freshDbPath() {
  const dir = mkdtempSync(join(tmpdir(), 'vp-test-'));
  return join(dir, 'test.db');
}

/** Seed a DB with sample docs and return the db path. */
function seededDb() {
  const dbPath = freshDbPath();
  const db = new Database(dbPath);
  migrate(db);

  saveDocument(db, {
    id: 'doc_test01',
    meta: {
      title: 'Test Post',
      slug: 'test-post',
      collection: 'posts',
      status: 'published',
      description: 'A test post.',
      created: '2026-02-10',
      updated: '2026-02-12',
      published: '2026-02-12',
      tags: ['testing', 'cli'],
    },
    blocks: [
      { type: 'paragraph', children: [{ type: 'text', value: 'Hello from test.' }] },
    ],
  });

  saveDocument(db, {
    id: 'doc_test02',
    meta: {
      title: 'Draft Post',
      slug: 'draft-post',
      collection: 'posts',
      status: 'draft',
      created: '2026-02-14',
      updated: '2026-02-14',
    },
    blocks: [
      { type: 'paragraph', children: [{ type: 'text', value: 'Draft content.' }] },
    ],
  });

  saveDocument(db, {
    id: 'doc_test03',
    meta: {
      title: 'Getting Started',
      slug: 'getting-started',
      collection: 'docs',
      status: 'published',
      created: '2026-02-01',
      updated: '2026-02-01',
      published: '2026-02-01',
      tags: ['guide'],
    },
    blocks: [
      { type: 'paragraph', children: [{ type: 'text', value: 'Welcome to the docs.' }] },
    ],
  });

  db.close();
  return dbPath;
}

// --- Tests ---

describe('vp --help', () => {
  it('prints usage', () => {
    const { stdout, status } = vp(['--help'], { db: freshDbPath() });
    assert.equal(status, 0);
    assert.ok(stdout.includes('Usage: vp'));
    assert.ok(stdout.includes('list'));
    assert.ok(stdout.includes('export'));
    assert.ok(!stdout.includes('deploy'));
  });
});

describe('vp --version', () => {
  it('prints version', () => {
    const { stdout, status } = vp(['--version'], { db: freshDbPath() });
    assert.equal(status, 0);
    assert.ok(stdout.trim().match(/^\d+\.\d+\.\d+$/));
  });
});

describe('vp list', () => {
  it('lists all documents', () => {
    const dbPath = seededDb();
    const { stdout, status } = vp(['list'], { db: dbPath });
    assert.equal(status, 0);
    assert.ok(stdout.includes('doc_test01'));
    assert.ok(stdout.includes('test-post'));
    assert.ok(stdout.includes('doc_test02'));
    assert.ok(stdout.includes('draft-post'));
    assert.ok(stdout.includes('doc_test03'));
  });

  it('filters by collection', () => {
    const dbPath = seededDb();
    const { stdout } = vp(['list', 'posts'], { db: dbPath });
    assert.ok(stdout.includes('doc_test01'));
    assert.ok(stdout.includes('doc_test02'));
    assert.ok(!stdout.includes('doc_test03'));
  });

  it('filters by status', () => {
    const dbPath = seededDb();
    const { stdout } = vp(['list', '--status', 'draft'], { db: dbPath });
    assert.ok(stdout.includes('draft-post'));
    assert.ok(!stdout.includes('test-post'));
  });

  it('filters by tag', () => {
    const dbPath = seededDb();
    const { stdout } = vp(['list', '--tag', 'guide'], { db: dbPath });
    assert.ok(stdout.includes('doc_test03'));
    assert.ok(!stdout.includes('doc_test01'));
  });

  it('outputs JSON with --json flag', () => {
    const dbPath = seededDb();
    const { stdout } = vp(['list', '--json'], { db: dbPath });
    const data = JSON.parse(stdout);
    assert.ok(Array.isArray(data));
    assert.ok(data.length >= 3);
  });

  it('shows empty table for empty DB', () => {
    const dbPath = freshDbPath();
    const { stdout, status } = vp(['list'], { db: dbPath });
    assert.equal(status, 0);
    assert.ok(stdout.includes('no results'));
  });
});

describe('vp get', () => {
  it('prints document JSON by collection/slug', () => {
    const dbPath = seededDb();
    const { stdout, status } = vp(['get', 'posts/test-post'], { db: dbPath });
    assert.equal(status, 0);
    const doc = JSON.parse(stdout);
    assert.equal(doc.id, 'doc_test01');
    assert.equal(doc.meta.title, 'Test Post');
  });

  it('prints document JSON by id', () => {
    const dbPath = seededDb();
    const { stdout, status } = vp(['get', 'doc_test01'], { db: dbPath });
    assert.equal(status, 0);
    const doc = JSON.parse(stdout);
    assert.equal(doc.meta.slug, 'test-post');
  });

  it('errors for nonexistent document', () => {
    const dbPath = seededDb();
    const { status, stderr } = vp(['get', 'posts/nonexistent'], { db: dbPath });
    assert.equal(status, 1);
    assert.ok(stderr.includes('not found'));
  });
});

describe('vp new', () => {
  it('creates a document with --title', () => {
    const dbPath = seededDb();
    const { stderr, status } = vp(['new', 'posts', '--title', 'CLI Created'], { db: dbPath });
    assert.equal(status, 0);
    assert.ok(stderr.includes('created'));
    assert.ok(stderr.includes('cli-created'));

    // Verify it exists
    const { stdout } = vp(['get', 'posts/cli-created'], { db: dbPath });
    const doc = JSON.parse(stdout);
    assert.equal(doc.meta.title, 'CLI Created');
    assert.equal(doc.meta.status, 'draft');
  });

  it('creates with slug, description, and tags', () => {
    const dbPath = seededDb();
    vp(['new', 'posts', 'my-slug', '--title', 'Tagged', '--description', 'A desc', '--tags', 'a,b'], { db: dbPath });
    const { stdout } = vp(['get', 'posts/my-slug'], { db: dbPath });
    const doc = JSON.parse(stdout);
    assert.equal(doc.meta.slug, 'my-slug');
    assert.equal(doc.meta.description, 'A desc');
    assert.deepEqual(doc.meta.tags, ['a', 'b']);
  });

  it('errors without collection', () => {
    const dbPath = seededDb();
    const { status, stderr } = vp(['new'], { db: dbPath });
    assert.equal(status, 1);
    assert.ok(stderr.includes('usage'));
  });
});

describe('vp publish', () => {
  it('publishes a draft', () => {
    const dbPath = seededDb();
    const { stderr, status } = vp(['publish', 'posts/draft-post'], { db: dbPath });
    assert.equal(status, 0);
    assert.ok(stderr.includes('published'));

    const { stdout } = vp(['get', 'posts/draft-post'], { db: dbPath });
    const doc = JSON.parse(stdout);
    assert.equal(doc.meta.status, 'published');
    assert.ok(doc.meta.published);
  });
});

describe('vp unpublish', () => {
  it('unpublishes a document', () => {
    const dbPath = seededDb();
    const { stderr, status } = vp(['unpublish', 'posts/test-post'], { db: dbPath });
    assert.equal(status, 0);
    assert.ok(stderr.includes('unpublished'));

    const { stdout } = vp(['get', 'posts/test-post'], { db: dbPath });
    const doc = JSON.parse(stdout);
    assert.equal(doc.meta.status, 'draft');
  });
});

describe('vp delete', () => {
  it('deletes a document with --force', () => {
    const dbPath = seededDb();
    const { stderr, status } = vp(['delete', 'posts/test-post', '--force'], { db: dbPath });
    assert.equal(status, 0);
    assert.ok(stderr.includes('deleted'));

    const { status: getStatus } = vp(['get', 'posts/test-post'], { db: dbPath });
    assert.equal(getStatus, 1);
  });
});

describe('vp validate', () => {
  it('validates a document in the DB', () => {
    const dbPath = seededDb();
    const { stderr, status } = vp(['validate', 'posts/test-post'], { db: dbPath });
    assert.equal(status, 0);
    assert.ok(stderr.includes('valid'));
  });

  it('validates a file', () => {
    const dbPath = freshDbPath();
    const { stderr, status } = vp(['validate', '--file', join(FIXTURES, 'minimal.json')], { db: dbPath });
    assert.equal(status, 0);
    assert.ok(stderr.includes('valid'));
  });
});

describe('vp render', () => {
  it('renders HTML by default', () => {
    const dbPath = seededDb();
    const { stdout, status } = vp(['render', 'posts/test-post'], { db: dbPath });
    assert.equal(status, 0);
    assert.ok(stdout.includes('<article'));
    assert.ok(stdout.includes('Hello from test'));
  });

  it('renders markdown with --format=md', () => {
    const dbPath = seededDb();
    const { stdout, status } = vp(['render', 'posts/test-post', '--format', 'md'], { db: dbPath });
    assert.equal(status, 0);
    assert.ok(stdout.includes('---'));
    assert.ok(stdout.includes('title:'));
    assert.ok(stdout.includes('Hello from test'));
  });

  it('renders JSON with --format=json', () => {
    const dbPath = seededDb();
    const { stdout, status } = vp(['render', 'posts/test-post', '--format', 'json'], { db: dbPath });
    assert.equal(status, 0);
    const doc = JSON.parse(stdout);
    assert.equal(doc.id, 'doc_test01');
  });
});

describe('vp search', () => {
  it('finds documents by content', () => {
    const dbPath = seededDb();
    const { stdout, status } = vp(['search', 'Hello'], { db: dbPath });
    assert.equal(status, 0);
    assert.ok(stdout.includes('doc_test01'));
  });

  it('finds documents by tag', () => {
    const dbPath = seededDb();
    const { stdout } = vp(['search', 'guide'], { db: dbPath });
    assert.ok(stdout.includes('doc_test03'));
  });

  it('returns no results for no match', () => {
    const dbPath = seededDb();
    const { stdout, status } = vp(['search', 'xyznonexistent'], { db: dbPath });
    assert.equal(status, 0);
    assert.ok(stdout.includes('no results'));
  });

  it('outputs JSON with --json flag', () => {
    const dbPath = seededDb();
    const { stdout } = vp(['search', 'Hello', '--json'], { db: dbPath });
    const data = JSON.parse(stdout);
    assert.ok(Array.isArray(data));
  });
});

describe('vp stats', () => {
  it('shows document counts', () => {
    const dbPath = seededDb();
    const { stdout, status } = vp(['stats'], { db: dbPath });
    assert.equal(status, 0);
    assert.ok(stdout.includes('Documents: 3'));
    assert.ok(stdout.includes('published: 2'));
    assert.ok(stdout.includes('draft: 1'));
  });

  it('outputs JSON with --json flag', () => {
    const dbPath = seededDb();
    const { stdout } = vp(['stats', '--json'], { db: dbPath });
    const data = JSON.parse(stdout);
    assert.equal(data.total, 3);
    assert.equal(data.byStatus.published, 2);
    assert.equal(data.byStatus.draft, 1);
  });
});

describe('vp import:json', () => {
  it('imports a JSON fixture', () => {
    const dbPath = freshDbPath();
    const { stderr, status } = vp(['import:json', join(FIXTURES, 'minimal.json')], { db: dbPath });
    assert.equal(status, 0);
    assert.ok(stderr.includes('imported'));

    const { stdout } = vp(['get', 'posts/hello-world'], { db: dbPath });
    const doc = JSON.parse(stdout);
    assert.equal(doc.id, 'doc_min01');
  });
});

describe('vp import:markdown', () => {
  it('imports a markdown file', () => {
    const dbPath = freshDbPath();
    const tmpDir = mkdtempSync(join(tmpdir(), 'vp-md-'));
    const mdFile = join(tmpDir, 'test.md');
    writeFileSync(mdFile, [
      '---', 'title: MD Import', 'slug: md-import',
      'collection: posts', 'status: draft', '---',
      '', '## Hello', '', 'World.',
    ].join('\n'));

    const { stderr, status } = vp(['import:markdown', mdFile], { db: dbPath });
    assert.equal(status, 0);
    assert.ok(stderr.includes('imported'));

    const { stdout } = vp(['get', 'posts/md-import'], { db: dbPath });
    const doc = JSON.parse(stdout);
    assert.equal(doc.meta.title, 'MD Import');
    assert.equal(doc.blocks[0].type, 'heading');
  });
});

describe('vp import:dir', () => {
  it('imports all files from a directory', () => {
    const dbPath = freshDbPath();
    const tmpDir = mkdtempSync(join(tmpdir(), 'vp-dir-'));

    writeFileSync(join(tmpDir, 'a.json'), JSON.stringify({
      id: 'doc_dira',
      meta: { title: 'Dir A', slug: 'dir-a', collection: 'posts', status: 'draft', created: '2026-01-01', updated: '2026-01-01' },
      blocks: [{ type: 'paragraph', children: [{ type: 'text', value: 'A.' }] }],
    }));

    writeFileSync(join(tmpDir, 'b.md'), [
      '---', 'title: Dir B', 'slug: dir-b',
      'collection: posts', 'status: draft', '---',
      '', 'B content.',
    ].join('\n'));

    const { stderr, status } = vp(['import:dir', tmpDir], { db: dbPath });
    assert.equal(status, 0);
    assert.ok(stderr.includes('imported 2'));
  });
});

describe('vp unknown', () => {
  it('errors on unknown command', () => {
    const { status, stderr } = vp(['foobar'], { db: freshDbPath() });
    assert.equal(status, 1);
    assert.ok(stderr.includes('unknown command'));
  });
});

describe('vp with --site', () => {
  /** A temp Cook site with one committed content JSON. */
  function siteWithContent() {
    const site = mkdtempSync(join(tmpdir(), 'vp-site-'));
    mkdirSync(join(site, 'content', 'posts'), { recursive: true });
    writeFileSync(join(site, 'content', 'posts', 'from-disk.json'), JSON.stringify({
      id: 'doc_disk01',
      meta: { title: 'From Disk', slug: 'from-disk', collection: 'posts', status: 'draft', created: '2026-03-01', updated: '2026-03-01' },
      blocks: [{ type: 'paragraph', children: [{ type: 'text', value: 'Committed.' }] }],
    }, null, 2) + '\n');
    return site;
  }

  it('import:content imports content JSON, and list shows it', (t) => {
    const site = siteWithContent();
    t.after(() => rmSync(site, { recursive: true, force: true }));

    const imp = vp(['import:content', '--site', site]);
    assert.equal(imp.status, 0, imp.stderr);
    assert.ok(imp.stderr.includes('imported 1'), imp.stderr);

    const list = vp(['list', '--site', site]);
    assert.equal(list.status, 0, list.stderr);
    assert.ok(list.stdout.includes('from-disk'), list.stdout);
  });

  it('publish, unpublish and delete export to the site', (t) => {
    const site = siteWithContent();
    t.after(() => rmSync(site, { recursive: true, force: true }));
    vp(['import:content', '--site', site]);
    const html = join(site, 'src', 'posts', 'from-disk.html');
    const jsonFile = join(site, 'content', 'posts', 'from-disk.json');

    assert.equal(vp(['publish', 'posts/from-disk', '--site', site]).status, 0);
    assert.ok(existsSync(html));
    assert.equal(vp(['unpublish', 'posts/from-disk', '--site', site]).status, 0);
    assert.ok(!existsSync(html));
    assert.ok(existsSync(jsonFile));
    assert.equal(vp(['delete', 'posts/from-disk', '--force', '--site', site]).status, 0);
    assert.ok(!existsSync(jsonFile));
  });

  it('export writes every document plus media.json and vp.json', (t) => {
    const site = siteWithContent();
    t.after(() => rmSync(site, { recursive: true, force: true }));
    vp(['import:content', '--site', site]);

    const res = vp(['export', '--site', site]);
    assert.equal(res.status, 0, res.stderr);
    assert.ok(res.stderr.includes('exported 1'), res.stderr);
    assert.ok(existsSync(join(site, 'content', 'media.json')));
    assert.ok(existsSync(join(site, 'config', 'vp.json')));
  });

  it('new onto an unowned JSON file fails without saving', (t) => {
    const site = siteWithContent();
    t.after(() => rmSync(site, { recursive: true, force: true }));

    const res = vp(['new', 'posts', 'from-disk', '--title', 'Dup', '--site', site]);
    assert.equal(res.status, 1, res.stderr);
    assert.match(res.stderr, /not saved/);
    assert.ok(vp(['list', '--site', site]).stdout.includes('(no results)'));
  });

  it('edit renaming onto a hand-written HTML page fails without saving', (t) => {
    const site = siteWithContent();
    t.after(() => rmSync(site, { recursive: true, force: true }));
    vp(['import:content', '--site', site]);
    assert.equal(vp(['publish', 'posts/from-disk', '--site', site]).status, 0);
    writeFileSync(join(site, 'src', 'posts', 'taken.html'), '<p>mine</p>\n');

    // $EDITOR: a script that renames the slug in the temp file
    const editor = join(site, 'rename-editor.sh');
    writeFileSync(editor, '#!/bin/sh\nsed -i.bak \'s/"slug": "from-disk"/"slug": "taken"/\' "$1"\n', { mode: 0o755 });

    const res = vp(['edit', 'posts/from-disk', '--site', site], { env: { EDITOR: editor } });
    assert.equal(res.status, 1, res.stderr);
    assert.match(res.stderr, /not saved/);
    assert.ok(vp(['get', 'posts/from-disk', '--site', site]).stdout.includes('"slug": "from-disk"'));
    assert.equal(readFileSync(join(site, 'src', 'posts', 'taken.html'), 'utf8'), '<p>mine</p>\n');
    assert.ok(!existsSync(join(site, 'content', 'posts', 'taken.json')));
  });

  it('export without a site is an error', () => {
    const res = vp(['export'], { db: freshDbPath() });
    assert.equal(res.status, 1);
  });
});
