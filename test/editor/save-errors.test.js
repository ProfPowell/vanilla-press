import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { saveFailureMessage, isNetworkFailure } from '../../editor/assets/js/drafts/save-failure.js';

const OFFLINE = "Can't reach Vanilla Press. Your changes are kept in this browser and will save when it's back.";
const httpError = (status, message, data = {}) => Object.assign(new Error(message), { status, data });

describe('save failure message', () => {
  it('a failed fetch says the app cannot be reached and the work is kept', () => {
    assert.deepEqual(saveFailureMessage(new TypeError('Failed to fetch')), { tone: 'error', text: OFFLINE });
    assert.equal(isNetworkFailure(new TypeError('Failed to fetch')), true);
  });

  it('an error with no status says the same', () => {
    assert.deepEqual(saveFailureMessage(new Error('socket hang up')), { tone: 'error', text: OFFLINE });
  });

  it('a 500 shows the server message', () => {
    const msg = saveFailureMessage(httpError(500, 'Disk full'));
    assert.equal(msg.tone, 'error');
    assert.match(msg.text, /Disk full/);
    assert.equal(isNetworkFailure(httpError(500, 'Disk full')), false);
  });

  it('a 400 with validation errors says what to fix', () => {
    const msg = saveFailureMessage(httpError(400, 'Invalid', { errors: ['slug is taken'] }));
    assert.deepEqual(msg, { tone: 'error', text: 'Not saved: slug is taken' });
  });

  it('a 409 is left to the conflict notice', () => {
    assert.equal(saveFailureMessage(httpError(409, 'Changed on disk')), null);
  });
});
