import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn as nodeSpawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createPreviews } from '../../src/app/preview.js';

let dir;
let previews;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'vp-prev-')); previews = createPreviews({}); });
afterEach(async () => { await previews.stopAll(); rmSync(dir, { recursive: true, force: true }); });

function site(dev) {
  mkdirSync(join(dir, 'node_modules'));
  writeFileSync(join(dir, 'server.js'),
    `const a=process.argv;const p=Number(a[a.indexOf('--port')+1]);
require('node:http').createServer((q,s)=>s.end('ok')).listen(p,'127.0.0.1');`);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0', scripts: { dev } }));
  return { id: 's1', path: dir };
}

async function refused(url) {
  try { await fetch(url); return false; } catch { return true; }
}

test('preview starts the dev server and reuses it', async () => {
  const s = site('node server.js');
  const { url } = await previews.start(s);
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal((await fetch(url)).status, 200);
  const again = await previews.start(s);
  assert.equal(again.url, url);
  await previews.stopAll();
  assert.equal(await refused(url), true);
});

test('stop(siteId) stops one site', async () => {
  const s = site('node server.js');
  const { url } = await previews.start(s);
  await previews.stop('s1');
  assert.equal(await refused(url), true);
});

test('preview reports a dev server that exits', async () => {
  const s = site(`node -e "process.exit(1)"`);
  const t0 = Date.now();
  await assert.rejects(previews.start(s), /Preview server did not start/);
  assert.ok(Date.now() - t0 < 20000);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = [];
  child.kill = (sig) => {
    child.killed.push(sig);
    setImmediate(() => { child.emit('exit', null, sig); child.emit('close', null, sig); });
  };
  return child;
}

test('concurrent starts share one spawn and resolve only once ready', async () => {
  mkdirSync(join(dir, 'node_modules'));
  writeFileSync(join(dir, 'server.js'),
    `const a=process.argv;const p=Number(a[a.indexOf('--port')+1]);
setTimeout(()=>require('node:http').createServer((q,s)=>s.end('ok')).listen(p,'127.0.0.1'),800);`);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { dev: 'node server.js' } }));
  const s = { id: 's1', path: dir };
  const calls = [];
  previews = createPreviews({ spawn: (...a) => { calls.push(a); return nodeSpawn(...a); } });
  const first = previews.start(s);
  await sleep(100);
  const second = previews.start(s);
  const check = async (r) => ({ r, status: (await fetch(r.url)).status });
  const [a, b] = await Promise.all([first.then(check), second.then(check)]);
  assert.equal(calls.length, 1);
  assert.equal(a.r.url, b.r.url);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
});

test('stopAll during the pre-spawn window leaves nothing running', async () => {
  const calls = [];
  previews = createPreviews({
    spawn: (...a) => { calls.push(a); return nodeSpawn(...a); },
    ensureInstalled: () => sleep(300),
  });
  const settled = previews.start({ id: 's1', path: dir }).then(() => 'resolved', (e) => e.message);
  await sleep(50);
  await previews.stopAll();
  assert.match(await settled, /Preview stopped/);
  assert.equal(calls.length, 0);
});

test('stop kills a grandchild that ignores SIGTERM', async () => {
  mkdirSync(join(dir, 'node_modules'));
  writeFileSync(join(dir, 'server.js'),
    `process.on('SIGTERM',()=>{});const a=process.argv;const p=Number(a[a.indexOf('--port')+1]);
require('node:http').createServer((q,s)=>s.end('ok')).listen(p,'127.0.0.1');`);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { dev: 'node server.js' } }));
  previews = createPreviews({ killGraceMs: 300 });
  const { url } = await previews.start({ id: 's1', path: dir });
  await previews.stop('s1');
  await sleep(100);
  assert.equal(await refused(url), true);
});

test('failure message includes the dev server output', async () => {
  const s = site(`node -e "console.error('MARKER42');process.exit(1)"`);
  await assert.rejects(previews.start(s), /Preview server did not start: [\s\S]*MARKER42/);
});

test('start times out when the server never answers, and kills the child', async () => {
  const child = fakeChild();
  previews = createPreviews({
    spawn: () => child,
    ensureInstalled: async () => {},
    freePort: async () => 1,
    startTimeoutMs: 500,
    killGraceMs: 50,
  });
  await assert.rejects(previews.start({ id: 's1', path: dir }), /did not start/);
  assert.ok(child.killed.includes('SIGTERM'));
});

test('a failing npm install rejects start and spawns nothing', async () => {
  const calls = [];
  previews = createPreviews({
    spawn: (...a) => { calls.push(a); return nodeSpawn(...a); },
    ensureInstalled: async () => { throw new Error('npm install failed: nope'); },
  });
  await assert.rejects(previews.start({ id: 's1', path: dir }), /npm install failed/);
  assert.equal(calls.length, 0);
});
