/**
 * Pure view model for the Services screen (no DOM).
 * @module services-view
 */

export const COMING_LATER = 'Coming in a later update';
export const KEY_SAVED_PLACEHOLDER = 'Key saved — enter a new one to replace it';

/**
 * @typedef {{ id: string, label: string, needsKey: boolean, hasKey: boolean,
 *   enabled: boolean, ready: boolean, signupUrl: string|null, keyName?: string|null }} ServiceState
 */

/**
 * One service row: its status words and tone (the words carry the meaning, the
 * tone only colours a dot), and the key field when the service needs a key.
 * @param {ServiceState} s
 */
export function serviceRow(s) {
  let status = 'Ready';
  let tone = 'ok';
  if (!s.enabled) { status = 'Turned off'; tone = 'off'; }
  else if (s.needsKey && !s.hasKey) { status = 'Needs a key'; tone = 'warn'; }
  return {
    id: s.id,
    label: s.label,
    status,
    tone,
    enabled: s.enabled,
    signupUrl: s.signupUrl ?? null,
    key: s.needsKey
      ? { label: `${s.label} ${s.keyName || 'API key'}`, hasKey: s.hasKey, placeholder: s.hasKey ? KEY_SAVED_PLACEHOLDER : '', canRemove: s.hasKey }
      : null,
  };
}

/**
 * The screen from `GET /api/services`: groups in the server's order.
 * @param {{ groups: { id: string, label: string, services: ServiceState[] }[] }} [state]
 */
export function servicesView(state) {
  return {
    groups: (state?.groups || []).map((g) => ({
      id: g.id,
      label: g.label,
      emptyText: g.services.length ? null : COMING_LATER,
      services: g.services.map(serviceRow),
    })),
  };
}
