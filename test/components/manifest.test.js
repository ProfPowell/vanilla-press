import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCemType, readManifest } from '../../src/components/manifest.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/components');

describe('component manifests', () => {
  it('parses CEM types', () => {
    assert.deepEqual(parseCemType('boolean'), { type: 'boolean' });
    assert.deepEqual(parseCemType('number'), { type: 'number' });
    assert.deepEqual(parseCemType(`'light' | "dark" | undefined`), { type: 'string', enum: ['light', 'dark'] });
    assert.deepEqual(parseCemType('boolean | undefined'), { type: 'boolean' });
    assert.deepEqual(parseCemType('string | HTMLElement'), { type: 'string' });
    assert.deepEqual(parseCemType('string'), { type: 'string' });
    assert.deepEqual(parseCemType(undefined), { type: 'string' });
  });

  it('reads attributes per tag', () => {
    const m = readManifest(join(FIX, 'x-widgets'));
    assert.deepEqual([...m.keys()], ['x-one', 'x-two']);
    const one = m.get('x-one');
    assert.equal(one.description, 'The first widget.');
    assert.deepEqual(one.attributes, [
      { name: 'mode', type: 'string', enum: ['a', 'b'], description: 'Display mode', default: 'a' },
      { name: 'count', type: 'number' },
      { name: 'open', type: 'boolean' },
    ]);
    assert.deepEqual(m.get('x-two').attributes, [{ name: 'label', type: 'string' }]);
  });

  it('returns an empty map when the manifest is missing or unreadable', () => {
    assert.equal(readManifest(join(FIX, 'nope')).size, 0);
    assert.equal(readManifest(FIX).size, 0);
  });
});
