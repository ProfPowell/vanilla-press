import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import matter from 'gray-matter';
import { frontMatter, localDay } from '../../src/sync/front-matter.js';

const base = {
  id: '1',
  meta: {
    title: 'Hello', slug: 'hello', collection: 'posts', status: 'published',
    description: 'D', author_id: 'tp', created: '2026-10-01T12:00:00Z',
    updated: '2026-10-03T12:00:00Z', published: '2026-10-02T12:00:00Z', tags: ['a', 'b'],
  },
  blocks: [],
};

describe('localDay', () => {
  it('uses the local timezone', () => {
    const prev = process.env.TZ;
    try {
      process.env.TZ = 'America/Los_Angeles';
      assert.equal(localDay('2026-11-02T05:30:00Z'), '2026-11-01');
    } finally {
      if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev;
    }
  });
});

describe('frontMatter', () => {
  it('full doc, exact output', () => {
    const expected = `---\ntitle: "Hello"\ndescription: "D"\ndate: "${localDay('2026-10-02T12:00:00Z')}"\npublished: "2026-10-02T12:00:00Z"\nupdated: "2026-10-03T12:00:00Z"\nauthor: "tp"\ntags: ["a","b"]\nlayout: "post"\nslug: "hello"\nvp_id: "1"\n---\n`;
    assert.equal(frontMatter(base, { layout: 'post' }), expected);
  });
  it('omits empty values and falls back to created for date', () => {
    const d = { ...base, id: 'doc_x', meta: { title: 'X', slug: 'x', created: '2026-10-01T12:00:00Z', tags: [], description: '' } };
    const out = frontMatter(d, { layout: 'page' });
    assert.equal(out, `---\ntitle: "X"\ndate: "${localDay('2026-10-01T12:00:00Z')}"\nlayout: "page"\nslug: "x"\nvp_id: "doc_x"\n---\n`);
  });
  for (const title of ['He said "hi": yes', 'a\nb', '--- x', '#hash']) {
    it(`round-trips title ${JSON.stringify(title)}`, () => {
      const d = { ...base, id: 'doc_x', meta: { ...base.meta, title } };
      assert.equal(matter(frontMatter(d, { layout: 'post' }) + '<p>x</p>').data.title, title);
    });
  }
});
