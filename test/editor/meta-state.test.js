import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addSaveNote, takeSaveNotes, clearSaveNotes } from '../../editor/assets/js/meta-state.js';

describe('save notes', () => {
  it('the next save takes them once, without duplicates', () => {
    addSaveNote('A'); addSaveNote('A'); addSaveNote('B');
    assert.deepEqual(takeSaveNotes(), ['A', 'B']);
    assert.deepEqual(takeSaveNotes(), []);
  });
  it('opening another post drops them', () => {
    addSaveNote('Inserted as a link.');
    clearSaveNotes();
    assert.deepEqual(takeSaveNotes(), []);
  });
});
