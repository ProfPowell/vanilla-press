import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isChromeMutation } from '../../editor/assets/js/blocks/node-view-mutations.js';

describe('isChromeMutation', () => {
  const input = { name: 'input' };
  const chrome = { contains: (n) => n === chrome || n === input };
  const content = { name: 'content' };
  const dom = { name: 'node-view-dom' };

  it('ignores mutations on the view\'s own controls', () => {
    assert.equal(isChromeMutation({ type: 'attributes', target: input, attributeName: 'value' }, dom, chrome), true);
    assert.equal(isChromeMutation({ type: 'childList', target: chrome }, dom, chrome), true);
  });

  it('ignores attribute changes on the view\'s outer element (the view sets those; page scripts like VB theme sync add others)', () => {
    assert.equal(isChromeMutation({ type: 'attributes', target: dom, attributeName: 'theme' }, dom, chrome), true);
    assert.equal(isChromeMutation({ type: 'attributes', target: dom, attributeName: 'data-step-title' }, dom, chrome), true);
  });

  it('lets ProseMirror see content mutations, child changes and selection changes', () => {
    assert.equal(isChromeMutation({ type: 'characterData', target: content }, dom, chrome), false);
    assert.equal(isChromeMutation({ type: 'childList', target: dom }, dom, chrome), false);
    assert.equal(isChromeMutation({ type: 'attributes', target: content, attributeName: 'class' }, dom, chrome), false);
    assert.equal(isChromeMutation({ type: 'selection', target: input }, dom, chrome), false);
  });
});
