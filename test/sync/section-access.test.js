import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sectionAccess, readSections, documentAccess } from '../../src/sync/section-access.js';

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'vp-sectacc-')); mkdirSync(join(dir, 'config')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const write = (v) => writeFileSync(join(dir, 'config', 'sections.json'), typeof v === 'string' ? v : JSON.stringify(v));

describe('sectionAccess', () => {
  it("returns the section's level", () => {
    write([{ id: 'art', label: 'Art', access: 'friends' }, { id: 'news' }]);
    assert.equal(sectionAccess(dir, 'art'), 'friends');
  });
  it('a section without a level is null', () => {
    write([{ id: 'news' }]);
    assert.equal(sectionAccess(dir, 'news'), null);
  });
  it('a missing file, an unknown section or no id is null', () => {
    assert.equal(sectionAccess(dir, 'art'), null);
    write([{ id: 'news' }]);
    assert.equal(sectionAccess(dir, 'art'), null);
    assert.equal(sectionAccess(dir, undefined), null);
    assert.equal(sectionAccess(null, 'art'), null);
  });
  it('a broken or non-array file is null, not a throw', () => {
    write('{nope');
    assert.equal(sectionAccess(dir, 'art'), null);
    write({ id: 'art', access: 'private' });
    assert.equal(sectionAccess(dir, 'art'), null);
  });
  it('an unknown level is kept (callers fail closed)', () => {
    write([{ id: 'art', access: 'members' }]);
    assert.equal(sectionAccess(dir, 'art'), 'members');
  });
  it('a present level that is empty or not text is private (fail closed); null is none', () => {
    write([{ id: 'a', access: '' }, { id: 'b', access: 1 }, { id: 'c', access: null }]);
    assert.equal(sectionAccess(dir, 'a'), 'private');
    assert.equal(sectionAccess(dir, 'b'), 'private');
    assert.equal(sectionAccess(dir, 'c'), null);
  });
});

describe('documentAccess', () => {
  it('is the higher of the page level and its section level', () => {
    write([{ id: 'club', access: 'friends' }, { id: 'vault', access: 'private' }, { id: 'odd', access: 'Friends' }, { id: 'news' }]);
    assert.equal(documentAccess(dir, {}), 'public');
    assert.equal(documentAccess(dir, { section: 'news' }), 'public');
    assert.equal(documentAccess(dir, { section: 'nope' }), 'public');
    assert.equal(documentAccess(dir, { section: 'club' }), 'friends');
    assert.equal(documentAccess(dir, { access: 'public', section: 'club' }), 'friends');
    assert.equal(documentAccess(dir, { access: 'private', section: 'club' }), 'private');
    assert.equal(documentAccess(dir, { access: 'friends', section: 'vault' }), 'private');
    assert.equal(documentAccess(dir, { section: 'odd' }), 'private');
    assert.equal(documentAccess(dir, { access: 'bogus' }), 'private');
    assert.equal(documentAccess(null, { access: 'friends', section: 'club' }), 'friends');
  });
});

describe('readSections', () => {
  it('lists id, label and access of each section', () => {
    write([{ id: 'art', label: 'Art', access: 'private', extra: 1 }, { id: 'news' }, 'junk']);
    assert.deepEqual(readSections(dir), [
      { id: 'art', label: 'Art', access: 'private' },
      { id: 'news', label: 'news', access: null },
    ]);
  });
  it('is empty without a file', () => assert.deepEqual(readSections(dir), []));
});
