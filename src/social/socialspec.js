// SocialSpec validation: about, contact, following. Each validator returns the
// cleaned value (or null for "remove") and throws SocialError(400, message) on bad input.
import { SocialError } from './config.js';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const bad = (m) => { throw new SocialError(400, m); };
/** Absolute http(s) URL with a host, written with `//` (so `https:/a.com` and `https://@` fail). */
export function isUrl(s, https) {
  if (typeof s !== 'string' || !/^https?:\/\//i.test(s)) return false;
  try {
    const u = new URL(s);
    return (u.protocol === 'https:' || (!https && u.protocol === 'http:')) && u.hostname !== '';
  } catch {
    return false;
  }
}

/** A copy with strings trimmed and empty strings dropped (empty means absent). */
const clean = (o, keep = []) => {
  const out = {};
  for (const [k, x] of Object.entries(o)) {
    if (typeof x === 'string') {
      const t = keep.includes(k) ? x : x.trim();
      if (t.trim() !== '') out[k] = t;
    } else if (x !== undefined && x !== null) out[k] = x;
  }
  return out;
};

export function validateAbout(v) {
  if (v === null || v === undefined) return null;
  if (!isObj(v)) bad('About must be an object');
  v = clean(v, ['body']);
  if (v.summary !== undefined && typeof v.summary !== 'string') bad('About: the summary must be text');
  if (typeof v.summary === 'string' && v.summary.length > 300) bad('About: the summary must be 300 characters or fewer');
  if (v.body !== undefined && typeof v.body !== 'string') bad('About: the body must be text');
  if (v.file !== undefined) {
    const f = v.file;
    if (typeof f !== 'string' || f.startsWith('/') || f.startsWith('src/') || f.split(/[\\/]/).includes('..')) {
      bad('About: the file must be a relative path outside src/, without ..');
    }
  }
  return Object.keys(v).length ? v : null;
}

export function validateContact(v) {
  if (v === null || v === undefined) return null;
  if (!isObj(v)) bad('Contact must be an object');
  v = clean(v);
  if (!Object.keys(v).length) return null;
  if (typeof v.name !== 'string' || !v.name.trim()) bad('Contact: a name is required');
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (Array.isArray(v.email)) {
    const list = [];
    v.email.forEach((e, i) => {
      if (typeof e === 'string' && e.trim() === '') return;
      if (typeof e !== 'string' || !EMAIL.test(e.trim())) bad(`Contact: email ${i + 1} does not look like an email address`);
      list.push(e.trim());
    });
    if (list.length > 1) v.email = list;
    else if (list.length === 1) v.email = list[0];
    else delete v.email;
  } else if (v.email !== undefined && v.email !== '' && (typeof v.email !== 'string' || !EMAIL.test(v.email))) {
    bad('Contact: the email does not look like an email address');
  }
  if (v.url !== undefined && v.url !== '' && (typeof v.url !== 'string' || !isUrl(v.url, true))) bad('Contact: the URL must start with https://');
  if (v.org !== undefined && typeof v.org !== 'string') bad('Contact: the organization must be text');
  if (v.title !== undefined && typeof v.title !== 'string') bad('Contact: the title must be text');
  return v;
}

export function validateFollowing(v) {
  if (v === null || v === undefined) return [];
  if (!Array.isArray(v)) bad('Following must be a list');
  return v.map((e, i) => {
    const n = `Following ${i + 1}`;
    if (!isObj(e)) bad(`${n}: each entry must be an object`);
    e = clean(e);
    if (e.title !== undefined && typeof e.title !== 'string') bad(`${n}: the title must be text`);
    if (typeof e.feedUrl !== 'string' || !e.feedUrl.trim()) bad(`${n}: a feed URL is required`);
    if (!isUrl(e.feedUrl, false)) bad(`${n}: the feed URL must start with https:// or http://`);
    if (e.siteUrl !== undefined && e.siteUrl !== '' && (typeof e.siteUrl !== 'string' || !isUrl(e.siteUrl, false))) {
      bad(`${n}: the site URL must start with https:// or http://`);
    }
    if (e.category !== undefined && typeof e.category !== 'string') bad(`${n}: the category must be text`);
    if (e.public !== undefined && typeof e.public !== 'boolean') bad(`${n}: public must be true or false`);
    return { ...e, public: e.public === undefined ? true : e.public };
  });
}
