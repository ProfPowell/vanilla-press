/**
 * Pure decisions about local copies of a post: the keys they are stored
 * under, whether to offer one back when a post is reopened, and a short,
 * plain description of how it differs from the saved post.
 *
 * @module editor/drafts/draft-logic
 */

const META_FIELDS = [
  ['title', 'Title'],
  ['slug', 'Slug'],
  ['description', 'Description'],
  ['tags', 'Tags'],
  ['layout', 'Layout'],
];
const MAX_LINES = 6;

/** Key for a saved post. A missing site (fixture mode) is stored as `local`. */
export const postKey = (siteId, docId) => `post:${siteId ?? 'local'}:${docId}`;

/** Key for a post that has never been saved and so has no id yet. */
export const newPostKey = (siteId, stamp) => `post:${siteId ?? 'local'}:new-${stamp}`;

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const metaOf = (doc) => doc?.meta || {};
const regionsOf = (doc) => doc?.regions || {};
const blocksOf = (list) => (Array.isArray(list) ? list : []);

const SERVER_MANAGED = new Set(['updated', 'created']);

/** JSON with sorted keys; null and missing values are the same thing. */
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).filter((k) => value[k] != null).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * True when two posts have the same content: every meta field (but the
 * server-managed `updated`/`created`), the blocks and the regions. Key order
 * does not matter.
 * @param {{ meta?: object, blocks?: object[], regions?: object }|null} a
 * @param {{ meta?: object, blocks?: object[], regions?: object }|null} b
 */
export function sameContent(a, b) {
  const meta = (doc) => Object.fromEntries(Object.entries(metaOf(doc)).filter(([k]) => !SERVER_MANAGED.has(k)));
  const whole = (doc) => ({ meta: meta(doc), blocks: blocksOf(doc?.blocks), regions: regionsOf(doc) });
  return stable(whole(a)) === stable(whole(b));
}

/**
 * What to offer when a post is opened.
 * @returns {null | { kind: 'restore' | 'stale', at: string }}
 */
export function restoreOffer(local, serverDoc) {
  if (!local) return null;
  if (sameContent(local, serverDoc)) return null;
  const base = serverDoc?.meta?.updated ?? null;
  const kind = (local.baseUpdated ?? null) !== base ? 'stale' : 'restore';
  return { kind, at: local.at };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function blockLine(label, mine, theirs) {
  const a = blocksOf(mine);
  const b = blocksOf(theirs);
  const common = Math.min(a.length, b.length);
  let changed = 0;
  for (let i = 0; i < common; i++) if (!same(a[i], b[i])) changed++;
  const parts = [];
  if (changed) parts.push([changed, 'changed']);
  if (a.length > b.length) parts.push([a.length - b.length, 'added']);
  if (b.length > a.length) parts.push([b.length - a.length, 'removed']);
  if (!parts.length) return null;
  const text = parts.map(([n, verb], i) => (i === 0 ? `${plural(n, 'block')} ${verb}` : `${n} ${verb}`)).join(', ');
  return `${label}: ${text}`;
}

const capitalise = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Plain lines describing how the local copy differs from the server's post. */
export function describeDifferences(local, serverDoc) {
  const lines = [];
  const a = metaOf(local);
  const b = metaOf(serverDoc);
  for (const [k, label] of META_FIELDS) if (!same(a[k], b[k])) lines.push(`${label} changed`);
  const body = blockLine('Body', local?.blocks, serverDoc?.blocks);
  if (body) lines.push(body);
  const ra = regionsOf(local);
  const rb = regionsOf(serverDoc);
  for (const name of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
    const line = blockLine(capitalise(name), ra[name], rb[name]);
    if (line) lines.push(line);
  }
  if (!lines.length && !sameContent(local, serverDoc)) lines.push('Other settings changed');
  return lines.length > MAX_LINES ? [...lines.slice(0, MAX_LINES), '…and more'] : lines;
}
