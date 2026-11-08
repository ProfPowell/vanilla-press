import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, rmSync, mkdtempSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { saveDocument } from '../../src/store/content.js';
import { resolveWorkspace, openWorkspaceDb } from '../../src/workspace/workspace.js';
import {
  readSetting, writeSetting, migrateVpTheme, ensureThemeSetting, themeState,
  saveCustomTheme, importCustomTheme, renameCustomTheme, deleteCustomTheme, ThemeError,
} from '../../src/app/site-theme.js';
import { makeGitSite, write, git } from './git-site-fixture.js';

const VB = 'src/assets/vendor/vanilla-breeze';
const T = { light: { '--color-primary': 'oklch(0.5 0.2 30)' }, dark: { '--color-primary': 'oklch(0.7 0.2 30)' } };

/** A site VB copy: modern built in, swiss and 8bit as theme files. */
function addVb(site) {
  write(site, `${VB}/vanilla-breeze.css`, '[data-theme~="modern"]{--x:1}\n');
  write(site, `${VB}/themes/swiss.css`, '[data-theme~="swiss"]{--x:1}\n');
  write(site, `${VB}/themes/8bit.css`, '[data-theme~="8bit"]{--x:1}\n');
}

const doc = (id, meta, n = 1) => ({
  id,
  meta: { title: id, slug: id, collection: 'posts', status: 'draft', ...meta },
  blocks: Array.from({ length: n }, (_, i) => ({ type: 'paragraph', children: [{ type: 'text', value: `Para ${i + 1}` }] })),
});

describe('site theme store', () => {
  let fx, site, ws, db;
  const read = (rel) => readFileSync(join(site, rel), 'utf8');
  const opts = () => ({ siteId: 's1', vpCdnDir: join(fx.root, 'no-vp-vb') });

  beforeEach(() => {
    fx = makeGitSite({ remote: false });
    site = fx.site;
    addVb(site);
    ws = resolveWorkspace({ site, env: {}, repoRoot: fx.root });
    db = openWorkspaceDb(ws);
  });
  afterEach(() => {
    db.close();
    rmSync(fx.root, { recursive: true, force: true });
  });

  it('migration copies the vp.json theme to theme.json and leaves vp.json byte-identical', () => {
    write(site, 'config/vp.json', '{ "theme": "swiss",  "x": 1 }\n');
    assert.equal(migrateVpTheme(ws), true);
    assert.equal(readSetting(ws).name, 'swiss');
    assert.equal(readSetting(ws).mode, 'auto');
    assert.equal(readSetting(ws).files.swiss, '/assets/vendor/vanilla-breeze/themes/swiss.css');
    assert.equal(read('config/vp.json'), '{ "theme": "swiss",  "x": 1 }\n');
    assert.match(read('config/theme.json'), /^\{\n {2}"name": "swiss",\n[\s\S]*\}\n$/);
  });

  it('migration skips default and an existing theme.json', () => {
    write(site, 'config/vp.json', '{ "theme": "default" }\n');
    assert.equal(migrateVpTheme(ws), false);
    assert.equal(existsSync(join(site, 'config/theme.json')), false);
    assert.equal(read('config/vp.json'), '{ "theme": "default" }\n'); // R1: Task 9's commit drops the key

    write(site, 'config/vp.json', '{ "theme": "swiss" }\n');
    write(site, 'config/theme.json', '{ "name": "8bit", "mode": "dark" }\n');
    assert.equal(migrateVpTheme(ws), false);
    assert.equal(read('config/theme.json'), '{ "name": "8bit", "mode": "dark" }\n');
    assert.equal(read('config/vp.json'), '{ "theme": "swiss" }\n');
  });

  it('migration leaves no vp.json, a broken vp.json and an unsafe theme alone', () => {
    assert.equal(migrateVpTheme(ws), false);
    assert.equal(existsSync(join(site, 'config/vp.json')), false);
    write(site, 'config/vp.json', '{not json');
    assert.equal(migrateVpTheme(ws), false);
    assert.equal(read('config/vp.json'), '{not json');
    write(site, 'config/vp.json', '{ "theme": "Retro!" }\n');
    assert.equal(migrateVpTheme(ws), false);
    assert.equal(existsSync(join(site, 'config/theme.json')), false);
  });

  it('readSetting is null without a file or with a broken one', () => {
    assert.equal(readSetting(ws), null);
    write(site, 'config/theme.json', '{oops');
    assert.equal(readSetting(ws), null);
  });

  it('writeSetting recomputes files and modes; ensureThemeSetting creates the default (R4)', () => {
    writeSetting(ws, {
      name: 'swiss', mode: 'light', files: { bogus: '/x.css' }, modes: { bogus: 'dark' },
      custom: [{ id: 'night', name: 'Night', base: 'default', only: 'dark' }],
    });
    const s = readSetting(ws);
    assert.equal(s.files.bogus, undefined);
    assert.equal(s.files.night, '/assets/themes/night.css');
    assert.equal(s.files['8bit'], '/assets/vendor/vanilla-breeze/themes/8bit.css');
    assert.equal(s.files.modern, undefined); // built into vanilla-breeze.css
    assert.deepEqual({ ...s.modes }, { night: 'dark' });
    assert.equal(s.vb, '/assets/vendor/vanilla-breeze/vanilla-breeze.css');

    rmSync(join(site, 'config/theme.json'));
    assert.equal(ensureThemeSetting(ws).name, 'default');
    assert.equal(readSetting(ws).mode, 'auto');
    writeSetting(ws, { ...readSetting(ws), name: 'swiss' });
    assert.equal(ensureThemeSetting(ws).name, 'swiss'); // kept
  });

  it('saveCustomTheme writes a scoped file and a custom entry with a unique id', () => {
    const t = saveCustomTheme(ws, { name: 'Retro Mine', base: '8bit', tokens: T }, opts());
    assert.equal(t.id, 'retro-mine');
    assert.equal(t.tier, 'custom');
    assert.equal(t.custom, true);
    assert.equal(t.href, '/sites/s1/site/assets/themes/retro-mine.css');
    assert.match(read('src/assets/themes/retro-mine.css'), /@layer bundle-theme/);
    assert.match(read('src/assets/themes/retro-mine.css'), /\[data-theme~="retro-mine"\]/);
    assert.deepEqual(readSetting(ws).custom, [{ id: 'retro-mine', name: 'Retro Mine', base: '8bit' }]);
    assert.equal(readSetting(ws).files['retro-mine'], '/assets/themes/retro-mine.css');
    assert.equal(readSetting(ws).name, 'default'); // R4
    assert.equal(saveCustomTheme(ws, { name: 'Retro Mine', base: '8bit', tokens: T }, opts()).id, 'retro-mine-2');
  });

  it('a custom id is unique against VB themes and the adjustments id', () => {
    assert.equal(saveCustomTheme(ws, { name: 'Swiss', base: 'default', tokens: T }, opts()).id, 'swiss-2');
    assert.equal(saveCustomTheme(ws, { name: 'Modern', base: 'default', tokens: T }, opts()).id, 'modern-2');
    assert.equal(saveCustomTheme(ws, { name: 'VP Site', base: 'default', tokens: T }, opts()).id, 'vp-site-2');
  });

  it('refuses bad input (400) and skips unsafe tokens, 422 when none is usable', () => {
    const status = (fn) => { try { fn(); } catch (e) { assert.ok(e instanceof ThemeError); return e.status; } return 0; };
    assert.equal(status(() => saveCustomTheme(ws, { name: '', base: '8bit', tokens: T }, opts())), 400);
    assert.equal(status(() => saveCustomTheme(ws, { name: 'X', base: 'Bad!', tokens: T }, opts())), 400);
    assert.equal(status(() => saveCustomTheme(ws, { name: 'X', base: '8bit', tokens: 'red' }, opts())), 400);
    assert.equal(status(() => saveCustomTheme(ws, { name: 'X', base: '8bit', tokens: { light: [] } }, opts())), 400);
    let err;
    try {
      saveCustomTheme(ws, { name: 'X', base: '8bit', tokens: { light: { '--A': 'red', '--b': 'red;}' } } }, opts());
    } catch (e) { err = e; }
    assert.equal(err.status, 422);
    assert.deepEqual(err.body.dropped, ['--A', '--b']);
    assert.equal(existsSync(join(site, 'src/assets/themes/x.css')), false);

    const t = saveCustomTheme(ws, { name: 'X', base: '8bit', tokens: { light: { '--ok': 'red', '--b': 'red;}' } } }, opts());
    const css = read(`src/assets/themes/${t.id}.css`);
    assert.match(css, /--ok: red;/);
    assert.doesNotMatch(css, /--b/);
  });

  it('a theme saved from a one-scheme base keeps its scheme (only), given or from the base entry', () => {
    const night = importCustomTheme(ws, { name: 'Night', css: ':root{--color-background: oklch(0.2 0 0)}' }, opts()).theme;
    const inherited = saveCustomTheme(ws, { name: 'Night Copy', base: night.id, tokens: T }, opts());
    assert.equal(inherited.only, 'dark');
    assert.deepEqual(readSetting(ws).custom.find((c) => c.id === inherited.id), { id: 'night-copy', name: 'Night Copy', base: 'night', only: 'dark' });
    assert.equal(readSetting(ws).modes['night-copy'], 'dark');
    assert.doesNotMatch(read('src/assets/themes/night-copy.css'), /data-mode/, 'one block, no dark variant');
    const given = saveCustomTheme(ws, { name: 'Day', base: '8bit', tokens: { light: T.light }, only: 'light' }, opts());
    assert.equal(given.only, 'light');
    assert.equal(saveCustomTheme(ws, { name: 'Both', base: '8bit', tokens: T }, opts()).only, undefined);
    const status = (fn) => { try { fn(); } catch (e) { return e.status; } return 0; };
    assert.equal(status(() => saveCustomTheme(ws, { name: 'X', base: '8bit', tokens: T, only: 'sepia' }, opts())), 400);
    assert.equal(status(() => saveCustomTheme(ws, { name: 'X', base: '8bit', tokens: T, only: 1 }, opts())), 400);
  });

  it('import marks a one-scheme theme and sets modes', () => {
    const { theme, dropped } = importCustomTheme(ws, { name: 'Night', css: ':root{--color-background: oklch(0.2 0 0)} body{color:red}' }, opts());
    assert.equal(theme.id, 'night');
    assert.equal(theme.only, 'dark');
    assert.deepEqual(dropped, ['body']);
    assert.equal(readSetting(ws).modes.night, 'dark');
    assert.deepEqual(readSetting(ws).custom, [{ id: 'night', name: 'Night', base: 'default', only: 'dark' }]);
  });

  it('import errors: 413 over the limit, 422 with dropped when nothing is usable, 400 without css', () => {
    const fail = (input) => { try { importCustomTheme(ws, input, opts()); } catch (e) { return e; } return null; };
    assert.equal(fail({ name: 'Big', css: `:root{--a:1}/*${'x'.repeat(300 * 1024)}*/` }).status, 413);
    const e = fail({ name: 'Empty', css: 'body{color:red}' });
    assert.equal(e.status, 422);
    assert.deepEqual(e.body.dropped, ['body']);
    assert.equal(fail({ name: 'None' }).status, 400);
    assert.equal(readSetting(ws), null); // nothing written on failure
  });

  it('rename keeps the id (R12)', () => {
    saveCustomTheme(ws, { name: 'Retro Mine', base: '8bit', tokens: T }, opts());
    const t = renameCustomTheme(ws, 'retro-mine', 'Arcade', opts());
    assert.equal(t.id, 'retro-mine');
    assert.equal(t.name, 'Arcade');
    assert.equal(readSetting(ws).custom[0].name, 'Arcade');
    assert.throws(() => renameCustomTheme(ws, 'nope', 'X', opts()), (e) => e.status === 404);
    assert.throws(() => renameCustomTheme(ws, 'retro-mine', '  ', opts()), (e) => e.status === 400);
  });

  it('delete is refused while the site or a post uses it, naming them', async () => {
    saveCustomTheme(ws, { name: 'Retro Mine', base: '8bit', tokens: T }, opts());
    writeSetting(ws, { ...readSetting(ws), name: 'retro-mine' });
    saveDocument(db, doc('doc_old', { title: 'Old Games', theme: 'retro-mine' }));
    await assert.rejects(deleteCustomTheme(ws, db, 'retro-mine'),
      (e) => e.status === 409 && e.body.usedBy.join() === 'the site theme,Old Games');
    assert.ok(existsSync(join(site, 'src/assets/themes/retro-mine.css')));

    writeSetting(ws, { ...readSetting(ws), name: 'default' });
    saveDocument(db, doc('doc_old', { title: 'Old Games' }));
    await deleteCustomTheme(ws, db, 'retro-mine');
    assert.equal(existsSync(join(site, 'src/assets/themes/retro-mine.css')), false);
    assert.deepEqual(readSetting(ws).custom, []);
    assert.equal(readSetting(ws).files['retro-mine'], undefined);
    await assert.rejects(deleteCustomTheme(ws, db, 'retro-mine'), (e) => e.status === 404);
    await assert.rejects(deleteCustomTheme(ws, db, 'swiss'), (e) => e.status === 404); // not a custom theme
  });

  it('delete is refused while committed HEAD uses it: the live theme.json or a live page', async () => {
    saveCustomTheme(ws, { name: 'Retro Mine', base: '8bit', tokens: T }, opts());
    // HEAD: theme.json naming it, and a page (not in the database) whose front matter uses it.
    writeSetting(ws, { ...readSetting(ws), name: 'retro-mine' });
    write(site, 'src/posts/live.html', '---\ntitle: "Live Post"\ntheme: retro-mine\nthemeScope: "page"\n---\n<p>x</p>\n');
    write(site, 'src/posts/other.html', '---\ntitle: "Other"\ntheme: "retro-mine-2"\n---\n<p>x</p>\n');
    git(site, 'add', '-A');
    git(site, 'commit', '-m', 'live');
    // The working tree has moved on: the site theme is default again and the page is gone.
    writeSetting(ws, { ...readSetting(ws), name: 'default' });
    rmSync(join(site, 'src/posts/live.html'));
    await assert.rejects(deleteCustomTheme(ws, db, 'retro-mine'),
      (e) => e.status === 409 && e.body.usedBy.join() === 'the site theme,Live Post');
    assert.ok(existsSync(join(site, 'src/assets/themes/retro-mine.css')));

    write(site, 'config/theme.json', JSON.stringify(readSetting(ws)));
    git(site, 'add', '-A');
    git(site, 'commit', '-m', 'not live any more');
    await deleteCustomTheme(ws, db, 'retro-mine');
    assert.equal(existsSync(join(site, 'src/assets/themes/retro-mine.css')), false);
  });

  it('delete fails closed (503) when git cannot be read', async () => {
    saveCustomTheme(ws, { name: 'Retro Mine', base: '8bit', tokens: T }, opts());
    const broken = { headCommit: async () => { throw new Error('git broke'); } };
    await assert.rejects(deleteCustomTheme(ws, db, 'retro-mine', { git: broken }),
      (e) => e.status === 503 && /git broke/.test(e.message));
    assert.ok(existsSync(join(site, 'src/assets/themes/retro-mine.css')));
    assert.equal(readSetting(ws).custom.length, 1);
  });

  it('a failed setting write leaves no orphan theme file, and the R4 default is one write', () => {
    mkdirSync(join(site, 'config/theme.json'), { recursive: true }); // renaming onto a folder fails
    assert.throws(() => saveCustomTheme(ws, { name: 'Orphan', base: '8bit', tokens: T }, opts()));
    assert.equal(existsSync(join(site, 'src/assets/themes/orphan.css')), false);
  });

  it('themeState lists custom themes, pages with their own theme, and a preview post', () => {
    saveCustomTheme(ws, { name: 'Retro Mine', base: '8bit', tokens: T }, opts());
    saveDocument(db, doc('doc_draft', { title: 'Newest draft', updated: '2026-11-07T00:00:00Z' }));
    saveDocument(db, doc('doc_old', { title: 'Old Games', status: 'published', published: '2026-01-01T00:00:00Z', theme: 'retro-mine', themeScope: 'article' }, 8));
    saveDocument(db, doc('doc_new', { title: 'New <b>', status: 'published', published: '2026-06-01T00:00:00Z' }, 8));
    const s = themeState(ws, db, opts());
    assert.equal(s.setting.name, 'default');
    assert.deepEqual(s.vb, { source: 'site', url: '/sites/s1/site/assets/vendor/vanilla-breeze/vanilla-breeze.css' });
    const ids = s.themes.map((t) => t.id);
    assert.ok(ids.includes('swiss') && ids.includes('modern') && ids.includes('retro-mine'));
    assert.deepEqual(s.themes.find((t) => t.id === 'retro-mine'),
      { id: 'retro-mine', name: 'Retro Mine', tier: 'custom', custom: true, href: '/sites/s1/site/assets/themes/retro-mine.css', base: '8bit' });
    assert.deepEqual(s.pages, [{ id: 'doc_old', title: 'Old Games', status: 'published', theme: 'retro-mine', themeScope: 'article' }]);
    assert.equal(s.preview.title, 'New <b>');
    assert.equal(s.preview.date, '2026-06-01T00:00:00Z');
    assert.equal((s.preview.html.match(/<p>/g) || []).length, 6);
    assert.match(s.preview.html, /^<article/);
  });

  it('themeState: a draft preview when nothing is published, null with no posts; VP VB without a site copy', () => {
    const empty = mkdtempSync(join(tmpdir(), 'vp-theme-nothing-'));
    try {
      assert.equal(themeState(ws, db, opts()).preview, null);
      saveDocument(db, doc('doc_d', { title: 'Draft one' }));
      assert.equal(themeState(ws, db, opts()).preview.title, 'Draft one');
      rmSync(join(site, VB), { recursive: true });
      const s = themeState(ws, db, { siteId: 's1', vpCdnDir: empty });
      assert.deepEqual(s.vb, { source: 'vp', url: null });
      assert.equal(s.setting, null);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
