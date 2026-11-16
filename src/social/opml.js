// A small, tolerant OPML reader for the Following import. Hand-rolled (no XML library):
// it only needs the outline tree. Nested outlines are folders; a folder's text becomes the
// category of the feeds inside it. Outlines without an xmlUrl are skipped and counted.
import { SocialError } from './config.js';

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Decode the five XML entities and numeric references; anything unknown stays as written. */
function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(n); } catch { return m; }
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

/** Attributes of a tag body, in one pass (no backtracking). Values may be quoted or bare. */
function attrs(text) {
  const out = {};
  const n = text.length;
  let i = 0;
  const ws = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r';
  while (i < n) {
    while (i < n && (ws(text[i]) || text[i] === '/')) i += 1;
    const start = i;
    while (i < n && !ws(text[i]) && text[i] !== '=' && text[i] !== '/') i += 1;
    const name = text.slice(start, i).toLowerCase();
    while (i < n && ws(text[i])) i += 1;
    if (text[i] !== '=') continue;
    i += 1;
    while (i < n && ws(text[i])) i += 1;
    let value;
    if (text[i] === '"' || text[i] === "'") {
      const end = text.indexOf(text[i], i + 1);
      const stop = end === -1 ? n : end;
      value = text.slice(i + 1, stop);
      i = stop + 1;
    } else {
      const vs = i;
      while (i < n && !ws(text[i])) i += 1;
      value = text.slice(vs, i);
    }
    if (name) out[name] = decode(value);
  }
  return out;
}

const invalid = () => new SocialError(400, "That file doesn't look like OPML. Export a list from your feed reader and try again.");
const isHttp = (u) => { try { return /^https?:$/.test(new URL(u).protocol); } catch { return false; } };

/**
 * @param {string} text
 * @returns {{ entries: Array<{ title: string, feedUrl: string, siteUrl?: string, category?: string }>, skipped: number }}
 * @throws {SocialError} 400 when the text is not well-formed OPML
 */
export function parseOpml(text) {
  if (typeof text !== 'string' || !text.trim()) throw invalid();
  const src = text.replace(/^\uFEFF/, '');
  const stack = [];
  const entries = [];
  let skipped = 0;
  let sawOpml = false;
  let sawBody = false;
  // One forward pass: every step moves `pos` past what it read, so nothing is rescanned.
  const skipPast = (from, close) => {
    const end = src.indexOf(close, from);
    if (end === -1) throw invalid();
    return end + close.length;
  };
  let pos = 0;
  for (;;) {
    const i = src.indexOf('<', pos);
    if (i === -1) break;
    if (src.startsWith('<!--', i)) { pos = skipPast(i + 4, '-->'); continue; }
    if (src.startsWith('<![CDATA[', i)) { pos = skipPast(i + 9, ']]>'); continue; }
    if (src.startsWith('<?', i)) { pos = skipPast(i + 2, '?>'); continue; }
    if (src.startsWith('<!', i)) { pos = skipPast(i + 2, '>'); continue; }
    // A tag: walk to the closing `>`, outside quotes.
    let j = i + 1;
    let quote = '';
    for (; j < src.length; j += 1) {
      const c = src[j];
      if (quote) { if (c === quote) quote = ''; } else if (c === '"' || c === "'") quote = c; else if (c === '>') break;
    }
    if (j >= src.length) throw invalid();
    pos = j + 1;
    const inner = src.slice(i + 1, j);
    const closing = inner[0] === '/';
    const selfClose = !closing && inner.endsWith('/');
    const body = inner.slice(closing ? 1 : 0, selfClose ? -1 : undefined);
    let k = 0;
    while (k < body.length && /[\w:.-]/.test(body[k])) k += 1;
    const rawName = body.slice(0, k);
    const rest = body.slice(k);
    if (!/^[A-Za-z]/.test(rawName)) throw invalid();
    const name = rawName.toLowerCase();
    if (closing) {
      const open = stack.pop();
      if (!open || open.name !== name) throw invalid();
      continue;
    }
    if (name === 'opml') sawOpml = true;
    if (name === 'body') sawBody = true;
    const node = { name, a: name === 'outline' ? attrs(rest) : {} };
    if (name === 'outline' && sawBody) {
      const a = node.a;
      const label = (a.text || a.title || '').trim();
      const feedUrl = (a.xmlurl || '').trim();
      let parent;
      for (let p = stack.length - 1; p >= 0 && !parent; p -= 1) if (stack[p].name === 'outline') parent = stack[p];
      if (!feedUrl) {
        // A folder has children (not self-closed); a bare outline with no feed is a skipped entry.
        if (selfClose) skipped += 1;
      } else if (!isHttp(feedUrl)) {
        skipped += 1;
      } else {
        const entry = { title: label || feedUrl, feedUrl };
        const site = (a.htmlurl || '').trim();
        if (site && isHttp(site)) entry.siteUrl = site;
        const category = parent ? (parent.a.text || parent.a.title || '').trim() : '';
        if (category) entry.category = category;
        entries.push(entry);
      }
    }
    if (!selfClose) stack.push(node);
  }
  if (!sawOpml || stack.length) throw invalid();
  return { entries, skipped };
}
