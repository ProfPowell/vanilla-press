import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { memoryBackend, createDraftStore } from '../../editor/assets/js/drafts/draft-store.js';

describe('draft store', () => {
  it('puts, gets and removes a record', async () => {
    const s = createDraftStore(memoryBackend());
    assert.equal(await s.get('post:s:a'), null);
    assert.equal(await s.put('post:s:a', { title: 'Hi' }), true);
    assert.deepEqual(await s.get('post:s:a'), { title: 'Hi' });
    await s.pushVersion('post:s:a', { n: 1 });
    await s.remove('post:s:a');
    assert.equal(await s.get('post:s:a'), null);
    assert.equal((await s.versions('post:s:a')).length, 1); // versions outlive the draft
  });

  it('rekey moves the record and its versions', async () => {
    const s = createDraftStore(memoryBackend());
    await s.put('post:s:new-1', { title: 'T' });
    await s.pushVersion('post:s:new-1', { n: 1 });
    assert.equal(await s.rekey('post:s:new-1', 'post:s:doc_9'), true);
    assert.equal(await s.get('post:s:new-1'), null);
    assert.deepEqual(await s.get('post:s:doc_9'), { title: 'T' });
    assert.deepEqual(await s.versions('post:s:new-1'), []);
    assert.deepEqual(await s.versions('post:s:doc_9'), [{ n: 1 }]);
  });

  it('keys filters by prefix', async () => {
    const s = createDraftStore(memoryBackend());
    await s.put('post:s:a', {});
    await s.put('post:s:b', {});
    await s.put('post:t:c', {});
    assert.deepEqual((await s.keys('post:s:')).sort(), ['post:s:a', 'post:s:b']);
    assert.equal((await s.keys()).length, 3);
  });

  it('pushVersion keeps the newest 20, newest first', async () => {
    const s = createDraftStore(memoryBackend());
    for (let i = 1; i <= 25; i++) await s.pushVersion('post:s:a', { n: i });
    const v = await s.versions('post:s:a');
    assert.equal(v.length, 20);
    assert.equal(v[0].n, 25);
    assert.equal(v[19].n, 6);
  });

  it('pushVersion honours a custom limit', async () => {
    const s = createDraftStore(memoryBackend());
    for (let i = 1; i <= 5; i++) await s.pushVersion('k', { n: i }, { limit: 3 });
    assert.deepEqual((await s.versions('k')).map((x) => x.n), [5, 4, 3]);
  });

  it('a throwing backend degrades quietly and reports once', async () => {
    const boom = () => { throw new Error('nope'); };
    const calls = [];
    const s = createDraftStore({ get: boom, set: boom, delete: boom, keys: boom }, { onUnavailable: (e) => calls.push(e) });
    assert.equal(s.available, true);
    assert.equal(await s.get('k'), null);
    assert.equal(await s.put('k', {}), false);
    assert.equal(await s.remove('k'), false);
    assert.equal(await s.rekey('a', 'b'), false);
    assert.deepEqual(await s.keys('x'), []);
    assert.deepEqual(await s.versions('k'), []);
    assert.equal(await s.pushVersion('k', {}), false);
    assert.equal(calls.length, 1);
    assert.equal(s.available, false);
  });
});
