// Account checks against the real services. `fetch` is injected; a slow or silent
// service becomes `unreachable` after `timeoutMs`, never a hung request.
export const UNCHECKED_MESSAGE = "Not checked: open the link to make sure it's you";
export const UNREACHABLE_MESSAGE = 'Not checked yet';
const UNCHECKED = new Set(['linkedin', 'youtube', 'link']);
const DEFAULT_TIMEOUT = 8000;

const NOT_FOUND = {
  bluesky: 'No Bluesky account has that handle',
  mastodon: 'No Mastodon account has that handle',
  github: 'No GitHub account has that name',
};

class Unreachable extends Error {}
class Missing extends Error {}

/** GET JSON; 404 and 400 throw Missing (with the service's words), anything else not ok throws Unreachable. */
async function getJson(url, { fetch, timeoutMs }, service) {
  const ctl = new AbortController();
  let timer;
  const timedOut = new Promise((_, reject) => {
    timer = setTimeout(() => { ctl.abort(); reject(new Unreachable('timeout')); }, timeoutMs);
  });
  try {
    const res = await Promise.race([
      fetch(url, { signal: ctl.signal, headers: { Accept: 'application/json' } }),
      timedOut,
    ]);
    if (res.status === 404 || res.status === 400) {
      let message = '';
      try {
        const data = await res.json();
        message = typeof data?.message === 'string' ? data.message : typeof data?.error === 'string' ? data.error : '';
      } catch { /* no body */ }
      throw new Missing(message || NOT_FOUND[service]);
    }
    if (!res.ok) throw new Unreachable(`HTTP ${res.status}`);
    try {
      return await res.json();
    } catch {
      throw new Unreachable('bad response');
    }
  } catch (err) {
    if (err instanceof Missing || err instanceof Unreachable) throw err;
    throw new Unreachable(err?.message || 'network error');
  } finally {
    clearTimeout(timer);
  }
}

async function lookup(service, handle, opts) {
  if (service === 'bluesky') {
    const r = await getJson(`https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`, opts, service);
    const did = r?.did;
    if (typeof did !== 'string') throw new Unreachable('no did');
    const out = { did };
    try {
      const p = await getJson(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`, opts, service);
      if (p?.displayName) out.displayName = p.displayName;
      if (p?.avatar) out.avatar = p.avatar;
    } catch { /* the handle resolves; the profile card is a nicety */ }
    return out;
  }
  if (service === 'mastodon') {
    const [, user, instance] = handle.split('@');
    const p = await getJson(`https://${instance}/api/v1/accounts/lookup?acct=${encodeURIComponent(user)}`, opts, service);
    return { ...(p?.display_name ? { displayName: p.display_name } : {}), ...(p?.avatar ? { avatar: p.avatar } : {}) };
  }
  const p = await getJson(`https://api.github.com/users/${encodeURIComponent(handle)}`, opts, service);
  return { ...(p?.name ? { displayName: p.name } : {}), ...(p?.avatar_url ? { avatar: p.avatar_url } : {}) };
}

/**
 * @param {{ service: string, handle: string }} account
 * @param {{ fetch: Function, timeoutMs?: number }} opts
 * @returns {Promise<{ status: 'ok'|'not-found'|'unreachable'|'unchecked', handle: string,
 *   did?: string, displayName?: string, avatar?: string, message?: string }>}
 */
export async function checkAccount({ service, handle }, { fetch, timeoutMs = DEFAULT_TIMEOUT } = {}) {
  if (UNCHECKED.has(service) || !NOT_FOUND[service]) return { status: 'unchecked', handle, message: UNCHECKED_MESSAGE };
  try {
    return { status: 'ok', handle, ...(await lookup(service, handle, { fetch, timeoutMs })) };
  } catch (err) {
    if (err instanceof Missing) return { status: 'not-found', handle, message: err.message };
    return { status: 'unreachable', handle, message: UNREACHABLE_MESSAGE };
  }
}

/** A Bluesky account's current handle from its DID, or undefined when it cannot be read. */
export async function currentBlueskyHandle(did, { fetch, timeoutMs = DEFAULT_TIMEOUT } = {}) {
  try {
    const p = await getJson(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`, { fetch, timeoutMs }, 'bluesky');
    return typeof p?.handle === 'string' ? p.handle : undefined;
  } catch {
    return undefined;
  }
}
