import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLiveMedia } from '../../src/app/live-media.js';

/** A fake git whose HEAD is whatever `state` says; counts blob reads. */
function fakeGit(state) {
  const calls = { tree: 0, blobs: [] };
  return {
    calls,
    git: {
      headCommit: async () => state.sha,
      headTree: async (dir, path) => {
        calls.tree++;
        assert.equal(path, 'src');
        return Object.entries(state.files).map(([p, { oid }]) => ({ path: p, oid }));
      },
      readBlob: async (dir, oid) => {
        calls.blobs.push(oid);
        return Object.values(state.files).find((f) => f.oid === oid).text;
      },
    },
  };
}

const post = (id, body) => `---\ntitle: "T"\nvp_id: "${id}"\n---\n${body}`;

test('maps each media file to the committed pages that show it, with their vp_id', async () => {
  const state = {
    sha: 'c1',
    files: {
      'src/posts/hello.html': { oid: 'b1', text: post('doc_1', '<img src="/media/a.jpg" alt="">') },
      'src/about.html': { oid: 'b2', text: '<a href="/media/a.jpg">a</a><img src="/media/b.png" alt="">' },
      'src/media/notes.txt': { oid: 'b3', text: '/media/c.jpg' },
    },
  };
  const { git, calls } = fakeGit(state);
  const live = createLiveMedia('/site', git);
  const map = await live();
  assert.deepEqual(Object.fromEntries(map), {
    'a.jpg': [{ path: 'src/posts/hello.html', vpId: 'doc_1' }, { path: 'src/about.html', vpId: null }],
    'b.png': [{ path: 'src/about.html', vpId: null }],
  });
  assert.deepEqual(calls.blobs, ['b1', 'b2'], 'only html pages are read');
});

test('recomputes only when HEAD changes, and rereads only changed pages', async () => {
  const state = { sha: 'c1', files: { 'src/a.html': { oid: 'b1', text: '<img src="/media/a.jpg">' }, 'src/b.html': { oid: 'b2', text: '' } } };
  const { git, calls } = fakeGit(state);
  const live = createLiveMedia('/site', git);
  await live();
  await live();
  assert.equal(calls.tree, 1);
  assert.deepEqual(calls.blobs, ['b1', 'b2']);
  state.sha = 'c2';
  state.files['src/b.html'] = { oid: 'b3', text: '<img src="/media/z.jpg">' };
  const map = await live();
  assert.equal(calls.tree, 2);
  assert.deepEqual(calls.blobs, ['b1', 'b2', 'b3']);
  assert.deepEqual([...map.keys()].sort(), ['a.jpg', 'z.jpg']);
});

test('no HEAD (no repo or no commit yet) is empty', async () => {
  const { git, calls } = fakeGit({ sha: null, files: {} });
  assert.equal((await createLiveMedia('/site', git)()).size, 0);
  assert.equal(calls.tree, 0);
});

test('a failed read is thrown, and the next call tries again', async () => {
  const state = { sha: 'c1', files: { 'src/a.html': { oid: 'b1', text: '<img src="/media/a.jpg">' } } };
  const { git } = fakeGit(state);
  let fail = true;
  const live = createLiveMedia('/site', { ...git, readBlob: async (d, oid) => { if (fail) throw new Error('boom'); return git.readBlob(d, oid); } });
  await assert.rejects(live(), /boom/);
  fail = false;
  assert.deepEqual([...(await live()).keys()], ['a.jpg']);
});
