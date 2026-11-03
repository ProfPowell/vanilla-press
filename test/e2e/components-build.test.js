import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { resolveWorkspace } from '../../src/workspace/workspace.js';
import { syncDocument } from '../../src/sync/to-site.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixture = (n) => JSON.parse(readFileSync(join(repoRoot, 'test', 'fixtures', n), 'utf8'));
const mk = (base, meta) => ({ ...base, meta: { ...base.meta, ...meta } });
const text = (value) => ({ type: 'text', value });

const SRC = '/assets/components/@profpowell/browser-window/browser-window.js';
let tmp, build;
const write = (rel, body) => {
  mkdirSync(dirname(join(tmp, rel)), { recursive: true });
  writeFileSync(join(tmp, rel), body);
};
const page = (slug) => readFileSync(join(tmp, 'dist/posts', slug, 'index.html'), 'utf8');
/** <script …> tags whose src is under /assets/components/, whatever the attribute order (Cook's minifier reorders). */
const componentScripts = (html) => (html.match(/<script\b[^>]*>/g) || []).filter((t) => /\bsrc="\/assets\/components\//.test(t));

describe('component posts build with Cook (package-components)', () => {
  before(() => {
    tmp = mkdtempSync(join(tmpdir(), 'vp-e2e-comp-'));
    write('package.json', JSON.stringify({
      name: 'comp-site', private: true, type: 'module',
      dependencies: { '@profpowell/browser-window': '*', 'vanilla-breeze': '*' },
    }));
    write('config/main.js', `export default { buildOnlyPaths: ['layouts'], collections: { html: true }, formats: { json: false, markdown: false, llmsTxt: false } };\n`);
    write('config/data.js', `export default { siteUrl: 'https://example.com', siteTitle: 'Components Site' };\n`);
    write('src/layouts/post.html', '<!doctype html><html><head><title>${title}</title></head><body><main><article>${content}</article></main></body></html>\n');
    write('src/index.html', '<!doctype html><html><head><title>Home</title></head><body><p>Home</p></body></html>\n');
    symlinkSync(join(repoRoot, 'node_modules'), join(tmp, 'node_modules'));

    const ws = resolveWorkspace({ site: tmp, repoRoot });
    const withComponents = mk(fixture('simple-post.json'), { title: 'With Components', slug: 'with', collection: 'posts', status: 'published', published: '2026-02-05T10:00:00.000Z' });
    withComponents.id = 'doc_with';
    withComponents.blocks = [
      {
        type: 'component', tag: 'browser-window', attrs: { url: 'https://example.com/?a=1&b="2"', title: 'Demo <one>' },
        children: [
          { type: 'paragraph', children: [text('Inside the window, '), { type: 'component', tag: 'blink-wc', attrs: {}, children: [text('blinking')] }, text('.')] },
          { type: 'component', tag: 'code-block', attrs: { language: 'js' }, value: 'const a = 1;', wrap: 'text' },
        ],
      },
    ];
    const plain = mk(fixture('simple-post.json'), { title: 'Plain Post', slug: 'plain', collection: 'posts', status: 'published', published: '2026-01-05T10:00:00.000Z' });
    plain.id = 'doc_plain';
    for (const d of [withComponents, plain]) syncDocument(ws, d, {});

    build = spawnSync(process.execPath, ['node_modules/cook-ssg/bin/cook.js', 'build'], {
      cwd: tmp, env: { ...process.env, NODE_ENV: 'production' }, stdio: 'pipe', encoding: 'utf8',
    });
  });
  after(() => rmSync(tmp, { recursive: true, force: true }));

  it('cook build succeeds', () => {
    assert.equal(build.status, 0, build.stdout + build.stderr);
  });

  it('the component post loads browser-window once, as a module script', () => {
    const scripts = componentScripts(page('with'));
    const mine = scripts.filter((t) => t.includes(`src="${SRC}"`));
    assert.equal(mine.length, 1, scripts.join('\n'));
    assert.match(mine[0], /\btype="module"/);
  });

  it('the page has the element with escaped attributes, and its children', () => {
    const html = page('with');
    assert.match(html, /<browser-window\b/);
    // Cook's minifier rewrites entities that are legal bare in an attribute (< and &); the quote stays escaped.
    assert.match(html, /title="Demo (?:<|&lt;)one(?:>|&gt;)"/);
    assert.match(html, /url="https:\/\/example\.com\/\?a=1(?:&|&amp;)b=&quot;2&quot;"/);
    assert.match(html, /<code-block\b[^>]*language="js"/);
    assert.ok(html.includes('const a = 1;'));
  });

  it('blink-wc is not a dependency: markup yes, script no', () => {
    const html = page('with');
    assert.match(html, /<blink-wc\b[^>]*>blinking<\/blink-wc>/);
    assert.ok(!componentScripts(html).some((t) => t.includes('blink-wc')));
    assert.ok(!existsSync(join(tmp, 'dist/assets/components/@profpowell/blink-wc')));
  });

  it('the post without components has no component script', () => {
    assert.equal(componentScripts(page('plain')).length, 0);
  });

  it('the package is copied into dist; vanilla-breeze is not', () => {
    assert.ok(existsSync(join(tmp, 'dist/assets/components/@profpowell/browser-window/browser-window.js')));
    assert.ok(!existsSync(join(tmp, 'dist/assets/components/vanilla-breeze')));
  });
});
