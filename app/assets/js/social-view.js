/**
 * Pure view model for the Social screen (no DOM).
 * @module social-view
 */

export const COOK_TOO_OLD = "This site's Cook is too old for Social; update cook-ssg to 2.10.0 or later";
export const UNCHECKED_MESSAGE = "Not checked: open the link to make sure it's you";
export const UNREACHABLE_MESSAGE = 'Not checked yet';
export const MISMATCH_MESSAGE = 'This handle now points to a different account';

export const SERVICE_NAMES = {
  bluesky: 'Bluesky', mastodon: 'Mastodon', github: 'GitHub', linkedin: 'LinkedIn', youtube: 'YouTube', link: 'Link',
};
/** Service order in the Add menu. */
export const SERVICE_IDS = ['bluesky', 'mastodon', 'github', 'linkedin', 'youtube', 'link'];

/** The app has no brand icons: a one-letter badge per service. */
const ICONS = { bluesky: 'B', mastodon: 'M', github: 'G', linkedin: 'in', youtube: 'Y', link: '↗' };

const PLACEHOLDERS = {
  bluesky: 'name.bsky.social', mastodon: '@user@instance', github: 'ProfPowell', linkedin: 'in/your-name', youtube: '@channel',
};

function profileUrl(a) {
  const h = String(a.handle || '');
  switch (a.service) {
    case 'bluesky': return `https://bsky.app/profile/${h}`;
    case 'mastodon': { const [, user, instance] = h.split('@'); return `https://${instance}/@${user}`; }
    case 'github': return `https://github.com/${h}`;
    case 'linkedin': return `https://www.linkedin.com/in/${h.replace(/^in\//, '')}`;
    case 'youtube': return `https://www.youtube.com/${h}`;
    case 'link': return a.url || '';
    default: return '';
  }
}

function linkHost(url) {
  try { return new URL(url).host; } catch { return String(url || ''); }
}

function statusOf(account, check) {
  if (check) {
    if (check.mismatch) return [MISMATCH_MESSAGE, 'warn'];
    if (check.status === 'ok') return ['Checked', 'ok'];
    if (check.status === 'not-found') return [check.message || 'Not found', 'warn'];
    if (check.status === 'unreachable') return [UNREACHABLE_MESSAGE, 'warn'];
    if (check.status === 'unchecked') return [UNCHECKED_MESSAGE, 'off'];
  }
  if (account.checked === 'never') return [UNCHECKED_MESSAGE, 'off'];
  if (account.checked === 'no') return [UNREACHABLE_MESSAGE, 'warn'];
  return ['Checking', 'off'];
}

/**
 * One account row. `check` is the account's entry from `GET /social/recheck` (or null).
 * @param {object} account - a stored account
 * @param {object|null} [check]
 * @param {{ index?: number, count?: number }} [pos]
 */
export function accountRow(account, check = null, { index = 0, count = 1 } = {}) {
  const [status, tone] = statusOf(account, check);
  const isLink = account.service === 'link';
  return {
    id: `${account.service}:${isLink ? account.url : account.handle}`,
    icon: ICONS[account.service] || '?',
    name: isLink ? account.label : SERVICE_NAMES[account.service] || account.service,
    handle: isLink ? linkHost(account.url) : account.handle,
    url: profileUrl(account),
    displayName: check?.displayName || '',
    avatar: check?.avatar || '',
    status,
    tone,
    hidden: !!account.hidden,
    canMoveUp: index > 0,
    canMoveDown: index < count - 1,
  };
}

/** A new list with the item at `index` moved by `delta` (no change when it would leave the list). */
export function moveAccount(list, index, delta) {
  const to = index + delta;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return [...list];
  const out = [...list];
  [out[index], out[to]] = [out[to], out[index]];
  return out;
}

/** The fields of the Add form for a service. */
export function addFormFor(serviceId) {
  if (serviceId === 'link') {
    return { fields: [
      { name: 'label', label: 'Label', placeholder: 'My shop', type: 'text' },
      { name: 'url', label: 'Address', placeholder: 'https://example.com', type: 'url' },
    ] };
  }
  return { fields: [{ name: 'handle', label: 'Handle', placeholder: PLACEHOLDERS[serviceId] || '', type: 'text' }] };
}

/** The stored-shape entry sent to PUT /social/accounts for an account. */
export function toPutEntry(a) {
  if (a.service === 'link') return { service: 'link', label: a.label, url: a.url, hidden: !!a.hidden };
  return { service: a.service, handle: a.handle, hidden: !!a.hidden };
}
