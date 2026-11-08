import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'editor', 'index.html'), 'utf8');

describe('editor page', () => {
  // VB analytics sets ping/data-vb-analytics-wired on outbound links; inside
  // ProseMirror that is a DOM change it redraws, and the editor loops forever.
  it('keeps VB analytics out of the editable content', () => {
    assert.match(html, /<div class="editor-content"[^>]*\sdata-vb-no-track[\s>=]/);
  });
});
