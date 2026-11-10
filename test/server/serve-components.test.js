import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startServer } from '../../src/server/index.js';

const freePort = () => new Promise((resolve) => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

describe('vp serve: document saves check components against the catalog (R12)', () => {
  let server, base, dir;
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'vp-serve-comp-'));
    const port = await freePort();
    server = startServer({ port, dbPath: join(dir, 'content.db') });
    await new Promise((r) => (server.listening ? r() : server.once('listening', r)));
    base = `http://127.0.0.1:${port}`;
  });
  after(async () => {
    await new Promise((r) => server.close(r));
    rmSync(dir, { recursive: true, force: true });
  });

  const post = (tag) => fetch(`${base}/api/documents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({
      meta: { title: 'C', slug: `c-${tag}`, collection: 'posts', status: 'draft' },
      blocks: [{ type: 'component', tag, attrs: {} }],
    }),
  });

  it('saves a catalog component and refuses a tag not in the catalog', async () => {
    const ok = await post('terminal-window');
    assert.equal(ok.status, 201, await ok.clone().text());
    const bad = await post('x-not-catalogued');
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).errors.join('\n'), /x-not-catalogued" is not on for this site/);
  });
});

describe('vp serve: media is served sandboxed', () => {
  let server, base, dir;
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'vp-serve-media-'));
    const port = await freePort();
    server = startServer({ port, dbPath: join(dir, 'content.db') });
    await new Promise((r) => (server.listening ? r() : server.once('listening', r)));
    base = `http://127.0.0.1:${port}`;
  });
  after(async () => {
    await new Promise((r) => server.close(r));
    rmSync(dir, { recursive: true, force: true });
  });

  it('/media/x.svg carries the sandbox headers', async () => {
    const res = await fetch(`${base}/media/logo.svg`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-security-policy'), 'sandbox');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('content-type'), 'image/svg+xml');
    await res.arrayBuffer();
  });

  it('serves the brand files under /brand/ for the editor', async () => {
    const res = await fetch(`${base}/brand/svg/seal-ink-medium.svg`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/svg+xml');
    await res.arrayBuffer();
  });

  it('serves the branded chrome and its font at the app\'s paths', async () => {
    const css = await fetch(`${base}/app/assets/brand-ui.css`);
    assert.equal(css.status, 200);
    assert.match(css.headers.get('content-type'), /^text\/css/);
    await css.arrayBuffer();
    const font = await fetch(`${base}/brand/fonts/fraunces-latin-wght-normal.woff2`);
    assert.equal(font.status, 200);
    assert.equal(font.headers.get('content-type'), 'font/woff2');
    await font.arrayBuffer();
  });
});
