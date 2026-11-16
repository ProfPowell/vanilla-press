import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { CATALOG } from '../../src/components/catalog.js';

// The `accounts` settings control (<social-feed>) in a real DOM (linkedom), with GET /social stubbed.
const win = parseHTML('<!doctype html><html><body></body></html>');
const GLOBALS = ['document', 'HTMLElement', 'customElements', 'CustomEvent', 'Event', 'Node', 'CSS'];
const saved = {};
let accountChoices, accountsValue, socialAnswer;

const ACCOUNTS = [
  { service: 'bluesky', handle: 'alice.example.com', did: 'did:plc:alice', profileUrl: 'https://bsky.app/profile/alice.example.com', valid: true },
  { service: 'mastodon', handle: '@bob@social.example', hidden: true, profileUrl: 'https://social.example/@bob', valid: true },
  { service: 'github', handle: 'carol-dev', profileUrl: 'https://github.com/carol-dev', valid: true },
  { service: 'linkedin', handle: 'dave', profileUrl: 'https://www.linkedin.com/in/dave', valid: true },
  { service: 'link', label: 'Blog', url: 'https://blog.example', profileUrl: 'https://blog.example', valid: true },
  { service: 'github', handle: 'bad handle!', profileUrl: null, valid: false },
];

before(async () => {
  for (const k of GLOBALS) { saved[k] = globalThis[k]; globalThis[k] = win[k]; }
  globalThis.CSS ??= { escape: (s) => String(s).replace(/["\\]/g, '\\$&') };
  saved.fetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/social')) return Response.json(socialAnswer);
    return Response.json({});
  };
  ({ accountChoices, accountsValue } = await import('../../editor/assets/js/accounts-field.js'));
  await import('../../editor/assets/js/components/component-settings.js');
});
after(() => {
  for (const k of GLOBALS) globalThis[k] = saved[k];
  globalThis.fetch = saved.fetch;
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const descriptor = CATALOG.find((e) => e.package === 'vanilla-breeze').elements.find((e) => e.tag === 'social-feed');
const nodeWith = (attrs) => ({ type: { name: 'component_leaf' }, attrs: { tag: 'social-feed', attrs, value: null, wrap: null } });

/** Show the panel for a node; returns { panel, patches } after GET /social answered. */
async function open(attrs) {
  const panel = win.document.createElement('component-settings');
  win.document.body.replaceChildren(panel);
  const patches = [];
  let node = nodeWith(attrs);
  const apply = (patch) => {
    patches.push(patch);
    node = nodeWith(patch.attrs);
    panel.show({ key: 'k', node, descriptor, availability: 'on', label: 'Social feed' }, apply);
  };
  panel.show({ key: 'k', node, descriptor, availability: 'on', label: 'Social feed' }, apply);
  for (let i = 0; i < 4; i++) await tick();
  return { panel, patches };
}
const boxes = (panel) => [...panel.querySelectorAll('fieldset[data-accounts] input[data-account-key]')];
const all = (panel) => panel.querySelector('fieldset[data-accounts] input[data-accounts-all]');
const click = (input) => { input.checked = !input.checked; input.dispatchEvent(new win.Event('change', { bubbles: true })); };

describe('accounts control: pure helpers', () => {
  it('lists Bluesky, Mastodon and GitHub accounts only, labelled with service and handle, hidden marked', () => {
    assert.deepEqual(accountChoices(ACCOUNTS), [
      { key: 'bluesky:alice.example.com', label: 'Bluesky alice.example.com', hidden: false },
      { key: 'mastodon:@bob@social.example', label: 'Mastodon @bob@social.example (hidden)', hidden: true },
      { key: 'github:carol-dev', label: 'GitHub carol-dev', hidden: false },
    ]);
    assert.deepEqual(accountChoices(null), []);
  });
  it('the value: empty for All; unticking All gives the visible keys; else the ticked keys', () => {
    const choices = accountChoices(ACCOUNTS);
    assert.equal(accountsValue({ all: true }, choices), '');
    assert.equal(accountsValue({ all: false }, choices), 'bluesky:alice.example.com,github:carol-dev');
    assert.equal(accountsValue({ all: false, keys: ['github:carol-dev', 'mastodon:@bob@social.example'] }, choices),
      'mastodon:@bob@social.example,github:carol-dev');
    assert.equal(accountsValue({ all: false, keys: [] }, choices), '');
  });
});

describe('accounts control in the settings panel', () => {
  it('accounts control: empty value = All; unticking All writes the visible keys', async () => {
    socialAnswer = { accounts: ACCOUNTS, cookReady: true };
    const { panel, patches } = await open({ items: 12 });
    const fieldset = panel.querySelector('fieldset[data-accounts]');
    assert.ok(fieldset, 'a fieldset');
    assert.equal(fieldset.querySelector('legend').textContent, 'Accounts');
    assert.equal(all(panel).checked, true, 'empty value = All');
    assert.equal(fieldset.querySelector(`label[for="${all(panel).id}"]`).textContent, 'All accounts');
    assert.deepEqual(boxes(panel).map((b) => fieldset.querySelector(`label[for="${b.id}"]`).textContent), [
      'Bluesky alice.example.com', 'Mastodon @bob@social.example (hidden)', 'GitHub carol-dev',
    ]);

    click(all(panel));
    assert.deepEqual(patches.at(-1), { attrs: { items: 12, accounts: 'bluesky:alice.example.com,github:carol-dev' } });
    assert.equal(all(panel).checked, false);
    assert.deepEqual(boxes(panel).map((b) => b.checked), [true, false, true], 'every visible account ticked');

    click(boxes(panel)[1]);
    assert.deepEqual(patches.at(-1), { attrs: { items: 12, accounts: 'bluesky:alice.example.com,mastodon:@bob@social.example,github:carol-dev' } });

    click(all(panel));
    assert.deepEqual(patches.at(-1), { attrs: { items: 12 } }, 'All leaves the attribute out');
    assert.equal(all(panel).checked, true);
  });

  it('a stored list ticks just those accounts; unticking the last one goes back to All', async () => {
    socialAnswer = { accounts: ACCOUNTS, cookReady: true };
    const { panel, patches } = await open({ accounts: 'github:carol-dev' });
    assert.equal(all(panel).checked, false);
    assert.deepEqual(boxes(panel).map((b) => b.checked), [false, false, true]);
    click(boxes(panel)[2]);
    assert.deepEqual(patches.at(-1), { attrs: {} });
    assert.equal(all(panel).checked, true);
  });
});
