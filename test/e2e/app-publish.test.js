import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { startApp } from '../../src/app/server.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
const write = (dir, rel, body) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), body);
};

describe('app publish end to end', () => {
  let root, remote, site, app, siteId, liveHtml;

  async function api(path, { method = 'GET', body } = {}) {
    const opts = { method };
    if (body !== undefined) {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`${app.url}${path}`, opts);
    return { status: res.status, data: await res.json() };
  }

  before(async () => {
    root = mkdtempSync(join(tmpdir(), 'vp-e2e-app-'));
    remote = join(root, 'remote.git');
    site = join(root, 'site');
    execFileSync('git', ['init', '--bare', '-b', 'main', remote], { stdio: 'ignore' });
    execFileSync('git', ['init', '-b', 'main', site], { stdio: 'ignore' });
    git(site, 'config', 'user.name', 'Test');
    git(site, 'config', 'user.email', 'test@example.com');
    write(site, 'package.json', JSON.stringify({
      name: 'site', type: 'module', private: true,
      scripts: { build: 'cook build' },
      devDependencies: { 'cook-ssg': '^2.4.0' },
    }, null, 2));
    write(site, '.gitignore', '.vp/\ndist/\nnode_modules\n');
    write(site, 'config/main.js', `export default { buildOnlyPaths: ['layouts'], collections: { html: true }, formats: { json: false, markdown: false, llmsTxt: false } };\n`);
    write(site, 'config/data.js', `export default { siteUrl: 'https://example.com' };\n`);
    write(site, 'src/layouts/post.html', '<!doctype html><html><head><title>${title}</title></head><body><main class="post-layout"><article>${content}</article></main></body></html>\n');
    write(site, 'src/layouts/page.html', '<!doctype html><html><head><title>${title}</title></head><body><main>${content}</main></body></html>\n');
    write(site, 'src/index.html', '<!doctype html><html><head><title>Home</title></head><body><h1>Home</h1></body></html>\n');
    // Cook resolves its own modules from the site's node_modules (a symlink is not committed: ignored).
    symlinkSync(join(repoRoot, 'node_modules'), join(site, 'node_modules'));
    git(site, 'add', '-A');
    git(site, 'commit', '-m', 'init');
    git(site, 'remote', 'add', 'origin', remote);
    git(site, 'push', '-u', 'origin', 'main');

    app = await startApp({
      port: 0,
      env: { VP_CONFIG_DIR: join(root, 'config') },
      // The "deployed" page is whatever the test says it is.
      fetch: async () => new Response(liveHtml, { status: 200 }),
    });
  }, { timeout: 60_000 });

  after(async () => {
    await app?.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('app publish builds a real Cook site and pushes the page', { timeout: 120_000 }, async () => {
    const added = await api('/api/sites', { method: 'POST', body: { path: site, name: 'E2E' } });
    assert.equal(added.status, 201, JSON.stringify(added.data));
    siteId = added.data.id;
    const base = `/api/sites/${siteId}`;

    const created = await api(`${base}/documents`, {
      method: 'POST',
      body: {
        meta: { title: 'Hello Cook', slug: 'hello-cook', collection: 'posts', status: 'draft' },
        blocks: [{ type: 'paragraph', children: [{ type: 'text', value: 'First post body.' }] }],
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));

    const published = await api(`${base}/documents/${created.data.id}/publish`, { method: 'POST' });
    assert.equal(published.status, 200, JSON.stringify(published.data));
    assert.equal(published.data.status, 'pushed');
    assert.equal(published.data.url, 'https://example.com/posts/hello-cook/');

    // The remote has a Publish commit containing the page.
    assert.equal(git(remote, 'log', '-1', '--format=%s', 'main'), 'Publish: Hello Cook');
    const files = git(remote, 'show', '--name-only', '--format=', 'main').split('\n');
    assert.ok(files.includes('src/posts/hello-cook.html'), files.join('\n'));

    // Cook really built it.
    const built = join(site, 'dist', 'posts', 'hello-cook', 'index.html');
    assert.ok(existsSync(built));
    liveHtml = readFileSync(built, 'utf8');
    assert.ok(liveHtml.includes('First post body.'));

    // The live check passes when the deployed page matches the local build.
    const live = await api(`${base}/documents/${created.data.id}/live`);
    assert.equal(live.status, 200);
    assert.deepEqual(live.data, { live: true, url: 'https://example.com/posts/hello-cook/' });

    // ...and fails when it does not.
    liveHtml = '<html><body>Old page</body></html>';
    assert.equal((await api(`${base}/documents/${created.data.id}/live`)).data.live, false);
  });
});
