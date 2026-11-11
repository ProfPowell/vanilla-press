/**
 * Image search across the ready image services, merged round-robin and cached
 * in memory. Keys are read per request with `serviceKey` and never appear in a
 * result, an error message or a log: an error names only the source's label.
 *
 * The cache also indexes each result by `source|id`, so a later import or image
 * proxy works only from a result this server itself found, never from a URL a
 * client supplies.
 *
 * @module services/image-search
 */

import { SERVICES } from './catalog.js';
import { serviceKey, servicesState } from './store.js';
import { MAX_BYTES, formatBytes } from '../media/limits.js';
import * as openverse from './image-sources/openverse.js';
import * as pexels from './image-sources/pexels.js';
import * as pixabay from './image-sources/pixabay.js';
import * as unsplash from './image-sources/unsplash.js';

/**
 * @typedef {{ name?: string, url?: string, site?: string, siteUrl?: string,
 *   license?: string, licenseUrl?: string, adapted?: boolean }} Credit
 * @typedef {{ source: string, id: string, mode: 'copy'|'link', thumb: string, url: string,
 *   width: number, height: number, description: string, credit: Credit,
 *   downloadLocation?: string }} WebImage
 * @typedef {{ source: string, label: string, message: string }} SearchError
 */

const ADAPTERS = { openverse, pexels, pixabay, unsplash };

const HOUR = 60 * 60 * 1000;
/** Pixabay asks for search responses to be cached for 24 hours. */
const TTL = { pixabay: 24 * HOUR };
const DEFAULT_TTL = HOUR;
const DEFAULT_TIMEOUT_MS = 8000;
/**
 * Sources that need longer than the default to answer a search. Openverse,
 * used without a key, often takes 10-13 seconds on a query it hasn't cached.
 */
export const SOURCE_TIMEOUT_MS = Object.freeze({ openverse: 20_000 });
/** An image is up to 25 MiB, so its download gets longer than a search. */
const DEFAULT_IMAGE_TIMEOUT_MS = 30_000;
/** Unsplash asks for the download ping; it should not hold up using the photo. */
const PING_TIMEOUT_MS = 5000;
const EXPIRED = 'Search again — this result has expired';

const ttlOf = (source) => TTL[source] ?? DEFAULT_TTL;

/** A failure whose message is safe to show: it names only the source's label. */
class SourceError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/**
 * @param {{ env?: NodeJS.ProcessEnv, fetch?: typeof globalThis.fetch,
 *   now?: () => number, timeoutMs?: number, sourceTimeoutMs?: Record<string, number>,
 *   imageTimeoutMs?: number, maxBytes?: number }} [options]
 *   timeoutMs covers a whole search request, body included; sourceTimeoutMs overrides it
 *   per source; imageTimeoutMs covers a whole image download.
 */
export function createImageSearch({
  env = process.env,
  fetch: fetchImpl = globalThis.fetch,
  now = Date.now,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  sourceTimeoutMs = SOURCE_TIMEOUT_MS,
  imageTimeoutMs = DEFAULT_IMAGE_TIMEOUT_MS,
  maxBytes = MAX_BYTES,
} = {}) {
  /** `source|query|page` -> { at, value: { results, hasMore } } */
  const searches = new Map();
  /** `source|id` -> { at, item } */
  const items = new Map();

  const fresh = (source, at) => now() - at < ttlOf(source);

  function prune() {
    for (const [key, entry] of searches) if (!fresh(key.split('|')[0], entry.at)) searches.delete(key);
    for (const [key, entry] of items) if (!fresh(entry.item.source, entry.at)) items.delete(key);
  }

  /**
   * Fetch and read the body under one deadline: the timer stays armed (and
   * aborts the request) until `read` has finished with the body.
   * @template T
   * @param {string} url
   * @param {RequestInit} init
   * @param {string} label
   * @param {(res: Response) => Promise<T>} read
   * @param {number} [ms]
   * @returns {Promise<T>}
   */
  async function fetchWithin(url, init, label, read, ms = timeoutMs) {
    const controller = new AbortController();
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new SourceError(`${label} didn't answer in time. Try again in a moment.`, 504)), ms);
    });
    const work = (async () => read(await fetchImpl(url, { ...init, signal: controller.signal })))();
    work.catch(() => {}); // after the deadline wins, its rejection is expected
    try {
      return await Promise.race([work, deadline]);
    } catch (err) {
      if (err instanceof SourceError) throw err;
      throw new SourceError(`${label} couldn't be reached`, 502);
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }

  async function searchSource(service, query, page) {
    const cacheKey = `${service.id}|${query}|${page}`;
    const cached = searches.get(cacheKey);
    if (cached && fresh(service.id, cached.at)) return cached.value;

    const adapter = ADAPTERS[service.id];
    const { url, headers } = adapter.request(query, { page, key: serviceKey(service.id, env) });
    const { label } = service;
    const value = await fetchWithin(url, { headers }, label, async (res) => {
      if (!res.ok) {
        // The body is read only to classify the failure; it is never echoed.
        const body = adapter.isKeyError ? await res.text().catch(() => '') : '';
        if (res.status === 401 || res.status === 403 || adapter.isKeyError?.(res.status, body)) {
          throw new SourceError(`${label} didn't accept the key`);
        }
        if (res.status === 429) throw new SourceError(`${label} has had too many searches; try again later`);
        // Past the first page, a refused page means the source has run out
        // (Pixabay and Openverse both answer a page past the end with a 4xx).
        if (page > 1 && res.status >= 400 && res.status < 500) return { results: [], hasMore: false };
        throw new SourceError(`${label} couldn't search right now`);
      }
      let json;
      try {
        json = await res.json();
      } catch (err) {
        if (err?.name === 'AbortError') throw err;
        throw new SourceError(`${label} sent an answer that couldn't be read`);
      }
      return adapter.normalize(json, { page });
    }, sourceTimeoutMs[service.id] ?? timeoutMs);
    const at = now();
    searches.set(cacheKey, { at, value });
    for (const item of value.results) items.set(`${item.source}|${item.id}`, { at, item });
    return value;
  }

  /**
   * Search every ready source. A source that fails or times out becomes an
   * entry in `errors`; it never fails the whole search. `ready` counts the
   * sources searched, so 0 means no image service is turned on.
   * @param {string} q
   * @param {{ page?: number, for?: 'picker'|'library' }} [options] every ready source is searched for
   *   both: a link-mode (Unsplash) result added to the library becomes a linked item
   * @returns {Promise<{ results: WebImage[], errors: SearchError[], hasMore: boolean, ready: number }>}
   */
  async function search(q, { page = 1 } = {}) {
    const query = String(q ?? '').trim();
    prune();
    const ready = new Set(servicesState(env).groups.flatMap((g) => g.services).filter((s) => s.ready).map((s) => s.id));
    const sources = SERVICES.filter((s) => ADAPTERS[s.id] && ready.has(s.id));

    // A source whose previous page said there is no more is not asked again.
    const exhausted = (s) => {
      const previous = searches.get(`${s.id}|${query}|${page - 1}`);
      return page > 1 && previous && fresh(s.id, previous.at) && !previous.value.hasMore;
    };
    const settled = await Promise.allSettled(sources.map((s) => (exhausted(s)
      ? { results: [], hasMore: false }
      : searchSource(s, query, page))));
    const lists = [];
    const errors = [];
    let hasMore = false;
    settled.forEach((outcome, i) => {
      const service = sources[i];
      if (outcome.status === 'fulfilled') {
        lists.push(outcome.value.results);
        hasMore ||= outcome.value.hasMore;
      } else {
        const message = outcome.reason instanceof SourceError
          ? outcome.reason.message
          : `${service.label} couldn't search right now`;
        errors.push({ source: service.id, label: service.label, message });
      }
    });

    const results = [];
    const longest = Math.max(0, ...lists.map((list) => list.length));
    for (let i = 0; i < longest; i++) {
      for (const list of lists) if (i < list.length) results.push(list[i]);
    }
    return { results, errors, hasMore, ready: sources.length };
  }

  /**
   * A result from an earlier search that is still cached, or null.
   * @param {string} source
   * @param {string} id
   * @returns {WebImage|null}
   */
  function get(source, id) {
    const entry = items.get(`${source}|${id}`);
    if (!entry || !fresh(source, entry.at)) return null;
    return entry.item;
  }

  /**
   * The bytes of a cached result's `url`, streamed and refused past `maxBytes`.
   * Rejects with `status`: 404 when the result is not cached, 413 when the
   * image is too large, 504 when it takes too long, 502 when the source does
   * not deliver it.
   * @param {string} source
   * @param {string} id
   * @param {{ maxBytes?: number, timeoutMs?: number }} [limits] this call's cap and
   *   deadline (default: the search's): the image proxy, which never stores the
   *   bytes, takes a larger original than an import may
   * @returns {Promise<{ data: Buffer, contentType: string }>}
   */
  async function image(source, id, { maxBytes: cap = maxBytes, timeoutMs: deadline = imageTimeoutMs } = {}) {
    const item = get(source, id);
    if (!item) throw Object.assign(new Error(EXPIRED), { status: 404 });
    const label = SERVICES.find((s) => s.id === source)?.label || source;
    const tooLarge = () => new SourceError(`${label} sent an image larger than ${formatBytes(cap)}`, 413);
    try {
      return await fetchWithin(item.url, {}, label, async (res) => {
        if (!res.ok || !res.body) throw new SourceError(`${label} couldn't send the image`, 502);
        if (Number(res.headers.get('content-length')) > cap) throw tooLarge();
        const chunks = [];
        let total = 0;
        for await (const chunk of res.body) {
          total += chunk.byteLength;
          if (total > cap) throw tooLarge();
          chunks.push(chunk);
        }
        return {
          data: Buffer.concat(chunks, total),
          contentType: res.headers.get('content-type') || 'application/octet-stream',
        };
      }, deadline);
    } catch (err) {
      throw Object.assign(new Error(err.message), { status: err.status || 502 });
    }
  }

  /**
   * Tell Unsplash a cached photo is being used: its guidelines ask for a ping of the
   * result's `download_location`, with the key. The key goes only to api.unsplash.com
   * and never into an error message or a log. Rejects with `status`: 404 when the
   * result is not cached (or its download_location is not Unsplash's API), 409 when
   * Unsplash has no key, 502 when the ping fails.
   * @param {string} id an Unsplash result's id
   * @returns {Promise<void>}
   */
  async function pingDownload(id) {
    const fail = (message, status) => Object.assign(new Error(message), { status });
    const item = get('unsplash', id);
    if (!item || !item.downloadLocation) throw fail(EXPIRED, 404);
    let target;
    try {
      target = new URL(item.downloadLocation);
    } catch {
      throw fail(EXPIRED, 404);
    }
    if (target.protocol !== 'https:' || target.hostname !== 'api.unsplash.com') throw fail(EXPIRED, 404);
    const key = serviceKey('unsplash', env);
    if (!key) throw fail('Unsplash has no key; add it under Services', 409);
    let ok = false;
    try {
      const answer = await fetchImpl(target.href, {
        headers: { Authorization: `Client-ID ${key}` },
        signal: AbortSignal.timeout(PING_TIMEOUT_MS),
      });
      ok = answer.ok;
    } catch { /* reported below, without the error: it could carry the request */ }
    if (!ok) throw fail("Unsplash couldn't be told about the download", 502);
  }

  return { search, get, image, pingDownload };
}
