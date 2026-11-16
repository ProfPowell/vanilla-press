// Stand-in for cook-ssg/social (Cook 2.11.0): a copy of cook's scripts/social/{catalog,accounts,render}.js
// and of renderOpml and renderVcard from socialspec.js (the SocialSpec renderers Vanilla Press calls)
// so the contracts match (normalizeAccounts takes the config object; services is a comma string;
// parseHandle('link', url) gives { handle: url }). The opt-in run with COOK_SOCIAL_MODULE checks the real one.

/** @type {Array<{ id: string, name: string, checkable: boolean }>} */
export const SERVICES = [
  { id: 'bluesky', name: 'Bluesky', checkable: true },
  { id: 'mastodon', name: 'Mastodon', checkable: true },
  { id: 'github', name: 'GitHub', checkable: true },
  { id: 'linkedin', name: 'LinkedIn', checkable: false },
  { id: 'youtube', name: 'YouTube', checkable: false },
  { id: 'link', name: 'Link', checkable: false },
];

/** @param {string} id */
export const serviceById = (id) => SERVICES.find((s) => s.id === id);


const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

const DOMAIN = /^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const GITHUB = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const MASTODON_USER = /^[A-Za-z0-9_](?:[A-Za-z0-9_.-]*[A-Za-z0-9_])?$/;
const LINKEDIN_SLUG = /^[A-Za-z0-9_%-]+$/;
const YOUTUBE = /^@[A-Za-z0-9._-]+$/;

/**
 * If `s` is a pasted URL on `host` (optional `https?://` and `www.`, optional trailing
 * slash), return the path after the host; otherwise null. Bare handles never match.
 */
const urlPath = (s, host) => {
  const m = s.match(new RegExp(`^(?:https?://)?(?:www\\.)?${host.replace(/\./g, '\\.')}/(.+?)/*$`, 'i'));
  return m ? m[1] : null;
};

const fail = (error) => ({ error });

/** @param {string} v */
function isHttpsUrl(v) {
  if (!/^https:\/\//i.test(v)) return false;
  try {
    return new URL(v).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Turn what a person typed (or pasted) into the stored handle.
 * @param {string} service
 * @param {string} input
 * @returns {{ handle: string } | { error: string }}
 */
export function parseHandle(service, input) {
  if (typeof input !== 'string') return fail('Enter a handle');
  const raw = input.trim();
  if (!raw) return fail('Enter a handle');

  switch (service) {
    case 'bluesky': {
      const m = (urlPath(raw, 'bsky.app') || '').match(/^profile\/([^/]+)$/i);
      const handle = (m ? m[1] : raw).replace(/^@/, '').toLowerCase();
      return DOMAIN.test(handle) ? { handle } : fail('Bluesky handles look like name.bsky.social');
    }
    case 'mastodon': {
      const s = raw;
      const m = s.match(/^(?:https?:\/\/)?([^/@\s]+)\/@([^/@]+)\/*$/i);
      let user;
      let instance;
      if (m) {
        [, instance, user] = m;
      } else {
        const parts = s.replace(/^@/, '').split('@');
        if (parts.length !== 2) return fail('Mastodon handles look like @user@instance');
        [user, instance] = parts;
      }
      instance = instance.toLowerCase();
      if (!MASTODON_USER.test(user) || !DOMAIN.test(instance)) return fail('Mastodon handles look like @user@instance');
      return { handle: `@${user}@${instance}` };
    }
    case 'github': {
      const p = urlPath(raw, 'github.com');
      const handle = (p && !p.includes('/') ? p : raw).replace(/^@/, '');
      return GITHUB.test(handle) ? { handle } : fail('GitHub usernames are 1 to 39 letters, digits or single hyphens');
    }
    case 'linkedin': {
      const m = (urlPath(raw, 'linkedin.com') || '').match(/^in\/([^/]+)$/i) || raw.match(/^in\/([^/]+?)\/*$/i);
      const slug = m ? m[1] : raw;
      return LINKEDIN_SLUG.test(slug) ? { handle: slug } : fail('Use the part after linkedin.com/in/');
    }
    case 'youtube': {
      const p = urlPath(raw, 'youtube.com');
      const handle = p && !p.includes('/') ? p : raw;
      return YOUTUBE.test(handle) ? { handle } : fail('YouTube handles look like @name');
    }
    case 'link':
      return isHttpsUrl(raw) ? { handle: raw } : fail('Links must start with https://');
    default:
      return fail(`Unknown service "${service}"`);
  }
}

/**
 * The public profile URL for an account, or null when it can't be built.
 * @param {{ service?: string, handle?: string, url?: string } | null | undefined} account
 * @returns {string | null}
 */
export function profileUrl(account) {
  if (!isObj(account)) return null;
  const { service, handle, url } = account;
  if (service === 'link') return typeof url === 'string' && isHttpsUrl(url) ? url : null;
  if (typeof handle !== 'string' || !handle) return null;
  switch (service) {
    case 'bluesky': return `https://bsky.app/profile/${handle}`;
    case 'mastodon': {
      const m = handle.match(/^@([^@]+)@([^@]+)$/);
      return m ? `https://${m[2]}/@${m[1]}` : null;
    }
    case 'github': return `https://github.com/${handle}`;
    case 'linkedin': return `https://www.linkedin.com/in/${handle}`;
    case 'youtube': return `https://www.youtube.com/${handle}`;
    default: return null;
  }
}

/**
 * Validate the raw contents of config/social.json. A bad entry is skipped with a
 * warning; the rest still build.
 * @param {unknown} raw
 * @returns {{ all: object[], visible: object[], warnings: string[] }}
 */
export function normalizeAccounts(raw) {
  const warnings = [];
  const all = [];
  const list = isObj(raw) ? raw.accounts : undefined;
  if (list !== undefined && !Array.isArray(list)) warnings.push('accounts must be an array; ignoring it');

  (Array.isArray(list) ? list : []).forEach((entry, i) => {
    const at = `accounts[${i}]`;
    if (!isObj(entry)) return void warnings.push(`${at}: not an object; skipped`);
    const svc = typeof entry.service === 'string' ? serviceById(entry.service) : undefined;
    if (!svc) return void warnings.push(`${at}: unknown service ${JSON.stringify(entry.service)}; skipped`);

    const hidden = entry.hidden === true;
    if (svc.id === 'link') {
      const label = typeof entry.label === 'string' ? entry.label.trim() : '';
      const url = typeof entry.url === 'string' ? entry.url.trim() : '';
      if (!label) return void warnings.push(`${at}: link needs a label; skipped`);
      if (!isHttpsUrl(url)) return void warnings.push(`${at}: link url must be https:; skipped`);
      all.push({ service: 'link', handle: '', url, name: label, icon: 'link', hidden });
      return;
    }

    const parsed = parseHandle(svc.id, entry.handle);
    if ('error' in parsed) return void warnings.push(`${at}: ${svc.id} handle ${JSON.stringify(entry.handle)}: ${parsed.error}; skipped`);
    const account = {
      service: svc.id,
      handle: parsed.handle,
      url: profileUrl({ service: svc.id, handle: parsed.handle }),
      name: svc.name,
      icon: svc.id,
      hidden,
    };
    if (svc.id === 'bluesky' && typeof entry.did === 'string' && entry.did.startsWith('did:')) account.did = entry.did;
    all.push(account);
  });

  return { all, visible: all.filter((a) => !a.hidden), warnings };
}


const escapeHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * @param {Array<{ service: string, url: string, name: string, icon?: string }>} accounts
 * @param {{ services?: string, variant?: string }} [options] `variant` is for CSS and
 *   is copied onto the element by the fill step; it does not change the list.
 * @returns {string} the `<ul>…</ul>`, or '' when nothing matches
 */
export function renderSocialLinks(accounts, { services } = {}) {
  if (!Array.isArray(accounts)) return '';
  const wanted = typeof services === 'string' && services.trim()
    ? new Set(services.split(',').map((s) => s.trim()).filter(Boolean))
    : null;
  const items = accounts
    .filter((a) => a && a.url && (!wanted || wanted.has(a.service)))
    .map((a) => {
      const rel = a.service === 'mastodon' ? ' rel="me"' : '';
      return `<li><a href="${escapeHtml(a.url)}"${rel}><span class="social-icon" data-service="${escapeHtml(a.service)}" aria-hidden="true"></span><span>${escapeHtml(a.name)}</span></a></li>`;
    });
  return items.length ? `<ul>${items.join('')}</ul>` : '';
}

const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';

const escapeXml = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * OPML 2.0 subscription list. Public entries only, in the order given.
 * @param {Array<{ title?: string, feedUrl?: string, siteUrl?: string, public?: boolean }>} following
 * @param {{ title?: string }} [options]
 * @returns {string|null} null when there is no public entry with a feedUrl
 */
export function renderOpml(following, { title } = {}) {
  if (!Array.isArray(following)) return null;
  const outlines = following
    .filter((e) => e && e.public !== false && nonEmpty(e.feedUrl))
    .map((e) => {
      const text = escapeXml(nonEmpty(e.title) ? e.title : e.feedUrl);
      const html = nonEmpty(e.siteUrl) ? ` htmlUrl="${escapeXml(e.siteUrl)}"` : '';
      return `    <outline type="rss" text="${text}" title="${text}" xmlUrl="${escapeXml(e.feedUrl)}"${html}/>`;
    });
  if (!outlines.length) return null;
  const head = escapeXml(nonEmpty(title) ? title : 'Following');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    '  <head>',
    `    <title>${head}</title>`,
    '  </head>',
    '  <body>',
    ...outlines,
    '  </body>',
    '</opml>',
    '',
  ].join('\n');
}

// --- renderVcard (Cook 2.11.1), copied from cook's scripts/social/socialspec.js ---
const escapeVcardText = (s) =>
  String(s)
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');

/** Fold one content line at 75 octets (RFC 6350), never splitting a character. */
function fold(line) {
  if (Buffer.byteLength(line) <= 75) return line;
  const parts = [];
  let cur = '';
  let curBytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = Buffer.byteLength(ch);
    if (curBytes + n > limit) {
      parts.push(cur);
      cur = '';
      curBytes = 0;
      limit = 74; // continuation lines carry a leading space
    }
    cur += ch;
    curBytes += n;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

/**
 * vCard 4.0 for contact.vcf.
 * @param {{ name?: string, email?: string|string[], url?: string, org?: string, title?: string }} contact
 * @param {{ siteUrl?: string }} [options] `URL` defaults to siteUrl
 * @returns {{ text: string|null, warning?: string }}
 */
export function renderVcard(contact, { siteUrl } = {}) {
  const c = contact && typeof contact === 'object' ? contact : {};
  if (!nonEmpty(c.name)) {
    return { text: null, warning: 'social: contact has no name, so contact.vcf was not written (FN is required)' };
  }
  const lines = ['BEGIN:VCARD', 'VERSION:4.0', `FN:${escapeVcardText(c.name.trim())}`];
  if (nonEmpty(c.org)) lines.push(`ORG:${escapeVcardText(c.org.trim())}`);
  if (nonEmpty(c.title)) lines.push(`TITLE:${escapeVcardText(c.title.trim())}`);
  const emails = (Array.isArray(c.email) ? c.email : [c.email]).filter(nonEmpty);
  emails.forEach((e, i) => lines.push(`${i === 0 ? 'EMAIL;PREF=1' : 'EMAIL'}:${escapeVcardText(e.trim())}`));
  const url = nonEmpty(c.url) ? c.url : siteUrl;
  // URI value type: not text-escaped (RFC 6350); only strip whitespace so it cannot break a line.
  if (nonEmpty(url)) lines.push(`URL:${String(url).replace(/\s+/g, '')}`);
  lines.push('END:VCARD');
  return { text: lines.map(fold).join('\r\n') + '\r\n' };
}
