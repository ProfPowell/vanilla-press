/**
 * Which media files the live site shows: the HTML pages committed in the
 * site's git HEAD under `src/` (what the next deploy builds), whether Vanilla
 * Press wrote them or not. A saved post that is not live yet still has its old
 * page in HEAD, so a file it showed stays in use until Update.
 *
 * @module app/live-media
 */

import { liveMediaRefs } from '../media/usage.js';
import { readVpId } from '../sync/front-matter.js';

/**
 * @typedef {{ headCommit: (dir: string) => Promise<string|null>,
 *   headTree: (dir: string, path: string) => Promise<Array<{ path: string, oid: string }>>,
 *   readBlobs: (dir: string, oids: string[]) => Promise<Map<string, string>> }} LiveMediaGit
 */

/**
 * A function answering Map<filename, [{ path, vpId }]> for HEAD. The answer is
 * kept until HEAD changes; then only pages whose blob changed are read again.
 * No repo or no commit yet: an empty map. A git failure is thrown (and the
 * next call tries again).
 * @param {string} siteDir
 * @param {LiveMediaGit} git
 * @param {{ refs?: (html: string) => Iterable<string> }} [options] - refs: the map's keys
 *   for one page (default: the media files it shows; programs pass their own)
 * @returns {() => Promise<Map<string, Array<{ path: string, vpId: string|null }>>>}
 */
export function createLiveMedia(siteDir, git, { refs = liveMediaRefs } = {}) {
  let cached = null; // { sha, promise }
  let blobs = new Map(); // oid -> { refs: string[], vpId }

  async function build() {
    const pages = (await git.headTree(siteDir, 'src')).filter((e) => e.path.endsWith('.html'));
    const seen = new Map();
    const usage = new Map();
    // One git process reads every page not seen at an earlier HEAD.
    const fresh = [...new Set(pages.map((p) => p.oid).filter((oid) => !blobs.has(oid)))];
    const texts = await git.readBlobs(siteDir, fresh);
    for (const { path, oid } of pages) {
      let info = seen.get(oid) || blobs.get(oid);
      if (!info) {
        if (!texts.has(oid)) throw new Error(`git has no page ${path}`);
        const text = texts.get(oid);
        info = { refs: [...refs(text)], vpId: readVpId(text) };
      }
      seen.set(oid, info);
      for (const file of info.refs) {
        if (!usage.has(file)) usage.set(file, []);
        usage.get(file).push({ path, vpId: info.vpId });
      }
    }
    blobs = seen;
    return usage;
  }

  return async function liveMedia() {
    const sha = await git.headCommit(siteDir);
    if (!sha) return new Map();
    if (cached?.sha !== sha) {
      const promise = build();
      cached = { sha, promise };
      promise.catch(() => { if (cached?.promise === promise) cached = null; });
    }
    return cached.promise;
  };
}
