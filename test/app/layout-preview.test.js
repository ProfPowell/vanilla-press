import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, rmSync, mkdirSync, symlinkSync, cpSync, readdirSync, lstatSync, existsSync, readFileSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { request } from 'node:http';
import { EventEmitter } from 'node:events';
import { createLayoutPreview, PREVIEW_BUILD_TIMEOUT_MS } from '../../src/app/layout-preview.js';
import { pageHtml, syncDocument } from '../../src/sync/to-site.js';
import { resolveWorkspace } from '../../src/workspace/workspace.js';

const REPO_ROOT = join(import.meta.dirname, '..', '..');

const COOK = '/Users/tpowell/src/cook';
const STARTER = join(COOK, 'starters/vanilla-breeze');

/** A temp copy of the Cook starter with node_modules/cook-ssg linked to the local Cook. */
function makeSite(root) {
  const dir = join(root, 'site');
  cpSync(STARTER, dir, { recursive: true });
  mkdirSync(join(dir, 'node_modules'));
  symlinkSync(COOK, join(dir, 'node_modules', 'cook-ssg'));
  return dir;
}

/** Every path under dir (symlinks not followed) with its mtime. */
function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const abs = join(d, name);
      const st = lstatSync(abs);
      out[relative(dir, abs)] = st.mtimeMs;
      if (st.isDirectory()) walk(abs);
    }
  };
  walk(dir);
  return out;
}

/** A raw GET (no URL normalisation, so `..` reaches the server). */
function rawGet(url, path, headers = {}) {
  const { hostname, port } = new URL(url);
  return new Promise((resolve, reject) => {
    const req = request({ hostname, port, path, method: 'GET', headers }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

const POST_OVERRIDE = `<body data-template="base">
  <script type="application/json" data-layout-info>
  { "format": 1, "label": "Blog post" }
  </script>
  <article><h1>\${title}</h1><p>OVERRIDE-MARKER-7731</p>\${content}</article>
</body>
`;

describe('createLayoutPreview', () => {
  let root;
  let site;
  let configDir;
  let preview;

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'vp-layout-preview-'));
    site = { id: 'site1', path: makeSite(root) };
    configDir = join(root, 'config');
    preview = createLayoutPreview({ site, configDir });
  });
  after(async () => {
    await preview?.close();
    rmSync(root, { recursive: true, force: true });
  });

  const copyDir = () => join(configDir, 'layout-preview', 'site1');

  it('renders a changed post override and serves the page', async () => {
    const r = await preview.render({ layouts: { post: POST_OVERRIDE }, layout: 'post' });
    assert.equal(r.ok, true, r.log);
    assert.match(r.url, /^http:\/\/127\.0\.0\.1:\d+\/vp-layout-preview\/$/);
    const res = await fetch(r.url);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^text\/html/);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const html = await res.text();
    assert.match(html, /OVERRIDE-MARKER-7731/);
    assert.match(html, /Sample page/);
    assert.ok(lstatSync(join(copyDir(), 'node_modules')).isSymbolicLink());
  });

  it('never writes into the site directory (Review Focus 4)', async () => {
    const before = snapshot(site.path);
    const r = await preview.render({ layouts: { post: POST_OVERRIDE }, includes: { footer: '<footer>F-OVR</footer>' }, layout: 'post' });
    assert.equal(r.ok, true, r.log);
    const broken = await preview.render({ layouts: { base: '<body data-template="post">${content}</body>' }, layout: 'post' });
    assert.equal(broken.ok, false);
    assert.deepEqual(snapshot(site.path), before);
  });

  it('overrides do not persist into the next render', async () => {
    await preview.render({ layouts: { post: POST_OVERRIDE }, layout: 'post' });
    const r = await preview.render({ layout: 'post' });
    assert.equal(r.ok, true, r.log);
    const html = await (await fetch(r.url)).text();
    assert.doesNotMatch(html, /OVERRIDE-MARKER-7731/);
    assert.equal(readFileSync(join(copyDir(), 'src/layouts/post.html'), 'utf8'),
      readFileSync(join(site.path, 'src/layouts/post.html'), 'utf8'));
  });

  it('a layout chain cycle gives { ok: false, log } naming the chain', async () => {
    const r = await preview.render({ layouts: { base: '<body data-template="post">${content}</body>' }, layout: 'post' });
    assert.equal(r.ok, false);
    assert.equal(r.url, undefined);
    assert.match(r.log, /cycle/i);
    assert.match(r.log, /post/);
    assert.match(r.log, /base/);
  });

  it('a second render after deleting a site file removes it from the copy', async () => {
    writeFileSync(join(site.path, 'src', 'extra.html'), '---\ntitle: "Extra"\n---\n<p>extra</p>\n');
    assert.equal((await preview.render({ layout: 'page' })).ok, true);
    assert.ok(existsSync(join(copyDir(), 'src', 'extra.html')));
    rmSync(join(site.path, 'src', 'extra.html'));
    const r = await preview.render({ layout: 'page' });
    assert.equal(r.ok, true, r.log);
    assert.equal(existsSync(join(copyDir(), 'src', 'extra.html')), false);
  });

  it('renders a document draft with the chosen layout', async () => {
    const doc = {
      id: 'doc-1',
      meta: { title: 'Draft Title Q', slug: 'q', collection: 'posts', status: 'draft' },
      blocks: [{ type: 'paragraph', children: [{ type: 'text', value: 'Draft body ${x}' }] }],
    };
    const r = await preview.render({ doc, layout: 'post', layouts: { post: POST_OVERRIDE } });
    assert.equal(r.ok, true, r.log);
    const html = await (await fetch(r.url)).text();
    assert.match(html, /Draft Title Q/);
    assert.match(html, /Draft body/);
    assert.match(html, /OVERRIDE-MARKER-7731/);
    const src = readFileSync(join(copyDir(), 'src', 'vp-layout-preview.html'), 'utf8');
    assert.equal(src, pageHtml(doc, { layout: 'post' }));
  });

  it('only the latest of overlapping requests is used', async () => {
    const [a, b, c] = await Promise.all([
      preview.render({ layouts: { post: POST_OVERRIDE.replace('7731', 'AAA') }, layout: 'post' }),
      preview.render({ layouts: { post: POST_OVERRIDE.replace('7731', 'BBB') }, layout: 'post' }),
      preview.render({ layouts: { post: POST_OVERRIDE.replace('7731', 'CCC') }, layout: 'post' }),
    ]);
    for (const r of [a, b, c]) assert.equal(r.ok, true, r.log);
    const html = await (await fetch(c.url)).text();
    assert.match(html, /OVERRIDE-MARKER-CCC/);
  });

  it('refuses path traversal and serves 404 for missing files', async () => {
    const r = await preview.render({ layout: 'page' });
    for (const path of ['/../', '/..%2f..%2fpackage.json', '/%2e%2e/%2e%2e/config/main.js']) {
      const res = await rawGet(r.url, path);
      assert.ok(res.status === 403 || res.status === 400, `${path} -> ${res.status}`);
    }
    assert.equal((await rawGet(r.url, '/nope.html')).status, 404);
    const css = await rawGet(r.url, '/');
    assert.equal(css.status, 200);
    assert.match(css.headers['content-type'], /^text\/html/);
  });

  it('skips unchanged files on a second render and recopies changed ones', async () => {
    await preview.render({ layout: 'page' });
    const keep = join(copyDir(), 'src', 'about.html');
    const edit = join(copyDir(), 'src', 'index.html');
    const before = lstatSync(keep);
    const editBefore = lstatSync(edit);
    writeFileSync(join(site.path, 'src', 'index.html'), `${readFileSync(join(site.path, 'src', 'index.html'), 'utf8')}<!-- edited -->\n`);
    const r = await preview.render({ layout: 'page' });
    assert.equal(r.ok, true, r.log);
    const after = lstatSync(keep);
    assert.equal(after.ino, before.ino);
    assert.equal(after.mtimeMs, before.mtimeMs);
    assert.notEqual(lstatSync(edit).ino, editBefore.ino);
    assert.equal(readFileSync(edit, 'utf8'), readFileSync(join(site.path, 'src', 'index.html'), 'utf8'));
  });

  it('refuses a Host header other than 127.0.0.1 or localhost on its port', async () => {
    const r = await preview.render({ layout: 'page' });
    const { port } = new URL(r.url);
    assert.equal((await rawGet(r.url, '/', { Host: `evil.example:${port}` })).status, 403);
    assert.equal((await rawGet(r.url, '/', { Host: '127.0.0.1:1' })).status, 403);
    assert.equal((await rawGet(r.url, '/', { Host: `localhost:${port}` })).status, 200);
    assert.equal((await rawGet(r.url, '/', { Host: `127.0.0.1:${port}` })).status, 200);
  });

  it('stops a build that runs too long and reports it', async () => {
    assert.equal(PREVIEW_BUILD_TIMEOUT_MS, 120_000);
    const spawn = () => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => setImmediate(() => child.emit('close', null));
      return child;
    };
    const p = createLayoutPreview({ site, configDir: join(root, 'config-timeout'), spawn, buildTimeoutMs: 50 });
    try {
      const r = await p.render({ layout: 'page' });
      assert.equal(r.ok, false);
      assert.match(r.log, /The preview build took too long \(over 0 s\) and was stopped\./);
    } finally {
      await p.close();
    }
  });

  it('close stops the server', async () => {
    const p = createLayoutPreview({ site, configDir });
    const r = await p.render({ layout: 'page' });
    assert.equal(r.ok, true, r.log);
    await p.close();
    await assert.rejects(fetch(r.url));
  });
});

describe('pageHtml', () => {
  it('is what syncDocument writes for a published page', () => {
    const root = mkdtempSync(join(tmpdir(), 'vp-pagehtml-'));
    try {
      const ws = resolveWorkspace({ site: root, repoRoot: REPO_ROOT });
      const siteDir = ws.siteDir;
      const doc = {
        id: 'd1',
        meta: { title: 'T', slug: 'hello', collection: 'posts', status: 'published', image: '/m/a.jpg', published: '2026-01-02T10:00:00Z' },
        blocks: [{ type: 'paragraph', children: [{ type: 'text', value: 'a ${b}' }] }],
      };
      const mediaAlt = () => 'An "alt"';
      const { written } = syncDocument(ws, doc, { mediaAlt });
      const html = written.find((p) => p.endsWith('.html'));
      assert.equal(readFileSync(join(siteDir, html), 'utf8'), pageHtml(doc, { layout: 'post', mediaAlt }));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
