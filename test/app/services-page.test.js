import { test } from 'node:test';
import assert from 'node:assert/strict';
import { servicesView, COMING_LATER, KEY_SAVED_PLACEHOLDER } from '../../app/assets/js/services-view.js';

const svc = (id, label, over = {}) => ({ id, label, needsKey: true, hasKey: false, enabled: true, ready: false, signupUrl: `https://${id}.test/api`, ...over });

const STATE = {
  groups: [
    { id: 'image-search', label: 'Image search', services: [
      svc('openverse', 'Openverse', { needsKey: false, ready: true, signupUrl: null }),
      svc('pexels', 'Pexels'),
      svc('pixabay', 'Pixabay', { hasKey: true, enabled: false }),
      svc('unsplash', 'Unsplash', { hasKey: true, ready: true }),
    ] },
    { id: 'sound-video', label: 'Sound and video', services: [] },
    { id: 'ai', label: 'AI generation', services: [] },
  ],
};

const view = servicesView(STATE);
const row = (id) => view.groups[0].services.find((s) => s.id === id);

test('servicesView: keeps the groups in order, with their labels', () => {
  assert.deepEqual(view.groups.map((g) => g.label), ['Image search', 'Sound and video', 'AI generation']);
  assert.equal(view.groups[0].emptyText, null);
});

test('servicesView: groups with no services say they are coming later', () => {
  assert.equal(COMING_LATER, 'Coming in a later update');
  assert.equal(view.groups[1].emptyText, COMING_LATER);
  assert.equal(view.groups[2].emptyText, COMING_LATER);
});

test('servicesView: Openverse is ready and has no key field', () => {
  assert.equal(row('openverse').status, 'Ready');
  assert.equal(row('openverse').tone, 'ok');
  assert.equal(row('openverse').key, null);
  assert.equal(row('openverse').signupUrl, null);
  assert.equal(row('openverse').enabled, true);
});

test('servicesView: Pexels without a key needs one; no Remove yet', () => {
  assert.equal(row('pexels').status, 'Needs a key');
  assert.equal(row('pexels').tone, 'warn');
  assert.deepEqual(row('pexels').key, { label: 'Pexels API key', hasKey: false, placeholder: '', canRemove: false });
  assert.equal(row('pexels').signupUrl, 'https://pexels.test/api');
});

test('servicesView: Pixabay turned off says so, even with a key', () => {
  assert.equal(row('pixabay').status, 'Turned off');
  assert.equal(row('pixabay').tone, 'off');
  assert.equal(row('pixabay').enabled, false);
  assert.deepEqual(row('pixabay').key, { label: 'Pixabay API key', hasKey: true, placeholder: KEY_SAVED_PLACEHOLDER, canRemove: true });
});

test('servicesView: a saved key reads as saved, never shown', () => {
  assert.equal(KEY_SAVED_PLACEHOLDER, 'Key saved — enter a new one to replace it');
  assert.equal(row('unsplash').status, 'Ready');
  assert.equal(row('unsplash').key.placeholder, KEY_SAVED_PLACEHOLDER);
});

test('servicesView: tolerates a missing state', () => {
  assert.deepEqual(servicesView(undefined), { groups: [] });
});

test('servicesView: the key field is named as the service names it', () => {
  const v = servicesView({ groups: [{ id: 'image-search', label: 'Image search', services: [
    svc('unsplash', 'Unsplash', { keyName: 'Access Key' }),
    svc('pexels', 'Pexels', { keyName: 'API key' }),
    svc('legacy', 'Legacy'),
  ] }] });
  const [unsplash, pexels, legacy] = v.groups[0].services;
  assert.equal(unsplash.key.label, 'Unsplash Access Key');
  assert.equal(pexels.key.label, 'Pexels API key');
  assert.equal(legacy.key.label, 'Legacy API key');
});
