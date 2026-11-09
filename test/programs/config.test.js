import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PROGRAMS_FILE, ProgramError, readPrograms, writePrograms, SLUG, checkSlug, checkAreaPath,
  cardFromInput, effectiveSandbox, programsState, buildOnlyPaths,
} from '../../src/programs/config.js';

function site() {
  const dir = mkdtempSync(join(tmpdir(), 'vp-programs-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  return dir;
}
const put = (dir, rel, text = 'x') => {
  const f = join(dir, rel);
  mkdirSync(join(f, '..'), { recursive: true });
  writeFileSync(f, text);
};
const cleanup = (dir) => rmSync(dir, { recursive: true, force: true });

test('PROGRAMS_FILE and SLUG', () => {
  assert.equal(PROGRAMS_FILE, 'config/programs.json');
  assert.ok(SLUG.test('div-vaders') && SLUG.test('a1'));
  for (const bad of ['', 'Foo', 'a--b', '-a', 'a-', 'a/b', 'a b', 'é']) assert.ok(!SLUG.test(bad), bad);
});

test('ProgramError carries status, message and body', () => {
  const e = new ProgramError(422, 'nope', { why: 1 });
  assert.ok(e instanceof Error);
  assert.deepEqual([e.status, e.message, e.body], [422, 'nope', { why: 1 }]);
  assert.deepEqual(new ProgramError(400, 'x').body, {});
});

test('readPrograms: missing file gives empty arrays', () => {
  const dir = site();
  assert.deepEqual(readPrograms(dir), { areas: [], programs: [] });
  cleanup(dir);
});

test('readPrograms: bad JSON is a 422', () => {
  const dir = site();
  put(dir, PROGRAMS_FILE, '{ nope');
  assert.throws(() => readPrograms(dir), (e) =>
    e instanceof ProgramError && e.status === 422 && e.message.startsWith('config/programs.json is not valid JSON: '));
  cleanup(dir);
});

test('readPrograms: wrong shapes give empty arrays', () => {
  const dir = site();
  put(dir, PROGRAMS_FILE, '[]');
  assert.deepEqual(readPrograms(dir), { areas: [], programs: [] });
  put(dir, PROGRAMS_FILE, '{"areas":5,"programs":"x"}');
  assert.deepEqual(readPrograms(dir), { areas: [], programs: [] });
  cleanup(dir);
});

test('writePrograms writes the exact format, keys in the spec order, and round-trips', () => {
  const dir = site();
  writePrograms(dir, {
    areas: [{ sandbox: false, title: 'Programs', path: 'programs' }],
    programs: [{
      listed: true, image: '/media/plasma.png', tags: ['Demo', 'CSS'], date: '2026-11-09',
      description: 'Old-school plasma effect.', title: 'Plasma', slug: 'plasma', area: 'programs',
      order: 2, previewClass: 'plasma', sandbox: true,
    }],
  });
  const expected = `{
  "areas": [
    {
      "path": "programs",
      "title": "Programs",
      "sandbox": false
    }
  ],
  "programs": [
    {
      "area": "programs",
      "slug": "plasma",
      "title": "Plasma",
      "description": "Old-school plasma effect.",
      "date": "2026-11-09",
      "tags": [
        "Demo",
        "CSS"
      ],
      "image": "/media/plasma.png",
      "listed": true,
      "sandbox": true,
      "previewClass": "plasma",
      "order": 2
    }
  ]
}
`;
  assert.equal(readFileSync(join(dir, PROGRAMS_FILE), 'utf8'), expected);
  const back = readPrograms(dir);
  assert.equal(back.programs[0].slug, 'plasma');
  writePrograms(dir, back);
  assert.equal(readFileSync(join(dir, PROGRAMS_FILE), 'utf8'), expected);
  cleanup(dir);
});

test('writePrograms creates config/ and writes empty arrays', () => {
  const dir = site();
  writePrograms(dir, { areas: [], programs: [] });
  assert.equal(readFileSync(join(dir, PROGRAMS_FILE), 'utf8'), '{\n  "areas": [],\n  "programs": []\n}\n');
  cleanup(dir);
});

test('checkSlug', () => {
  assert.equal(checkSlug('div-vaders'), null);
  for (const bad of ['', 'Div', 'a_b', 'a--b', null, undefined, 5]) assert.match(checkSlug(bad), /lowercase/);
});

test('checkAreaPath: bad slug, reserved, buildOnlyPaths', () => {
  const dir = site();
  assert.match(checkAreaPath(dir, 'Bad Name', { areas: [] }), /lowercase/);
  assert.match(checkAreaPath(dir, 'a/b', { areas: [] }), /lowercase/);
  for (const r of ['media', 'assets', 'layouts', 'includes']) {
    assert.equal(checkAreaPath(dir, r, { areas: [] }), `"${r}" is reserved: choose another name.`);
  }
  assert.equal(checkAreaPath(dir, 'partials', { areas: [], buildOnlyPaths: ['/partials/'] }),
    '"partials" is a build-only folder in this site\'s config: choose another name.');
  assert.equal(checkAreaPath(dir, 'demos', { areas: [], buildOnlyPaths: ['partials'] }), null);
  cleanup(dir);
});

test('checkAreaPath (R3): refuses any existing src entry, page, folder or file', () => {
  const dir = site();
  put(dir, 'src/about.html');
  put(dir, 'src/notes.md');
  put(dir, 'src/posts/hello.md');
  put(dir, 'src/gallery/index.html');
  put(dir, 'src/robots.txt');
  put(dir, 'src/favicon/icon.png');
  assert.equal(checkAreaPath(dir, 'about', { areas: [] }), '"about" is already a page on this site (src/about.html).');
  assert.equal(checkAreaPath(dir, 'notes', { areas: [] }), '"notes" is already a page on this site (src/notes.md).');
  assert.equal(checkAreaPath(dir, 'posts', { areas: [] }), '"posts" is already a folder on this site (src/posts/).');
  assert.equal(checkAreaPath(dir, 'gallery', { areas: [] }), '"gallery" is already a folder on this site (src/gallery/).');
  assert.equal(checkAreaPath(dir, 'favicon', { areas: [] }), '"favicon" is already a folder on this site (src/favicon/).');
  assert.equal(checkAreaPath(dir, 'robots', { areas: [] }), null, 'robots.txt is not named robots');
  put(dir, 'src/data');
  assert.equal(checkAreaPath(dir, 'data', { areas: [] }), '"data" is already a file on this site (src/data).');
  assert.equal(checkAreaPath(dir, 'demos', { areas: [] }), null);
  cleanup(dir);
});

test('checkAreaPath (R3): the list page src/<name>.html is refused at creation too', () => {
  const dir = site();
  put(dir, 'src/demos.html');
  assert.equal(checkAreaPath(dir, 'demos', { areas: [] }), '"demos" is already a page on this site (src/demos.html).');
  cleanup(dir);
});

test('checkAreaPath: an existing configured area passes (editing it)', () => {
  const dir = site();
  put(dir, 'src/programs/plasma/index.html');
  put(dir, 'src/programs.html');
  assert.equal(checkAreaPath(dir, 'programs', { areas: [{ path: 'programs', title: 'P', sandbox: false }] }), null);
  assert.match(checkAreaPath(dir, 'programs', { areas: [] }), /already/);
  // reserved and build-only still refuse an area of that name
  assert.match(checkAreaPath(dir, 'media', { areas: [{ path: 'media' }] }), /reserved/);
  assert.match(checkAreaPath(dir, 'programs', { areas: [{ path: 'programs' }], buildOnlyPaths: ['programs'] }), /build-only/);
  cleanup(dir);
});

test('cardFromInput: defaults', () => {
  const today = new Date();
  const local = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const { card, errors } = cardFromInput({}, { area: 'programs', slug: 'div-vaders' });
  assert.deepEqual(errors, []);
  assert.deepEqual(card, {
    area: 'programs', slug: 'div-vaders', title: 'Div Vaders', description: '', date: local,
    tags: [], image: '', listed: false,
  });
  assert.deepEqual(Object.keys(card), ['area', 'slug', 'title', 'description', 'date', 'tags', 'image', 'listed']);
});

test('cardFromInput: a full valid card, with optional keys', () => {
  const { card, errors } = cardFromInput({
    title: '  Plasma  ', description: 'Old.', date: '2026-02-28', tags: [' Demo ', 'CSS', 'Demo'],
    image: '/media/plasma-3f9a2c.png', listed: true, sandbox: false, previewClass: 'plasma-2', order: -3,
  }, { area: 'programs', slug: 'plasma' });
  assert.deepEqual(errors, []);
  assert.deepEqual(card, {
    area: 'programs', slug: 'plasma', title: 'Plasma', description: 'Old.', date: '2026-02-28',
    tags: ['Demo', 'CSS'], image: '/media/plasma-3f9a2c.png', listed: true,
    sandbox: false, previewClass: 'plasma-2', order: -3,
  });
});

test('cardFromInput: absent or null sandbox, previewClass and order are left out', () => {
  const { card, errors } = cardFromInput({ sandbox: null, previewClass: '', order: null }, { area: 'a', slug: 'b' });
  assert.deepEqual(errors, []);
  assert.ok(!('sandbox' in card) && !('previewClass' in card) && !('order' in card));
});

test('cardFromInput: title rules', () => {
  assert.equal(cardFromInput({ title: '   ' }, { area: 'a', slug: 'x-y' }).card.title, 'X Y');
  assert.equal(cardFromInput({ title: 'a'.repeat(120) }, { area: 'a', slug: 'x' }).errors.length, 0);
  const long = cardFromInput({ title: 'a'.repeat(121) }, { area: 'a', slug: 'x' });
  assert.deepEqual(long.errors, ['Title must be 120 characters or fewer.']);
  assert.equal(cardFromInput({ title: 5 }, { area: 'a', slug: 'x' }).errors.length, 1);
});

test('cardFromInput: description rules', () => {
  assert.equal(cardFromInput({ description: 'a'.repeat(500) }, { area: 'a', slug: 'x' }).errors.length, 0);
  assert.deepEqual(cardFromInput({ description: 'a'.repeat(501) }, { area: 'a', slug: 'x' }).errors,
    ['Description must be 500 characters or fewer.']);
});

test('cardFromInput: date rules', () => {
  for (const bad of ['2026-13-01', '2026-02-30', '11/09/2026', '2026-1-1', 20261109]) {
    assert.deepEqual(cardFromInput({ date: bad }, { area: 'a', slug: 'x' }).errors, ['Date must be YYYY-MM-DD.'], String(bad));
  }
  assert.equal(cardFromInput({ date: '2024-02-29' }, { area: 'a', slug: 'x' }).errors.length, 0);
});

test('cardFromInput: tag rules', () => {
  const ten = Array.from({ length: 10 }, (_, i) => `t${i}`);
  assert.equal(cardFromInput({ tags: ten }, { area: 'a', slug: 'x' }).errors.length, 0);
  assert.deepEqual(cardFromInput({ tags: [...ten, 'more'] }, { area: 'a', slug: 'x' }).errors, ['Use 10 tags or fewer.']);
  assert.deepEqual(cardFromInput({ tags: ['a'.repeat(31)] }, { area: 'a', slug: 'x' }).errors,
    ['Each tag must be 30 characters or fewer.']);
  assert.equal(cardFromInput({ tags: ['a'.repeat(30)] }, { area: 'a', slug: 'x' }).errors.length, 0);
  assert.deepEqual(cardFromInput({ tags: 'Demo' }, { area: 'a', slug: 'x' }).errors, ['Tags must be a list of text.']);
  assert.deepEqual(cardFromInput({ tags: [1] }, { area: 'a', slug: 'x' }).errors, ['Tags must be a list of text.']);
  assert.deepEqual(cardFromInput({ tags: ['A', ' A ', '', 'B'] }, { area: 'a', slug: 'x' }).card.tags, ['A', 'B']);
});

test('cardFromInput: image rules', () => {
  assert.equal(cardFromInput({ image: '' }, { area: 'a', slug: 'x' }).errors.length, 0);
  assert.equal(cardFromInput({ image: '/media/a-b.png' }, { area: 'a', slug: 'x' }).errors.length, 0);
  for (const bad of ['https://x.com/a.png', '/media/', '/media/a/b.png', '/media/../x', 'media/a.png', '/other/a.png']) {
    assert.deepEqual(cardFromInput({ image: bad }, { area: 'a', slug: 'x' }).errors, ['Image must be a /media/ file.'], bad);
  }
});

test('cardFromInput: listed, sandbox, previewClass and order rules', () => {
  assert.deepEqual(cardFromInput({ listed: 'yes' }, { area: 'a', slug: 'x' }).errors, ['Listed must be true or false.']);
  assert.deepEqual(cardFromInput({ sandbox: 'no' }, { area: 'a', slug: 'x' }).errors, ['Sandbox must be true, false or left out.']);
  assert.equal(cardFromInput({ sandbox: true }, { area: 'a', slug: 'x' }).card.sandbox, true);
  assert.equal(cardFromInput({ previewClass: 'a-1' }, { area: 'a', slug: 'x' }).errors.length, 0);
  for (const bad of ['1a', 'A', 'a b', '-a', 5]) {
    assert.deepEqual(cardFromInput({ previewClass: bad }, { area: 'a', slug: 'x' }).errors,
      ['Preview class must be a CSS class name (lowercase letters, digits, hyphens).'], String(bad));
  }
  for (const bad of [1.5, '2', NaN, Infinity]) {
    assert.deepEqual(cardFromInput({ order: bad }, { area: 'a', slug: 'x' }).errors, ['Order must be a whole number.'], String(bad));
  }
  assert.equal(cardFromInput({ order: 0 }, { area: 'a', slug: 'x' }).card.order, 0);
});

test('cardFromInput: several errors are all reported', () => {
  const { errors } = cardFromInput({ title: 'a'.repeat(200), date: 'x', listed: 3 }, { area: 'a', slug: 'x' });
  assert.equal(errors.length, 3);
});

test('effectiveSandbox: the card overrides the area default', () => {
  const config = {
    areas: [{ path: 'a', sandbox: true }, { path: 'b', sandbox: false }, { path: 'c' }],
    programs: [
      { area: 'a', slug: 'one' }, { area: 'a', slug: 'two', sandbox: false },
      { area: 'b', slug: 'one', sandbox: true }, { area: 'b', slug: 'two' }, { area: 'c', slug: 'one' },
    ],
  };
  assert.equal(effectiveSandbox(config, 'a', 'one'), true);
  assert.equal(effectiveSandbox(config, 'a', 'two'), false);
  assert.equal(effectiveSandbox(config, 'b', 'one'), true);
  assert.equal(effectiveSandbox(config, 'b', 'two'), false);
  assert.equal(effectiveSandbox(config, 'c', 'one'), false);
  assert.equal(effectiveSandbox(config, 'a', 'stray'), true, 'a stray folder takes the area default');
  assert.equal(effectiveSandbox(config, 'nope', 'x'), false);
});

test('programsState: ok, missing-folder, stray with index, stray without index', () => {
  const dir = site();
  writePrograms(dir, {
    areas: [{ path: 'programs', title: 'Programs', sandbox: false }, { path: 'empty', title: 'Empty', sandbox: true }],
    programs: [
      { area: 'programs', slug: 'plasma', title: 'Plasma', description: 'd', date: '2026-11-09', tags: ['Demo'], image: '', listed: true },
      { area: 'programs', slug: 'gone', title: 'Gone', description: '', date: '2026-01-01', tags: [], image: '', listed: false },
      { area: 'programs', slug: 'nested', title: 'Nested', description: '', date: '2026-01-02', tags: [], image: '', listed: false },
      { area: 'nowhere', slug: 'orphan', title: 'Orphan', description: '', date: '2026-01-01', tags: [], image: '', listed: true },
    ],
  });
  put(dir, 'src/programs/plasma/index.html');
  put(dir, 'src/programs/nested/sub/index.html');
  put(dir, 'src/programs/stray-ok/index.html');
  put(dir, 'src/programs/stray-bare/app.js');
  put(dir, 'src/programs/Not A Slug/index.html');
  put(dir, 'src/programs/loose-file.txt');
  const state = programsState(dir);
  assert.deepEqual(state.areas.map((a) => [a.path, a.count]), [['programs', 5], ['empty', 0]]);
  assert.equal(state.areas[0].title, 'Programs');
  const by = Object.fromEntries(state.programs.map((p) => [`${p.area}/${p.slug}`, p]));
  assert.deepEqual(Object.keys(by).sort(), [
    'programs/gone', 'programs/nested', 'programs/plasma', 'programs/stray-bare', 'programs/stray-ok',
  ]);
  assert.deepEqual([by['programs/plasma'].status, by['programs/plasma'].hasCard, by['programs/plasma'].url],
    ['ok', true, '/programs/plasma/']);
  assert.equal(by['programs/plasma'].listed, true);
  assert.equal(by['programs/plasma'].title, 'Plasma');
  assert.deepEqual([by['programs/gone'].status, by['programs/gone'].hasCard], ['missing-folder', true]);
  assert.equal(by['programs/nested'].status, 'no-index', 'index.html must be top-level');
  assert.deepEqual([by['programs/stray-ok'].status, by['programs/stray-ok'].hasCard, by['programs/stray-ok'].listed],
    ['ok', false, false]);
  assert.equal(by['programs/stray-ok'].title, 'Stray Ok');
  assert.equal(by['programs/stray-ok'].url, '/programs/stray-ok/');
  assert.deepEqual([by['programs/stray-bare'].status, by['programs/stray-bare'].hasCard, by['programs/stray-bare'].listed],
    ['no-index', false, false]);
  cleanup(dir);
});

test('programsState: no file, no areas', () => {
  const dir = site();
  assert.deepEqual(programsState(dir), { areas: [], programs: [] });
  cleanup(dir);
});

test('buildOnlyPaths: [] when config/main.js is absent', async () => {
  const dir = site();
  assert.deepEqual(await buildOnlyPaths(dir), []);
  cleanup(dir);
});

test('buildOnlyPaths reads config/main.js fresh each call', async () => {
  const dir = site();
  put(dir, 'config/main.js', "export default { buildOnlyPaths: ['layouts', 'partials'] };\n");
  assert.deepEqual(await buildOnlyPaths(dir), ['layouts', 'partials']);
  put(dir, 'config/main.js', "export default { buildOnlyPaths: ['x'] };\n");
  assert.deepEqual(await buildOnlyPaths(dir), ['x']);
  put(dir, 'config/main.js', 'export default { other: 1 };\n');
  assert.deepEqual(await buildOnlyPaths(dir), []);
  put(dir, 'config/main.js', 'throw new Error("boom");\n');
  assert.deepEqual(await buildOnlyPaths(dir), []);
  cleanup(dir);
});
