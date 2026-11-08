import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isMissingMedia, missingText, embedText } from '../../editor/assets/js/media-check.js';

const answer = (status) => async () => ({ status });

describe('isMissingMedia', () => {
  it('is true when the server says 404 for a library file', async () => {
    assert.equal(await isMissingMedia('/media/song.mp3', { site: null, fetchFn: answer(404) }), true);
  });

  it('asks for the file where the app serves it, with HEAD', async () => {
    let seen;
    await isMissingMedia('/media/a%231.pdf', { site: 'my site', fetchFn: async (url, init) => { seen = [url, init.method]; return { status: 200 }; } });
    assert.deepEqual(seen, ['/sites/my%20site/media/a%231.pdf', 'HEAD']);
  });

  it('is false for a file that is there, a server error, or no answer', async () => {
    assert.equal(await isMissingMedia('/media/a.mp4', { site: null, fetchFn: answer(200) }), false);
    assert.equal(await isMissingMedia('/media/a.mp4', { site: null, fetchFn: answer(500) }), false);
    assert.equal(await isMissingMedia('/media/a.mp4', { site: null, fetchFn: async () => { throw new Error('offline'); } }), false);
  });

  it('never asks about a URL that is not a library file', async () => {
    const fetchFn = async () => { throw new Error('should not be called'); };
    for (const url of ['https://example.com/a.mp4', '', undefined, '/media/', '/media/x/y.mp4']) {
      assert.equal(await isMissingMedia(url, { site: null, fetchFn }), false, String(url));
    }
  });
});

describe('block text', () => {
  it('missingText names the file, decoded', () => {
    assert.equal(missingText('/media/a%231.pdf'), 'Missing file: a#1.pdf');
  });

  it('embedText is the placeholder, or the missing-file note', () => {
    assert.equal(embedText({ type: 'audio', url: '/media/s.mp3' }, false), '[audio: /media/s.mp3]');
    assert.equal(embedText({ type: 'audio', url: '/media/s.mp3' }, true), 'Missing file: s.mp3');
  });
});
