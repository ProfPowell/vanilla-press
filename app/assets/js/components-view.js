/**
 * Pure helpers for the Components section (no DOM).
 * @module components-view
 */

/**
 * @param {Array<object>} packages - PackageState[] from GET /components
 * @returns {Array<{ package: string, label: string, version: string, enabled: boolean, canToggle: boolean, note: string }>}
 */
export function packageRows(packages) {
  return (packages || []).map((p) => {
    const els = p.elements || [];
    let note = '';
    if (p.bundled) note = 'Part of Vanilla Breeze';
    else if (p.source === null) note = 'Not installed';
    else if (p.loadsOnLiveSite === false) note = p.liveSiteNote || "Won't load on the live site";
    return {
      package: p.package,
      label: els.length === 1 ? els[0].label : p.package,
      version: p.siteVersion || p.vpVersion || '',
      enabled: Boolean(p.enabled),
      canToggle: !p.bundled,
      note,
    };
  });
}

export const NPM_NEXT_STEP = 'Check your internet connection, then try again.';

/**
 * Classify a PUT /components/:pkg response. An npm failure (a 502 with npm's
 * `log`) adds the next step to its text and carries the log tail to show.
 * @param {number} status
 * @param {any} body
 * @returns {{ kind: 'ok'|'in-use'|'dirty'|'npm'|'error', text: string, log?: string,
 *   posts?: Array<{id: string, title: string, status: string}> }}
 */
export function toggleOutcome(status, body) {
  const text = body?.error || '';
  if (status >= 200 && status < 300) return { kind: 'ok', text: '' };
  if (status === 409 && Array.isArray(body?.posts)) return { kind: 'in-use', text, posts: body.posts };
  if (status === 409) return { kind: 'dirty', text };
  if (status === 502 && typeof body?.log === 'string') {
    return { kind: 'npm', text: `${text.replace(/\.$/, '')}. ${NPM_NEXT_STEP}`, log: body.log };
  }
  return { kind: 'error', text: text || `Request failed (${status})` };
}
