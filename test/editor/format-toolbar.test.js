import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatItems, PRIMARY_IDS } from '../../editor/assets/js/menu.js';
import { toolbarPosition, toolbarKeyNav, normalizeLinkUrl } from '../../editor/assets/js/format-toolbar.js';

describe('formatItems', () => {
  const { primary, more } = formatItems();
  const ids = [...primary, ...more].map((i) => i.id);

  it('puts the five primary commands in the primary list, in order', () => {
    assert.deepEqual(PRIMARY_IDS, ['bold', 'italic', 'code', 'highlight', 'link']);
    assert.deepEqual(primary.map((i) => i.id), PRIMARY_IDS);
  });

  it('puts every other old toolbar command in More', () => {
    assert.deepEqual(more.map((i) => i.id), ['strikethrough', 'kbd', 'subscript', 'superscript', 'lift', 'wrap']);
  });

  it('lists each command exactly once', () => {
    assert.equal(new Set(ids).size, ids.length);
  });

  it('has no block types', () => {
    for (const id of ids) assert.doesNotMatch(id, /^(h[234]|heading.*|.*list|blockquote|quote|hr|rule)$/);
  });

  it('gives every item a label and a title; all but wrap have a command', () => {
    for (const item of [...primary, ...more]) {
      assert.ok(item.label && item.title, item.id);
      if (item.id !== 'wrap') assert.equal(typeof item.command, 'function', item.id);
    }
  });
});

describe('toolbarPosition', () => {
  const size = { width: 200, height: 44 };
  const viewport = { width: 1000, height: 800 };

  it('goes above the selection when there is room', () => {
    const p = toolbarPosition({ top: 300, bottom: 320, left: 400, right: 500 }, size, viewport);
    assert.deepEqual(p, { top: 248, left: 350, placement: 'above' });
  });

  it('goes below when the selection is near the top', () => {
    const p = toolbarPosition({ top: 30, bottom: 50, left: 400, right: 500 }, size, viewport);
    assert.deepEqual(p, { top: 58, left: 350, placement: 'below' });
  });

  it('stays above when it fits exactly', () => {
    const p = toolbarPosition({ top: 52, bottom: 70, left: 400, right: 500 }, size, viewport);
    assert.equal(p.placement, 'above');
    assert.equal(p.top, 0);
  });

  it('clamps at the left edge', () => {
    assert.equal(toolbarPosition({ top: 300, bottom: 320, left: 0, right: 40 }, size, viewport).left, 8);
  });

  it('clamps at the right edge', () => {
    assert.equal(toolbarPosition({ top: 300, bottom: 320, left: 960, right: 1000 }, size, viewport).left, 792);
  });

  it('honors a custom gap', () => {
    const p = toolbarPosition({ top: 300, bottom: 320, left: 400, right: 500 }, size, viewport, 16);
    assert.equal(p.top, 240);
  });
});

describe('toolbarKeyNav', () => {
  it('moves right and left', () => {
    assert.equal(toolbarKeyNav(1, 6, 'ArrowRight'), 2);
    assert.equal(toolbarKeyNav(3, 6, 'ArrowLeft'), 2);
  });
  it('wraps at both ends', () => {
    assert.equal(toolbarKeyNav(5, 6, 'ArrowRight'), 0);
    assert.equal(toolbarKeyNav(0, 6, 'ArrowLeft'), 5);
  });
  it('jumps with Home and End', () => {
    assert.equal(toolbarKeyNav(3, 6, 'Home'), 0);
    assert.equal(toolbarKeyNav(3, 6, 'End'), 5);
  });
  it('ignores other keys', () => {
    assert.equal(toolbarKeyNav(3, 6, 'a'), null);
    assert.equal(toolbarKeyNav(3, 6, 'ArrowDown'), null);
  });
});

describe('normalizeLinkUrl', () => {
  it('adds https:// to a bare address', () => {
    assert.equal(normalizeLinkUrl('example.com/a'), 'https://example.com/a');
    assert.equal(normalizeLinkUrl('  example.com  '), 'https://example.com');
  });
  it('keeps full URLs, paths, anchors, mailto and tel as typed', () => {
    for (const u of ['https://a.test/x', 'http://a.test', '/about', '#top', '../x', 'mailto:a@b.test', 'tel:+15551234']) {
      assert.equal(normalizeLinkUrl(u), u);
    }
  });
  it('refuses empty text, spaces and script-capable schemes', () => {
    for (const u of ['', '   ', null, 'two words', 'javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,x', 'vbscript:x']) {
      assert.equal(normalizeLinkUrl(u), null, String(u));
    }
  });
});
