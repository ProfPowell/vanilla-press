import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startApp } from '../../src/app/server.js';
import { LIMITS } from '../../src/programs/import.js';

function makeSite(root, name) {
  const dir = join(root, name);
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, devDependencies: { 'cook-ssg': '^2.4.0' } }));
  return dir;
}

const put = (dir, rel, text = 'x') => {
  mkdirSync(join(dir, rel, '..'), { recursive: true });
  writeFileSync(join(dir, rel), text);
};

/** Every file under dir (relative), sorted. */
function tree(dir, base = dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? tree(p, base) : [p.slice(base.length + 1)];
  }).sort();
}

const linkPost = (id, slug, title, href) => ({
  id,
  meta: { title, slug, collection: 'posts', status: 'draft' },
  blocks: [{ type: 'paragraph', children: [
    { type: 'text', value: 'Try it: ' },
    { type: 'link', attrs: { href }, children: [{ type: 'text', value: 'Plasma' }] },
  ] }],
});

const CONNECTED = { isRepo: true, branch: 'main', hasRemote: true, hasUpstream: true };

describe('program routes', () => {
  let root, env, app, site, id, source;
  const commits = [];
  const pushes = [];
  // Looked up on each use (startApp's git Proxy), so a test can swap one.
  const fakeGit = {
    cloneRepo: async () => {},
    changedFiles: async () => [],
    pullFastForward: async () => ({}),
    gitStatus: async () => CONNECTED,
    commitPaths: async (dir, paths, message) => { commits.push({ paths, message }); return 'abc123'; },
    push: async (dir) => { pushes.push(dir); return { pushed: true, rebased: false }; },
  };
  const defaults = { ...fakeGit };

  async function api(path, { method = 'GET', body } = {}) {
    const opts = { method };
    if (body !== undefined) {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`${app.url}/api/sites/${id}${path}`, opts);
    const text = await res.text();
    let data = text;
    try { data = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, data };
  }
  const config = () => JSON.parse(readFileSync(join(site, 'config', 'programs.json'), 'utf8'));
  const lastCommit = () => commits[commits.length - 1];

  before(async () => {
    root = mkdtempSync(join(tmpdir(), 'vp-program-routes-'));
    env = { VP_CONFIG_DIR: join(root, 'config') };
    site = makeSite(root, 'site');
    put(site, 'src/about.html', '<h1>About</h1>');
    // A stale stage from an earlier run: cleared when the site opens.
    put(site, '.vp/tmp/0123456789abcdef/index.html', 'old');
    source = join(root, 'plasma-src');
    put(source, 'index.html', '<!doctype html><title>Plasma</title><script src="js/plasma.js"></script>');
    put(source, 'js/plasma.js', 'console.log(1)');
    put(source, '.notes', 'skipped');
    app = await startApp({ port: 0, env, git: fakeGit });
    const res = await fetch(`${app.url}/api/sites`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: site, name: 'Site' }),
    });
    id = (await res.json()).id;
  });
  after(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });
  beforeEach(() => Object.assign(fakeGit, defaults));

  it('GET with no programs.json: no areas, the run base and the limits; stale stages are cleared on open', async () => {
    const res = await api('/programs');
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.deepEqual(res.data, { areas: [], programs: [], runBase: `${app.programsUrl}/${id}`, limits: LIMITS });
    assert.equal(existsSync(join(site, '.vp', 'tmp', '0123456789abcdef')), false);
  });

  it('POST /programs/areas adds an area, commits it as Programs: and pushes', async () => {
    const before = pushes.length;
    const res = await api('/programs/areas', { method: 'POST', body: { path: 'programs', title: 'Programs', sandbox: false } });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.equal(res.data.committed, true);
    assert.deepEqual(res.data.area, { path: 'programs', title: 'Programs', sandbox: false, count: 0 });
    assert.deepEqual(config(), { areas: [{ path: 'programs', title: 'Programs', sandbox: false }], programs: [] });
    assert.equal(lastCommit().message, 'Programs: add area programs');
    assert.ok(lastCommit().paths.includes('config/programs.json'));
    assert.ok(lastCommit().paths.includes('src/programs')); // R6: every configured area folder
    assert.equal(pushes.length, before + 1);
  });

  it('POST /programs/areas refuses a taken, reserved or colliding path', async () => {
    const n = commits.length;
    const dup = await api('/programs/areas', { method: 'POST', body: { path: 'programs', title: 'Again' } });
    assert.equal(dup.status, 409);
    assert.match(dup.data.error, /already an area/);
    const reserved = await api('/programs/areas', { method: 'POST', body: { path: 'media', title: 'M' } });
    assert.equal(reserved.status, 422);
    assert.match(reserved.data.error, /reserved/);
    const page = await api('/programs/areas', { method: 'POST', body: { path: 'about', title: 'A' } });
    assert.equal(page.status, 422);
    assert.match(page.data.error, /already a page on this site \(src\/about\.html\)/);
    const areas = await api('/programs/areas', { method: 'POST', body: { path: 'areas', title: 'Areas' } });
    assert.equal(areas.status, 422); // R7: /programs/areas/<x> is the area route
    assert.match(areas.data.error, /"areas" is reserved/);
    const bad = await api('/programs/areas', { method: 'POST', body: { path: 'Bad Name', title: 'A' } });
    assert.equal(bad.status, 422);
    assert.equal(commits.length, n);
    assert.equal(config().areas.length, 1);
  });

  it('POST /programs adds from a folder: installed, unlisted, source kept, committed and pushed', async () => {
    const before = pushes.length;
    const res = await api('/programs', { method: 'POST', body: { area: 'programs', source, slug: 'plasma' } });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.deepEqual(tree(join(site, 'src', 'programs', 'plasma')), ['index.html', 'js/plasma.js']);
    assert.deepEqual(res.data.skipped, ['.notes']);
    assert.equal(res.data.large, false);
    assert.equal(res.data.committed, true);
    assert.equal(res.data.note, undefined);
    assert.equal(res.data.program.slug, 'plasma');
    assert.equal(res.data.program.listed, false);
    assert.equal(res.data.program.source, source);
    const card = config().programs[0];
    assert.equal(card.listed, false);
    assert.deepEqual([card.area, card.slug, card.title], ['programs', 'plasma', 'Plasma']);
    assert.equal(lastCommit().message, 'Programs: add plasma');
    assert.doesNotMatch(lastCommit().message, /CI Skip/i);
    assert.ok(lastCommit().paths.includes('config/programs.json'));
    assert.ok(lastCommit().paths.includes('src/programs'));
    assert.equal(pushes.length, before + 1);
    assert.deepEqual(readdirSync(join(site, '.vp', 'tmp')), []); // the stage was renamed into place

    const state = await api('/programs');
    const p = state.data.programs.find((x) => x.slug === 'plasma');
    assert.equal(p.source, source);
    assert.equal(p.status, 'ok');
    assert.equal(p.url, '/programs/plasma/');
  });

  it('POST /programs with a taken slug is 409 and changes nothing', async () => {
    const n = commits.length;
    const cfg = readFileSync(join(site, 'config', 'programs.json'), 'utf8');
    const files = tree(join(site, 'src'));
    const res = await api('/programs', { method: 'POST', body: { area: 'programs', source, slug: 'plasma' } });
    assert.equal(res.status, 409);
    assert.match(res.data.error, /plasma/);
    assert.equal(readFileSync(join(site, 'config', 'programs.json'), 'utf8'), cfg);
    assert.deepEqual(tree(join(site, 'src')), files);
    assert.equal(commits.length, n);
    assert.deepEqual(readdirSync(join(site, '.vp', 'tmp')), []);
  });

  it('POST /programs refuses a bad slug, an unknown area and a refused folder with nothing copied', async () => {
    assert.equal((await api('/programs', { method: 'POST', body: { area: 'programs', source, slug: 'Bad Slug' } })).status, 422);
    assert.equal((await api('/programs', { method: 'POST', body: { area: 'nope', source, slug: 'x' } })).status, 404);
    const noIndex = join(root, 'no-index');
    put(noIndex, 'main.js', '1');
    const res = await api('/programs', { method: 'POST', body: { area: 'programs', source: noIndex, slug: 'no-index' } });
    assert.equal(res.status, 422);
    assert.match(res.data.error, /no index\.html/);
    assert.equal(existsSync(join(site, 'src', 'programs', 'no-index')), false);
  });

  it('PATCH and DELETE of an area with programs are 409', async () => {
    const n = commits.length;
    const move = await api('/programs/areas/programs', { method: 'PATCH', body: { path: 'demos' } });
    assert.equal(move.status, 409);
    assert.match(move.data.error, /empty/);
    const del = await api('/programs/areas/programs', { method: 'DELETE' });
    assert.equal(del.status, 409);
    assert.match(del.data.error, /empty/);
    assert.equal(commits.length, n);
    assert.equal(config().areas[0].path, 'programs');
  });

  it('PATCH an area: title and sandbox default', async () => {
    const res = await api('/programs/areas/programs', { method: 'PATCH', body: { title: 'Demos & toys', sandbox: true } });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.deepEqual(config().areas[0], { path: 'programs', title: 'Demos & toys', sandbox: true });
    assert.equal(lastCommit().message, 'Programs: edit area programs');
    assert.equal((await api('/programs/areas/programs', { method: 'PATCH', body: { sandbox: 'yes' } })).status, 422);
    assert.equal((await api('/programs/areas/nope', { method: 'PATCH', body: { title: 'X' } })).status, 404);
  });

  it('an empty area can change path and be deleted', async () => {
    assert.equal((await api('/programs/areas', { method: 'POST', body: { path: 'labs', title: 'Labs' } })).status, 201);
    const moved = await api('/programs/areas/labs', { method: 'PATCH', body: { path: 'lab' } });
    assert.equal(moved.status, 200, JSON.stringify(moved.data));
    assert.deepEqual(config().areas.map((a) => a.path), ['programs', 'lab']);
    assert.equal(lastCommit().message, 'Programs: move area labs to lab');
    assert.ok(lastCommit().paths.includes('src/programs') && lastCommit().paths.includes('src/lab'));
    assert.ok(lastCommit().paths.includes('src/labs')); // the old folder, in case it held tracked files
    const taken = await api('/programs/areas/lab', { method: 'PATCH', body: { path: 'programs' } });
    assert.equal(taken.status, 409);
    const reserved = await api('/programs/areas/lab', { method: 'PATCH', body: { path: 'areas' } });
    assert.equal(reserved.status, 422);
    assert.match(reserved.data.error, /"areas" is reserved/);
    const del = await api('/programs/areas/lab', { method: 'DELETE' });
    assert.equal(del.status, 200, JSON.stringify(del.data));
    assert.deepEqual(config().areas.map((a) => a.path), ['programs']);
    assert.equal(lastCommit().message, 'Programs: remove area lab');
  });

  it('PATCH a card: fields saved, sandbox override, errors are 422 with the list', async () => {
    const res = await api('/programs/programs/plasma', {
      method: 'PATCH', body: { title: 'Plasma!', description: 'Old-school.', tags: ['Demo'], listed: true, sandbox: false },
    });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.committed, true);
    assert.equal(res.data.program.title, 'Plasma!');
    const card = config().programs[0];
    assert.deepEqual([card.title, card.description, card.tags, card.listed, card.sandbox], ['Plasma!', 'Old-school.', ['Demo'], true, false]);
    assert.equal(lastCommit().message, 'Programs: edit plasma');
    assert.ok(lastCommit().paths.includes('src/programs'));

    // sandbox: null goes back to the area default; other fields stay.
    await api('/programs/programs/plasma', { method: 'PATCH', body: { sandbox: null } });
    assert.equal('sandbox' in config().programs[0], false);
    assert.equal(config().programs[0].title, 'Plasma!');

    const bad = await api('/programs/programs/plasma', { method: 'PATCH', body: { date: '2026-13-40', tags: 'x' } });
    assert.equal(bad.status, 422);
    assert.deepEqual(bad.data.errors, ['Date must be YYYY-MM-DD.', 'Tags must be a list of text.']);
    assert.equal(config().programs[0].title, 'Plasma!');
    assert.equal((await api('/programs/programs/nope', { method: 'PATCH', body: { title: 'X' } })).status, 404);
  });

  it('PATCH a stray folder creates its card; a folder without index.html cannot be listed', async () => {
    put(site, 'src/programs/stray/index.html', '<p>stray</p>');
    const res = await api('/programs/programs/stray', { method: 'PATCH', body: { title: 'Stray' } });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    const card = config().programs.find((p) => p.slug === 'stray');
    assert.deepEqual([card.title, card.listed], ['Stray', false]);
    assert.ok(lastCommit().paths.includes('src/programs'));

    put(site, 'src/programs/broken/main.js', '1');
    const listed = await api('/programs/programs/broken', { method: 'PATCH', body: { listed: true } });
    assert.equal(listed.status, 422);
    assert.match(listed.data.error, /index\.html/);
  });

  it('DELETE while a saved post links the program is 409 with usedIn', async () => {
    const post = linkPost('doc_plasma01', 'try-plasma', 'Try plasma', '/programs/plasma/');
    assert.equal((await api('/documents', { method: 'POST', body: post })).status, 201);
    const n = commits.length;
    const res = await api('/programs/programs/plasma', { method: 'DELETE' });
    assert.equal(res.status, 409);
    assert.match(res.data.error, /used/);
    assert.deepEqual(res.data.usedIn, [{ title: 'Try plasma', path: 'src/posts/try-plasma.html' }]);
    assert.ok(existsSync(join(site, 'src', 'programs', 'plasma', 'index.html')));
    assert.ok(config().programs.some((p) => p.slug === 'plasma'));
    assert.equal(commits.length, n);
    // R8: GET lists usedIn for every program.
    const state = await api('/programs');
    assert.deepEqual(state.data.programs.find((p) => p.slug === 'plasma').usedIn, [{ title: 'Try plasma', path: 'src/posts/try-plasma.html' }]);
    assert.deepEqual(state.data.programs.find((p) => p.slug === 'stray').usedIn, []);
    assert.equal((await api('/documents/doc_plasma01', { method: 'DELETE' })).status, 200);
  });

  it('DELETE while a saved post has a featured image inside the program is 409', async () => {
    const doc = { ...linkPost('doc_plasma02', 'about-plasma', 'About plasma', '/elsewhere/'),
      meta: { title: 'About plasma', slug: 'about-plasma', collection: 'posts', status: 'draft', image: '/programs/plasma/shot.png' } };
    assert.equal((await api('/documents', { method: 'POST', body: doc })).status, 201);
    try {
      const res = await api('/programs/programs/plasma', { method: 'DELETE' });
      assert.equal(res.status, 409, JSON.stringify(res.data));
      assert.deepEqual(res.data.usedIn, [{ title: 'About plasma', path: 'src/posts/about-plasma.html' }]);
    } finally {
      assert.equal((await api('/documents/doc_plasma02', { method: 'DELETE' })).status, 200);
    }
  });

  it('DELETE while a committed page links the program is 409 naming the page', async () => {
    Object.assign(fakeGit, {
      headCommit: async () => 'c1',
      headTree: async () => [
        { path: 'src/demos.html', oid: 'b1' },
        { path: 'src/programs/plasma/index.html', oid: 'b2' },
      ],
      readBlobs: async (dir, oids) => new Map(oids.map((oid) => [oid, oid === 'b1'
        ? '<a href="/programs/plasma">Plasma</a>'
        : '<script src="/programs/plasma/js/plasma.js"></script>'])),
    });
    try {
      const res = await api('/programs/programs/plasma', { method: 'DELETE' });
      assert.equal(res.status, 409, JSON.stringify(res.data));
      assert.deepEqual(res.data.usedIn, [{ title: 'src/demos.html', path: 'src/demos.html' }]);
    } finally {
      delete fakeGit.headCommit;
      delete fakeGit.headTree;
      delete fakeGit.readBlobs;
    }
  });

  it('DELETE when unused removes the folder, the card and the source, committed and pushed', async () => {
    const before = pushes.length;
    const res = await api('/programs/programs/plasma', { method: 'DELETE' });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.committed, true);
    assert.equal(existsSync(join(site, 'src', 'programs', 'plasma')), false);
    assert.equal(config().programs.some((p) => p.slug === 'plasma'), false);
    assert.equal(lastCommit().message, 'Programs: remove plasma');
    assert.ok(lastCommit().paths.includes('src/programs'));
    assert.equal(pushes.length, before + 1);
    // Added again from the same folder: no source left over from before.
    put(site, 'src/programs/plasma/index.html', 'by hand');
    const state = await api('/programs');
    assert.equal(state.data.programs.find((p) => p.slug === 'plasma').source, null);
    rmSync(join(site, 'src', 'programs', 'plasma'), { recursive: true });
    assert.equal((await api('/programs/programs/plasma', { method: 'DELETE' })).status, 404);
  });

  it('a site that is not a git repository: committed false with a note, files kept', async () => {
    fakeGit.gitStatus = async () => ({ isRepo: false, branch: null, hasRemote: false, hasUpstream: false });
    const n = commits.length;
    const res = await api('/programs', { method: 'POST', body: { area: 'programs', source, slug: 'plasma-two' } });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.equal(res.data.committed, false);
    assert.match(res.data.note, /not a git repository/);
    assert.ok(existsSync(join(site, 'src', 'programs', 'plasma-two', 'index.html')));
    assert.ok(config().programs.some((p) => p.slug === 'plasma-two'));
    assert.equal(commits.length, n);
  });

  it('a failed push: committed false with a note, files kept', async () => {
    fakeGit.push = async () => { throw new Error('remote rejected'); };
    const res = await api('/programs', { method: 'POST', body: { area: 'programs', source, slug: 'plasma-three' } });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.equal(res.data.committed, false);
    assert.match(res.data.note, /remote rejected/);
    assert.ok(existsSync(join(site, 'src', 'programs', 'plasma-three', 'index.html')));
  });

  it('a failed commit: committed false with a note, files kept', async () => {
    fakeGit.commitPaths = async () => { throw new Error('disk full'); };
    const res = await api('/programs/programs/plasma-three', { method: 'PATCH', body: { title: 'Three' } });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.committed, false);
    assert.match(res.data.note, /disk full/);
    assert.equal(config().programs.find((p) => p.slug === 'plasma-three').title, 'Three');
  });

  it('slug traversal: a card whose slug is not a slug is never listed, edited or removed', async () => {
    const cfg = config();
    cfg.programs.push({ area: 'programs', slug: 'x/../..', title: 'Evil', listed: false });
    writeFileSync(join(site, 'config', 'programs.json'), `${JSON.stringify(cfg, null, 2)}\n`);
    const files = tree(join(site, 'src'));
    const n = commits.length;
    const state = await api('/programs');
    assert.equal(state.data.programs.some((p) => p.slug === 'x/../..'), false);
    const del = await api('/programs/programs/x%2F..%2F..', { method: 'DELETE' });
    assert.equal(del.status, 404, JSON.stringify(del.data));
    const patch = await api('/programs/programs/x%2F..%2F..', { method: 'PATCH', body: { title: 'X' } });
    assert.equal(patch.status, 404);
    const dots = await api('/programs/programs/..', { method: 'DELETE' });
    assert.equal(dots.status, 404);
    const area = await api('/programs/%2E%2E/programs', { method: 'DELETE' });
    assert.equal(area.status, 404);
    assert.deepEqual(tree(join(site, 'src')), files);
    assert.equal(commits.length, n);
    writeFileSync(join(site, 'config', 'programs.json'), `${JSON.stringify({ ...cfg, programs: cfg.programs.filter((p) => p.slug !== 'x/../..') }, null, 2)}\n`);
  });

  it('POST /programs refuses a source folder that is the site, inside it, or holds it', async () => {
    for (const src of [site, join(site, 'src'), root]) {
      const res = await api('/programs', { method: 'POST', body: { area: 'programs', source: src, slug: 'overlap' } });
      assert.equal(res.status, 422, src);
      assert.match(res.data.error, /this site's own folder/, src);
    }
    assert.equal(existsSync(join(site, 'src', 'programs', 'overlap')), false);
  });

  it('a failed commit gives the pending drafts back to the backup', async () => {
    const draft = { ...linkPost('doc_pending1', 'pending-post', 'Pending post', '/nowhere/') };
    assert.equal((await api('/documents', { method: 'POST', body: draft })).status, 201);
    fakeGit.commitPaths = async () => { throw new Error('index.lock exists'); };
    const res = await api('/programs/programs/plasma-three', { method: 'PATCH', body: { title: 'Three again' } });
    assert.equal(res.data.committed, false);
    fakeGit.commitPaths = defaults.commitPaths;
    // The next backup commits the draft under its own title, not as anonymous "changes".
    await api('/backup', { method: 'POST' });
    assert.equal(lastCommit().message, 'Draft: Pending post [CI Skip]');
  });
});
