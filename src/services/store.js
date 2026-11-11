/**
 * Machine-local settings for outside services: an on/off switch and an API key
 * each, in `services.json` beside sites.json. Keys never leave this module
 * except through `serviceKey`, for server-side requests; `servicesState` and
 * `updateService` report only `hasKey`.
 *
 * @module services/store
 */

import { existsSync, readFileSync, writeFileSync, chmodSync, renameSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { configDir } from '../app/registry.js';
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

/** Set a file that cannot be parsed aside, so a save does not destroy what it held. */
function setCorruptAside(file) {
  if (!existsSync(file)) return;
  try {
    JSON.parse(readFileSync(file, 'utf8'));
    return;
  } catch { /* unreadable: set aside below */ }
  const aside = `${file}.corrupt-${Date.now()}`;
  renameSync(file, aside);
  chmodSync(aside, 0o600);
  console.warn(`Vanilla Press: ${file} could not be read; kept as ${aside} and starting fresh.`);
}

/** Write with the key never readable by others: 0600 from creation, 0700 for a new dir. */
function writeServices(data, env, { beforeRename } = {}) {
  const file = servicesFile(env);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    chmodSync(tmp, 0o600); // a leftover temp file keeps its old mode through writeFileSync
    beforeRename?.(tmp);
    renameSync(tmp, file);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
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
 * @param {{ beforeRename?: (tmp: string) => void }} [hooks] - for tests
 * @returns {ServiceState}
 */
export function updateService(id, { key, enabled } = {}, env = process.env, hooks = {}) {
  const service = SERVICES.find((s) => s.id === id);
  if (!service) throw new Error(`Unknown service: ${id}`);
  setCorruptAside(servicesFile(env));
  const all = readServices(env);
  const entry = { ...all[id] };
  if (key !== undefined) {
    const trimmed = typeof key === 'string' ? key.trim() : '';
    if (trimmed) entry.key = trimmed; else delete entry.key;
  }
  if (enabled !== undefined) entry.enabled = Boolean(enabled);
  if (Object.keys(entry).length) all[id] = entry; else delete all[id];
  writeServices(all, env, hooks);
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
