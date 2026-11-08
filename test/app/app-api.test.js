import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../../app/assets/js/app-api.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

test('a refused request throws the server message with its status and whole body', async () => {
  const body = { error: 'Used by published posts.', posts: [{ id: 'p', title: 'Hello' }] };
  globalThis.fetch = async () => new Response(JSON.stringify(body), { status: 409, headers: { 'Content-Type': 'application/json' } });
  await assert.rejects(api('/api/x', { method: 'DELETE' }), (err) => {
    assert.equal(err.message, 'Used by published posts.');
    assert.equal(err.status, 409);
    assert.deepEqual(err.data, body);
    return true;
  });
});

test('a refusal with no body still has a message and status', async () => {
  globalThis.fetch = async () => new Response('', { status: 500 });
  await assert.rejects(api('/api/x'), (err) => err.message === 'Request failed (500)' && err.status === 500 && err.data === null);
});
