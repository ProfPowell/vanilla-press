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

function attrs(text) {
  const out = {};
  for (const m of text.matchAll(/([^\s=/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    out[m[1].toLowerCase()] = decode(m[2] ?? m[3]);
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
  const src = text
    .replace(/^﻿/, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '');
  const stack = [];
  const entries = [];
  let skipped = 0;
  let sawOpml = false;
  let sawBody = false;
  for (const m of src.matchAll(/<(\/)?([A-Za-z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/)?>/g)) {
    const [, closing, rawName, rest, selfClose] = m;
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
      const parent = [...stack].reverse().find((n) => n.name === 'outline');
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
