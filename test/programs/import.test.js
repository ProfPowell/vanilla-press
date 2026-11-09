import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync, readdirSync, chmodSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProgramError } from '../../src/programs/config.js';
import {
  LIMITS, scanFolder, stageFromFolder, stageFromUpload, installStaged, diffFolders, scanToken, clearTmp,
} from '../../src/programs/import.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'vp-import-'));
const put = (dir, rel, text = 'x') => {
  const f = join(dir, rel);
  mkdirSync(join(f, '..'), { recursive: true });
  writeFileSync(f, text);
};
// A folder that passes every rule, to add one offender to.
const good = (extra = {}) => {
  const dir = tmp();
  put(dir, 'index.html', '<h1>hi</h1>');
  for (const [k, v] of Object.entries(extra)) put(dir, k, v);
  return dir;
};
const refusal = async (promise, status, re, refused) => {
  await assert.rejects(promise, (e) => {
    assert.ok(e instanceof ProgramError, `expected ProgramError, got ${e}`);
    assert.equal(e.status, status);
    assert.match(e.message, re);
    if (refused !== undefined) assert.equal(e.body.refused, refused);
    return true;
  });
};
const caseInsensitive = (() => {
  const d = tmp();
  writeFileSync(join(d, 'a'), '1');
  const r = existsSync(join(d, 'A'));
  rmSync(d, { recursive: true });
  return r;
})();

test('LIMITS has the spec values', () => {
  assert.deepEqual(LIMITS, { totalBytes: 52_428_800, files: 2000, fileBytes: 26_214_400, largeBytes: 10_485_760 });
});

test('scanFolder lists regular files with sizes', async () => {
  const dir = good({ 'css/a.css': 'body{}', 'js/app.js': '1;' });
  const scan = await scanFolder(dir);
  assert.deepEqual(scan.files.map((f) => f.rel).sort(), ['css/a.css', 'index.html', 'js/app.js']);
  assert.equal(scan.files.find((f) => f.rel === 'css/a.css').size, 6);
  assert.equal(scan.total, 11 + 6 + 2);
  assert.deepEqual(scan.skipped, []);
  assert.equal(scan.large, false);
});

test('.git, node_modules and .DS_Store are skipped silently, at any depth', async () => {
  const dir = good({ '.git/config': 'x', 'node_modules/a/b.js': 'x', '.DS_Store': 'x', 'sub/.DS_Store': 'x', 'sub/node_modules/z.js': 'x', 'sub/.git/HEAD': 'x' });
  const scan = await scanFolder(dir);
  assert.deepEqual(scan.files.map((f) => f.rel), ['index.html']);
  assert.deepEqual(scan.skipped, []);
});

test('other dotfiles and dot-folders are skipped and listed, top-most once', async () => {
  const dir = good({ '.env': 'SECRET=1', '.cache/a/b.txt': 'x', '.cache/c.txt': 'x', 'sub/.npmrc': 'x', '.well-known/x': 'x' });
  const scan = await scanFolder(dir);
  assert.deepEqual(scan.files.map((f) => f.rel), ['index.html']);
  assert.deepEqual([...scan.skipped].sort(), ['.cache/', '.env', '.well-known/', 'sub/.npmrc']);
});

test('a symlinked dotfile is skipped and listed, not followed', async () => {
  const dir = good();
  symlinkSync('/etc/passwd', join(dir, '.link'));
  const scan = await scanFolder(dir);
  assert.deepEqual(scan.skipped, ['.link']);
});

test('symlinks are refused (file, folder, dangling, escaping)', async () => {
  for (const [name, target] of [['l.txt', '/etc/hosts'], ['d', tmpdir()], ['dangling', '/nonexistent/zzz'], ['up', '../x']]) {
    const dir = good();
    symlinkSync(target, join(dir, name));
    await refusal(scanFolder(dir), 422, /symlink/i, name);
  }
  const dir = good();
  mkdirSync(join(dir, 'sub'));
  symlinkSync('../index.html', join(dir, 'sub', 'ln'));
  await refusal(scanFolder(dir), 422, /symlink/i, 'sub/ln');
});

test('device and other non-regular files are refused', async (t) => {
  const dir = good();
  try { execFileSync('mkfifo', [join(dir, 'pipe')]); } catch { t.skip('mkfifo unavailable'); return; }
  await refusal(scanFolder(dir), 422, /regular file/i, 'pipe');
});

test('names with control characters are refused', async () => {
  for (const name of ['bad\nname.txt', 'tab\there.txt', 'nul\u0001.txt', 'del\u007f.txt']) {
    const dir = good();
    put(dir, name);
    await refusal(scanFolder(dir), 422, /control character/i);
  }
  const dir = good();
  put(dir, 'sub\nfolder/a.txt');
  await refusal(scanFolder(dir), 422, /control character/i);
});

test('names differing only by case are refused', { skip: caseInsensitive && 'case-insensitive filesystem' }, async () => {
  const dir = good({ 'A.txt': '1', 'a.txt': '2' });
  await refusal(scanFolder(dir), 422, /differ only by case/i);
  const dir2 = good({ 'Img/a.png': '1', 'img/b.png': '2' });
  await refusal(scanFolder(dir2), 422, /differ only by case/i);
});

test('a folder with no top-level index.html is refused', async () => {
  const dir = tmp();
  put(dir, 'sub/index.html');
  put(dir, 'other.html');
  await refusal(scanFolder(dir), 422, /index\.html/, 'index.html');
  const dir2 = tmp();
  mkdirSync(join(dir2, 'index.html'));
  put(dir2, 'index.html/x');
  await refusal(scanFolder(dir2), 422, /index\.html/);
});

test('likely secrets by name are refused, whole copy, file named', async () => {
  for (const name of ['server.pem', 'a/tls.key', 'cert.p12', 'id_rsa', 'id_rsa.pub', 'id_rsa_old', 'KEY.PEM']) {
    const dir = good();
    put(dir, name);
    await refusal(scanFolder(dir), 422, /private key/, name);
  }
});

test('the private key message is exact', async () => {
  const dir = good({ id_rsa: 'x' });
  await refusal(scanFolder(dir), 422, /^This folder has a private key \(id_rsa\)\. Programs go live in public, so nothing was copied\.$/, 'id_rsa');
});

test('files containing a PRIVATE KEY block are refused, whatever the name', async () => {
  for (const text of [
    '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
    'x\n-----BEGIN RSA PRIVATE KEY-----\r\nabc',
    '-----BEGIN OPENSSH PRIVATE KEY-----',
    '-----BEGIN ENCRYPTED PRIVATE KEY-----',
  ]) {
    const dir = good({ 'notes/readme.txt': text });
    await refusal(scanFolder(dir), 422, /private key/, 'notes/readme.txt');
  }
});

test('certificates and split markers are not private keys', async () => {
  const dir = good({ 'a.txt': '-----BEGIN CERTIFICATE-----\nabc', 'b.txt': '-----BEGIN\nPRIVATE KEY-----', 'c.txt': 'PRIVATE KEY----- -----BEGIN' });
  const scan = await scanFolder(dir);
  assert.equal(scan.files.length, 4);
});

test('the private-key content check reads only files within the per-file limit', async () => {
  const key = '-----BEGIN PRIVATE KEY-----';
  // within the limit: refused
  await refusal(scanFolder(good({ 'k.txt': key }), { limits: { ...LIMITS, fileBytes: 100 } }), 422, /private key/);
  // over the limit: refused for size, never read (the size message, not the key message)
  await refusal(scanFolder(good({ 'k.txt': key + 'x'.repeat(200) }), { limits: { ...LIMITS, fileBytes: 100 } }), 422, /too large/i, 'k.txt');
});

test('limits: files, total, per-file, each refused with 422', async () => {
  const small = { ...LIMITS, files: 3, totalBytes: 1000, fileBytes: 100 };
  await refusal(scanFolder(good({ a: '1', b: '1', c: '1' }), { limits: small }), 422, /too many files/i);
  await refusal(scanFolder(good({ 'a.bin': 'x'.repeat(90), 'b.bin': 'x'.repeat(90) }), { limits: { ...small, totalBytes: 150 } }), 422, /too large|over/i);
  await refusal(scanFolder(good({ 'a.bin': 'x'.repeat(101) }), { limits: small }), 422, /too large/i, 'a.bin');
  // exactly at the limits is fine
  const ok = await scanFolder(good({ a: '1', b: '1' }), { limits: small });
  assert.equal(ok.files.length, 3);
});

test('limits count only files that will be copied', async () => {
  const dir = good({ '.env': 'x'.repeat(500), 'node_modules/a.js': 'x'.repeat(500), '.cache/a': 'x'.repeat(500) });
  const scan = await scanFolder(dir, { limits: { ...LIMITS, files: 1, totalBytes: 50, fileBytes: 50 } });
  assert.equal(scan.files.length, 1);
});

test('large is true over the large threshold', async () => {
  const limits = { ...LIMITS, largeBytes: 30 };
  assert.equal((await scanFolder(good({ a: 'x'.repeat(5) }), { limits })).large, false);
  assert.equal((await scanFolder(good({ a: 'x'.repeat(50) }), { limits })).large, true);
});

test('scanToken is stable, order independent and sensitive to names and sizes', () => {
  const a = { files: [{ rel: 'a', size: 1 }, { rel: 'b', size: 2 }] };
  const b = { files: [{ rel: 'b', size: 2 }, { rel: 'a', size: 1 }] };
  assert.match(scanToken(a), /^[0-9a-f]{64}$/);
  assert.equal(scanToken(a), scanToken(b));
  assert.notEqual(scanToken(a), scanToken({ files: [{ rel: 'a', size: 1 }, { rel: 'b', size: 3 }] }));
  assert.notEqual(scanToken(a), scanToken({ files: [{ rel: 'a', size: 1 }, { rel: 'c', size: 2 }] }));
});

// ---- staging ----

const stageDirs = (site) => (existsSync(join(site, '.vp/tmp')) ? readdirSync(join(site, '.vp/tmp')) : []);

test('stageFromFolder copies byte for byte into .vp/tmp/<random>/ and leaves skipped files behind', async () => {
  const site = tmp();
  const bin = Buffer.from([0, 255, 1, 2, 254, 10, 13]);
  const src = good({ '.env': 'S', 'node_modules/x.js': 'x' });
  writeFileSync(join(src, 'data.bin'), bin);
  const { tmpDir, scan } = await stageFromFolder(site, src);
  assert.ok(tmpDir.startsWith(join(site, '.vp', 'tmp') + '/'));
  assert.deepEqual(readFileSync(join(tmpDir, 'data.bin')), bin);
  assert.equal(readFileSync(join(tmpDir, 'index.html'), 'utf8'), '<h1>hi</h1>');
  assert.deepEqual(readdirSync(tmpDir).sort(), ['data.bin', 'index.html']);
  assert.deepEqual(scan.skipped, ['.env']);
  assert.deepEqual(scan.files.map((f) => f.rel).sort(), ['data.bin', 'index.html']);
  assert.equal(scan.total, 11 + 7);
});

test('stageFromFolder: a missing or non-directory source is a 422 naming it', async () => {
  const site = tmp();
  const gone = join(tmp(), 'nope');
  await refusal(stageFromFolder(site, gone), 422, new RegExp(`^The source folder ${gone.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')} is gone or moved\\.$`));
  const f = join(tmp(), 'file.txt');
  writeFileSync(f, 'x');
  await refusal(stageFromFolder(site, f), 422, /is gone or moved/);
  assert.deepEqual(stageDirs(site), []);
});

test('stageFromFolder accepts a source that is itself a symlinked folder, but refuses symlinks inside', async () => {
  const site = tmp();
  const real = good();
  const holder = tmp();
  const link = join(holder, 'link');
  symlinkSync(real, link);
  const { tmpDir } = await stageFromFolder(site, link);
  assert.ok(existsSync(join(tmpDir, 'index.html')));
  symlinkSync('/etc/hosts', join(real, 'inner'));
  await refusal(stageFromFolder(site, link), 422, /symlink/i, 'inner');
});

test('stageFromFolder leaves no staged folder behind when it fails', async () => {
  const site = tmp();
  await refusal(stageFromFolder(site, good({ 'a.pem': 'x' })), 422, /private key/);
  await refusal(stageFromFolder(site, tmp()), 422, /index\.html/);
  assert.deepEqual(stageDirs(site), []);
});

test('stageFromFolder removes the half-copy if copying itself fails', async () => {
  const site = tmp();
  const src = good({ 'a.txt': '1' });
  const real = await scanFolder(src);
  assert.equal(real.files.length, 2);
  // An unreadable file makes the copy fail after the folder was created.
  chmodSync(join(src, 'a.txt'), 0o000);
  try {
    await assert.rejects(stageFromFolder(site, src));
  } finally {
    chmodSync(join(src, 'a.txt'), 0o644);
  }
  assert.deepEqual(stageDirs(site), []);
});

test('stageFromUpload strips a single common top folder', async () => {
  const site = tmp();
  const { tmpDir, scan } = await stageFromUpload(site, [
    { rel: 'plasma/index.html', data: Buffer.from('<p>') },
    { rel: 'plasma/js/app.js', data: Buffer.from('1') },
  ]);
  assert.deepEqual(scan.files.map((f) => f.rel).sort(), ['index.html', 'js/app.js']);
  assert.equal(readFileSync(join(tmpDir, 'js/app.js'), 'utf8'), '1');
});

test('stageFromUpload does not strip mixed tops or a top-level file', async () => {
  const site = tmp();
  const { scan } = await stageFromUpload(site, [
    { rel: 'index.html', data: Buffer.from('<p>') },
    { rel: 'js/app.js', data: Buffer.from('1') },
  ]);
  assert.deepEqual(scan.files.map((f) => f.rel).sort(), ['index.html', 'js/app.js']);
  await refusal(stageFromUpload(site, [
    { rel: 'a/index.html', data: Buffer.from('<p>') },
    { rel: 'b/x.js', data: Buffer.from('1') },
  ]), 422, /index\.html/);
  assert.deepEqual(stageDirs(site).length, 1);
});

test('stageFromUpload applies the folder rules and cleans up', async () => {
  const site = tmp();
  const f = (rel, text = 'x') => ({ rel, data: Buffer.from(text) });
  await refusal(stageFromUpload(site, [f('p/index.html'), f('p/id_rsa')]), 422, /private key \(id_rsa\)/, 'id_rsa');
  await refusal(stageFromUpload(site, [f('p/index.html'), f('p/k.txt', '-----BEGIN PRIVATE KEY-----')]), 422, /private key/);
  await refusal(stageFromUpload(site, [f('p/index.html'), f('p/bad\nname')]), 422, /control character/);
  assert.deepEqual(stageDirs(site), []);
  const { tmpDir, scan } = await stageFromUpload(site, [
    f('p/index.html'), f('p/.env'), f('p/.git/config'), f('p/node_modules/a.js'), f('p/.cache/a/b'), f('p/.cache/c'), f('p/s/.DS_Store'),
  ]);
  assert.deepEqual(scan.files.map((x) => x.rel), ['index.html']);
  assert.deepEqual(scan.skipped, ['.cache/', '.env']);
  assert.deepEqual(readdirSync(tmpDir), ['index.html']); // skipped files never reach the stage
});

test('stageFromUpload refuses paths that escape, duplicates and file/folder clashes', async () => {
  const site = tmp();
  const f = (rel) => ({ rel, data: Buffer.from('x') });
  for (const bad of ['../evil.txt', 'a/../../evil.txt', '/abs/evil.txt', 'a//b', 'a/./b', 'a\\b', '']) {
    await refusal(stageFromUpload(site, [f('index.html'), f(bad)]), 422, /path|escape|name/i);
  }
  await refusal(stageFromUpload(site, [f('index.html'), f('index.html')]), 422, /twice|duplicate|same/i);
  await refusal(stageFromUpload(site, [f('index.html'), f('A.txt'), f('a.txt')]), 422, /differ only by case/i);
  await refusal(stageFromUpload(site, [f('index.html'), f('a'), f('a/b')]), 422, /file and a folder|clash|both/i);
  assert.deepEqual(stageDirs(site), []);
  assert.ok(!existsSync(join(site, 'evil.txt')));
});

// ---- install ----

const siteWithStaged = async (files = { 'index.html': 'new' }) => {
  const site = tmp();
  const { tmpDir } = await stageFromUpload(site, Object.entries(files).map(([rel, t]) => ({ rel, data: Buffer.from(t) })));
  return { site, tmpDir };
};

test('installStaged puts the staged folder at src/<area>/<slug>/', async () => {
  const { site, tmpDir } = await siteWithStaged();
  await installStaged(site, tmpDir, 'demos', 'plasma');
  assert.equal(readFileSync(join(site, 'src/demos/plasma/index.html'), 'utf8'), 'new');
  assert.ok(!existsSync(tmpDir));
});

test('installStaged refuses an existing target with 409 and changes nothing', async () => {
  const { site, tmpDir } = await siteWithStaged();
  put(site, 'src/demos/plasma/index.html', 'old');
  await refusal(installStaged(site, tmpDir, 'demos', 'plasma'), 409, /^"plasma" already exists in \/demos\/\.$/);
  assert.equal(readFileSync(join(site, 'src/demos/plasma/index.html'), 'utf8'), 'old');
  assert.ok(existsSync(tmpDir));
});

test('installStaged refuses bad area or slug and a folder outside .vp/tmp', async () => {
  const { site, tmpDir } = await siteWithStaged();
  await refusal(installStaged(site, tmpDir, 'demos', '../x'), 422, /slug/i);
  await refusal(installStaged(site, tmpDir, '../demos', 'x'), 422, /area|slug/i);
  await refusal(installStaged(site, site, 'demos', 'x'), 422, /staged/i);
  assert.ok(!existsSync(join(site, 'src/demos')));
});

test('installStaged with replace swaps the folders and leaves nothing behind', async () => {
  const { site, tmpDir } = await siteWithStaged({ 'index.html': 'new', 'b.txt': 'b' });
  put(site, 'src/demos/plasma/index.html', 'old');
  put(site, 'src/demos/plasma/gone.txt', 'old');
  await installStaged(site, tmpDir, 'demos', 'plasma', { replace: true });
  assert.deepEqual(readdirSync(join(site, 'src/demos/plasma')).sort(), ['b.txt', 'index.html']);
  assert.equal(readFileSync(join(site, 'src/demos/plasma/index.html'), 'utf8'), 'new');
  assert.deepEqual(stageDirs(site), []);
});

test('installStaged with replace on a missing target just installs', async () => {
  const { site, tmpDir } = await siteWithStaged();
  await installStaged(site, tmpDir, 'demos', 'plasma', { replace: true });
  assert.equal(readFileSync(join(site, 'src/demos/plasma/index.html'), 'utf8'), 'new');
});

test('a failed replace leaves the old folder in place', { skip: process.getuid?.() === 0 && 'root ignores permissions' }, async () => {
  const { site, tmpDir } = await siteWithStaged();
  put(site, 'src/demos/plasma/index.html', 'old');
  chmodSync(join(site, 'src/demos'), 0o555);
  try {
    await assert.rejects(installStaged(site, tmpDir, 'demos', 'plasma', { replace: true }), (e) => e instanceof ProgramError);
  } finally {
    chmodSync(join(site, 'src/demos'), 0o755);
  }
  assert.equal(readFileSync(join(site, 'src/demos/plasma/index.html'), 'utf8'), 'old');
  assert.deepEqual(readdirSync(join(site, 'src/demos')), ['plasma']);
});

test('a replace that fails after the old folder moved puts it back', async () => {
  const { site, tmpDir } = await siteWithStaged();
  put(site, 'src/demos/plasma/index.html', 'old');
  rmSync(tmpDir, { recursive: true }); // the staged folder vanished: step 2 fails
  await assert.rejects(installStaged(site, tmpDir, 'demos', 'plasma', { replace: true }), (e) => e instanceof ProgramError);
  assert.equal(readFileSync(join(site, 'src/demos/plasma/index.html'), 'utf8'), 'old');
  assert.deepEqual(stageDirs(site), []);
});

// ---- diff and clear ----

test('diffFolders reports added, changed and removed, by size then bytes', async () => {
  const site = tmp();
  const cur = tmp();
  put(cur, 'index.html', 'same');
  put(cur, 'size.txt', 'abc');
  put(cur, 'bytes.txt', 'abc');
  put(cur, 'removed.txt', 'r');
  put(cur, 'sub/removed2.txt', 'r');
  put(cur, '.DS_Store', 'junk');
  const { tmpDir, scan } = await stageFromUpload(site, [
    { rel: 'index.html', data: Buffer.from('same') },
    { rel: 'size.txt', data: Buffer.from('abcd') },
    { rel: 'bytes.txt', data: Buffer.from('abd') },
    { rel: 'added.txt', data: Buffer.from('a') },
    { rel: 'sub/added2.txt', data: Buffer.from('a') },
  ]);
  const d = await diffFolders(cur, scan, tmpDir);
  assert.deepEqual(d, {
    added: ['added.txt', 'sub/added2.txt'],
    changed: ['bytes.txt', 'size.txt'],
    removed: ['removed.txt', 'sub/removed2.txt'],
  });
});

test('diffFolders on identical folders is empty', async () => {
  const site = tmp();
  const cur = good({ 'a.txt': 'a' });
  const { tmpDir, scan } = await stageFromFolder(site, cur);
  assert.deepEqual(await diffFolders(cur, scan, tmpDir), { added: [], changed: [], removed: [] });
});

test('clearTmp removes .vp/tmp and is fine when absent', async () => {
  const { site } = await siteWithStaged();
  assert.equal(stageDirs(site).length, 1);
  clearTmp(site);
  assert.ok(!existsSync(join(site, '.vp/tmp')));
  clearTmp(site);
  clearTmp(tmp());
});
