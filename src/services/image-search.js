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

const ttlOf = (source) => TTL[source] ?? DEFAULT_TTL;

class SourceError extends Error {}

/**
 * @param {{ env?: NodeJS.ProcessEnv, fetch?: typeof globalThis.fetch,
 *   now?: () => number, timeoutMs?: number }} [options]
 */
export function createImageSearch({
  env = process.env,
  fetch: fetchImpl = globalThis.fetch,
  now = Date.now,
  timeoutMs = DEFAULT_TIMEOUT_MS,
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

  /** Fetch with a deadline; a fetch that never settles still loses the race. */
  async function fetchWithin(url, init, label) {
    const controller = new AbortController();
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new SourceError(`${label} didn't answer in time`));
      }, timeoutMs);
    });
    try {
      return await Promise.race([fetchImpl(url, { ...init, signal: controller.signal }), deadline]);
    } catch (err) {
      if (err instanceof SourceError) throw err;
      throw new SourceError(`${label} couldn't be reached`);
    } finally {
      clearTimeout(timer);
    }
  }

  async function searchSource(service, query, page) {
    const cacheKey = `${service.id}|${query}|${page}`;
    const cached = searches.get(cacheKey);
    if (cached && fresh(service.id, cached.at)) return cached.value;

    const adapter = ADAPTERS[service.id];
    const { url, headers } = adapter.request(query, { page, key: serviceKey(service.id, env) });
    const res = await fetchWithin(url, { headers }, service.label);
    if (res.status === 401 || res.status === 403) throw new SourceError(`${service.label} didn't accept the key`);
    if (res.status === 429) throw new SourceError(`${service.label} has had too many searches; try again later`);
    if (!res.ok) throw new SourceError(`${service.label} couldn't search right now`);
    let json;
    try {
      json = await res.json();
    } catch {
      throw new SourceError(`${service.label} sent an answer that couldn't be read`);
    }
    const value = adapter.normalize(json, { page });
    const at = now();
    searches.set(cacheKey, { at, value });
    for (const item of value.results) items.set(`${item.source}|${item.id}`, { at, item });
    return value;
  }

  /**
   * Search every ready source. A source that fails or times out becomes an
   * entry in `errors`; it never fails the whole search.
   * @param {string} q
   * @param {{ page?: number, for?: 'picker'|'library' }} [options]
   * @returns {Promise<{ results: WebImage[], errors: SearchError[], hasMore: boolean }>}
   */
  async function search(q, { page = 1, for: purpose = 'picker' } = {}) {
    const query = String(q ?? '').trim();
    prune();
    const ready = new Set(servicesState(env).groups.flatMap((g) => g.services).filter((s) => s.ready).map((s) => s.id));
    const sources = SERVICES.filter((s) => ADAPTERS[s.id] && ready.has(s.id))
      .filter((s) => purpose !== 'library' || s.mode !== 'link');

    const settled = await Promise.allSettled(sources.map((s) => searchSource(s, query, page)));
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
    return { results, errors, hasMore };
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
   * The bytes of a cached result's `url`. Rejects with `status` 404 when the
   * result is not cached, 502 when the source does not deliver it.
   * @param {string} source
   * @param {string} id
   * @returns {Promise<{ data: Buffer, contentType: string }>}
   */
  async function image(source, id) {
    const item = get(source, id);
    if (!item) throw Object.assign(new Error('Search again — this result has expired'), { status: 404 });
    const label = SERVICES.find((s) => s.id === source)?.label || source;
    let res;
    try {
      res = await fetchWithin(item.url, {}, label);
    } catch (err) {
      throw Object.assign(new Error(err.message), { status: 502 });
    }
    if (!res.ok) throw Object.assign(new Error(`${label} couldn't send the image`), { status: 502 });
    const data = Buffer.from(await res.arrayBuffer());
    return { data, contentType: res.headers.get('content-type') || 'application/octet-stream' };
  }

  return { search, get, image };
}
