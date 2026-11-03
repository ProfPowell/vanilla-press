import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { checkRequest } from '../../src/server/guard.js';
import { createRouter, sendJson } from '../../src/server/router.js';

const req = (method, headers) => ({ method, headers });

describe('checkRequest', () => {
  it('allows loopback hosts on the port', () => {
    assert.equal(checkRequest(req('GET', { host: '127.0.0.1:3007' }), 3007), true);
    assert.equal(checkRequest(req('GET', { host: 'localhost:3007' }), 3007), true);
  });
  it('rejects other hosts, other ports and a missing host', () => {
    assert.equal(checkRequest(req('GET', { host: 'evil.example' }), 3007), false);
    assert.equal(checkRequest(req('GET', { host: '127.0.0.1:3008' }), 3007), false);
    assert.equal(checkRequest(req('GET', {}), 3007), false);
  });
  it('writes need no Origin or a same-origin one', () => {
    const host = '127.0.0.1:3007';
    assert.equal(checkRequest(req('POST', { host }), 3007), true);
    assert.equal(checkRequest(req('POST', { host, origin: 'http://127.0.0.1:3007' }), 3007), true);
    assert.equal(checkRequest(req('DELETE', { host, origin: 'http://localhost:3007' }), 3007), true);
    assert.equal(checkRequest(req('POST', { host, origin: 'https://evil.example' }), 3007), false);
    assert.equal(checkRequest(req('PUT', { host, origin: 'null' }), 3007), false);
  });
});

describe('router content types', () => {
  it('rejects a body that is not strictly application/json or multipart with 415', async () => {
    const router = createRouter();
    let called = 0;
    router.add('POST', '/x', (q, s) => { called++; sendJson(s, 200, q.body ?? null); });
    const server = createServer(async (q, s) => { if (!(await router.handle(q, s))) sendJson(s, 404, {}); });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const send = (type) => new Promise((resolve, reject) => {
      const r = request({ host: '127.0.0.1', port: server.address().port, path: '/x', method: 'POST', headers: type ? { 'Content-Type': type } : {} }, (res) => {
        let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => resolve({ status: res.statusCode, body: t }));
      });
      r.on('error', reject);
      r.end('{"a":1}');
    });
    try {
      assert.equal((await send('text/plain;application/json')).status, 415);
      assert.equal((await send('text/plain')).status, 415);
      assert.equal(called, 0);
      const ok = await send('application/json; charset=utf-8');
      assert.equal(ok.status, 200);
      assert.deepEqual(JSON.parse(ok.body), { a: 1 });
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});
