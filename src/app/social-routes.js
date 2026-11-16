/**
 * The Social screen's routes on a site's router: read the profile links, check an
 * account against its service, re-check them all, save, and render the links the
 * way Cook will. A save runs in the backup's git queue and the write lock (like
 * Layout publish, since config/social.json is outside the backup paths), commits
 * only that file with `Social: accounts` and pushes. Without a repo, or when the
 * commit or push fails, the change stays on disk and the response says
 * `committed: false` with a note. Every response is JSON.
 *
 * Needs Cook's `cook-ssg/social` (2.10.0): without it GET says `cookReady: false`
 * and every other route answers 409.
 *
 * @module app/social-routes
 */

import { sendJson } from '../server/router.js';
import { NEEDS_COOK, SocialError, readSocial, writeSocial } from '../social/config.js';
import { importCookSocial } from '../social/cook.js';
import { checkAccount, currentBlueskyHandle } from '../social/check.js';
import { SOCIAL_PATHS, socialMessage } from './site-git.js';
import { GitNotConnectedError } from '../git/git.js';

const NOT_COMMITTED = (why) => `Saved on this computer, but not committed (${why}), so it isn't live yet.`;
const NOT_PUSHED = (why) => `Committed on this computer, but not pushed to GitHub (${why}), so it isn't live yet. The next backup or Publish pushes it.`;
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const CHECKED = { ok: 'yes', unchecked: 'never' };

/**
 * @param {{ add: Function }} router
 * @param {string} prefix - `/api/sites/<id>`
 * @param {{ site: object, ws: object, backup: object, writes: Function,
 *   deps: { commitPaths: Function, push: Function, gitStatus: Function },
 *   fetch?: typeof fetch, timeoutMs?: number,
 *   cookSocial?: object|(() => Promise<object|null>|object|null) }} context - cookSocial: a
 *   stand-in for the site's `cook-ssg/social` (tests); timeoutMs: each account check's limit
 */
export function mountSocialRoutes(router, prefix, {
  ws, backup, writes, deps, fetch: fetchImpl = globalThis.fetch, timeoutMs = 8000, cookSocial,
}) {
  const siteDir = ws.siteDir;
  const loadCook = async () => (typeof cookSocial === 'function'
    ? cookSocial(siteDir)
    : cookSocial ?? importCookSocial(siteDir));
  const body = (req) => (isObj(req.body) ? req.body : {});
  const check = (account) => checkAccount(account, { fetch: fetchImpl, timeoutMs });

  const handle = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof SocialError) return sendJson(res, err.status, { error: err.message, ...err.body });
      console.error('Social error:', err);
      sendJson(res, 500, { error: err.message });
    }
  };

  /** The site's Cook social module, or a 409 saying which version is needed. */
  async function needCook() {
    const cook = await loadCook();
    if (!cook) {
      throw new SocialError(409, `This site's Cook needs updating to ${NEEDS_COOK} for Social.`,
        { cookReady: false, needsCook: NEEDS_COOK });
    }
    return cook;
  }

  router.add('GET', `${prefix}/social`, handle(async (req, res) => {
    const { accounts } = readSocial(siteDir);
    const cookReady = !!(await loadCook());
    sendJson(res, 200, { accounts, cookReady, needsCook: cookReady ? null : NEEDS_COOK });
  }));

  router.add('POST', `${prefix}/social/check`, handle(async (req, res) => {
    const cook = await needCook();
    const { service, input } = body(req);
    const parsed = cook.parseHandle(service, input);
    if (parsed.error) throw new SocialError(400, parsed.error);
    sendJson(res, 200, { service, ...(await check({ service, handle: parsed.handle })) });
  }));

  router.add('GET', `${prefix}/social/recheck`, handle(async (req, res) => {
    await needCook();
    const { accounts } = readSocial(siteDir);
    const results = await Promise.all(accounts.map(async (a, index) => {
      if (!isObj(a) || typeof a.service !== 'string' || typeof a.handle !== 'string') {
        return { index, status: 'unchecked', message: 'Not checked: open the link to make sure it\'s you' };
      }
      const r = await check(a);
      const out = { index, service: a.service, ...r };
      if (a.service === 'bluesky' && r.status === 'ok' && a.did && r.did !== a.did) {
        out.mismatch = true;
        const currentHandle = await currentBlueskyHandle(a.did, { fetch: fetchImpl, timeoutMs });
        if (currentHandle) out.currentHandle = currentHandle;
      }
      return out;
    }));
    sendJson(res, 200, { results });
  }));

  router.add('GET', `${prefix}/social/links`, handle(async (req, res) => {
    const cook = await needCook();
    const { raw } = readSocial(siteDir);
    const services = req.query.services ? req.query.services.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
    const opts = { ...(services ? { services } : {}), ...(req.query.variant ? { variant: req.query.variant } : {}) };
    sendJson(res, 200, { html: cook.renderSocialLinks(cook.normalizeAccounts(raw.accounts).visible, opts) });
  }));

  /** Commit config/social.json alone and push it; a failure is a note, never a lost save. */
  async function goLive() {
    let status;
    try {
      status = await deps.gitStatus(siteDir);
    } catch (err) {
      return { committed: false, note: NOT_COMMITTED(err.message) };
    }
    if (!status.isRepo) return { status: 'saved', committed: false, note: NOT_COMMITTED('this site folder is not a git repository') };
    let sha;
    try {
      sha = await deps.commitPaths(siteDir, [...SOCIAL_PATHS], socialMessage());
    } catch (err) {
      return { committed: false, note: NOT_COMMITTED(err.message) };
    }
    try {
      const pushed = await deps.push(siteDir, {});
      return { ...pushed, status: 'pushed', committed: true };
    } catch (err) {
      const notConnected = err instanceof GitNotConnectedError;
      return {
        ...(notConnected ? { status: 'saved' } : {}),
        ...(sha ? { unpushedCommit: true, pushError: notConnected ? null : err.message } : {}),
        committed: false, note: NOT_PUSHED(err.message),
      };
    }
  }

  /** One entry of the request, re-parsed through Cook; returns the account to store (without check fields). */
  function parseEntry(cook, entry, index) {
    const fail = (message) => new SocialError(400, message, { index });
    if (!isObj(entry)) throw fail('Each account must be an object.');
    const { service } = entry;
    if (service === 'link') {
      const out = { service, label: entry.label, url: entry.url };
      if (!cook.normalizeAccounts([out]).all.length) {
        throw fail('A link needs a label and an https: address.');
      }
      return out;
    }
    const parsed = cook.parseHandle(service, entry.handle);
    if (parsed.error) throw fail(parsed.error);
    return { service, handle: parsed.handle };
  }

  router.add('PUT', `${prefix}/social/accounts`, handle(async (req, res) => {
    const cook = await needCook();
    const { accounts: input, saveUnchecked = false } = body(req);
    if (!Array.isArray(input)) throw new SocialError(400, 'accounts must be a list.');
    const parsed = input.map((e, i) => parseEntry(cook, e, i));
    const { accounts: stored } = readSocial(siteDir);
    const known = (a) => stored.find((s) => isObj(s) && s.service === a.service
      && (a.service === 'link' ? s.url === a.url : s.handle === a.handle));

    // Check only what is new; the slow part runs before the queue and lock are taken.
    const checks = await Promise.all(parsed.map((a) => (known(a) ? null : check(a))));
    const missing = [];
    const unreachable = [];
    checks.forEach((c, index) => {
      if (c?.status === 'not-found') missing.push({ index, handle: c.handle, message: c.message });
      if (c?.status === 'unreachable') unreachable.push({ index, handle: c.handle, message: c.message });
    });
    if (missing.length) throw new SocialError(422, missing[0].message, { notFound: missing });
    if (unreachable.length && saveUnchecked !== true) {
      throw new SocialError(409, 'Some accounts could not be checked just now.', { unreachable });
    }

    const next = parsed.map((a, i) => {
      const prior = known(a);
      const c = checks[i];
      const out = { ...(isObj(prior) ? prior : {}), ...a };
      const hidden = input[i].hidden;
      if (typeof hidden === 'boolean') out.hidden = hidden;
      if (c) {
        if (c.did) out.did = c.did;
        out.checked = c.status === 'unreachable' ? 'no' : CHECKED[c.status];
      }
      return out;
    });

    const out = await backup.commitAndPush(() => writes(async () => {
      writeSocial(siteDir, next);
      return goLive();
    }));
    const { committed, note } = out;
    sendJson(res, 200, { accounts: next, committed, ...(note ? { note } : {}) });
  }));
}
