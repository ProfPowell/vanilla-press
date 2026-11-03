/**
 * Which site the editor is editing, from `?site=<id>` (the app's editor),
 * and the pure helpers that depend on it. No DOM: tested in Node.
 *
 * Without `?site=` (as in `vp serve`) everything here is a no-op: the API
 * base is `/api` and media URLs are left alone.
 *
 * @module editor/site-context
 */

/**
 * The site id in a query string, or null.
 * @param {string} search - e.g. `location.search`
 * @returns {string|null}
 */
export function siteFromSearch(search) {
  return new URLSearchParams(search || '').get('site') || null;
}

/**
 * The API base: `/api/sites/<site>` for a site, else `/api`.
 * @param {string|null} site
 * @returns {string}
 */
export function apiBase(site) {
  return site ? `/api/sites/${encodeURIComponent(site)}` : '/api';
}

const mediaPrefix = (site) => `/sites/${encodeURIComponent(site)}/media/`;

/**
 * The URL to show a stored media URL at. A stored `/media/<file>` is served
 * by the app at `/sites/<site>/media/<file>`; anything else is unchanged.
 * For display only: the stored URL never changes.
 * @param {string} url
 * @param {string|null} site
 * @returns {string}
 */
export function displayMediaUrl(url, site) {
  if (!site || typeof url !== 'string' || !url.startsWith('/media/')) return url;
  return mediaPrefix(site) + url.slice('/media/'.length);
}

/**
 * The inverse of `displayMediaUrl`: the URL to store for one read back from the DOM.
 * @param {string} url
 * @param {string|null} site
 * @returns {string}
 */
export function storedMediaUrl(url, site) {
  if (!site || typeof url !== 'string') return url;
  const prefix = mediaPrefix(site);
  return url.startsWith(prefix) ? '/media/' + url.slice(prefix.length) : url;
}

/**
 * Where the draft backup stands for a save made at `savedAt`. `updated`: it
 * was pushed in an `Update:` commit (it touched a published page), so the
 * live site is redeploying; it is never reported as plain `backed-up`.
 * @param {{ pending: number, lastPushAt: string|null, error: string|null, connected: boolean,
 *   lastPushKind?: 'draft'|'update'|'publish'|null }} status - GET /status
 * @param {number} savedAt - ms since epoch
 * @returns {'backed-up'|'updated'|'waiting'|'not-connected'|'error'}
 */
export function backupOutcome(status, savedAt) {
  if (!status.connected) return 'not-connected';
  if (status.error) return 'error';
  const pushedAt = status.lastPushAt ? Date.parse(status.lastPushAt) : NaN;
  if (status.pending === 0 && pushedAt >= savedAt) return status.lastPushKind === 'update' ? 'updated' : 'backed-up';
  return 'waiting';
}

/**
 * Whether the backup poll goes on after this outcome. An error may be stale
 * (from an earlier push), so it keeps polling until a newer push succeeds or
 * the poll's time bound runs out.
 * @param {ReturnType<typeof backupOutcome>} outcome
 * @returns {boolean}
 */
export function keepPollingBackup(outcome) {
  return outcome === 'waiting' || outcome === 'error';
}

/**
 * What to show once a save went out in an `Update:` push: the live site is
 * updating; the live check runs only when the open post is published.
 * @param {{ status?: string }|null} meta - the open document's meta
 * @returns {{ text: string, checkLive: boolean }}
 */
export function afterUpdatePush(meta) {
  return { text: 'Updating live site…', checkLive: meta?.status === 'published' };
}

/**
 * Token bookkeeping for the live poll, so a poll never reports on another
 * post: `start(docId)` returns a token, `current(token)` says whether it
 * still counts; `docOpened(docId)` cancels the poll (true) when a different
 * document is opened, `cancel()` always does.
 */
export function createLiveTracker() {
  let token = 0;
  let docId = null;
  return {
    start(id) { docId = id; return ++token; },
    current(t) { return t === token; },
    cancel() { token++; },
    docOpened(id) {
      if (id === docId) return false;
      docId = id;
      token++;
      return true;
    },
  };
}

/**
 * What to show after POST publish/unpublish failed.
 *
 * - 422 with a log: the build failed; nothing was applied.
 * - 409 with `files`, or 502: the change was applied and committed on this
 *   computer, only the push failed, so the editor reloads the document. The
 *   server's error text (which names the next step) is kept.
 * - Anything else (e.g. the save preflight's 409): the server's error text; nothing applied.
 *
 * A failure never starts the live poll.
 * @param {{ status?: number, message?: string, data?: { error?: string, log?: string, files?: string[] } }} err
 * @param {boolean} unpublish
 * @returns {{ message: string, reload: boolean, poll: false, log?: string, files?: string[] }}
 */
export function publishFailure(err, unpublish) {
  const data = err.data || {};
  const errorText = data.error || err.message || 'Publish failed';
  const applied = `${unpublish ? 'Unpublished' : 'Published'} on this computer, but couldn't push`;
  if (err.status === 422 && data.log !== undefined) {
    return { message: 'Build failed', log: data.log, reload: false, poll: false };
  }
  if (err.status === 409 && Array.isArray(data.files)) {
    return {
      message: `${applied}: ${data.error || 'GitHub has changes that conflict with yours'}`,
      files: data.files, reload: true, poll: false,
    };
  }
  if (err.status === 502) return { message: `${applied}: ${errorText}`, reload: true, poll: false };
  return { message: errorText, reload: false, poll: false };
}

/** The site being edited in this page, or null (no `?site=`, or not in a browser). */
export const SITE = typeof location === 'undefined' ? null : siteFromSearch(location.search);
