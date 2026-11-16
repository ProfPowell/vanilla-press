// Stand-in for cook-ssg/social (Cook 2.10.0). Same names and signatures, simple behaviour.
export const SERVICES = {
  bluesky: { name: 'Bluesky' },
  mastodon: { name: 'Mastodon' },
  github: { name: 'GitHub' },
  linkedin: { name: 'LinkedIn' },
  youtube: { name: 'YouTube' },
  link: { name: 'Link' },
};

export function parseHandle(service, input) {
  let s = String(input ?? '').trim();
  if (!SERVICES[service]) return { error: 'Unknown service' };
  s = s.replace(/^https?:\/\/(www\.)?/, '');
  if (service === 'bluesky') {
    s = s.replace(/^bsky\.app\/profile\//, '').replace(/^@/, '').toLowerCase();
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s) ? { handle: s } : { error: 'Not a Bluesky handle' };
  }
  if (service === 'mastodon') {
    const m = /^@?([\w.-]+)@([\w.-]+)$/.exec(s);
    return m ? { handle: `@${m[1]}@${m[2].toLowerCase()}` } : { error: 'Not a Mastodon handle' };
  }
  if (service === 'github') {
    s = s.replace(/^github\.com\//, '').replace(/^@/, '');
    return /^(?!-)(?!.*--)(?!.*-$)[A-Za-z0-9-]{1,39}$/.test(s) ? { handle: s } : { error: 'Not a GitHub handle' };
  }
  if (service === 'linkedin') {
    s = s.replace(/^linkedin\.com\/in\//, '').replace(/^in\//, '').replace(/\/$/, '');
    return /^[\w-]+$/.test(s) ? { handle: s } : { error: 'Not a LinkedIn slug' };
  }
  if (service === 'youtube') {
    s = s.replace(/^youtube\.com\//, '');
    return /^@[\w.-]+$/.test(s) ? { handle: s } : { error: 'Not a YouTube handle' };
  }
  return { error: 'Use label and url' };
}

export function profileUrl(a) {
  const h = a.handle;
  switch (a.service) {
    case 'bluesky': return `https://bsky.app/profile/${h}`;
    case 'mastodon': { const [, u, i] = h.split('@'); return `https://${i}/@${u}`; }
    case 'github': return `https://github.com/${h}`;
    case 'linkedin': return `https://www.linkedin.com/in/${h}`;
    case 'youtube': return `https://www.youtube.com/${h}`;
    default: return a.url;
  }
}

export function normalizeAccounts(raw) {
  const all = [];
  const warnings = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    if (!r || !SERVICES[r.service]) { warnings.push('Unknown service'); continue; }
    let handle = r.handle;
    let url;
    let name = SERVICES[r.service].name;
    if (r.service === 'link') {
      if (typeof r.url !== 'string' || !r.url.startsWith('https:')) { warnings.push('Bad link URL'); continue; }
      url = r.url; name = r.label; handle = r.url;
    } else {
      const p = parseHandle(r.service, handle);
      if (p.error) { warnings.push(p.error); continue; }
      handle = p.handle;
      url = profileUrl({ service: r.service, handle });
    }
    const a = { service: r.service, handle, url, name, icon: r.service, hidden: r.hidden === true };
    if (r.did) a.did = r.did;
    all.push(a);
  }
  return { all, visible: all.filter((a) => !a.hidden), warnings };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderSocialLinks(accounts, { services, variant = 'icon-label' } = {}) {
  const items = accounts
    .filter((a) => !services || services.includes(a.service))
    .map((a) => `<li><a href="${esc(a.url)}"${a.service === 'mastodon' ? ' rel="me"' : ''}><span class="social-icon" data-service="${a.service}" aria-hidden="true"></span><span>${esc(a.name)}</span></a></li>`);
  return items.length ? `<ul>${items.join('')}</ul>` : '';
}
