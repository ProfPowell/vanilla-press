import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startProgramServer } from '../../src/programs/program-server.js';
import { startApp } from '../../src/app/server.js';

const CSP = 'sandbox allow-scripts allow-forms allow-popups allow-pointer-lock allow-modals';

function put(file, text) {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, text);
}

describe('program server', () => {
  let root, siteDir, outside, ps;

  /** Raw request, so odd paths and Host headers reach the server unchanged. */
  const get = (path, { method = 'GET', host, headers = {} } = {}) => new Promise((resolve, reject) => {
    const req = httpRequest({
      host: '127.0.0.1', port: ps.port, path, method, headers: { host: host ?? `127.0.0.1:${ps.port}`, ...headers },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });

  before(async () => {
    root = mkdtempSync(join(tmpdir(), 'vp-program-server-'));
    siteDir = join(root, 'site');
    outside = join(root, 'outside.txt');
    writeFileSync(outside, 'SECRET');
    put(join(siteDir, 'config', 'programs.json'), JSON.stringify({
      areas: [{ path: 'demos', title: 'Demos' }, { path: 'apps', title: 'Apps', sandbox: true }],
      programs: [{ area: 'demos', slug: 'open', sandbox: false }],
    }));
    put(join(siteDir, 'src', 'demos', 'plasma', 'index.html'), '<h1>plasma</h1>');
    put(join(siteDir, 'src', 'demos', 'plasma', 'js', 'main.js'), 'export {};');
    put(join(siteDir, 'src', 'demos', 'plasma', 'é.txt'), 'accent');
    put(join(siteDir, 'src', 'demos', 'plasma', 'a b.html'), '<p>space</p>');
    put(join(siteDir, 'src', 'demos', 'plasma', '.secret'), 'dot');
    put(join(siteDir, 'src', 'demos', 'plasma', '.hidden', 'x.txt'), 'dot');
    symlinkSync(outside, join(siteDir, 'src', 'demos', 'plasma', 'link.txt'));
    symlinkSync(root, join(siteDir, 'src', 'demos', 'plasma', 'linkdir'));
    put(join(siteDir, 'src', 'demos', 'open', 'index.html'), 'open');
    put(join(siteDir, 'src', 'apps', 'tool', 'index.html'), 'tool');
    put(join(siteDir, 'src', 'stray', 'prog', 'index.html'), 'stray');
    put(join(siteDir, 'src', 'index.html'), 'home');
    put(join(siteDir, 'src', 'demos', 'Upper', 'index.html'), 'upper');
    ps = await startProgramServer({ port: 0, resolveSite: (id) => (id === 'mysite' ? { siteDir } : null) });
  });
  after(async () => {
    await ps.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('binds 127.0.0.1 and reports its url', () => {
    assert.equal(ps.server.address().address, '127.0.0.1');
    assert.equal(ps.url, `http://127.0.0.1:${ps.port}`);
  });

  it('serves an index and a nested file with the right types', async () => {
    const idx = await get('/mysite/demos/plasma/');
    assert.equal(idx.status, 200);
    assert.equal(idx.body, '<h1>plasma</h1>');
    assert.equal(idx.headers['content-type'], 'text/html; charset=utf-8');
    const js = await get('/mysite/demos/plasma/js/main.js');
    assert.equal(js.status, 200);
    assert.match(js.headers['content-type'], /^application\/javascript/);
  });

  it('answers HEAD without a body', async () => {
    const r = await get('/mysite/demos/plasma/', { method: 'HEAD' });
    assert.equal(r.status, 200);
    assert.equal(r.body, '');
  });

  it('redirects a program path to its trailing slash', async () => {
    const r = await get('/mysite/demos/plasma?x=1');
    assert.equal(r.status, 301);
    assert.equal(r.headers.location, '/mysite/demos/plasma/?x=1');
  });

  it('serves names needing URL encoding at their encoded URLs', async () => {
    const e = await get('/mysite/demos/plasma/%C3%A9.txt');
    assert.equal(e.status, 200);
    assert.equal(e.body, 'accent');
    const s = await get('/mysite/demos/plasma/a%20b.html');
    assert.equal(s.status, 200);
    assert.equal(s.body, '<p>space</p>');
  });

  it('sends the hardening headers on every response', async () => {
    for (const path of ['/mysite/demos/plasma/', '/nope/x/y/z']) {
      const r = await get(path);
      assert.equal(r.headers['x-content-type-options'], 'nosniff');
      assert.equal(r.headers['referrer-policy'], 'no-referrer');
      assert.equal(r.headers['cross-origin-resource-policy'], 'same-origin');
      assert.equal(r.headers['cache-control'], 'no-store');
    }
  });

  it('refuses traversal, dotfiles, symlinks and unknown places with 404', async () => {
    const paths = [
      '/mysite/demos/plasma/..%2f..%2f..%2foutside.txt',
      '/mysite/demos/plasma/%2e%2e/open/index.html',
      '/mysite/demos/plasma/../open/index.html',
      '/mysite/demos/plasma/..%5c..%5coutside.txt',
      '/mysite/demos/plasma/%00',
      '/mysite/demos/plasma/%zz',
      '/mysite/demos/plasma/.secret',
      '/mysite/demos/plasma/.hidden/x.txt',
      '/mysite/demos/plasma/link.txt',
      '/mysite/demos/plasma/linkdir/outside.txt',
      '/mysite/demos/plasma/nothing.txt',
      '/mysite/demos/plasma//index.html',
      '/mysite/nosuch/plasma/',
      '/mysite/demos/nosuch/',
      '/unknown/demos/plasma/',
      '/mysite/stray/prog/index.html',
      '/mysite/demos/Upper/',
      '/mysite/index.html',
      '/mysite/',
      '/',
    ];
    for (const p of paths) {
      const r = await get(p);
      assert.equal(r.status, 404, p);
      assert.match(r.headers['content-type'], /^text\/plain/, p);
      assert.doesNotMatch(r.body, /SECRET|home|stray/, p);
    }
  });

  it('refuses a program folder or area that is itself a symlink', async () => {
    symlinkSync(join(siteDir, 'src', 'apps', 'tool'), join(siteDir, 'src', 'apps', 'alias'));
    assert.equal((await get('/mysite/apps/alias/')).status, 404);
    symlinkSync(root, join(siteDir, 'src', 'demos', 'escape'));
    assert.equal((await get('/mysite/demos/escape/outside.txt')).status, 404);
  });

  it('answers 405 to other methods and 403 to a foreign Host', async () => {
    const post = await get('/mysite/demos/plasma/', { method: 'POST' });
    assert.equal(post.status, 405);
    assert.match(post.headers.allow, /GET/);
    for (const host of ['evil.example', `evil.example:${ps.port}`, '127.0.0.1:1']) {
      assert.equal((await get('/mysite/demos/plasma/', { host })).status, 403, host);
    }
    assert.equal((await get('/mysite/demos/plasma/', { host: `localhost:${ps.port}` })).status, 200);
  });

  it('adds the sandbox CSP only for a sandboxed program', async () => {
    const tool = await get('/mysite/apps/tool/'); // area sandbox true
    assert.equal(tool.headers['content-security-policy'], CSP);
    const plasma = await get('/mysite/demos/plasma/'); // area default off
    assert.equal(plasma.headers['content-security-policy'], undefined);
    const open = await get('/mysite/demos/open/'); // card overrides area
    assert.equal(open.headers['content-security-policy'], undefined);
  });

  it('reads config/programs.json per request', async () => {
    const file = join(siteDir, 'config', 'programs.json');
    const before = JSON.parse(await import('node:fs').then((fs) => fs.readFileSync(file, 'utf8')));
    writeFileSync(file, JSON.stringify({ ...before, areas: [{ path: 'demos', sandbox: true }] }));
    const r = await get('/mysite/demos/plasma/');
    assert.equal(r.headers['content-security-policy'], CSP);
    assert.equal((await get('/mysite/apps/tool/')).status, 404);
    writeFileSync(file, '{ not json');
    assert.equal((await get('/mysite/demos/plasma/')).status, 404);
    writeFileSync(file, JSON.stringify(before));
    assert.equal((await get('/mysite/demos/plasma/')).status, 200);
  });
});

describe('startApp and the program server', () => {
  let root, env, app;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), 'vp-app-programs-'));
    env = { VP_CONFIG_DIR: join(root, 'config') };
    const site = join(root, 'site-a');
    mkdirSync(join(site, 'src', 'demos', 'plasma'), { recursive: true });
    writeFileSync(join(site, 'package.json'), JSON.stringify({ name: 'site-a', devDependencies: { 'cook-ssg': '^2.4.0' } }));
    writeFileSync(join(site, 'src', 'demos', 'plasma', 'index.html'), 'plasma');
    mkdirSync(join(site, 'config'), { recursive: true });
    writeFileSync(join(site, 'config', 'programs.json'), JSON.stringify({ areas: [{ path: 'demos' }], programs: [] }));
    const { addSite } = await import('../../src/app/registry.js');
    addSite({ path: site, name: 'Site A' }, { env });
    app = await startApp({ port: 0, env });
  });
  after(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('exposes programsUrl on a different port, serving any registered site', async () => {
    assert.equal(typeof app.programsUrl, 'string');
    assert.match(app.programsUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.notEqual(new URL(app.programsUrl).port, String(app.port));
    const r = await fetch(`${app.programsUrl}/site-a/demos/plasma/`);
    assert.equal(r.status, 200);
    assert.equal(await r.text(), 'plasma');
    assert.equal((await fetch(`${app.programsUrl}/other/demos/plasma/`)).status, 404);
  });

  it('close stops the program server', async () => {
    const root2 = mkdtempSync(join(tmpdir(), 'vp-app-programs2-'));
    const app2 = await startApp({ port: 0, env: { VP_CONFIG_DIR: join(root2, 'config') } });
    const url = app2.programsUrl;
    await app2.close();
    await assert.rejects(fetch(`${url}/x/y/z/`));
    rmSync(root2, { recursive: true, force: true });
  });
});
