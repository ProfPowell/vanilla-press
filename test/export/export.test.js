import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveWorkspace } from '../../src/workspace/workspace.js';
import {
  exportDocument, removeExport, changedOnDisk, recordImported, readManifest, ExportConflictError,
} from '../../src/export/export.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixture = (n) => JSON.parse(readFileSync(join(repoRoot, 'test', 'fixtures', n), 'utf8'));
const mk = (base, meta) => ({ ...base, meta: { ...base.meta, ...meta } });

let tmp, ws;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'vp-export-'));
  ws = resolveWorkspace({ site: tmp, repoRoot });
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

const simple = () => mk(fixture('simple-post.json'), { collection: 'posts', slug: 'hello', status: 'published' });
const p = (rel) => join(tmp, rel);

describe('exportDocument', () => {
  it('publish writes JSON and HTML', () => {
    const doc = simple();
    const res = exportDocument(ws, doc, {});
    assert.deepEqual(res.written.sort(), ['content/posts/hello.json', 'src/posts/hello.html']);
    assert.deepEqual(JSON.parse(readFileSync(p('content/posts/hello.json'), 'utf8')), doc);
    const html = readFileSync(p('src/posts/hello.html'), 'utf8');
    assert.ok(html.startsWith('---\n'));
    assert.ok(html.includes('layout: "post"'));
    assert.ok(html.includes('<p>'));
    assert.ok(!html.includes('<article data-doc'));
    assert.ok(html.endsWith('\n'));
  });

  it('draft writes JSON only; unpublishing removes the HTML', () => {
    const doc = simple();
    exportDocument(ws, doc, {});
    assert.ok(existsSync(p('src/posts/hello.html')));
    const res = exportDocument(ws, mk(doc, { status: 'draft' }), {});
    assert.ok(!existsSync(p('src/posts/hello.html')));
    assert.deepEqual(res.removed, ['src/posts/hello.html']);
    assert.ok(existsSync(p('content/posts/hello.json')));
  });

  it('draft never creates HTML', () => {
    exportDocument(ws, mk(simple(), { status: 'draft' }), {});
    assert.ok(!existsSync(p('src/posts/hello.html')));
  });

  it('rename removes old files and keeps one manifest entry', () => {
    const doc = simple();
    exportDocument(ws, doc, {});
    const res = exportDocument(ws, mk(doc, { slug: 'renamed' }), {});
    assert.ok(!existsSync(p('content/posts/hello.json')));
    assert.ok(!existsSync(p('src/posts/hello.html')));
    assert.ok(existsSync(p('content/posts/renamed.json')));
    assert.ok(existsSync(p('src/posts/renamed.html')));
    assert.equal(res.removed.length, 2);
    assert.equal(Object.keys(readManifest(ws).documents).length, 1);
  });

  it('conflict: hand-edited JSON throws and is left unchanged', () => {
    const doc = simple();
    exportDocument(ws, doc, {});
    const file = p('content/posts/hello.json');
    const edited = JSON.parse(readFileSync(file, 'utf8'));
    edited.meta.title = 'By hand';
    writeFileSync(file, JSON.stringify(edited, null, 2) + '\n');
    const before = readFileSync(file, 'utf8');
    assert.equal(changedOnDisk(ws, doc.id, 'content/posts/hello.json'), true);
    assert.throws(() => exportDocument(ws, doc, {}), (e) => e instanceof ExportConflictError && e.path.endsWith('.json'));
    assert.equal(readFileSync(file, 'utf8'), before);

    recordImported(ws, doc.id, 'content/posts/hello.json');
    assert.equal(changedOnDisk(ws, doc.id, 'content/posts/hello.json'), false);
    exportDocument(ws, doc, {});
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).meta.title, doc.meta.title);
  });

  it('JSON with no manifest entry counts as changed', () => {
    mkdirSync(p('content/posts'), { recursive: true });
    writeFileSync(p('content/posts/hello.json'), '{}');
    assert.equal(changedOnDisk(ws, 'doc_simple01', 'content/posts/hello.json'), true);
    assert.throws(() => exportDocument(ws, simple(), {}), ExportConflictError);
  });

  it('missing JSON is not changed', () => {
    assert.equal(changedOnDisk(ws, 'x', 'content/posts/none.json'), false);
  });

  it('refuses to overwrite a foreign HTML file', () => {
    mkdirSync(p('src'), { recursive: true });
    writeFileSync(p('src/about.html'), 'mine');
    const doc = mk(simple(), { collection: 'pages', slug: 'about' });
    assert.throws(() => exportDocument(ws, doc, {}), /Refusing to overwrite src\/about\.html: not written by Vanilla Press/);
    assert.equal(readFileSync(p('src/about.html'), 'utf8'), 'mine');
  });

  it('is deterministic with tabs', () => {
    const doc = fixture('ks-components.json');
    exportDocument(ws, doc, {});
    const rel = 'src/kitchen-sink/ks-components.html';
    const a = readFileSync(p(rel), 'utf8');
    exportDocument(ws, doc, {});
    assert.equal(readFileSync(p(rel), 'utf8'), a);
    assert.ok(a.includes('<tab-set>'));
  });

  it('rejects unsafe slug or collection before writing', () => {
    for (const meta of [{ slug: '../x' }, { slug: '' }, { slug: '.hidden' }, { slug: 'a/b' }, { collection: 'a\\b' }, { collection: '..' }]) {
      assert.throws(() => exportDocument(ws, mk(simple(), meta), {}), /Invalid slug\/collection/);
    }
    assert.ok(!existsSync(p('content')));
  });
});

describe('removeExport', () => {
  it('removes files and entry; a missing file is a no-op', () => {
    const doc = simple();
    exportDocument(ws, doc, {});
    rmSync(p('src/posts/hello.html'));
    const res = removeExport(ws, doc.id);
    assert.ok(!existsSync(p('content/posts/hello.json')));
    assert.deepEqual(res.removed, ['content/posts/hello.json']);
    assert.deepEqual(readManifest(ws).documents, {});
  });

  it('unknown id is a no-op', () => {
    assert.deepEqual(removeExport(ws, 'nope'), { removed: [] });
  });
});
