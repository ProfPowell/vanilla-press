import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { postKey, newPostKey, restoreOffer, describeDifferences } from '../../editor/assets/js/drafts/draft-logic.js';

const server = () => ({
  id: 'd1',
  meta: { title: 'Hello', slug: 'hello', tags: ['a'], description: '', layout: 'post', updated: 'U1' },
  blocks: [{ t: 'p', x: 1 }],
  regions: { aside: [{ t: 'p', x: 9 }] },
});
const local = (over = {}) => ({
  docId: 'd1', meta: { ...server().meta }, blocks: server().blocks, regions: server().regions,
  baseUpdated: 'U1', seq: 1, at: '2026-01-01T00:00:00.000Z', ...over,
});

describe('keys', () => {
  it('builds post keys', () => {
    assert.equal(postKey('s', 'd1'), 'post:s:d1');
    assert.equal(postKey(null, 'd1'), 'post:local:d1');
    assert.equal(newPostKey('s', 123), 'post:s:new-123');
    assert.equal(newPostKey(null, 5), 'post:local:new-5');
  });
});

describe('restoreOffer', () => {
  it('is null with no local copy or equal content', () => {
    assert.equal(restoreOffer(null, server()), null);
    assert.equal(restoreOffer(local(), server()), null);
  });
  it('offers restore when blocks changed on the same base', () => {
    const o = restoreOffer(local({ blocks: [{ t: 'p', x: 2 }] }), server());
    assert.deepEqual(o, { kind: 'restore', at: '2026-01-01T00:00:00.000Z' });
  });
  it('offers stale when the server moved on', () => {
    const o = restoreOffer(local({ baseUpdated: 'U0', blocks: [] }), server());
    assert.equal(o.kind, 'stale');
  });
  it('offers restore for a new post with no server doc', () => {
    assert.equal(restoreOffer(local({ docId: null, baseUpdated: null }), null).kind, 'restore');
  });
});

describe('describeDifferences', () => {
  it('names title, body counts and regions', () => {
    const l = local({
      meta: { ...server().meta, title: 'Bye' },
      blocks: [{ t: 'p', x: 2 }, { t: 'p', x: 3 }],
      regions: { aside: [] },
    });
    const lines = describeDifferences(l, server());
    assert.deepEqual(lines, ['Title changed', 'Body: 1 block changed, 1 added', 'Aside: 1 block removed']);
  });
  it('reports tags', () => {
    const l = local({ meta: { ...server().meta, tags: ['a', 'b'] } });
    assert.deepEqual(describeDifferences(l, server()), ['Tags changed']);
  });
  it('caps at 6 lines then says more', () => {
    const regions = {};
    for (const n of ['a', 'b', 'c', 'd', 'e', 'f']) regions[n] = [{ n }];
    const l = local({ meta: { title: 'x', slug: 'y', tags: [], description: 'z', layout: 'q' }, regions });
    const lines = describeDifferences(l, server());
    assert.equal(lines.length, 7);
    assert.equal(lines[6], '…and more');
  });
});
