import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  siteFromSearch, apiBase, displayMediaUrl, storedMediaUrl, backupOutcome, publishFailure,
  keepPollingBackup, createLiveTracker, saveStateText, primaryAction, moreMenuItems, confirmText, savePill, actionPendingText, afterAction, heldOnLoad,
  saveErrorMessage,
} from '../../editor/assets/js/site-context.js';

describe('editor site context', () => {
  it('reads ?site= from the query string', () => {
    assert.equal(siteFromSearch('?site=my-blog'), 'my-blog');
    assert.equal(siteFromSearch('?x=1&site=a%2Fb'), 'a/b');
    assert.equal(siteFromSearch(''), null);
    assert.equal(siteFromSearch('?site='), null);
  });

  it('api base is per-site with ?site=, else /api', () => {
    assert.equal(apiBase(null), '/api');
    assert.equal(apiBase('my-blog'), '/api/sites/my-blog');
    assert.equal(apiBase('a/b c'), '/api/sites/a%2Fb%20c');
  });

  it('maps stored /media/ urls to the per-site media route for display only', () => {
    assert.equal(displayMediaUrl('/media/pic.png', 'blog'), '/sites/blog/media/pic.png');
    assert.equal(displayMediaUrl('/media/pic.png', null), '/media/pic.png');
    assert.equal(displayMediaUrl('https://x.test/media/p.png', 'blog'), 'https://x.test/media/p.png');
    assert.equal(displayMediaUrl('', 'blog'), '');
    assert.equal(storedMediaUrl('/sites/blog/media/pic.png', 'blog'), '/media/pic.png');
    assert.equal(storedMediaUrl('/sites/other/media/pic.png', 'blog'), '/sites/other/media/pic.png');
    assert.equal(storedMediaUrl('/media/pic.png', null), '/media/pic.png');
    const round = storedMediaUrl(displayMediaUrl('/media/a b.png', 'x y'), 'x y');
    assert.equal(round, '/media/a b.png');
  });

  it('backupOutcome: backed up once lastPushAt is newer than the save and nothing is pending', () => {
    const savedAt = Date.parse('2026-11-02T10:00:00Z');
    assert.equal(backupOutcome({ pending: 1, lastPushAt: null, connected: true, error: null }, savedAt), 'waiting');
    assert.equal(backupOutcome({ pending: 0, lastPushAt: '2026-11-02T09:59:00Z', connected: true, error: null }, savedAt), 'waiting');
    assert.equal(backupOutcome({ pending: 0, lastPushAt: '2026-11-02T10:00:31Z', connected: true, error: null }, savedAt), 'backed-up');
    assert.equal(backupOutcome({ pending: 1, lastPushAt: '2026-11-02T10:00:31Z', connected: true, error: null }, savedAt), 'waiting');
    assert.equal(backupOutcome({ pending: 1, lastPushAt: null, connected: false, error: null }, savedAt), 'not-connected');
    assert.equal(backupOutcome({ pending: 1, lastPushAt: null, connected: true, error: 'push failed' }, savedAt), 'error');
  });

  it('publishFailure: a failed push after the change was applied reloads and says so', () => {
    const conflict = { status: 409, data: { files: ['content/posts/a.json'] } };
    assert.deepEqual(publishFailure(conflict, 'unpublish'), {
      message: "Unpublished on this computer, but couldn't push: GitHub has changes that conflict with yours",
      files: ['content/posts/a.json'], reload: true, poll: false,
    });
    assert.equal(publishFailure(conflict, 'publish').message,
      "Published on this computer, but couldn't push: GitHub has changes that conflict with yours");
    // The server's own text (with its next step) is kept, e.g. GitStashConflictError's.
    const stash = { status: 409, data: { error: 'GitHub has changes to files you are editing outside Vanilla Press: README.md. Commit or discard your changes to those files, then publish again.', files: ['README.md'] } };
    assert.equal(publishFailure(stash, 'publish').message,
      `Published on this computer, but couldn't push: ${stash.data.error}`);
    const gone = { status: 502, message: 'remote unreachable', data: { error: 'remote unreachable' } };
    assert.deepEqual(publishFailure(gone, 'publish'), {
      message: "Published on this computer, but couldn't push: remote unreachable", reload: true, poll: false,
    });
  });

  it('publishFailure: nothing applied (build failed, preflight 409, other) does not reload', () => {
    assert.deepEqual(publishFailure({ status: 422, data: { error: 'Build failed', log: 'boom' } }, 'publish'), {
      message: 'Build failed', log: 'boom', reload: false, poll: false,
    });
    assert.deepEqual(publishFailure({ status: 409, message: 'Changed on disk', data: { error: 'Changed on disk' } }, 'unpublish'), {
      message: 'Changed on disk', reload: false, poll: false,
    });
    assert.deepEqual(publishFailure({ status: 500, message: 'oops', data: {} }, 'publish'), {
      message: 'oops', reload: false, poll: false,
    });
    assert.equal(publishFailure({ message: '' }, 'publish').message, 'Publish failed');
    assert.equal(publishFailure({ message: '' }, 'update').message, 'Update failed');
  });

  it('backupOutcome: a backup is only ever backed up (it never changes the live site)', () => {
    const savedAt = Date.parse('2026-11-02T10:00:00Z');
    const pushed = { pending: 0, lastPushAt: '2026-11-02T10:00:31Z', connected: true, error: null };
    assert.equal(backupOutcome({ ...pushed, lastPushKind: 'draft' }, savedAt), 'backed-up');
    assert.equal(backupOutcome({ ...pushed, lastPushKind: 'publish' }, savedAt), 'backed-up');
  });

  it('publishFailure: a failed Update push says Updated on this computer', () => {
    assert.deepEqual(publishFailure({ status: 502, data: { error: 'remote unreachable' } }, 'update'), {
      message: "Updated on this computer, but couldn't push: remote unreachable", reload: true, poll: false,
    });
    assert.deepEqual(publishFailure({ status: 409, data: { files: ['content/posts/a.json'] } }, 'update'), {
      message: "Updated on this computer, but couldn't push: GitHub has changes that conflict with yours",
      files: ['content/posts/a.json'], reload: true, poll: false,
    });
    assert.deepEqual(publishFailure({ status: 422, data: { error: 'Build failed', log: 'x' } }, 'update'), {
      message: 'Build failed', log: 'x', reload: false, poll: false,
    });
  });

  it('saveStateText: a published post with saved edits says they are not live yet', () => {
    assert.equal(saveStateText('saved', { published: true, held: true }), 'Saved · not live yet');
    assert.equal(saveStateText('backed-up', { published: true, held: true }), 'Backed up · not live yet');
    assert.equal(saveStateText('saved', { published: true, held: false }), 'Saved');
    assert.equal(saveStateText('backed-up', { published: true, held: false }), 'Backed up');
    assert.equal(saveStateText('saved', { published: false, held: true }), 'Saved');
    assert.equal(saveStateText('backed-up', { published: false, held: true }), 'Backed up');
  });

  it('saveStateText: notices from the save follow the state', () => {
    const notices = ['Removed "bogus" from <x-one>: this version of the component doesn\'t have it.'];
    assert.equal(saveStateText('saved', { published: false, held: false, notices }), `Saved · ${notices[0]}`);
    assert.equal(saveStateText('backed-up', { published: true, held: true, notices: [...notices, 'Second.'] }),
      `Backed up · not live yet · ${notices[0]} Second.`);
    assert.equal(saveStateText('saved', { published: false, held: false, notices: [] }), 'Saved');
  });

  it('primaryAction: Publish for a draft, Update for a published post', () => {
    assert.deepEqual(primaryAction({ status: 'published' }), { text: 'Update', action: 'update' });
    assert.deepEqual(primaryAction({ status: 'draft' }), { text: 'Publish', action: 'publish' });
    assert.deepEqual(primaryAction({ status: 'archived' }), { text: 'Publish', action: 'publish' });
  });

  const ids = (items) => items.map((i) => i.id);
  const byId = (items, id) => items.find((i) => i.id === id);

  it('moreMenuItems: a published post in site mode with a live url', () => {
    const items = moreMenuItems({ status: 'published' }, { siteMode: true, liveUrl: 'https://x.test/a/' });
    assert.deepEqual(ids(items), ['export', 'ast', 'live', 'delete', 'unpublish']);
    assert.equal(byId(items, 'delete').text, 'Delete post…');
    assert.equal(byId(items, 'delete').danger, true);
    assert.equal(byId(items, 'delete').disabled, true);
    assert.equal(byId(items, 'unpublish').text, 'Unpublish…');
    assert.equal(byId(items, 'unpublish').danger, true);
  });

  it('moreMenuItems: a draft can be deleted and has no Unpublish', () => {
    const items = moreMenuItems({ status: 'draft' }, { siteMode: true, liveUrl: null });
    assert.deepEqual(ids(items), ['export', 'ast', 'delete']);
    assert.notEqual(byId(items, 'delete').disabled, true);
  });

  it('moreMenuItems: fixture mode keeps Unpublish in the meta panel', () => {
    const items = moreMenuItems({ status: 'published' }, { siteMode: false, liveUrl: null });
    assert.deepEqual(ids(items), ['export', 'ast', 'delete']);
    assert.equal(byId(items, 'delete').disabled, true);
  });

  it('moreMenuItems: View live page needs a live url', () => {
    assert.ok(!ids(moreMenuItems({ status: 'published' }, { siteMode: true, liveUrl: null })).includes('live'));
    assert.ok(ids(moreMenuItems({ status: 'draft' }, { siteMode: true, liveUrl: 'https://x.test/' })).includes('live'));
  });

  it('confirmation for unpublish names the live url', () => {
    assert.deepEqual(confirmText('unpublish', { title: 'Hello', liveUrl: 'https://x.test/hello/' }), {
      heading: 'Unpublish "Hello"?',
      body: 'https://x.test/hello/ stops working once the site rebuilds. The post stays here as a draft.',
      confirm: 'Unpublish',
    });
  });

  it('confirmation for unpublish without a url says the live page', () => {
    assert.equal(confirmText('unpublish', { title: 'Hello', liveUrl: null }).body,
      'The live page stops working once the site rebuilds. The post stays here as a draft.');
  });

  it('confirmation for delete explains what is lost', () => {
    assert.deepEqual(confirmText('delete', { title: 'Hello', liveUrl: null }), {
      heading: 'Delete "Hello"?',
      body: 'This removes the post and its page file. It can be recovered only from git history.',
      confirm: 'Delete post',
    });
  });

  it('savePill: warn exactly when the post is published and its edits are not live', () => {
    assert.deepEqual(savePill('saved', { status: 'published' }, true), { text: 'Saved · not live yet', tone: 'warn' });
    assert.deepEqual(savePill('backed-up', { status: 'published' }, true), { text: 'Backed up · not live yet', tone: 'warn' });
    assert.deepEqual(savePill('saved', { status: 'published' }, false), { text: 'Saved', tone: 'plain' });
    assert.deepEqual(savePill('saved', { status: 'draft' }, true), { text: 'Saved', tone: 'plain' });
    assert.deepEqual(savePill('backed-up', { status: 'draft' }, false), { text: 'Backed up', tone: 'plain' });
  });

  it('actionPendingText names the running action', () => {
    assert.equal(actionPendingText('publish'), 'Publishing…');
    assert.equal(actionPendingText('update'), 'Updating…');
    assert.equal(actionPendingText('unpublish'), 'Unpublishing…');
  });

  it('keepPollingBackup: a (possibly stale) error keeps the poll going, like waiting', () => {
    assert.equal(keepPollingBackup('waiting'), true);
    assert.equal(keepPollingBackup('error'), true);
    assert.equal(keepPollingBackup('backed-up'), false);
    assert.equal(keepPollingBackup('not-connected'), false);
  });

  it('createLiveTracker: opening another document cancels the live poll', () => {
    const live = createLiveTracker();
    const t = live.start('doc_a');
    assert.equal(live.docOpened('doc_a'), false); // reloaded after publish: same post
    assert.equal(live.current(t), true);
    assert.equal(live.docOpened('doc_b'), true);
    assert.equal(live.current(t), false);
    const t2 = live.start('doc_b');
    live.cancel();
    assert.equal(live.current(t2), false);
  });
  it('afterAction: a save after the action\'s own save keeps the edits held and skips the live check', () => {
    assert.deepEqual(afterAction(3, 3), { clearHeld: true, watchLive: true });
    assert.deepEqual(afterAction(3, 4), { clearHeld: false, watchLive: false });
  });

  it('heldOnLoad: a published post whose page is not live yet, from GET state', () => {
    assert.equal(heldOnLoad({ status: 'published' }, { notLive: true }), true);
    assert.equal(heldOnLoad({ status: 'published' }, { notLive: false }), false);
    assert.equal(heldOnLoad({ status: 'draft' }, { notLive: true }), false);
    assert.equal(heldOnLoad({ status: 'published' }, null), false);
  });
});

describe('saveErrorMessage', () => {
  it("shows the server's validation errors, not a generic message", () => {
    const err = Object.assign(new Error('Validation failed'), {
      status: 400, data: { error: 'Validation failed', errors: ['blocks[0]: component "x-zz" is not on for this site', 'blocks[2]: bad'] },
    });
    assert.equal(saveErrorMessage(err), 'Not saved: blocks[0]: component "x-zz" is not on for this site; blocks[2]: bad');
  });
  it("falls back to the error's message", () => {
    assert.equal(saveErrorMessage(Object.assign(new Error('Saved, but not synced'), { status: 422, data: {} })), 'Saved, but not synced');
    assert.equal(saveErrorMessage(new Error('boom')), 'boom');
  });
});
