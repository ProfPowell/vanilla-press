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
 * and every other route answers 409. The About, Contact and Following routes (and OPML
 * import/export) need Cook 2.11.0 (`renderOpml`): older answers 409 with `needsCook`.
 *
 * @module app/social-routes
 */

import { sendJson } from '../server/router.js';
import { NEEDS_COOK, SocialError, readSocial, writeSocial, writeSocialSection } from '../social/config.js';
import { validateAbout, validateContact, validateFollowing, isUrl } from '../social/socialspec.js';
import { parseOpml } from '../social/opml.js';
import { importMarked } from '../social/marked.js';
import { importCookSocial } from '../social/cook.js';
import { checkAccount, currentBlueskyHandle } from '../social/check.js';
import { SOCIAL_PATHS, THEME_PATHS, socialMessage } from './site-git.js';
import { themeConflictResolver } from './site-theme.js';
import { GitNotConnectedError } from '../git/git.js';

const MAX_OPML = 2 * 1024 * 1024;
const NEEDS_SPEC = '2.11.0';
const NEEDS_SEVERAL_EMAILS = '2.11.1';
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
 *   cookSocial?: object|(() => Promise<object|null>|object|null),
 *   marked?: object|((siteDir: string) => Promise<object|null>|object|null) }} context - cookSocial: a
 *   stand-in for the site's `cook-ssg/social` (tests); marked: a stand-in for the site's `marked`; timeoutMs: each account check's limit
 */
export function mountSocialRoutes(router, prefix, {
  site, ws, backup, writes, deps, fetch: fetchImpl = globalThis.fetch, timeoutMs = 8000, cookSocial, marked,
}) {
  const siteDir = ws.siteDir;
  const loadCook = async () => (typeof cookSocial === 'function'
    ? cookSocial(siteDir)
    : cookSocial ?? importCookSocial(siteDir));
  const loadMarked = async () => (typeof marked === 'function' ? marked(siteDir) : marked ?? importMarked(siteDir));
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

  /**
   * Each stored account plus Cook's own answer for it: `profileUrl` (null when Cook
   * would not build one) and `valid` (false when Cook skips the entry at build time).
   * Display only; the file is never written with these.
   */
  const annotate = (cook, accounts) => accounts.map((a) => {
    const [account] = cook.normalizeAccounts({ accounts: [a] }).all;
    return { ...(isObj(a) ? a : {}), profileUrl: account?.url ?? null, valid: !!account };
  });

  router.add('GET', `${prefix}/social`, handle(async (req, res) => {
    const { accounts, about, contact, following } = readSocial(siteDir);
    const cook = await loadCook();
    sendJson(res, 200, {
      accounts: cook ? annotate(cook, accounts) : accounts, cookReady: !!cook, needsCook: cook ? null : NEEDS_COOK,
      about, contact, following, socialSpecReady: typeof cook?.renderOpml === 'function',
    });
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
    const opts = { ...(req.query.services ? { services: req.query.services } : {}), ...(req.query.variant ? { variant: req.query.variant } : {}) };
    sendJson(res, 200, { html: cook.renderSocialLinks(cook.normalizeAccounts(raw).visible, opts) });
  }));

  /** Commit config/social.json alone and push it; a failure is a note, never a lost save. */
  async function goLive(panel = 'accounts') {
    let status;
    try {
      status = await deps.gitStatus(siteDir);
    } catch (err) {
      return { committed: false, note: NOT_COMMITTED(err.message) };
    }
    if (!status.isRepo) return { status: 'saved', committed: false, note: NOT_COMMITTED('this site folder is not a git repository') };
    let sha;
    try {
      sha = await deps.commitPaths(siteDir, [...SOCIAL_PATHS], socialMessage(panel));
    } catch (err) {
      return { committed: false, note: NOT_COMMITTED(err.message) };
    }
    try {
      const pushed = await deps.push(siteDir, { yieldUntracked: [...THEME_PATHS], resolveConflicts: themeConflictResolver(ws) });
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
      if (!cook.normalizeAccounts({ accounts: [out] }).all.length) {
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
    sendJson(res, 200, { accounts: annotate(cook, next), committed, ...(note ? { note } : {}) });
  }));

  /** The site's Cook when it has the SocialSpec renderers (2.11.0), else a 409 naming the version. */
  async function needSpec() {
    const cook = await loadCook();
    if (typeof cook?.renderOpml !== 'function') {
      throw new SocialError(409, `This site's Cook is too old for this; update cook-ssg to ${NEEDS_SPEC} or later`,
        { needsCook: NEEDS_SPEC });
    }
    return cook;
  }

  /** Validate, then write one section and commit it; null removes the key. */
  async function saveSection(panel, value) {
    return backup.commitAndPush(() => writes(async () => {
      writeSocialSection(siteDir, panel, value);
      return goLive(panel);
    }));
  }
  const reply = (res, data, { committed, note }) => sendJson(res, 200, { ...data, committed, ...(note ? { note } : {}) });

  router.add('PUT', `${prefix}/social/about`, handle(async (req, res) => {
    await needSpec();
    const about = validateAbout(body(req).about ?? null);
    reply(res, { about }, await saveSection('about', about));
  }));

  router.add('PUT', `${prefix}/social/contact`, handle(async (req, res) => {
    const cook = await needSpec();
    const contact = validateContact(body(req).contact ?? null);
    // Cook 2.11.0 ignores a list email and would publish a card with none: probe the site's Cook.
    if (Array.isArray(contact?.email)) {
      const probe = cook.renderVcard?.({ name: 'x', email: ['a@b.co', 'c@d.co'] })?.text;
      if (typeof probe !== 'string' || (probe.match(/^EMAIL[;:]/gm) || []).length < 2) {
        throw new SocialError(409, `Several email addresses need cook-ssg ${NEEDS_SEVERAL_EMAILS} or later; save one address or update Cook`,
          { needsCook: NEEDS_SEVERAL_EMAILS });
      }
    }
    reply(res, { contact }, await saveSection('contact', contact));
  }));

  router.add('PUT', `${prefix}/social/following`, handle(async (req, res) => {
    await needSpec();
    const following = validateFollowing(body(req).following ?? null);
    reply(res, { following }, await saveSection('following', following.length ? following : null));
  }));

  router.add('POST', `${prefix}/social/about/preview`, handle(async (req, res) => {
    const text = body(req).body ?? '';
    if (typeof text !== 'string') throw new SocialError(400, 'The about text must be text.');
    const m = await loadMarked();
    if (!m || typeof m.parse !== 'function') {
      throw new SocialError(409, "This site's Cook isn't installed here, so the preview can't be shown.", { needsCook: NEEDS_SPEC });
    }
    sendJson(res, 200, { html: text.trim() ? await m.parse(text) : '' });
  }));

  // The request is JSON ({ opml: "<text>" }): the router refuses other content types.
  router.add('POST', `${prefix}/social/following/import`, handle(async (req, res) => {
    await needSpec();
    const { opml } = body(req);
    if (typeof opml === 'string' && opml.length > MAX_OPML) {
      throw new SocialError(413, 'That file is too large to import (the limit is 2 MB).');
    }
    const parsed = parseOpml(opml);
    const { entries } = parsed;
    let skipped = parsed.skipped;
    let invalid = 0;
    let added = 0;
    const out = await backup.commitAndPush(() => writes(async () => {
      const { following: stored } = readSocial(siteDir);
      const seen = new Set(stored.filter((e) => isObj(e) && typeof e.feedUrl === 'string').map((e) => e.feedUrl));
      const checked = [];
      for (const e of entries) {
        if (seen.has(e.feedUrl)) continue;
        // Only the new entries are validated, one by one: a malformed one is skipped, not fatal.
        // Stored ones (even hand-edited) are kept as they are. New feeds start private.
        let ok;
        try { [ok] = validateFollowing([{ ...e, public: false }]); } catch (err) {
          if (err instanceof SocialError) { invalid += 1; continue; }
          throw err;
        }
        seen.add(e.feedUrl);
        checked.push(ok);
      }
      added = checked.length;
      if (added) {
        writeSocialSection(siteDir, 'following', [...stored, ...checked]);
        return goLive('following');
      }
      return { committed: false, unchanged: true };
    }));
    const { following } = readSocial(siteDir);
    skipped += invalid;
    sendJson(res, 200, {
      following, added, skipped, unchanged: entries.length - added - invalid,
      committed: out.committed, ...(out.note ? { note: out.note } : {}),
    });
  }));

  router.add('GET', `${prefix}/social/following.opml`, handle(async (req, res) => {
    const cook = await needSpec();
    const { following } = readSocial(siteDir);
    // Same filters as Cook's writer: an absolute http(s) feedUrl is required; a non-absolute siteUrl is left out.
    // The title uses the site's name (Cook's writer uses its siteTitle data, which VP does not read).
    const kept = following
      .filter((e) => isObj(e) && isUrl(e.feedUrl, false))
      .map((e) => (e.siteUrl !== undefined && !isUrl(e.siteUrl, false) ? { ...e, siteUrl: undefined } : e));
    const xml = cook.renderOpml(kept, { title: `${site?.name || 'My site'} follows` });
    if (!xml) throw new SocialError(404, 'There is nothing public to export yet.');
    const buf = Buffer.from(xml, 'utf8');
    res.writeHead(200, {
      'Content-Type': 'text/x-opml; charset=utf-8',
      'Content-Disposition': 'attachment; filename="following.opml"',
      'Content-Length': buf.length,
    });
    res.end(buf);
  }));
}
