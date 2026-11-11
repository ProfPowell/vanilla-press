import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeCredit, creditParts, creditText, validCredit } from '../../src/media/credit.js';

describe('normalizeCredit', () => {
  it('trims strings and drops empty ones', () => {
    assert.deepEqual(
      normalizeCredit({ name: '  Jane ', url: '', site: 'Pexels', siteUrl: '   ', license: undefined }),
      { name: 'Jane', site: 'Pexels' },
    );
  });

  it('keeps adapted only when true, and drops unknown keys and non-strings', () => {
    assert.deepEqual(normalizeCredit({ name: 'Jane', adapted: true, extra: 'x', site: 5 }), { name: 'Jane', adapted: true });
    assert.deepEqual(normalizeCredit({ name: 'Jane', adapted: false }), { name: 'Jane' });
  });

  it('drops a link whose scheme is not http or https', () => {
    assert.deepEqual(
      normalizeCredit({ name: 'Jane', url: 'javascript:alert(1)', site: 'X', siteUrl: 'https://x.example/' }),
      { name: 'Jane', site: 'X', siteUrl: 'https://x.example/' },
    );
    assert.deepEqual(normalizeCredit({ name: 'Jane', url: 'java\tscript:alert(1)', licenseUrl: ' DATA:text/html,x' }), { name: 'Jane' });
  });

  it('reads a JSON string, and gives null for nothing usable', () => {
    assert.deepEqual(normalizeCredit('{"name":"Jane"}'), { name: 'Jane' });
    assert.equal(normalizeCredit('not json'), null);
    assert.equal(normalizeCredit(null), null);
    assert.equal(normalizeCredit([]), null);
    assert.equal(normalizeCredit({ name: '  ' }), null);
    assert.equal(normalizeCredit({ adapted: true }), null);
  });
});

describe('validCredit', () => {
  it('accepts a credit object', () => {
    assert.equal(validCredit({ name: 'Jane', url: 'https://x.example/j', adapted: true }), true);
  });
  it('refuses a non-object, an empty credit, wrong types, unknown keys and unsafe links', () => {
    assert.equal(validCredit('Jane'), false);
    assert.equal(validCredit(null), false);
    assert.equal(validCredit({}), false);
    assert.equal(validCredit({ name: 3 }), false);
    assert.equal(validCredit({ name: 'Jane', adapted: 'yes' }), false);
    assert.equal(validCredit({ name: 'Jane', other: 'x' }), false);
    assert.equal(validCredit({ name: 'Jane', url: 'javascript:alert(1)' }), false);
  });
});

describe('creditParts', () => {
  it('names the author and the site, each linked', () => {
    assert.deepEqual(
      creditParts({ name: 'Jane', url: 'u1', site: 'Pexels', siteUrl: 'u2' }),
      [{ text: 'Photo by ' }, { text: 'Jane', href: 'u1' }, { text: ' on ' }, { text: 'Pexels', href: 'u2' }],
    );
    assert.deepEqual(
      creditParts({ name: 'Jane', url: 'https://u1.example/', site: 'Pexels', siteUrl: 'https://u2.example/' }),
      [{ text: 'Photo by ' }, { text: 'Jane', href: 'https://u1.example/' }, { text: ' on ' }, { text: 'Pexels', href: 'https://u2.example/' }],
    );
  });

  it('adds the license, linked, and adapted', () => {
    const credit = {
      name: 'Jane', site: 'Openverse', license: 'CC BY 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', adapted: true,
    };
    const parts = creditParts(credit);
    assert.ok(creditText(credit).endsWith(', CC BY 4.0, adapted'));
    assert.deepEqual(parts.find((p) => p.text === 'CC BY 4.0'), { text: 'CC BY 4.0', href: credit.licenseUrl });
    assert.equal(creditText(credit), 'Photo by Jane on Openverse, CC BY 4.0, adapted');
  });

  it('with no name: Photo from the site', () => {
    assert.equal(creditText({ site: 'Pexels' }), 'Photo from Pexels');
    assert.deepEqual(creditParts({ site: 'Pexels', siteUrl: 'https://pexels.example/' }),
      [{ text: 'Photo from ' }, { text: 'Pexels', href: 'https://pexels.example/' }]);
  });

  it('a name with no site or links reads as one part', () => {
    assert.deepEqual(creditParts({ name: 'Jane' }), [{ text: 'Photo by Jane' }]);
  });

  it('never links an unsafe URL, and gives nothing for no credit', () => {
    assert.deepEqual(creditParts({ name: 'Jane', url: 'javascript:alert(1)' }), [{ text: 'Photo by Jane' }]);
    assert.deepEqual(creditParts(null), []);
    assert.equal(creditText(null), '');
  });
});

it('credit.js is pure: no imports at all', () => {
  const source = readFileSync(new URL('../../src/media/credit.js', import.meta.url), 'utf8');
  assert.equal(/^\s*import\s/m.test(source), false);
});
