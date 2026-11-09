import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { startApp } from '../../src/app/server.js';
import { makeGitSite, git, write } from './git-site-fixture.js';

/** Every file under dir with its mtime and size, skipping git and VP's own cache. */
function snapshot(dir, base = dir, out = {}) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (['.git', '.vp', 'node_modules', 'dist'].includes(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) snapshot(p, base, out);
    else { const st = statSync(p); out[p.slice(base.length + 1)] = `${st.mtimeMs}:${st.size}`; }
  }
  return out;
}

const DOC_ID = 'doc_exist001';

describe('GET routes change nothing', () => {
  let fx, app, siteId, base;

  const state = async () => ({
    files: snapshot(fx.site),
    log: git(fx.site, 'log', '--format=%H %s'),
    status: git(fx.site, 'status', '--porcelain'),
    refs: git(fx.site, 'for-each-ref'),
    // The store's documents and media tables, through the read API.
    documents: await (await fetch(`${base}/api/sites/${siteId}/documents`)).text(),
    media: await (await fetch(`${base}/api/sites/${siteId}/media`)).text(),
  });

  before(async () => {
    fx = makeGitSite();
    write(fx.site, 'content/posts/existing.json', JSON.stringify({
      id: DOC_ID, meta: { title: 'Existing', slug: 'existing', collection: 'posts', status: 'draft' },
      blocks: [{ type: 'paragraph', children: [{ type: 'text', value: 'Hi.' }] }],
    }, null, 2));
    git(fx.site, 'add', '-A');
    git(fx.site, 'commit', '-m', 'add post');
    // No network: the live checks fail the way an offline machine's do.
    const fetch = async () => { throw new Error('offline'); };
    app = await startApp({ port: 0, env: { VP_CONFIG_DIR: join(fx.root, 'config') }, fetch });
    base = app.url;
    const res = await globalThis.fetch(`${base}/api/sites`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: fx.site, name: 'Site' }),
    });
    siteId = (await res.json()).id;
    await globalThis.fetch(`${base}/api/sites/${siteId}/info`); // opens the site
  });
  after(async () => {
    await app.close();
    rmSync(fx.root, { recursive: true, force: true });
  });

  const fill = (pattern) => pattern.replace(/:([^/]+)/g, (_, name) => (name === 'id' && pattern.includes('/documents/') ? DOC_ID : name === 'siteId' ? siteId : name === 'key' ? 'preview_url' : 'x'));

  it('reads every GET route on the app router and a site router, and nothing on disk or in git changes', async () => {
    const tables = await app.routeTables(siteId);
    const gets = [...tables.app, ...tables.site].filter((r) => r.method === 'GET');
    assert.ok(gets.length >= 15, `expected the full GET table, got ${gets.length}`);
    const before = await state();
    const seen = [];
    for (const { pattern } of gets) {
      const path = fill(pattern);
      const res = await globalThis.fetch(`${base}${path}`);
      await res.arrayBuffer();
      seen.push(`${res.status} ${path}`);
      assert.notEqual(res.status, 500, `GET ${path} failed`);
    }
    const after = await state();
    assert.deepEqual(after, before, `GET changed state; requests: ${seen.join(', ')}`);
  });

  it('the audit covers the routes it claims to', async () => {
    const tables = await app.routeTables(siteId);
    const patterns = [...tables.app, ...tables.site].filter((r) => r.method === 'GET').map((r) => r.pattern);
    assert.ok(patterns.includes('/api/sites'));
    assert.ok(patterns.includes(`/api/sites/${siteId}/documents/:id/live`));
    assert.ok(patterns.includes(`/api/sites/${siteId}/theme/live`));
  });
});
