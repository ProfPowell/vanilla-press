/**
 * Test fixture (not a test file): a temp Cook-shaped site that is a clone of a
 * temp bare remote, with a stand-in `build` script (no Cook needed) that turns
 * each `src/**\/*.html` page into `dist/<path>/index.html` with its front matter removed.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

export const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();

export function write(dir, rel, text) {
  mkdirSync(join(dir, rel, '..'), { recursive: true });
  writeFileSync(join(dir, rel), text);
}

function identify(dir) {
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'user.email', 'test@example.com');
}

export const BUILD_OK = `
import { readdirSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
rmSync('dist', { recursive: true, force: true });
function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (p.endsWith('.html')) {
      const out = join('dist', p.slice('src/'.length, -'.html'.length), 'index.html');
      mkdirSync(join(out, '..'), { recursive: true });
      writeFileSync(out, readFileSync(p, 'utf8').replace(/^---\\n[\\s\\S]*?\\n---\\n/, ''));
    }
  }
}
walk('src');
`;

export const BUILD_FAIL = `console.error('boom: layout post not found'); process.exit(1);\n`;

/**
 * @param {{ remote?: boolean }} [opts] - remote: false gives a repo with no remote
 * @returns {{ root: string, remote: string|null, site: string, clone: (name: string) => string }}
 */
export function makeGitSite({ remote: withRemote = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'vp-git-site-'));
  const remote = withRemote ? join(root, 'remote.git') : null;
  const site = join(root, 'site');
  if (remote) execFileSync('git', ['init', '--bare', '-b', 'main', remote], { stdio: 'ignore' });
  execFileSync('git', ['init', '-b', 'main', site], { stdio: 'ignore' });
  identify(site);
  write(site, 'package.json', JSON.stringify({
    name: 'site', type: 'module', private: true,
    scripts: { build: 'node build.js' },
    devDependencies: { 'cook-ssg': '^2.4.0' },
  }, null, 2));
  write(site, '.gitignore', '.vp/\ndist/\nnode_modules/\n');
  write(site, 'build.js', BUILD_OK);
  write(site, 'config/data.js', "export default { siteUrl: 'https://example.com' };\n");
  write(site, 'config/main.js', 'export default {};\n');
  write(site, 'src/index.html', '<h1>Home</h1>\n');
  mkdirSync(join(site, 'node_modules'), { recursive: true }); // ensureInstalled skips npm install
  git(site, 'add', '-A');
  git(site, 'commit', '-m', 'init');
  if (remote) {
    git(site, 'remote', 'add', 'origin', remote);
    git(site, 'push', '-u', 'origin', 'main');
  }
  const clone = (name) => {
    const dir = join(root, name);
    execFileSync('git', ['clone', '-b', 'main', remote, dir], { stdio: 'ignore' });
    identify(dir);
    return dir;
  };
  return { root, remote, site, clone };
}

/** A controllable clock: `advance(ms)` runs (and awaits) every timer that came due. */
export function fakeClock(start = Date.parse('2026-11-02T12:00:00Z')) {
  let t = start;
  let next = 0;
  const timers = new Map();
  return {
    now: () => t,
    setTimer: (fn, ms) => { const h = ++next; timers.set(h, { at: t + ms, fn }); return h; },
    clearTimer: (h) => { timers.delete(h); },
    pending: () => timers.size,
    async advance(ms) {
      const end = t + ms;
      for (;;) {
        const due = [...timers].filter(([, x]) => x.at <= end).sort((p, q) => p[1].at - q[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        t = due[1].at;
        await due[1].fn();
      }
      t = end;
    },
  };
}
