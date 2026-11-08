import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyTheme, htmlThemeAttr, liveThemeIds } from '../../src/app/theme-apply.js';
import { BuildError } from '../../src/app/publish.js';
import { createBackup } from '../../src/app/site-git.js';
import { readSetting, saveCustomTheme, ensureThemeSetting, migrateVpTheme } from '../../src/app/site-theme.js';
import * as realGit from '../../src/git/git.js';
import { ensureInstalled, runBuild } from '../../src/app/site-process.js';
import { startApp } from '../../src/app/server.js';
import { resolveWorkspace, openWorkspaceDb } from '../../src/workspace/workspace.js';
import { makeGitSite, git, write, BUILD_OK, BUILD_FAIL, fakeClock } from './git-site-fixture.js';

const repoRoot = join(import.meta.dirname, '..', '..');
const VB = 'src/assets/vendor/vanilla-breeze';
const NO_VP_VB = { vpCdnDir: '/nonexistent-vp-vb' };
const ADJ = { hue: 25, headingFont: 'serif', bodyFont: null, corners: 'square', colors: null };

/** The brief's fake VB: classic built in, swiss and 8bit as theme files. */
function addVb(dir) {
  write(dir, `${VB}/vanilla-breeze.css`, '[data-theme~=classic]{}\n');
  write(dir, `${VB}/themes/swiss.css`, '[data-theme~="swiss"]{--x:1}\n');
  write(dir, `${VB}/themes/8bit.css`, '[data-theme~="8bit"]{--x:1}\n');
}

/** A build that vendors the fake VB into src/ (as `npm run vendor` does), then builds. */
const BUILD_VENDORS = `${BUILD_OK}
mkdirSync('${VB}/themes', { recursive: true });
writeFileSync('${VB}/vanilla-breeze.css', '[data-theme~=classic]{}\\n');
writeFileSync('${VB}/themes/swiss.css', '[data-theme~="swiss"]{--x:1}\\n');
`;

describe('applyTheme', () => {
  let fx, ws, db;
  const read = (rel) => readFileSync(join(fx.site, rel), 'utf8');
  const remoteShow = (path) => git(fx.remote, 'show', `main:${path}`);
  const lastRemote = () => git(fx.remote, 'log', '-1', '--format=%s', 'main');
  const deps = (extra = {}) => ({ ensureInstalled, runBuild, ...realGit, ...extra });
  const apply = (body, extra) => applyTheme({ ws, db, body, deps: deps(extra), options: NO_VP_VB });

  beforeEach(() => {
    fx = makeGitSite();
    addVb(fx.site);
    write(fx.site, '.gitignore', '.vp/\ndist/\nnode_modules/\nsrc/assets/vendor/\n'); // VB is vendored (R5)
    git(fx.site, 'add', '-A');
    git(fx.site, 'commit', '-m', 'ignore vendor');
    git(fx.site, 'push');
    ws = resolveWorkspace({ site: fx.site, env: {}, repoRoot });
    db = openWorkspaceDb(ws);
  });
  afterEach(() => {
    db.close();
    rmSync(fx.root, { recursive: true, force: true });
  });

  it('applies a theme: files written, committed and pushed', async () => {
    const r = await apply({ name: 'swiss', mode: 'dark', adjustments: ADJ });
    assert.equal(r.status, 'pushed');
    const s = JSON.parse(remoteShow('config/theme.json'));
    assert.equal(s.name, 'swiss');
    assert.equal(s.mode, 'dark');
    assert.equal(s.adjust, 'vp-site');
    assert.equal(s.files.swiss, '/assets/vendor/vanilla-breeze/themes/swiss.css');
    assert.equal(s.files['vp-site'], '/assets/themes/vp-site.css');
    assert.equal(s.vb, '/assets/vendor/vanilla-breeze/vanilla-breeze.css');
    assert.equal(s.adjustments.hue, 25);
    assert.match(remoteShow('src/assets/themes/vp-site.css'), /--hue-primary: 25/);
    assert.equal(lastRemote(), 'Theme: swiss');
    assert.equal(r.ids, 'swiss vp-site');
    assert.equal(r.url, 'https://example.com/');
    assert.equal(r.sha, git(fx.site, 'rev-parse', 'HEAD'));
  });

  it('no adjustments: no adjust key and vp-site.css removed', async () => {
    await apply({ name: 'swiss', mode: 'auto', adjustments: ADJ });
    const r = await apply({ name: '8bit', mode: 'auto', adjustments: { hue: null, headingFont: null, bodyFont: null, corners: 'theme', colors: null } });
    assert.equal(r.ids, '8bit');
    const s = JSON.parse(remoteShow('config/theme.json'));
    assert.equal(s.name, '8bit');
    assert.equal('adjust' in s, false);
    assert.equal('adjustments' in s, false);
    assert.equal(s.files['vp-site'], undefined);
    assert.equal(existsSync(join(fx.site, 'src/assets/themes/vp-site.css')), false);
    assert.ok(!git(fx.remote, 'ls-tree', '-r', '--name-only', 'main').includes('src/assets/themes/vp-site.css'));
  });

  it('ids start with the theme name, including default', async () => {
    const r = await apply({ name: 'default', mode: 'light', adjustments: ADJ });
    assert.equal(r.ids, 'default vp-site');
  });

  it('a failed build restores the previous files and throws BuildError', async () => {
    await apply({ name: 'swiss', mode: 'auto', adjustments: ADJ });
    const theme = read('config/theme.json');
    const css = read('src/assets/themes/vp-site.css');
    const head = git(fx.site, 'rev-parse', 'HEAD');
    write(fx.site, 'build.js', BUILD_FAIL);
    await assert.rejects(apply({ name: '8bit', mode: 'dark', adjustments: null }),
      (e) => e instanceof BuildError && /boom/.test(e.log));
    assert.equal(read('config/theme.json'), theme);
    assert.equal(read('src/assets/themes/vp-site.css'), css);
    assert.equal(git(fx.site, 'rev-parse', 'HEAD'), head);
  });

  it('a failed first apply leaves no theme.json behind', async () => {
    write(fx.site, 'build.js', BUILD_FAIL);
    await assert.rejects(apply({ name: 'swiss', mode: 'auto', adjustments: ADJ }), BuildError);
    assert.equal(existsSync(join(fx.site, 'config/theme.json')), false);
    assert.equal(existsSync(join(fx.site, 'src/assets/themes/vp-site.css')), false);
  });

  it('fresh clone without a vendored VB: one build vendors it, then applies (R5)', async () => {
    rmSync(join(fx.site, 'src/assets/vendor'), { recursive: true });
    write(fx.site, 'build.js', BUILD_VENDORS);
    git(fx.site, 'commit', '-am', 'vendoring build');
    let builds = 0;
    const r = await apply({ name: 'swiss', mode: 'auto', adjustments: null }, {
      runBuild: async (dir) => { builds++; return runBuild(dir); },
    });
    assert.equal(r.status, 'pushed');
    assert.equal(builds, 2); // the vendoring build, then the check of the applied theme
    const s = JSON.parse(remoteShow('config/theme.json'));
    assert.equal(s.files.swiss, '/assets/vendor/vanilla-breeze/themes/swiss.css');
    assert.equal(s.vb, '/assets/vendor/vanilla-breeze/vanilla-breeze.css');
  });

  it('still no VB and a VB file theme is needed: 422 with the R5 text', async () => {
    rmSync(join(fx.site, 'src/assets/vendor'), { recursive: true });
    await assert.rejects(apply({ name: 'swiss', mode: 'auto', adjustments: null }),
      (e) => e.status === 422 && /no copy of Vanilla Breeze under src\//.test(e.message)
        && e.message === 'This site has no copy of Vanilla Breeze under src/, so only themes built into Vanilla Breeze can be applied.');
    assert.equal(existsSync(join(fx.site, 'config/theme.json')), false);
  });

  it('a built-in theme applies without a VB copy', async () => {
    rmSync(join(fx.site, 'src/assets/vendor'), { recursive: true });
    const r = await apply({ name: 'classic', mode: 'auto', adjustments: null });
    assert.equal(r.status, 'pushed');
    const s = JSON.parse(remoteShow('config/theme.json'));
    assert.equal(s.name, 'classic');
    assert.deepEqual(s.files, {});
    assert.equal('vb' in s, false);
  });

  it('refuses an unknown theme, a bad mode and an unsafe color (400)', async () => {
    const is400 = (e) => e.status === 400;
    await assert.rejects(apply({ name: 'nope', mode: 'auto', adjustments: null }), is400);
    await assert.rejects(apply({ name: 'Swiss!', mode: 'auto', adjustments: null }), is400);
    await assert.rejects(apply({ name: 'swiss', mode: 'sepia', adjustments: null }), is400);
    await assert.rejects(apply({ name: 'swiss', mode: 'auto', adjustments: { ...ADJ, colors: { light: { '--color-primary': 'red;}' }, dark: {} } } }), is400);
    await assert.rejects(apply({ name: 'swiss', mode: 'auto', adjustments: { ...ADJ, colors: { light: { 'color': 'red' } } } }), is400);
    await assert.rejects(apply({ name: 'swiss', mode: 'auto', adjustments: { ...ADJ, hue: 'red' } }), is400);
    await assert.rejects(apply({ name: 'swiss', mode: 'auto', adjustments: { ...ADJ, corners: 'blobby' } }), is400);
    await assert.rejects(apply({ name: 'swiss', mode: 'auto', adjustments: [] }), is400);
    assert.equal(existsSync(join(fx.site, 'config/theme.json')), false);
  });

  it('a custom theme applies; one whose CSS file is missing is refused (422)', async () => {
    const theme = saveCustomTheme(ws, { name: 'Retro Mine', base: 'swiss', tokens: { light: { '--color-primary': 'oklch(0.5 0.2 30)' } } });
    const r = await apply({ name: theme.id, mode: 'auto', adjustments: null });
    assert.equal(r.ids, 'retro-mine');
    assert.match(remoteShow('src/assets/themes/retro-mine.css'), /retro-mine/);
    const before = read('config/theme.json');
    rmSync(join(fx.site, 'src/assets/themes/retro-mine.css'));
    await assert.rejects(apply({ name: 'retro-mine', mode: 'dark', adjustments: null }),
      (e) => e.status === 422 && /Retro Mine/.test(e.message) && /src\/assets\/themes\/retro-mine\.css/.test(e.message));
    assert.equal(read('config/theme.json'), before);
  });

  it('the first commit of theme.json drops the vp.json theme key; vp.json is left alone after that', async () => {
    write(fx.site, 'config/vp.json', JSON.stringify({ theme: 'swiss', other: 1 }, null, 2) + '\n');
    git(fx.site, 'add', 'config/vp.json');
    git(fx.site, 'commit', '-m', 'legacy vp.json');
    assert.equal(migrateVpTheme(ws), true);
    await apply({ name: '8bit', mode: 'auto', adjustments: null });
    assert.deepEqual(JSON.parse(remoteShow('config/vp.json')), { other: 1 });
    const files = git(fx.remote, 'show', '--name-only', '--format=', 'main').split('\n');
    assert.ok(files.includes('config/vp.json') && files.includes('config/theme.json'), files.join(' '));
    // A hand-written theme key after that is not VP's to remove.
    write(fx.site, 'config/vp.json', JSON.stringify({ theme: 'x', other: 1 }, null, 2) + '\n');
    await apply({ name: 'swiss', mode: 'auto', adjustments: null });
    assert.equal(JSON.parse(read('config/vp.json')).theme, 'x');
  });

  it('a failed commit puts vp.json back (M2)', async () => {
    const legacy = JSON.stringify({ theme: 'swiss', other: 1 }, null, 2) + '\n';
    write(fx.site, 'config/vp.json', legacy);
    git(fx.site, 'add', 'config/vp.json');
    git(fx.site, 'commit', '-m', 'legacy vp.json');
    const failing = async () => { throw new realGit.GitError('git commit failed: disk full', 'disk full'); };
    await assert.rejects(apply({ name: '8bit', mode: 'auto', adjustments: null }, { commitPaths: failing }), /disk full/);
    assert.equal(read('config/vp.json'), legacy);
  });

  it('no remote: saved, not pushed', async () => {
    db.close();
    rmSync(fx.root, { recursive: true, force: true });
    fx = makeGitSite({ remote: false });
    addVb(fx.site);
    ws = resolveWorkspace({ site: fx.site, env: {}, repoRoot });
    db = openWorkspaceDb(ws);
    const r = await apply({ name: 'swiss', mode: 'auto', adjustments: null });
    assert.equal(r.status, 'saved');
    assert.equal(git(fx.site, 'log', '-1', '--format=%s'), 'Theme: swiss');
  });
});

describe('htmlThemeAttr', () => {
  it('reads the html element only', () => {
    assert.equal(htmlThemeAttr('<!doctype html><html lang="en" data-theme="swiss vp-site"><body><article data-theme="x">'), 'swiss vp-site');
    assert.equal(htmlThemeAttr("<html data-theme='8bit'>"), '8bit');
    assert.equal(htmlThemeAttr('<HTML data-theme=classic lang=en>'), 'classic');
    assert.equal(htmlThemeAttr('<html lang="en"><body data-theme="x">'), null);
    assert.equal(htmlThemeAttr('<html-x data-theme="y"><p>'), null);
    assert.equal(htmlThemeAttr('<html data-theme-source="site" lang="en">'), null);
    assert.equal(htmlThemeAttr(''), null);
  });
});

describe('a local unapplied theme.json yields to the remote one on pull', () => {
  let fx, b, wsB, dbB;
  const remoteShow = (path) => git(fx.remote, 'show', `main:${path}`);

  beforeEach(async () => {
    fx = makeGitSite();
    addVb(fx.site);
    // Machine A applies a theme: the remote has config/theme.json.
    const wsA = resolveWorkspace({ site: fx.site, env: {}, repoRoot });
    const dbA = openWorkspaceDb(wsA);
    b = fx.clone('b');
    addVb(b);
    write(b, 'node_modules/.keep', '');
    try {
      await applyTheme({ ws: wsA, db: dbA, body: { name: 'swiss', mode: 'dark', adjustments: null },
        deps: { ensureInstalled, runBuild, ...realGit }, options: NO_VP_VB });
    } finally {
      dbA.close();
    }
    wsB = resolveWorkspace({ site: b, env: {}, repoRoot });
    dbB = openWorkspaceDb(wsB);
    // Machine B (not pulled yet) opted in on its own: an untracked theme.json and a custom theme.
    ensureThemeSetting(wsB);
    saveCustomTheme(wsB, { name: 'Mine', base: 'default', tokens: { light: { '--color-primary': 'oklch(0.5 0.2 30)' } } });
  });
  afterEach(() => {
    dbB?.close();
    rmSync(fx.root, { recursive: true, force: true });
  });

  it('plain git refuses the rebase (the case this guards)', async () => {
    write(b, 'content/b.json', '{}\n');
    git(b, 'add', 'content');
    git(b, 'commit', '-m', 'b');
    await assert.rejects(realGit.push(b), /untracked working tree files would be overwritten/);
  });

  it('a backup push drops the local copy, rebases and pushes; the remote theme wins', async () => {
    const clock = fakeClock();
    let rebased = 0;
    const backup = createBackup({ ws: wsB, git: realGit, onRebased: () => { rebased++; }, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
    write(b, 'content/b.json', '{}\n');
    backup.noteSaved({ title: 'B', status: 'draft' });
    const state = await backup.flush();
    assert.equal(state.error, null);
    assert.equal(rebased, 1);
    assert.equal(git(b, 'rev-parse', 'HEAD'), git(fx.remote, 'rev-parse', 'main'));
    assert.deepEqual(JSON.parse(readFileSync(join(b, 'config/theme.json'), 'utf8')), JSON.parse(remoteShow('config/theme.json')));
    assert.equal(readSetting(wsB).name, 'swiss');
    assert.ok(existsSync(join(b, 'src/assets/themes/mine.css'))); // not on the remote: kept
  });

  it('a pull that fails for another reason puts the local copy back', async () => {
    const mine = readFileSync(join(b, 'config/theme.json'), 'utf8');
    // A tracked file B changed that the remote also changed: refused before anything is touched.
    write(fx.site, 'README.md', 'a\n');
    git(fx.site, 'add', 'README.md');
    git(fx.site, 'commit', '-m', 'a readme');
    git(fx.site, 'push');
    write(b, 'README.md', 'b\n');
    git(b, 'add', 'README.md');
    git(b, 'commit', '-m', 'b readme');
    await assert.rejects(realGit.push(b, { yieldUntracked: ['config/theme.json', 'src/assets/themes'] }), realGit.GitConflictError);
    assert.equal(readFileSync(join(b, 'config/theme.json'), 'utf8'), mine);
  });

  it('pull on open drops the local copy and fast-forwards', async () => {
    dbB.close();
    dbB = null;
    const env = { VP_CONFIG_DIR: join(fx.root, 'vp-config') };
    const app = await startApp({ port: 0, env, previews: { start() {}, stop: async () => {}, stopAll: async () => {} } });
    try {
      const added = await (await fetch(`${app.url}/api/sites`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: b }),
      })).json();
      const res = await fetch(`${app.url}/api/sites/${added.id}/theme`);
      assert.equal(res.status, 200);
      const state = await res.json();
      assert.equal(state.setting.name, 'swiss');
      assert.equal(git(b, 'rev-parse', 'HEAD'), git(fx.remote, 'rev-parse', 'main'));
    } finally {
      await app.close();
    }
  });
});

describe('liveThemeIds', () => {
  const setting = { name: 'swiss', adjust: 'vp-site' };
  const article = '---\ntheme: 8bit\nthemeScope: article\n---\n<h1>Home</h1>\n';
  it('article scope: the site ids when the live page has an <article> or <main>, else the page theme (Cook\'s fallback)', () => {
    assert.equal(liveThemeIds(setting, article, '<html><body><main class="x">'), 'swiss vp-site');
    assert.equal(liveThemeIds(setting, article, '<html><body><ARTICLE>'), 'swiss vp-site');
    assert.equal(liveThemeIds(setting, article, '<html><body><h1>Home</h1><mainly>'), '8bit');
    assert.equal(liveThemeIds(setting, article, '<html><body><!-- <article> --><script>"<main>"</script>'), '8bit');
    assert.equal(liveThemeIds(setting, article), 'swiss vp-site'); // no live page to look at
    assert.equal(liveThemeIds(setting, '---\ntheme: 8bit\n---\n', '<main>'), '8bit');
    assert.equal(liveThemeIds(null, article, ''), '');
  });
});

describe('theme routes: apply and live', () => {
  let fx, app, id, pages;
  async function api(path, { method = 'GET', body } = {}) {
    const opts = { method };
    if (body !== undefined) {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`${app.url}/api/sites/${id}${path}`, opts);
    return { status: res.status, data: await res.json() };
  }
  beforeEach(async () => {
    fx = makeGitSite();
    addVb(fx.site);
    pages = new Map();
    const fakeFetch = async (url) => {
      const html = pages.get(String(url));
      return html == null ? new Response('no', { status: 404 }) : new Response(html, { status: 200 });
    };
    app = await startApp({
      port: 0, env: { VP_CONFIG_DIR: join(fx.root, 'vp-config') },
      previews: { start() {}, stop: async () => {}, stopAll: async () => {} },
      fetch: fakeFetch,
    });
    const added = await (await fetch(`${app.url}/api/sites`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: fx.site }),
    })).json();
    id = added.id;
  });
  afterEach(async () => {
    await app.close();
    rmSync(fx.root, { recursive: true, force: true });
  });

  it('POST /theme/apply applies and GET /theme/live checks the home page', async () => {
    const r = await api('/theme/apply', { method: 'POST', body: { name: 'swiss', mode: 'auto', adjustments: ADJ } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.deepEqual(r.data, { status: 'pushed', url: 'https://example.com/', ids: 'swiss vp-site' });
    assert.deepEqual((await api('/theme/live')).data, { live: false, url: 'https://example.com/' });
    pages.set('https://example.com/', '<!doctype html><html lang="en" data-theme="default"><body>');
    assert.equal((await api('/theme/live')).data.live, false);
    pages.set('https://example.com/', '<!doctype html><html lang="en" data-theme="swiss  vp-site"><body>');
    assert.deepEqual((await api('/theme/live')).data, { live: true, url: 'https://example.com/' });
  });

  it('errors: 400 JSON for a bad request, 422 Build failed with the log', async () => {
    const bad = await api('/theme/apply', { method: 'POST', body: { name: '<b>x</b>', mode: 'auto' } });
    assert.equal(bad.status, 400);
    assert.equal(typeof bad.data.error, 'string');
    writeFileSync(join(fx.site, 'build.js'), BUILD_FAIL);
    const failed = await api('/theme/apply', { method: 'POST', body: { name: 'swiss', mode: 'auto', adjustments: null } });
    assert.equal(failed.status, 422);
    assert.equal(failed.data.error, 'Build failed');
    assert.match(failed.data.log, /boom/);
  });

  it('another computer applied meanwhile: GitHub\'s theme is kept, 409', async () => {
    assert.equal((await api('/theme')).status, 200); // opened (and pulled) before the other machine pushes
    const other = fx.clone('other');
    write(other, 'config/theme.json', '{"name":"8bit","mode":"auto","files":{}}\n');
    git(other, 'add', '-A');
    git(other, 'commit', '-m', 'other theme');
    git(other, 'push');
    const r = await api('/theme/apply', { method: 'POST', body: { name: 'swiss', mode: 'auto', adjustments: null } });
    assert.equal(r.status, 409, JSON.stringify(r.data));
    assert.deepEqual(r.data, { error: 'The theme was changed on another computer. Review it and apply again.' });
    assert.equal(JSON.parse(readFileSync(join(fx.site, 'config/theme.json'), 'utf8')).name, '8bit');
    assert.equal(git(fx.site, 'rev-parse', 'HEAD'), git(fx.remote, 'rev-parse', 'main'));
  });

  it('live reads the applied ids from theme.json each time (M3)', async () => {
    assert.equal((await api('/theme/apply', { method: 'POST', body: { name: 'swiss', mode: 'auto', adjustments: null } })).status, 200);
    pages.set('https://example.com/', '<html data-theme="8bit">');
    assert.equal((await api('/theme/live')).data.live, false);
    const file = join(fx.site, 'config/theme.json');
    writeFileSync(file, readFileSync(file, 'utf8').replace('"name": "swiss"', '"name": "8bit"')); // e.g. a pull brought another Apply
    assert.equal((await api('/theme/live')).data.live, true);
  });

  it('live expects the home page\'s own page theme when its committed front matter has one (M4)', async () => {
    assert.equal((await api('/theme/apply', { method: 'POST', body: { name: 'swiss', mode: 'auto', adjustments: ADJ } })).status, 200);
    write(fx.site, 'src/index.html', '---\ntitle: Home\ntheme: "8bit"\n---\n<h1>Home</h1>\n');
    git(fx.site, 'commit', '-am', 'home theme');
    pages.set('https://example.com/', '<html data-theme="swiss vp-site">');
    assert.equal((await api('/theme/live')).data.live, false);
    pages.set('https://example.com/', '<html data-theme="8bit">');
    assert.equal((await api('/theme/live')).data.live, true);
    // Article scope keeps the site ids on <html>.
    write(fx.site, 'src/index.html', "---\ntheme: 8bit\nthemeScope: 'article'\n---\n<h1>Home</h1>\n");
    git(fx.site, 'commit', '-am', 'home article theme');
    pages.set('https://example.com/', '<html data-theme="8bit"><body><main>');
    assert.equal((await api('/theme/live')).data.live, false);
    pages.set('https://example.com/', '<html data-theme="swiss vp-site"><body><main><article data-theme="8bit">');
    assert.equal((await api('/theme/live')).data.live, true);
    // No <article> or <main> on the page: Cook falls back to page scope (the page's own theme on <html>).
    pages.set('https://example.com/', '<html data-theme="swiss vp-site"><body><!-- <main> --><h1>Home</h1>');
    assert.equal((await api('/theme/live')).data.live, false);
    pages.set('https://example.com/', '<html data-theme="8bit"><body><h1>Home</h1>');
    assert.equal((await api('/theme/live')).data.live, true);
    // Only the committed page counts (what is deployed).
    write(fx.site, 'src/index.html', '---\ntheme: classic\n---\n<h1>Home</h1>\n');
    assert.equal((await api('/theme/live')).data.live, true);
  });

  it('live is false without a site URL or an applied theme', async () => {
    assert.deepEqual((await api('/theme/live')).data, { live: false, url: 'https://example.com/' });
    writeFileSync(join(fx.site, 'config/data.js'), 'export default {};\n');
    assert.deepEqual((await api('/theme/live')).data, { live: false, url: null });
  });
});

describe('library commits and theme changes from another computer', () => {
  let fx, app, clock, b;
  const ids = {};
  const T = { light: { '--color-primary': 'oklch(0.5 0.2 30)' } };
  async function api(site, path, { method = 'GET', body } = {}) {
    const opts = { method };
    if (body !== undefined) {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`${app.url}/api/sites/${ids[site]}${path}`, opts);
    return { status: res.status, data: await res.json() };
  }
  const porcelain = (dir) => git(dir, 'status', '--porcelain', '--', 'config/theme.json', 'src/assets/themes');
  const remoteSetting = () => JSON.parse(git(fx.remote, 'show', 'main:config/theme.json'));
  const localSetting = (dir) => JSON.parse(readFileSync(join(dir, 'config/theme.json'), 'utf8'));

  beforeEach(async () => {
    fx = makeGitSite();
    addVb(fx.site);
    b = fx.clone('b');
    addVb(b);
    write(b, 'node_modules/.keep', '');
    clock = fakeClock();
    app = await startApp({
      port: 0, env: { VP_CONFIG_DIR: join(fx.root, 'vp-config') },
      previews: { start() {}, stop: async () => {}, stopAll: async () => {} },
      backup: { now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer },
    });
    for (const [key, path] of [['a', fx.site], ['b', b]]) {
      const added = await (await fetch(`${app.url}/api/sites`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, name: key }),
      })).json();
      ids[key] = added.id;
      assert.equal((await api(key, '/theme')).status, 200); // open (and pull) now
    }
  });
  afterEach(async () => {
    await app.close();
    rmSync(fx.root, { recursive: true, force: true });
  });

  it('every library operation commits its files at once; the applied state is untouched', async () => {
    assert.equal((await api('a', '/theme/apply', { method: 'POST', body: { name: 'swiss', mode: 'dark', adjustments: ADJ } })).status, 200);
    const applied = localSetting(fx.site);
    const saved = await api('a', '/theme/custom', { method: 'POST', body: { name: 'Mine', base: 'default', tokens: T } });
    assert.equal(saved.status, 201, JSON.stringify(saved.data));
    assert.equal(saved.data.committed, true);
    assert.equal(porcelain(fx.site), '');
    assert.match(git(fx.site, 'log', '-1', '--format=%s'), /^Theme library: /);
    const s = localSetting(fx.site);
    for (const k of ['name', 'mode', 'adjust', 'adjustments']) assert.deepEqual(s[k], applied[k], k);
    assert.equal(s.files.swiss, applied.files.swiss);
    assert.equal(s.files['vp-site'], applied.files['vp-site']);
    const imported = await api('a', '/theme/import', { method: 'POST', body: { name: 'Imp', css: ':root { --color-primary: oklch(0.5 0.1 10); }' } });
    assert.equal(imported.status, 201, JSON.stringify(imported.data));
    assert.equal(porcelain(fx.site), '');
    assert.equal((await api('a', '/theme/custom/mine', { method: 'PATCH', body: { name: 'Mine 2' } })).data.committed, true);
    assert.equal(porcelain(fx.site), '');
    assert.equal((await api('a', '/theme/custom/mine', { method: 'DELETE' })).data.committed, true);
    assert.equal(porcelain(fx.site), '');
    assert.equal(git(fx.site, 'ls-files', 'src/assets/themes/mine.css'), '');
    // Pushed like a backup: after the pause (or a flush), not at once.
    assert.notEqual(git(fx.site, 'rev-parse', 'HEAD'), git(fx.remote, 'rev-parse', 'main'));
    assert.equal((await api('a', '/backup', { method: 'POST' })).data.error, null);
    assert.equal(git(fx.site, 'rev-parse', 'HEAD'), git(fx.remote, 'rev-parse', 'main'));
  });

  it('A saves a custom theme, B applies another theme: A\'s next backup and Apply both work', async () => {
    assert.equal((await api('a', '/theme/custom', { method: 'POST', body: { name: 'Mine', base: 'default', tokens: T } })).status, 201);
    const applied = await api('b', '/theme/apply', { method: 'POST', body: { name: 'swiss', mode: 'auto', adjustments: null } });
    assert.equal(applied.status, 200, JSON.stringify(applied.data));
    const flushed = await api('a', '/backup', { method: 'POST' });
    assert.equal(flushed.data.error, null);
    assert.equal(git(fx.site, 'rev-parse', 'HEAD'), git(fx.remote, 'rev-parse', 'main'));
    assert.equal(remoteSetting().name, 'swiss');
    assert.deepEqual(remoteSetting().custom.map((c) => c.id), ['mine']);
    assert.equal(porcelain(fx.site), '');
    const again = await api('a', '/theme/apply', { method: 'POST', body: { name: '8bit', mode: 'dark', adjustments: null } });
    assert.equal(again.status, 200, JSON.stringify(again.data));
    assert.equal(remoteSetting().name, '8bit');
    assert.deepEqual(remoteSetting().custom.map((c) => c.id), ['mine']);
  });

  it('two computers apply: GitHub\'s theme wins and the later Apply answers 409', async () => {
    assert.equal((await api('b', '/theme/apply', { method: 'POST', body: { name: 'swiss', mode: 'auto', adjustments: null } })).status, 200);
    const r = await api('a', '/theme/apply', { method: 'POST', body: { name: '8bit', mode: 'dark', adjustments: ADJ } });
    assert.equal(r.status, 409, JSON.stringify(r.data));
    assert.deepEqual(r.data, { error: 'The theme was changed on another computer. Review it and apply again.' });
    assert.equal(localSetting(fx.site).name, 'swiss');
    assert.equal(remoteSetting().name, 'swiss');
    assert.equal(git(fx.site, 'rev-parse', 'HEAD'), git(fx.remote, 'rev-parse', 'main'));
    assert.equal((await api('a', '/theme')).data.setting.name, 'swiss');
    // Applying again (reviewed) works.
    assert.equal((await api('a', '/theme/apply', { method: 'POST', body: { name: '8bit', mode: 'dark', adjustments: null } })).status, 200);
    assert.equal(remoteSetting().name, '8bit');
  });

  it('a library operation on a folder that is not a git repo keeps the files and says so', async () => {
    const plain = join(fx.root, 'plain');
    write(plain, 'package.json', '{"name":"p","type":"module","scripts":{"build":"node -e 0"},"devDependencies":{"cook-ssg":"^2.4.0"}}');
    write(plain, 'config/main.js', 'export default {};\n');
    write(plain, 'src/index.html', '<h1>x</h1>\n');
    const added = await (await fetch(`${app.url}/api/sites`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: plain }),
    })).json();
    assert.ok(added.id, JSON.stringify(added));
    ids.p = added.id;
    const saved = await api('p', '/theme/custom', { method: 'POST', body: { name: 'Mine', base: 'default', tokens: T } });
    assert.equal(saved.status, 201, JSON.stringify(saved.data));
    assert.equal(saved.data.committed, false);
    assert.match(saved.data.note, /not committed/);
    assert.ok(existsSync(join(plain, 'src/assets/themes/mine.css')));
  });
});
