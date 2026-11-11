import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, writeFileSync, existsSync, readdirSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { updateService, serviceKey, servicesState, readServices } from '../../src/services/store.js';
import { SERVICES, SERVICE_GROUPS } from '../../src/services/catalog.js';

describe('services store', () => {
  let dir, env;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vp-services-'));
    env = { VP_CONFIG_DIR: dir };
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('catalog has the groups and the four image services', () => {
    assert.deepEqual(SERVICE_GROUPS.map((g) => g.id), ['image-search', 'sound-video', 'ai']);
    const by = Object.fromEntries(SERVICES.map((s) => [s.id, s]));
    assert.equal(by.openverse.needsKey, false);
    assert.equal(by.unsplash.mode, 'link');
    assert.equal(by.pexels.signupUrl, 'https://www.pexels.com/api/');
    assert.equal(by.pixabay.signupUrl, 'https://pixabay.com/api/docs/');
  });

  it('trims a pasted key', () => {
    updateService('pexels', { key: '  abc\n' }, env);
    assert.equal(serviceKey('pexels', env), 'abc');
  });

  it('an empty or null key removes it', () => {
    updateService('pexels', { key: 'abc' }, env);
    updateService('pexels', { key: '' }, env);
    assert.equal(serviceKey('pexels', env), null);
    updateService('pexels', { key: 'abc' }, env);
    updateService('pexels', { key: null }, env);
    assert.equal(serviceKey('pexels', env), null);
    assert.equal(updateService('pexels', { key: '  ' }, env).hasKey, false);
  });

  it('writes the file with mode 0600', () => {
    updateService('pexels', { key: 'abc' }, env);
    assert.equal(statSync(join(dir, 'services.json')).mode & 0o777, 0o600);
  });

  it('servicesState lists 3 groups, no key in the JSON, openverse ready with no file', () => {
    assert.equal(existsSync(join(dir, 'services.json')), false);
    updateService('pixabay', { key: 'SECRET-KEY-123' }, env);
    const state = servicesState(env);
    assert.equal(state.groups.length, 3);
    assert.deepEqual(state.groups.map((g) => g.id), ['image-search', 'sound-video', 'ai']);
    assert.equal(state.groups[0].services.length, 4);
    assert.equal(JSON.stringify(state).includes('SECRET-KEY-123'), false);
    const by = Object.fromEntries(state.groups[0].services.map((s) => [s.id, s]));
    assert.equal(by.openverse.ready, true);
    assert.equal(by.pexels.ready, false);
    assert.equal(by.pixabay.ready, true);
    assert.equal(by.pixabay.hasKey, true);
  });

  it('each keyed service names its key as the service does', () => {
    const by = Object.fromEntries(servicesState(env).groups[0].services.map((s) => [s.id, s]));
    assert.equal(by.unsplash.keyName, 'Access Key');
    assert.equal(by.pexels.keyName, 'API key');
    assert.equal(by.pixabay.keyName, 'API key');
    assert.equal(by.openverse.keyName, null);
  });

  it('enabled: false makes ready false', () => {
    const s = updateService('openverse', { enabled: false }, env);
    assert.equal(s.enabled, false);
    assert.equal(s.ready, false);
    assert.deepEqual(readServices(env), { openverse: { enabled: false } });
  });

  it('unknown id throws', () => {
    assert.throws(() => updateService('nope', { enabled: true }, env), /Unknown service/);
  });

  it('reads an unreadable file as empty', () => {
    writeFileSync(join(dir, 'services.json'), '{not json');
    assert.deepEqual(readServices(env), {});
  });

  it('the temp file is 0600 before it is renamed, on create and on rewrite', () => {
    const seen = [];
    const hooks = { beforeRename: (tmp) => seen.push(statSync(tmp).mode & 0o777) };
    updateService('pexels', { key: 'abc' }, env, hooks);
    updateService('pexels', { key: 'def' }, env, hooks);
    assert.deepEqual(seen, [0o600, 0o600]);
    assert.equal(statSync(join(dir, 'services.json')).mode & 0o777, 0o600);
  });

  it('creates a missing config dir as 0700 and leaves an existing one alone', () => {
    const fresh = join(dir, 'new', 'cfg');
    updateService('pexels', { key: 'abc' }, { VP_CONFIG_DIR: fresh });
    assert.equal(statSync(fresh).mode & 0o777, 0o700);
    chmodSync(dir, 0o755);
    updateService('pexels', { key: 'abc' }, env);
    assert.equal(statSync(dir).mode & 0o777, 0o755);
  });

  it('a corrupt file is set aside, not overwritten, on the next save', (t) => {
    const warn = t.mock.method(console, 'warn', () => {});
    writeFileSync(join(dir, 'services.json'), '{"pexels":{"key":"OLD-SECRET"} oops');
    assert.deepEqual(readServices(env), {});
    updateService('pixabay', { key: 'new' }, env);
    const kept = readdirSync(dir).filter((f) => f.startsWith('services.json.corrupt-'));
    assert.equal(kept.length, 1);
    assert.match(readFileSync(join(dir, kept[0]), 'utf8'), /OLD-SECRET/);
    assert.equal(statSync(join(dir, kept[0])).mode & 0o777, 0o600);
    assert.deepEqual(readServices(env), { pixabay: { key: 'new' } });
    assert.equal(warn.mock.callCount(), 1);
    const msg = warn.mock.calls[0].arguments.join(' ');
    assert.match(msg, /services\.json/);
    assert.equal(msg.includes('OLD-SECRET'), false);
  });
});
