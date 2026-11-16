// Social config: config/social.json. `accounts` is an ordered array; every other
// top-level key (SocialSpec's about, contact, following) is kept as it is.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileAtomic } from '../sync/atomic-write.js';

export const SOCIAL_FILE = 'config/social.json';
export const NEEDS_COOK = '2.10.0';
const SECTION_KEYS = {
  about: ['summary', 'body', 'file'],
  contact: ['name', 'email', 'url', 'org', 'title'],
  following: ['title', 'feedUrl', 'siteUrl', 'category', 'public'],
};
const ACCOUNT_KEYS = ['service', 'handle', 'label', 'url', 'did', 'hidden', 'checked'];

export class SocialError extends Error {
  constructor(status, message, body = {}) {
    super(message);
    this.name = 'SocialError';
    this.status = status;
    this.body = body;
  }
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

function readRaw(siteDir) {
  const file = join(siteDir, SOCIAL_FILE);
  if (!existsSync(file)) return {};
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new SocialError(422, `${SOCIAL_FILE} is not valid JSON: ${e.message}`);
  }
  return isObj(raw) ? raw : {};
}

export function readSocial(siteDir) {
  const raw = readRaw(siteDir);
  return {
    raw,
    accounts: Array.isArray(raw.accounts) ? raw.accounts : [],
    about: isObj(raw.about) ? raw.about : null,
    contact: isObj(raw.contact) ? raw.contact : null,
    following: Array.isArray(raw.following) ? raw.following : [],
  };
}

// Known keys first, then any others in their original order.
function ordered(obj, keys = ACCOUNT_KEYS) {
  if (!isObj(obj)) return obj;
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  for (const k of Object.keys(obj)) if (!(k in out) && obj[k] !== undefined) out[k] = obj[k];
  return out;
}

export function writeSocial(siteDir, accounts) {
  const { raw } = readSocial(siteDir);
  const list = (accounts || []).map((a) => ordered(a));
  const out = 'accounts' in raw ? { ...raw, accounts: list } : { accounts: list, ...raw };
  writeFileAtomic(join(siteDir, SOCIAL_FILE), `${JSON.stringify(out, null, 2)}\n`);
}

// Write one SocialSpec section (about | contact | following). `null` removes the key.
// Every other key is kept in place; a new key goes at the end.
export function writeSocialSection(siteDir, key, value) {
  if (!SECTION_KEYS[key]) throw new SocialError(400, `Unknown social section: ${key}`);
  const { raw } = readSocial(siteDir);
  const out = { ...raw };
  if (value === null || value === undefined) delete out[key];
  else if (key === 'following') out[key] = (value || []).map((e) => ordered(e, SECTION_KEYS[key]));
  else out[key] = ordered(value, SECTION_KEYS[key]);
  writeFileAtomic(join(siteDir, SOCIAL_FILE), `${JSON.stringify(out, null, 2)}\n`);
}
