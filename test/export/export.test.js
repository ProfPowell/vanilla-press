import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveWorkspace } from '../../src/workspace/workspace.js';
import {
  exportDocument, removeExport, changedOnDisk, recordImported, readManifest, ExportConflictError, checkExport,
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

describe('fix round 1', () => {
  const edit = (rel) => {
    const f = p(rel);
    const j = JSON.parse(readFileSync(f, 'utf8'));
    j.meta.title = 'By hand';
    writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
    return readFileSync(f, 'utf8');
  };

  it('rename with hand-edited old JSON throws and writes nothing', () => {
    const doc = simple();
    exportDocument(ws, doc, {});
    const before = edit('content/posts/hello.json');
    assert.throws(() => exportDocument(ws, mk(doc, { slug: 'renamed' }), {}),
      (e) => e instanceof ExportConflictError && e.path === 'content/posts/hello.json');
    assert.equal(readFileSync(p('content/posts/hello.json'), 'utf8'), before);
    assert.ok(!existsSync(p('content/posts/renamed.json')));
    assert.ok(!existsSync(p('src/posts/renamed.html')));
    assert.ok(existsSync(p('src/posts/hello.html')));
  });

  it('removeExport with hand-edited JSON throws and removes nothing', () => {
    const doc = simple();
    exportDocument(ws, doc, {});
    const before = edit('content/posts/hello.json');
    assert.throws(() => removeExport(ws, doc.id), ExportConflictError);
    assert.equal(readFileSync(p('content/posts/hello.json'), 'utf8'), before);
    assert.ok(existsSync(p('src/posts/hello.html')));
    assert.ok(readManifest(ws).documents[doc.id]);
  });

  it('another document claiming the HTML path is a collision', () => {
    const a = mk(simple(), { collection: 'pages', slug: 'about' });
    exportDocument(ws, a, {});
    const html = readFileSync(p('src/about.html'), 'utf8');
    const b = { ...mk(simple(), { collection: 'notes', slug: 'about' }), id: 'doc_other' };
    const cfg = { notes: { path: '' } };
    assert.throws(() => exportDocument(ws, b, { collectionsConfig: cfg }), /already used by document doc_simple01/);
    assert.equal(readFileSync(p('src/about.html'), 'utf8'), html);
    assert.ok(!existsSync(p('content/notes/about.json')));
  });

  it('removal skips an HTML file another document owns (its vp_id)', () => {
    const doc = simple();
    exportDocument(ws, doc, {});
    const f = p('src/posts/hello.html');
    writeFileSync(f, readFileSync(f, 'utf8').replace('vp_id: "doc_simple01"', 'vp_id: "doc_other"'));
    const res = removeExport(ws, doc.id);
    assert.ok(existsSync(f));
    assert.deepEqual(res.removed, ['content/posts/hello.json']);
  });

  it('a failing render writes nothing and leaves no conflict behind', () => {
    const doc = simple();
    const boom = () => { throw new Error('render boom'); };
    assert.throws(() => exportDocument(ws, doc, { render: boom }), /render boom/);
    assert.ok(!existsSync(p('content')));
    exportDocument(ws, doc, {});
    assert.ok(existsSync(p('src/posts/hello.html')));
  });

  it('corrupt manifest refuses to write and is left unchanged', () => {
    mkdirSync(p('.vp'), { recursive: true });
    writeFileSync(p('.vp/manifest.json'), '{not json');
    assert.throws(() => exportDocument(ws, simple(), {}), /Cannot read \.vp\/manifest\.json/);
    assert.throws(() => removeExport(ws, 'x'), /Cannot read/);
    assert.equal(readFileSync(p('.vp/manifest.json'), 'utf8'), '{not json');
    assert.ok(!existsSync(p('content/posts')));
  });

  it('rejects configured output paths that escape', () => {
    for (const path of ['../../x', 'a/../b', '.hidden', 'a\\b']) {
      assert.throws(() => exportDocument(ws, simple(), { collectionsConfig: { posts: { path } } }), /Invalid output path/);
    }
    assert.ok(!existsSync(p('content')));
    exportDocument(ws, simple(), { collectionsConfig: { posts: { path: 'a/b' } } });
    assert.ok(existsSync(p('src/a/b/hello.html')));
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

describe('checkExport', () => {
  const listAll = () => {
    const out = [];
    const walk = (d) => {
      for (const e of (existsSync(d) ? readdirSync(d, { withFileTypes: true }) : [])) {
        const abs = join(d, e.name);
        if (e.isDirectory()) walk(abs); else out.push(abs + ':' + readFileSync(abs, 'utf8'));
      }
    };
    walk(tmp);
    return out.sort();
  };

  it('throws on a foreign HTML target and writes nothing', () => {
    mkdirSync(p('src/posts'), { recursive: true });
    writeFileSync(p('src/posts/hello.html'), '<p>hand written</p>\n');
    const before = listAll();
    assert.throws(() => checkExport(ws, simple(), {}), /Refusing to overwrite src\/posts\/hello.html/);
    assert.deepEqual(listAll(), before);
  });

  it('throws ExportConflictError on an unowned JSON target and writes nothing', () => {
    mkdirSync(p('content/posts'), { recursive: true });
    writeFileSync(p('content/posts/hello.json'), '{}\n');
    const before = listAll();
    assert.throws(() => checkExport(ws, simple(), {}), ExportConflictError);
    assert.deepEqual(listAll(), before);
  });

  it('passes for a clean target and writes nothing', () => {
    assert.equal(checkExport(ws, simple(), {}), undefined);
    assert.deepEqual(listAll(), []);
  });

  it('rejects an invalid slug', () => {
    assert.throws(() => checkExport(ws, mk(simple(), { slug: '../x' }), {}), /Invalid slug/);
  });
});

describe('ownership from the files (final fix)', () => {
  it('the manifest is machine-local in .vp/; an old content/.vp-manifest.json is ignored', () => {
    mkdirSync(p('content'), { recursive: true });
    writeFileSync(p('content/.vp-manifest.json'), '{not json');
    const doc = simple();
    exportDocument(ws, doc, {});
    assert.ok(existsSync(p('.vp/manifest.json')));
    assert.ok(readManifest(ws).documents[doc.id]);
    assert.equal(readFileSync(p('content/.vp-manifest.json'), 'utf8'), '{not json');
  });

  it('exported HTML carries vp_id in its front matter', () => {
    exportDocument(ws, simple(), {});
    assert.match(readFileSync(p('src/posts/hello.html'), 'utf8'), /\nslug: "hello"\nvp_id: "doc_simple01"\n---\n/);
  });

  it('a target HTML owned by another vp_id is "already used" and is left unchanged', () => {
    const other = { ...simple(), id: 'doc_other' };
    exportDocument(ws, other, {});
    rmSync(p('.vp'), { recursive: true }); // no local record of either document
    const html = readFileSync(p('src/posts/hello.html'), 'utf8');
    rmSync(p('content/posts/hello.json'));
    assert.throws(() => checkExport(ws, simple(), {}), /Output path src\/posts\/hello\.html is already used by document doc_other/);
    assert.throws(() => exportDocument(ws, simple(), {}), /already used by document doc_other/);
    assert.equal(readFileSync(p('src/posts/hello.html'), 'utf8'), html);
  });

  it('a hand-written HTML (no vp_id) is refused, even with front matter', () => {
    mkdirSync(p('src/posts'), { recursive: true });
    writeFileSync(p('src/posts/hello.html'), '---\ntitle: "Mine"\n---\n<p>mine</p>\n');
    assert.throws(() => checkExport(ws, simple(), {}), /Refusing to overwrite src\/posts\/hello\.html: not written by Vanilla Press/);
  });

  it('a target HTML with our vp_id is owned even with no local manifest entry', () => {
    const doc = simple();
    exportDocument(ws, doc, {});
    rmSync(p('.vp'), { recursive: true });
    rmSync(p('content/posts/hello.json'));
    const res = exportDocument(ws, mk(doc, { title: 'Again' }), {});
    assert.ok(res.written.includes('src/posts/hello.html'));
    assert.match(readFileSync(p('src/posts/hello.html'), 'utf8'), /title: "Again"/);
  });

  it('with no local entry, old paths come from previousDoc', () => {
    const doc = simple();
    exportDocument(ws, doc, {});
    rmSync(p('.vp'), { recursive: true });
    rmSync(p('content/posts/hello.json'));
    let res = exportDocument(ws, mk(doc, { status: 'draft' }), {});
    assert.deepEqual(res.removed, []);
    assert.ok(existsSync(p('src/posts/hello.html')), 'no record of the old path without previousDoc');

    exportDocument(ws, doc, {}); // publish again (owned via vp_id)
    rmSync(p('.vp'), { recursive: true });
    rmSync(p('content/posts/hello.json'));
    res = exportDocument(ws, mk(doc, { status: 'draft' }), { previousDoc: doc });
    assert.deepEqual(res.removed, ['src/posts/hello.html']);
  });

  it('cleanup never removes an old HTML whose vp_id is another document', () => {
    const doc = simple();
    exportDocument(ws, doc, {});
    const html = readFileSync(p('src/posts/hello.html'), 'utf8').replace('vp_id: "doc_simple01"', 'vp_id: "doc_other"');
    writeFileSync(p('src/posts/hello.html'), html);
    const res = exportDocument(ws, mk(doc, { slug: 'moved' }), {});
    assert.ok(existsSync(p('src/posts/hello.html')));
    assert.deepEqual(res.removed, ['content/posts/hello.json']);
  });

  it('cleanup never removes an old JSON holding another id', () => {
    const doc = simple();
    exportDocument(ws, doc, {});
    rmSync(p('.vp'), { recursive: true });
    const theirs = { ...simple(), id: 'doc_other' };
    writeFileSync(p('content/posts/hello.json'), JSON.stringify(theirs, null, 2) + '\n');
    const res = removeExport(ws, doc.id, { previousDoc: doc });
    assert.ok(existsSync(p('content/posts/hello.json')));
    assert.deepEqual(res.removed, ['src/posts/hello.html']);
  });

  it('recordImported records the html hint when the page is ours', () => {
    const doc = simple();
    exportDocument(ws, doc, {});
    rmSync(p('.vp'), { recursive: true });
    recordImported(ws, doc.id, 'content/posts/hello.json');
    assert.deepEqual(readManifest(ws).documents[doc.id].html, 'src/posts/hello.html');
    assert.equal(changedOnDisk(ws, doc.id, 'content/posts/hello.json'), false);
  });
});

describe('Cook template safety and minors (final fix)', () => {
  it('escapes ${ in the HTML body (not the front matter) so Cook does not interpolate it', () => {
    const doc = mk(simple(), { title: 'Cost ${title}' });
    doc.blocks = [
      { type: 'paragraph', children: [{ type: 'text', value: 'Use ${title} here.' }] },
      { type: 'code_block', attrs: { language: 'js' }, value: 'const s = `${title}`;' },
    ];
    exportDocument(ws, doc, {});
    const html = readFileSync(p('src/posts/hello.html'), 'utf8');
    const end = html.indexOf('\n---\n', 4) + 5;
    const body = html.slice(end);
    assert.ok(!body.includes('${'), body);
    assert.equal((body.match(/&#36;\{title\}/g) || []).length, 2, body);
    assert.ok(html.slice(0, end).includes('title: "Cost ${title}"'));
    // The JSON keeps the text as written.
    assert.equal(JSON.parse(readFileSync(p('content/posts/hello.json'), 'utf8')).blocks[0].children[0].value, 'Use ${title} here.');
  });

  for (const name of ['layouts', 'includes', 'components', 'media', 'assets']) {
    it(`reserved collection name ${name} is rejected`, () => {
      assert.throws(() => checkExport(ws, mk(simple(), { collection: name }), {}), new RegExp(`Reserved collection name: ${name}`));
    });
  }

  it('moving a post out of a collection prunes the emptied directories', () => {
    const doc = mk(simple(), { collection: 'new' });
    exportDocument(ws, doc, {});
    assert.ok(existsSync(p('src/new/hello.html')));
    exportDocument(ws, mk(doc, { collection: 'posts' }), {});
    assert.ok(!existsSync(p('content/new')));
    assert.ok(!existsSync(p('src/new')));
    assert.ok(existsSync(p('content/posts/hello.json')));
    assert.ok(existsSync(p('src/posts/hello.html')));
  });

  it('pruning stops at content/ and src/ and keeps non-empty directories', () => {
    const doc = mk(simple(), { collection: 'pages' });
    exportDocument(ws, doc, {});
    mkdirSync(p('src/posts'), { recursive: true });
    writeFileSync(p('src/posts/keep.txt'), 'x');
    removeExport(ws, doc.id);
    assert.ok(existsSync(p('content')));
    assert.ok(existsSync(p('src')));
    exportDocument(ws, simple(), {});
    removeExport(ws, simple().id);
    assert.ok(existsSync(p('src/posts/keep.txt')));
  });
});
