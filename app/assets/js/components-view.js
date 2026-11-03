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

/**
 * Classify a PUT /components/:pkg response.
 * @param {number} status
 * @param {any} body
 * @returns {{ kind: 'ok'|'in-use'|'dirty'|'npm'|'error', text: string, posts?: Array<{id: string, title: string, status: string}> }}
 */
export function toggleOutcome(status, body) {
  const text = body?.error || '';
  if (status >= 200 && status < 300) return { kind: 'ok', text: '' };
  if (status === 409 && Array.isArray(body?.posts)) return { kind: 'in-use', text, posts: body.posts };
  if (status === 409) return { kind: 'dirty', text };
  if (status === 502) return { kind: 'npm', text };
  return { kind: 'error', text: text || `Request failed (${status})` };
}
