import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  addSaveNote, takeSaveNotes, clearSaveNotes, resetCurrentMeta, getCurrentMeta, clearPageTheme, metaToSave,
} from '../../editor/assets/js/meta-state.js';

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

describe('clearPageTheme', () => {
  it('clearPageTheme removes both keys', () => {
    resetCurrentMeta({ title: 'T', theme: '8bit', themeScope: 'article' }); clearPageTheme();
    assert.deepEqual(getCurrentMeta(), { title: 'T' });
  });
});

describe('metaToSave', () => {
  it('no page theme is sent as null, so the server\'s merge drops a stored one', () => {
    assert.deepEqual(metaToSave({ title: 'T' }), { title: 'T', theme: null, themeScope: null });
  });
  it('a page theme is sent as it is', () => {
    assert.deepEqual(metaToSave({ title: 'T', theme: '8bit', themeScope: 'article' }), { title: 'T', theme: '8bit', themeScope: 'article' });
  });
});
