/**
 * What the save bar says when a post's save failed. A failure with no HTTP
 * status (the network is down or the app has stopped) is the loud "can't
 * reach" line: the work is kept in this browser and auto-save retries. A
 * 409 is left to the conflict notice.
 *
 * @module editor/drafts/save-failure
 */

import { saveErrorMessage } from '../site-context.js';

export const OFFLINE_TEXT = "Can't reach Vanilla Press. Your changes are kept in this browser and will save when it's back.";

/** True when the save never got an answer from the server. */
export const isNetworkFailure = (err) => !err?.status;

/**
 * @param {Error & { status?: number, data?: object }} err
 * @returns {{ tone: 'error', text: string } | null}
 */
export function saveFailureMessage(err) {
  if (isNetworkFailure(err)) return { tone: 'error', text: OFFLINE_TEXT };
  if (err.status === 409) return null;
  return { tone: 'error', text: saveErrorMessage(err) };
}
