/**
 * The `accounts` settings control's logic (`<social-feed>`): which Social
 * accounts it offers and the attribute value a choice writes. Pure, no DOM.
 *
 * The value is a comma list of account keys (`<service>:<handle>`, as stored
 * in config/social.json), or empty for "All accounts", which Cook reads as
 * every visible Bluesky, Mastodon and GitHub account.
 *
 * @module editor/accounts-field
 */

/** The services a feed reads, in the order Cook's catalog lists them, with their names. */
const FEED_SERVICES = new Map([['bluesky', 'Bluesky'], ['mastodon', 'Mastodon'], ['github', 'GitHub']]);

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * The feed accounts from `GET /social`'s `accounts`, in their stored order.
 * Accounts Cook would skip (`valid: false`) are left out.
 * @param {Array<{ service?: string, handle?: string, hidden?: boolean, valid?: boolean }>|null} accounts
 * @returns {Array<{ key: string, label: string, hidden: boolean }>}
 */
export function accountChoices(accounts) {
  const out = [];
  const seen = new Set();
  for (const a of Array.isArray(accounts) ? accounts : []) {
    if (!isObj(a) || !FEED_SERVICES.has(a.service) || typeof a.handle !== 'string' || !a.handle || a.valid === false) continue;
    const key = `${a.service}:${a.handle}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const hidden = a.hidden === true;
    out.push({ key, label: `${FEED_SERVICES.get(a.service)} ${a.handle}${hidden ? ' (hidden)' : ''}`, hidden });
  }
  return out;
}

/**
 * The keys in an `accounts` value.
 * @param {unknown} value
 * @returns {string[]}
 */
export function parseKeys(value) {
  return typeof value === 'string' ? value.split(',').map((s) => s.trim()).filter(Boolean) : [];
}

/**
 * The attribute value for a choice: '' for All; unticking All (no `keys`) gives
 * every visible account; otherwise the ticked keys, in the choices' order.
 * @param {{ all: boolean, keys?: string[] }} choice
 * @param {ReturnType<typeof accountChoices>} choices
 * @returns {string}
 */
export function accountsValue({ all, keys }, choices) {
  if (all) return '';
  if (!keys) return choices.filter((c) => !c.hidden).map((c) => c.key).join(',');
  const ticked = new Set(keys.map((k) => k.toLowerCase()));
  return choices.filter((c) => ticked.has(c.key.toLowerCase())).map((c) => c.key).join(',');
}
