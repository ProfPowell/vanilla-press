import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listThemes } from '../../src/themes/list-themes.js';

describe('listThemes', () => {
  let dir;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'vp-themes-'));
    mkdirSync(join(dir, 'themes'));
    for (const f of ['amber.css', 'art-deco.css', 'kawaii.css', 'classic.css', 'amber.css.map']) {
      writeFileSync(join(dir, 'themes', f), '');
    }
    writeFileSync(join(dir, 'themes', 'manifest.json'), JSON.stringify({
      'art-deco': { file: 'art-deco.css', tier: 'showcase' },
      kawaii: { file: 'kawaii.css', tier: 'community' },
      classic: { file: 'classic.css', tier: 'core' },
    }));
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it('lists built-ins, manifest themes and unlisted color themes in order', () => {
    const themes = listThemes(dir);
    assert.deepEqual(themes.map(t => t.id), ['default', 'classic', 'minimal', 'modern', 'amber', 'art-deco', 'kawaii']);
  });

  it('marks built-in themes as needing no stylesheet', () => {
    const byId = Object.fromEntries(listThemes(dir).map(t => [t.id, t]));
    assert.equal(byId.default.file, null);
    assert.equal(byId.classic.file, null);
    assert.equal(byId.amber.file, 'amber.css');
    assert.equal(byId.amber.tier, 'color');
    assert.equal(byId['art-deco'].name, 'Art Deco');
  });

  it('copes with a missing themes directory', () => {
    assert.deepEqual(listThemes(join(dir, 'nope')).map(t => t.id), ['default', 'classic', 'minimal', 'modern']);
  });
});
