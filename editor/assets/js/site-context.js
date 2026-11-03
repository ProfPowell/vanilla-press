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
 * Where the backup stands for a save made at `savedAt`. A backup never
 * changes the live site (edits to a published post go live on Update).
 * @param {{ pending: number, lastPushAt: string|null, error: string|null, connected: boolean }} status - GET /status
 * @param {number} savedAt - ms since epoch
 * @returns {'backed-up'|'waiting'|'not-connected'|'error'}
 */
export function backupOutcome(status, savedAt) {
  if (!status.connected) return 'not-connected';
  if (status.error) return 'error';
  const pushedAt = status.lastPushAt ? Date.parse(status.lastPushAt) : NaN;
  if (status.pending === 0 && pushedAt >= savedAt) return 'backed-up';
  return 'waiting';
}

/**
 * The save slot's text once a save is done. `held`: this published post has
 * saved edits that are not live yet (they go live on Update).
 * @param {'saved'|'backed-up'} outcome
 * @param {{ published: boolean, held: boolean }} post
 * @returns {string}
 */
export function saveStateText(outcome, { published, held }) {
  const text = outcome === 'backed-up' ? 'Backed up' : 'Saved';
  return published && held ? `${text} · not live yet` : text;
}

/**
 * The header's buttons for a post: Publish for a draft; Unpublish plus Update for a published post.
 * @param {{ status?: string }} meta
 * @returns {{ publish: { text: string, className: string, action: 'publish'|'unpublish' }, update: boolean }}
 */
export function headerActions(meta) {
  const published = meta?.status === 'published';
  return {
    publish: published
      ? { text: 'Unpublish', className: 'btn-unpublish', action: 'unpublish' }
      : { text: 'Publish', className: 'btn-publish', action: 'publish' },
    update: published,
  };
}

const PENDING = { publish: 'Publishing…', update: 'Updating…', unpublish: 'Unpublishing…' };

/**
 * The action slot's text while an action runs (and while the live check waits).
 * @param {'publish'|'update'|'unpublish'} action
 * @returns {string}
 */
export function actionPendingText(action) {
  return PENDING[action];
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
 * After a publish/update/unpublish succeeded (or was committed): were its
 * edits the newest? `savesAtAction` is the real-save count right after the
 * action's own save; a save after it is not in this build, so the post stays
 * held and the live check (which would say Live) is skipped.
 * @param {number} savesAtAction
 * @param {number} savesNow
 * @returns {{ clearHeld: boolean, watchLive: boolean }}
 */
export function afterAction(savesAtAction, savesNow) {
  const newest = savesNow === savesAtAction;
  return { clearHeld: newest, watchLive: newest };
}

/**
 * Whether a post opened with saved edits that are not live yet (GET .../state).
 * @param {{ status?: string }|null} meta
 * @param {{ notLive?: boolean }|null} state
 * @returns {boolean}
 */
export function heldOnLoad(meta, state) {
  return meta?.status === 'published' && state?.notLive === true;
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
 * What to show after POST publish/update/unpublish failed.
 *
 * - 422 with a log: the build failed; nothing was applied.
 * - 409 with `files`, or 502: the change was applied and committed on this
 *   computer, only the push failed, so the editor reloads the document. The
 *   server's error text (which names the next step) is kept.
 * - Anything else (e.g. the save preflight's 409): the server's error text; nothing applied.
 *
 * A failure never starts the live poll.
 * @param {{ status?: number, message?: string, data?: { error?: string, log?: string, files?: string[] } }} err
 * @param {'publish'|'update'|'unpublish'} action
 * @returns {{ message: string, reload: boolean, poll: false, log?: string, files?: string[] }}
 */
export function publishFailure(err, action) {
  const data = err.data || {};
  const errorText = data.error || err.message || (action === 'update' ? 'Update failed' : 'Publish failed');
  const done = { publish: 'Published', update: 'Updated', unpublish: 'Unpublished' }[action];
  const applied = `${done} on this computer, but couldn't push`;
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

/**
 * What the save status says when a save failed: the server's validation
 * errors when it sent them (400), so the writer knows what to fix; else the
 * error's own message.
 * @param {Error & { data?: { errors?: string[] } }} err
 * @returns {string}
 */
export function saveErrorMessage(err) {
  const errors = err?.data?.errors;
  if (Array.isArray(errors) && errors.length) return `Not saved: ${errors.join('; ')}`;
  return err?.message || 'Not saved';
}

/** The site being edited in this page, or null (no `?site=`, or not in a browser). */
export const SITE = typeof location === 'undefined' ? null : siteFromSearch(location.search);
