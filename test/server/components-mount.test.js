import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { serveComponent } from '../../src/server/index.js';

describe('fixture mode /components/ mount', () => {
  let server;
  let base;
  before(async () => {
    server = createServer((req, res) => {
      if (serveComponent(req, res)) return;
      res.writeHead(404);
      res.end();
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server.close());

  it("serves a catalog package's files from VP's node_modules, nosniff", async () => {
    const res = await fetch(`${base}/components/@profpowell/browser-window/package.json`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal((await res.json()).name, '@profpowell/browser-window');
    const encoded = await fetch(`${base}/components/%40profpowell/browser-window/package.json`);
    assert.equal(encoded.status, 200);
  });

  it('refuses packages not in the catalog and path traversal', async () => {
    assert.equal((await fetch(`${base}/components/better-sqlite3/package.json`)).status, 404);
    assert.equal((await fetch(`${base}/components/@profpowell/browser-window/%2e%2e/%2e%2e/better-sqlite3/package.json`)).status, 404);
    assert.equal((await fetch(`${base}/components/@profpowell/browser-window/..%2F..%2Fbetter-sqlite3/package.json`)).status, 404);
  });
});
