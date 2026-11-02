import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveWorkspace } from '../../src/workspace/workspace.js';
import {
  syncDocument, unsyncDocument, changedOnDisk, recordSynced, readManifest, SyncConflictError, checkSync,
} from '../../src/sync/to-site.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixture = (n) => JSON.parse(readFileSync(join(repoRoot, 'test', 'fixtures', n), 'utf8'));
const mk = (base, meta) => ({ ...base, meta: { ...base.meta, ...meta } });

let tmp, ws;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'vp-sync-'));
  ws = resolveWorkspace({ site: tmp, repoRoot });
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

const simple = () => mk(fixture('simple-post.json'), { collection: 'posts', slug: 'hello', status: 'published' });
const p = (rel) => join(tmp, rel);

describe('syncDocument', () => {
  it('publish writes JSON and HTML', () => {
    const doc = simple();
    const res = syncDocument(ws, doc, {});
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
    syncDocument(ws, doc, {});
    assert.ok(existsSync(p('src/posts/hello.html')));
    const res = syncDocument(ws, mk(doc, { status: 'draft' }), {});
    assert.ok(!existsSync(p('src/posts/hello.html')));
    assert.deepEqual(res.removed, ['src/posts/hello.html']);
    assert.ok(existsSync(p('content/posts/hello.json')));
  });

  it('draft never creates HTML', () => {
    syncDocument(ws, mk(simple(), { status: 'draft' }), {});
    assert.ok(!existsSync(p('src/posts/hello.html')));
  });

  it('rename removes old files and keeps one manifest entry', () => {
    const doc = simple();
    syncDocument(ws, doc, {});
    const res = syncDocument(ws, mk(doc, { slug: 'renamed' }), {});
    assert.ok(!existsSync(p('content/posts/hello.json')));
    assert.ok(!existsSync(p('src/posts/hello.html')));
    assert.ok(existsSync(p('content/posts/renamed.json')));
    assert.ok(existsSync(p('src/posts/renamed.html')));
    assert.equal(res.removed.length, 2);
    assert.equal(Object.keys(readManifest(ws).documents).length, 1);
  });

  it('conflict: hand-edited JSON throws and is left unchanged', () => {
    const doc = simple();
    syncDocument(ws, doc, {});
    const file = p('content/posts/hello.json');
    const edited = JSON.parse(readFileSync(file, 'utf8'));
    edited.meta.title = 'By hand';
    writeFileSync(file, JSON.stringify(edited, null, 2) + '\n');
    const before = readFileSync(file, 'utf8');
    assert.equal(changedOnDisk(ws, doc.id, 'content/posts/hello.json'), true);
    assert.throws(() => syncDocument(ws, doc, {}), (e) => e instanceof SyncConflictError && e.path.endsWith('.json'));
    assert.equal(readFileSync(file, 'utf8'), before);

    recordSynced(ws, doc.id, 'content/posts/hello.json');
    assert.equal(changedOnDisk(ws, doc.id, 'content/posts/hello.json'), false);
    syncDocument(ws, doc, {});
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).meta.title, doc.meta.title);
  });

  it('JSON with no manifest entry counts as changed', () => {
    mkdirSync(p('content/posts'), { recursive: true });
    writeFileSync(p('content/posts/hello.json'), '{}');
    assert.equal(changedOnDisk(ws, 'doc_simple01', 'content/posts/hello.json'), true);
    assert.throws(() => syncDocument(ws, simple(), {}), SyncConflictError);
  });

  it('missing JSON is not changed', () => {
    assert.equal(changedOnDisk(ws, 'x', 'content/posts/none.json'), false);
  });

  it('refuses to overwrite a foreign HTML file', () => {
    mkdirSync(p('src'), { recursive: true });
    writeFileSync(p('src/about.html'), 'mine');
    const doc = mk(simple(), { collection: 'pages', slug: 'about' });
    assert.throws(() => syncDocument(ws, doc, {}), /Refusing to overwrite src\/about\.html: not written by Vanilla Press/);
    assert.equal(readFileSync(p('src/about.html'), 'utf8'), 'mine');
  });

  it('is deterministic with tabs', () => {
    const doc = fixture('ks-components.json');
    syncDocument(ws, doc, {});
    const rel = 'src/kitchen-sink/ks-components.html';
    const a = readFileSync(p(rel), 'utf8');
    syncDocument(ws, doc, {});
    assert.equal(readFileSync(p(rel), 'utf8'), a);
    assert.ok(a.includes('<tab-set>'));
  });

  it('rejects unsafe slug or collection before writing', () => {
    for (const meta of [{ slug: '../x' }, { slug: '' }, { slug: '.hidden' }, { slug: 'a/b' }, { collection: 'a\\b' }, { collection: '..' }]) {
      assert.throws(() => syncDocument(ws, mk(simple(), meta), {}), /Invalid slug\/collection/);
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
    syncDocument(ws, doc, {});
    const before = edit('content/posts/hello.json');
    assert.throws(() => syncDocument(ws, mk(doc, { slug: 'renamed' }), {}),
      (e) => e instanceof SyncConflictError && e.path === 'content/posts/hello.json');
    assert.equal(readFileSync(p('content/posts/hello.json'), 'utf8'), before);
    assert.ok(!existsSync(p('content/posts/renamed.json')));
    assert.ok(!existsSync(p('src/posts/renamed.html')));
    assert.ok(existsSync(p('src/posts/hello.html')));
  });

  it('unsyncDocument with hand-edited JSON throws and removes nothing', () => {
    const doc = simple();
    syncDocument(ws, doc, {});
    const before = edit('content/posts/hello.json');
    assert.throws(() => unsyncDocument(ws, doc.id), SyncConflictError);
    assert.equal(readFileSync(p('content/posts/hello.json'), 'utf8'), before);
    assert.ok(existsSync(p('src/posts/hello.html')));
    assert.ok(readManifest(ws).documents[doc.id]);
  });

  it('another document claiming the HTML path is a collision', () => {
    const a = mk(simple(), { collection: 'pages', slug: 'about' });
    syncDocument(ws, a, {});
    const html = readFileSync(p('src/about.html'), 'utf8');
    const b = { ...mk(simple(), { collection: 'notes', slug: 'about' }), id: 'doc_other' };
    const cfg = { notes: { path: '' } };
    assert.throws(() => syncDocument(ws, b, { collectionsConfig: cfg }), /already used by document doc_simple01/);
    assert.equal(readFileSync(p('src/about.html'), 'utf8'), html);
    assert.ok(!existsSync(p('content/notes/about.json')));
  });

  it('removal skips an HTML file another document owns (its vp_id)', () => {
    const doc = simple();
    syncDocument(ws, doc, {});
    const f = p('src/posts/hello.html');
    writeFileSync(f, readFileSync(f, 'utf8').replace('vp_id: "doc_simple01"', 'vp_id: "doc_other"'));
    const res = unsyncDocument(ws, doc.id);
    assert.ok(existsSync(f));
    assert.deepEqual(res.removed, ['content/posts/hello.json']);
  });

  it('a failing render writes nothing and leaves no conflict behind', () => {
    const doc = simple();
    const boom = () => { throw new Error('render boom'); };
    assert.throws(() => syncDocument(ws, doc, { render: boom }), /render boom/);
    assert.ok(!existsSync(p('content')));
    syncDocument(ws, doc, {});
    assert.ok(existsSync(p('src/posts/hello.html')));
  });

  it('corrupt manifest refuses to write and is left unchanged', () => {
    mkdirSync(p('.vp'), { recursive: true });
    writeFileSync(p('.vp/manifest.json'), '{not json');
    assert.throws(() => syncDocument(ws, simple(), {}), /Cannot read \.vp\/manifest\.json/);
    assert.throws(() => unsyncDocument(ws, 'x'), /Cannot read/);
    assert.equal(readFileSync(p('.vp/manifest.json'), 'utf8'), '{not json');
    assert.ok(!existsSync(p('content/posts')));
  });

  it('rejects configured output paths that escape', () => {
    for (const path of ['../../x', 'a/../b', '.hidden', 'a\\b']) {
      assert.throws(() => syncDocument(ws, simple(), { collectionsConfig: { posts: { path } } }), /Invalid output path/);
    }
    assert.ok(!existsSync(p('content')));
    syncDocument(ws, simple(), { collectionsConfig: { posts: { path: 'a/b' } } });
    assert.ok(existsSync(p('src/a/b/hello.html')));
  });
});

describe('unsyncDocument', () => {
  it('removes files and entry; a missing file is a no-op', () => {
    const doc = simple();
    syncDocument(ws, doc, {});
    rmSync(p('src/posts/hello.html'));
    const res = unsyncDocument(ws, doc.id);
    assert.ok(!existsSync(p('content/posts/hello.json')));
    assert.deepEqual(res.removed, ['content/posts/hello.json']);
    assert.deepEqual(readManifest(ws).documents, {});
  });

  it('unknown id is a no-op', () => {
    assert.deepEqual(unsyncDocument(ws, 'nope'), { removed: [] });
  });
});

describe('checkSync', () => {
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
    assert.throws(() => checkSync(ws, simple(), {}), /Refusing to overwrite src\/posts\/hello.html/);
    assert.deepEqual(listAll(), before);
  });

  it('throws SyncConflictError on an unowned JSON target and writes nothing', () => {
    mkdirSync(p('content/posts'), { recursive: true });
    writeFileSync(p('content/posts/hello.json'), '{}\n');
    const before = listAll();
    assert.throws(() => checkSync(ws, simple(), {}), SyncConflictError);
    assert.deepEqual(listAll(), before);
  });

  it('passes for a clean target and writes nothing', () => {
    assert.equal(checkSync(ws, simple(), {}), undefined);
    assert.deepEqual(listAll(), []);
  });

  it('rejects an invalid slug', () => {
    assert.throws(() => checkSync(ws, mk(simple(), { slug: '../x' }), {}), /Invalid slug/);
  });
});

describe('ownership from the files (final fix)', () => {
  it('the manifest is machine-local in .vp/; an old content/.vp-manifest.json is ignored', () => {
    mkdirSync(p('content'), { recursive: true });
    writeFileSync(p('content/.vp-manifest.json'), '{not json');
    const doc = simple();
    syncDocument(ws, doc, {});
    assert.ok(existsSync(p('.vp/manifest.json')));
    assert.ok(readManifest(ws).documents[doc.id]);
    assert.equal(readFileSync(p('content/.vp-manifest.json'), 'utf8'), '{not json');
  });

  it('synced HTML carries vp_id in its front matter', () => {
    syncDocument(ws, simple(), {});
    assert.match(readFileSync(p('src/posts/hello.html'), 'utf8'), /\nslug: "hello"\nvp_id: "doc_simple01"\n---\n/);
  });

  it('a target HTML owned by another vp_id is "already used" and is left unchanged', () => {
    const other = { ...simple(), id: 'doc_other' };
    syncDocument(ws, other, {});
    rmSync(p('.vp'), { recursive: true }); // no local record of either document
    const html = readFileSync(p('src/posts/hello.html'), 'utf8');
    rmSync(p('content/posts/hello.json'));
    assert.throws(() => checkSync(ws, simple(), {}), /Output path src\/posts\/hello\.html is already used by document doc_other/);
    assert.throws(() => syncDocument(ws, simple(), {}), /already used by document doc_other/);
    assert.equal(readFileSync(p('src/posts/hello.html'), 'utf8'), html);
  });

  it('a hand-written HTML (no vp_id) is refused, even with front matter', () => {
    mkdirSync(p('src/posts'), { recursive: true });
    writeFileSync(p('src/posts/hello.html'), '---\ntitle: "Mine"\n---\n<p>mine</p>\n');
    assert.throws(() => checkSync(ws, simple(), {}), /Refusing to overwrite src\/posts\/hello\.html: not written by Vanilla Press/);
  });

  it('a target HTML with our vp_id is owned even with no local manifest entry', () => {
    const doc = simple();
    syncDocument(ws, doc, {});
    rmSync(p('.vp'), { recursive: true });
    rmSync(p('content/posts/hello.json'));
    const res = syncDocument(ws, mk(doc, { title: 'Again' }), {});
    assert.ok(res.written.includes('src/posts/hello.html'));
    assert.match(readFileSync(p('src/posts/hello.html'), 'utf8'), /title: "Again"/);
  });

  it('with no local entry, old paths come from previousDoc', () => {
    const doc = simple();
    syncDocument(ws, doc, {});
    rmSync(p('.vp'), { recursive: true });
    rmSync(p('content/posts/hello.json'));
    let res = syncDocument(ws, mk(doc, { status: 'draft' }), {});
    assert.deepEqual(res.removed, []);
    assert.ok(existsSync(p('src/posts/hello.html')), 'no record of the old path without previousDoc');

    syncDocument(ws, doc, {}); // publish again (owned via vp_id)
    rmSync(p('.vp'), { recursive: true });
    rmSync(p('content/posts/hello.json'));
    res = syncDocument(ws, mk(doc, { status: 'draft' }), { previousDoc: doc });
    assert.deepEqual(res.removed, ['src/posts/hello.html']);
  });

  it('cleanup never removes an old HTML whose vp_id is another document', () => {
    const doc = simple();
    syncDocument(ws, doc, {});
    const html = readFileSync(p('src/posts/hello.html'), 'utf8').replace('vp_id: "doc_simple01"', 'vp_id: "doc_other"');
    writeFileSync(p('src/posts/hello.html'), html);
    const res = syncDocument(ws, mk(doc, { slug: 'moved' }), {});
    assert.ok(existsSync(p('src/posts/hello.html')));
    assert.deepEqual(res.removed, ['content/posts/hello.json']);
  });

  it('cleanup never removes an old JSON holding another id', () => {
    const doc = simple();
    syncDocument(ws, doc, {});
    rmSync(p('.vp'), { recursive: true });
    const theirs = { ...simple(), id: 'doc_other' };
    writeFileSync(p('content/posts/hello.json'), JSON.stringify(theirs, null, 2) + '\n');
    const res = unsyncDocument(ws, doc.id, { previousDoc: doc });
    assert.ok(existsSync(p('content/posts/hello.json')));
    assert.deepEqual(res.removed, ['src/posts/hello.html']);
  });

  it('recordSynced records the html hint when the page is ours', () => {
    const doc = simple();
    syncDocument(ws, doc, {});
    rmSync(p('.vp'), { recursive: true });
    recordSynced(ws, doc.id, 'content/posts/hello.json');
    assert.deepEqual(readManifest(ws).documents[doc.id].html, 'src/posts/hello.html');
    assert.equal(changedOnDisk(ws, doc.id, 'content/posts/hello.json'), false);
  });
});

describe('Cook template safety and minors (final fix)', () => {
  it('protects ${ from Cook: comment-split in prose, raw data-escape code blocks; front matter as is', () => {
    const doc = mk(simple(), { title: 'Cost ${title}' });
    const code = 'if (a < b && c > d) say("hi", \'${title}\');';
    doc.blocks = [
      { type: 'paragraph', children: [{ type: 'text', value: 'Use ${title} & <this>.' }] },
      { type: 'code_block', attrs: { language: 'js', filename: 'a.js' }, value: code },
    ];
    syncDocument(ws, doc, {});
    const html = readFileSync(p('src/posts/hello.html'), 'utf8');
    const end = html.indexOf('\n---\n', 4) + 5;
    const body = html.slice(end);
    assert.ok(html.slice(0, end).includes('title: "Cost ${title}"'));
    assert.ok(body.includes('<p>Use $<!---->{title} &amp; &lt;this&gt;.</p>'), body);
    assert.ok(body.includes(`<code-block data-escape language="js" label="a.js">${code}</code-block>`), body);
    assert.ok(!body.replace(/<code-block[\s\S]*?<\/code-block>/g, '').includes('${'), body);
    assert.ok(!body.includes('&#36;'));
    // The JSON keeps the text as written.
    assert.equal(JSON.parse(readFileSync(p('content/posts/hello.json'), 'utf8')).blocks[0].children[0].value, 'Use ${title} & <this>.');
  });

  it('the shared renderer output is unchanged (protection is sync-only)', async () => {
    const { render } = await import('../../src/renderers/html.js');
    const doc = { ...simple(), blocks: [{ type: 'code_block', attrs: { language: 'js' }, value: 'a < b' }] };
    assert.ok(render(doc, { scope: 'content', bare: true }).includes('<code-block language="js">a &lt; b</code-block>'));
  });

  for (const name of ['layouts', 'includes', 'components', 'media', 'assets']) {
    it(`reserved collection name ${name} is rejected`, () => {
      assert.throws(() => checkSync(ws, mk(simple(), { collection: name }), {}), new RegExp(`Reserved collection name: ${name}`));
    });
  }

  it('moving a post out of a collection prunes the emptied directories', () => {
    const doc = mk(simple(), { collection: 'new' });
    syncDocument(ws, doc, {});
    assert.ok(existsSync(p('src/new/hello.html')));
    syncDocument(ws, mk(doc, { collection: 'posts' }), {});
    assert.ok(!existsSync(p('content/new')));
    assert.ok(!existsSync(p('src/new')));
    assert.ok(existsSync(p('content/posts/hello.json')));
    assert.ok(existsSync(p('src/posts/hello.html')));
  });

  it('pruning stops at content/ and src/ and keeps non-empty directories', () => {
    const doc = mk(simple(), { collection: 'pages' });
    syncDocument(ws, doc, {});
    mkdirSync(p('src/posts'), { recursive: true });
    writeFileSync(p('src/posts/keep.txt'), 'x');
    unsyncDocument(ws, doc.id);
    assert.ok(existsSync(p('content')));
    assert.ok(existsSync(p('src')));
    syncDocument(ws, simple(), {});
    unsyncDocument(ws, simple().id);
    assert.ok(existsSync(p('src/posts/keep.txt')));
  });
});

describe('merge fixes', () => {
  it('a code block containing </code-block> stays escaped, without data-escape', () => {
    const doc = simple();
    const code = '<code-block>x</code-block><script>alert(1)</script> ${title}';
    doc.blocks = [{ type: 'code_block', attrs: { language: 'html' }, value: code }];
    syncDocument(ws, doc, {});
    const html = readFileSync(p('src/posts/hello.html'), 'utf8');
    const body = html.slice(html.indexOf('\n---\n', 4) + 5);
    assert.ok(!body.includes('<script>'), body);
    assert.ok(!body.includes('data-escape'), body);
    assert.ok(body.includes('&lt;/code-block&gt;&lt;script&gt;'), body);
    assert.ok(!body.includes('${'), body);
    assert.ok(body.includes('$<!---->{title}'), body);
  });

  it('checkSync: a JSON this machine wrote that is now missing (pulled rename) is a conflict', () => {
    const doc = simple();
    syncDocument(ws, doc, {});
    rmSync(p('content/posts/hello.json'));
    assert.throws(() => checkSync(ws, mk(doc, { title: 'Edit' }), {}), (err) =>
      err instanceof SyncConflictError && err.path === 'content/posts/hello.json');
    assert.throws(() => syncDocument(ws, mk(doc, { title: 'Edit' }), {}), SyncConflictError);
    assert.ok(!existsSync(p('content/posts/hello.json')));
  });

  it('unsyncDocument: a missing tracked JSON is a conflict and nothing is removed', () => {
    const doc = simple();
    syncDocument(ws, doc, {});
    rmSync(p('content/posts/hello.json'));
    assert.throws(() => unsyncDocument(ws, doc.id), SyncConflictError);
    assert.ok(existsSync(p('src/posts/hello.html')));
    assert.ok(readManifest(ws).documents[doc.id]);
  });
});
