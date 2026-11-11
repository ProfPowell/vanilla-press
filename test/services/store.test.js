import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
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
});
