import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  siteFromSearch, apiBase, displayMediaUrl, storedMediaUrl, backupOutcome, publishFailure,
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
    const conflict = { status: 409, data: { error: 'git push failed', files: ['content/posts/a.json'] } };
    assert.deepEqual(publishFailure(conflict, true), {
      message: "Unpublished on this computer, but couldn't push: GitHub has changes that conflict with yours",
      files: ['content/posts/a.json'], reload: true, poll: false,
    });
    assert.equal(publishFailure(conflict, false).message,
      "Published on this computer, but couldn't push: GitHub has changes that conflict with yours");
    const gone = { status: 502, message: 'remote unreachable', data: { error: 'remote unreachable' } };
    assert.deepEqual(publishFailure(gone, false), {
      message: "Published on this computer, but couldn't push: remote unreachable", reload: true, poll: false,
    });
  });

  it('publishFailure: nothing applied (build failed, preflight 409, other) does not reload', () => {
    assert.deepEqual(publishFailure({ status: 422, data: { error: 'Build failed', log: 'boom' } }, false), {
      message: 'Build failed', log: 'boom', reload: false, poll: false,
    });
    assert.deepEqual(publishFailure({ status: 409, message: 'Changed on disk', data: { error: 'Changed on disk' } }, true), {
      message: 'Changed on disk', reload: false, poll: false,
    });
    assert.deepEqual(publishFailure({ status: 500, message: 'oops', data: {} }, false), {
      message: 'oops', reload: false, poll: false,
    });
    assert.equal(publishFailure({ message: '' }, false).message, 'Publish failed');
  });
});
