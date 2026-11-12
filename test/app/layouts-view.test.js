import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  layoutRows, deletedRows, publishFiles, publishSummary, nameFromLabel, startOptions, startFromValue,
  newLayoutProblem, blockedText, OLD_COOK_TEXT,
} from '../../app/assets/js/layouts-view.js';

const entry = (o) => ({
  name: 'post', kind: 'layout', label: 'Post', status: 'editable', problems: [], parent: null,
  baseFor: [], usedBy: [], unpublished: false, ...o,
});

describe('layoutRows', () => {
  it('words each status', () => {
    const rows = layoutRows({
      layouts: [
        entry({}),
        entry({ name: 'bad', status: 'problems', problems: [{ line: 3, message: 'unknown slot' }, { line: 5, message: 'other' }] }),
        entry({ name: 'old', status: 'plain' }),
      ],
      includes: [],
    });
    assert.equal(rows[0].statusText, 'Editable');
    assert.equal(rows[0].canOpen, true);
    assert.equal(rows[1].statusText, "Can't be edited here: unknown slot");
    assert.equal(rows[1].canOpen, false);
    assert.deepEqual(rows[1].problems, ['Line 3: unknown slot', 'Line 5: other']);
    assert.equal(rows[2].statusText, 'Plain layout: add a layout info block to edit it here');
    assert.equal(rows[2].canOpen, false);
  });

  it('says Used by with singular and plural', () => {
    const [one, three, none] = layoutRows({ layouts: [
      entry({ usedBy: ['src/posts/a.html'] }),
      entry({ name: 'b', usedBy: ['src/posts/a.html', 'src/posts/b.html', 'src/c.html'] }),
      entry({ name: 'c' }),
    ] });
    assert.equal(one.usedText, 'Used by 1 page');
    assert.equal(three.usedText, 'Used by 3 pages');
    assert.equal(none.usedText, '');
  });

  it('words the relations', () => {
    const [base, child, both] = layoutRows({ layouts: [
      entry({ name: 'base', baseFor: ['post', 'essay'] }),
      entry({ name: 'post', parent: 'base' }),
      entry({ name: 'mid', parent: 'base', baseFor: ['post'] }),
    ] });
    assert.equal(base.relationText, 'Base for: post, essay');
    assert.equal(child.relationText, 'Built on base');
    assert.equal(both.relationText, 'Built on base · Base for: post');
  });

  it('blocks delete with the users named', () => {
    const [free, used] = layoutRows({ layouts: [
      entry({}),
      entry({ name: 'base', usedBy: ['src/posts/a.html'], baseFor: ['post', 'essay'] }),
    ] });
    assert.equal(free.canDelete, true);
    assert.equal(free.deleteBlockedText, '');
    assert.equal(used.canDelete, false);
    assert.match(used.deleteBlockedText, /Used by 1 page \(src\/posts\/a\.html\)/);
    assert.match(used.deleteBlockedText, /Base for: post, essay/);
    assert.equal(blockedText([], []), '');
  });

  it('lists layouts then includes, with the unpublished marker and file names', () => {
    const rows = layoutRows({
      layouts: [entry({ unpublished: true })],
      includes: [entry({ name: 'nav', kind: 'include', label: 'nav' })],
    });
    assert.deepEqual(rows.map((r) => r.fileName), ['src/layouts/post.html', 'src/includes/nav.html']);
    assert.equal(rows[0].unpublished, true);
    assert.equal(rows[1].unpublished, false);
  });
});

describe('publish', () => {
  const listing = {
    layouts: [entry({ unpublished: true, usedBy: ['a', 'b'], baseFor: ['x'] }), entry({ name: 'quiet' })],
    includes: [entry({ name: 'nav', kind: 'include', unpublished: true })],
    deleted: [{ kind: 'layout', name: 'gone' }],
  };
  it('names every unpublished and deleted file', () => {
    assert.deepEqual(publishFiles(listing), [
      { kind: 'layout', name: 'post' }, { kind: 'include', name: 'nav' }, { kind: 'layout', name: 'gone' },
    ]);
    assert.deepEqual(publishFiles({ layouts: [entry({})] }), []);
  });
  it('summarises with usage and asks to confirm when any file is used', () => {
    const s = publishSummary(listing);
    assert.equal(s.needsConfirm, true);
    assert.equal(s.items[0].text, 'Used by 2 pages · Base for: x');
    assert.equal(s.items[1].text, '');
    assert.equal(publishSummary({ layouts: [entry({ unpublished: true })] }).needsConfirm, false);
  });
  it('shows deleted rows as deleted and not published', () => {
    assert.equal(deletedRows(listing)[0].text, 'gone — deleted, Not published');
  });
});

describe('new layout', () => {
  it('derives a name from the label', () => {
    assert.equal(nameFromLabel('  My Fancy Post! '), 'my-fancy-post');
    assert.equal(nameFromLabel('---x'), 'x');
    assert.equal(nameFromLabel(''), '');
  });
  it('lists the starts', () => {
    const opts = startOptions({ layouts: [entry({}), entry({ name: 'bad', label: 'Bad', status: 'problems' })] });
    assert.deepEqual(opts.map((o) => o.text), ['Built on Post', 'Built on Bad', 'Copy of Post', 'Blank base']);
    assert.deepEqual(startFromValue('child:post'), { type: 'child', from: 'post' });
    assert.deepEqual(startFromValue('blank'), { type: 'blank' });
  });
  it('checks label and name', () => {
    assert.match(newLayoutProblem('', 'a'), /label/);
    assert.match(newLayoutProblem('A', '-a'), /name/);
    assert.equal(newLayoutProblem('A', 'a_b.c-d'), '');
  });
  it('has the old-Cook message', () => {
    assert.equal(OLD_COOK_TEXT, "This site's Cook is too old to edit layouts; update cook-ssg");
  });
});
