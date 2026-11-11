/**
 * Machine-local settings for outside services: an on/off switch and an API key
 * each, in `services.json` beside sites.json. Keys never leave this module
 * except through `serviceKey`, for server-side requests; `servicesState` and
 * `updateService` report only `hasKey`.
 *
 * @module services/store
 */

import { existsSync, readFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { configDir } from '../app/registry.js';
import { writeFileAtomic } from '../sync/atomic-write.js';
import { SERVICES, SERVICE_GROUPS } from './catalog.js';

/**
 * @typedef {{ id: string, label: string, needsKey: boolean, hasKey: boolean,
 *   enabled: boolean, ready: boolean, signupUrl: string|null }} ServiceState
 */

function servicesFile(env) {
  return join(configDir(env), 'services.json');
}

/**
 * The stored settings; a missing or unreadable file is no settings.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Record<string, { key?: string, enabled?: boolean }>}
 */
export function readServices(env = process.env) {
  const file = servicesFile(env);
  if (!existsSync(file)) return {};
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

function writeServices(data, env) {
  const file = servicesFile(env);
  writeFileAtomic(file, `${JSON.stringify(data, null, 2)}\n`);
  chmodSync(file, 0o600);
}

function stateOf(service, stored) {
  const hasKey = typeof stored?.key === 'string' && stored.key !== '';
  const enabled = stored?.enabled !== false;
  return {
    id: service.id,
    label: service.label,
    needsKey: service.needsKey,
    hasKey,
    enabled,
    ready: enabled && (!service.needsKey || hasKey),
    signupUrl: service.signupUrl,
  };
}

/**
 * Change a service's key or switch. A blank or null key removes the key.
 * @param {string} id
 * @param {{ key?: string|null, enabled?: boolean }} change
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {ServiceState}
 */
export function updateService(id, { key, enabled } = {}, env = process.env) {
  const service = SERVICES.find((s) => s.id === id);
  if (!service) throw new Error(`Unknown service: ${id}`);
  const all = readServices(env);
  const entry = { ...all[id] };
  if (key !== undefined) {
    const trimmed = typeof key === 'string' ? key.trim() : '';
    if (trimmed) entry.key = trimmed; else delete entry.key;
  }
  if (enabled !== undefined) entry.enabled = Boolean(enabled);
  if (Object.keys(entry).length) all[id] = entry; else delete all[id];
  writeServices(all, env);
  return stateOf(service, entry);
}

/**
 * The stored key, for a server-side request. Never send it to a client.
 * @param {string} id
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string|null}
 */
export function serviceKey(id, env = process.env) {
  const key = readServices(env)[id]?.key;
  return typeof key === 'string' && key !== '' ? key : null;
}

/**
 * Every service by group, with no keys.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ groups: { id: string, label: string, services: ServiceState[] }[] }}
 */
export function servicesState(env = process.env) {
  const all = readServices(env);
  return {
    groups: SERVICE_GROUPS.map((g) => ({
      ...g,
      services: SERVICES.filter((s) => s.group === g.id).map((s) => stateOf(s, all[s.id])),
    })),
  };
}
