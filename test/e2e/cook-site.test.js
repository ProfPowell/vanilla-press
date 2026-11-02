import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { resolveWorkspace } from '../../src/workspace/workspace.js';
import { exportDocument } from '../../src/export/export.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixture = (n) => JSON.parse(readFileSync(join(repoRoot, 'test', 'fixtures', n), 'utf8'));
const mk = (base, meta) => ({ ...base, meta: { ...base.meta, ...meta } });

let tmp, build;
const write = (rel, body) => {
  mkdirSync(dirname(join(tmp, rel)), { recursive: true });
  writeFileSync(join(tmp, rel), body);
};

describe('export builds with Cook', () => {
  before(() => {
    tmp = mkdtempSync(join(tmpdir(), 'vp-e2e-'));
    write('config/main.js', `export default { buildOnlyPaths: ['layouts'], collections: { html: true }, formats: { feed: { collection: 'posts' }, json: false, markdown: false, llmsTxt: false } };\n`);
    write('config/data.js', `export default { siteUrl: 'https://example.com', siteTitle: 'T' };\n`);
    write('src/layouts/post.html', '<!doctype html><html><head><title>${title}</title></head><body><main class="post-layout"><article>${content}</article></main></body></html>\n');
    write('src/layouts/page.html', '<!doctype html><html><head><title>${title}</title></head><body><main class="page-layout">${content}</main></body></html>\n');
    write('src/index.html', '<!doctype html><html><head><title>Home</title></head><body>\n<ul>\n<li data-repeat="collections.posts as post"><a href="${post.url}">${post.title}</a></li>\n</ul>\n</body></html>\n');
    // Cook resolves its own modules from the site's node_modules.
    symlinkSync(join(repoRoot, 'node_modules'), join(tmp, 'node_modules'));

    const ws = resolveWorkspace({ site: tmp, repoRoot });
    const older = mk(fixture('simple-post.json'), { id: 'doc_old', title: 'Older Post', slug: 'older', collection: 'posts', status: 'published', published: '2026-01-05T10:00:00.000Z' });
    const tabs = fixture('ks-components.json');
    const newer = mk(tabs, { title: 'Newer Tabs Post', slug: 'newer', collection: 'posts', status: 'published', published: '2026-03-05T10:00:00.000Z' });
    newer.id = 'doc_new';
    const draft = mk(fixture('simple-post.json'), { title: 'Secret Draft', slug: 'secret', collection: 'posts', status: 'draft' });
    draft.id = 'doc_draft';
    for (const d of [older, newer, draft]) exportDocument(ws, d, {});

    build = spawnSync(process.execPath, ['node_modules/cook-ssg/bin/cook.js', 'build'], {
      cwd: tmp, env: { ...process.env, NODE_ENV: 'production' }, stdio: 'pipe', encoding: 'utf8',
    });
  });
  after(() => rmSync(tmp, { recursive: true, force: true }));

  it('cook build succeeds', () => {
    assert.equal(build.status, 0, build.stdout + build.stderr);
  });

  it('index lists published posts newest first, not the draft', () => {
    const html = readFileSync(join(tmp, 'dist/index.html'), 'utf8');
    const a = html.indexOf('Newer Tabs Post');
    const b = html.indexOf('Older Post');
    assert.ok(a >= 0 && b > a, html);
    assert.ok(!html.includes('Secret Draft'));
  });

  it('feed has two entries', () => {
    const xml = readFileSync(join(tmp, 'dist/feed.xml'), 'utf8');
    assert.equal((xml.match(/<entry>|<item>/g) || []).length, 2, xml);
    assert.ok(!xml.includes('Secret Draft'));
  });

  it('post page has tab-set inside the layout', () => {
    const html = readFileSync(join(tmp, 'dist/posts/newer/index.html'), 'utf8');
    assert.ok(html.includes('<tab-set'));
    assert.ok(html.includes('class="post-layout"'));
    assert.ok(!existsSync(join(tmp, 'dist/posts/secret/index.html')));
  });
});
