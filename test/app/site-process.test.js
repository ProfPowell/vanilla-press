import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { ensureInstalled, runBuild, runNpm, freePort, durationText } from '../../src/app/site-process.js';

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'vp-proc-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const require_ = (name) => readFileSync(join(dir, name), 'utf8');

function pkg(scripts) {
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0', scripts }));
}

test('runBuild reports success', async () => {
  pkg({ build: `node -e "require('fs').mkdirSync('dist');require('fs').writeFileSync('dist/ok','1')"` });
  const res = await runBuild(dir);
  assert.equal(res.ok, true);
  assert.ok(existsSync(join(dir, 'dist', 'ok')));
});

test('runBuild reports failure with the log tail', async () => {
  pkg({ build: `node -e "console.error('boom');process.exit(1)"` });
  const res = await runBuild(dir);
  assert.equal(res.ok, false);
  assert.match(res.log, /boom/);
});

test('runBuild sets NODE_ENV=production', async () => {
  pkg({ build: `node -e "console.log('env='+process.env.NODE_ENV)"` });
  const res = await runBuild(dir);
  assert.match(res.log, /env=production/);
});

test('runBuild times out as a failed build and kills the build', { timeout: 15000 }, async () => {
  pkg({ build: `node -e "require('fs').writeFileSync('pid',String(process.pid));setInterval(()=>{},1000)"` });
  const started = Date.now();
  const res = await runBuild(dir, { timeoutMs: 1500 });
  assert.equal(res.ok, false);
  assert.match(res.log, /Build timed out after 2 s/);
  assert.ok(Date.now() - started < 8000);
  const pid = Number(require_('pid'));
  await new Promise((r) => setTimeout(r, 200));
  assert.throws(() => process.kill(pid, 0), /ESRCH/);
});

test('runNpm timeout says npm took too long, not that a build timed out', { timeout: 15000 }, async () => {
  pkg({ hang: `node -e "setInterval(()=>{},1000)"` });
  const res = await runNpm(dir, ['run', 'hang'], {}, { timeoutMs: 1500 });
  assert.equal(res.ok, false);
  assert.equal(res.timedOut, true);
  assert.match(res.log, /npm took too long \(over 2 s\) and was stopped\./);
  assert.doesNotMatch(res.log, /Build/);
});

test('durationText: minutes from a minute up, else seconds', () => {
  assert.equal(durationText(5 * 60_000), '5 min');
  assert.equal(durationText(10 * 60_000), '10 min');
  assert.equal(durationText(1500), '2 s');
});

test('ensureInstalled skips when node_modules exists', async () => {
  mkdirSync(join(dir, 'node_modules'));
  let called = 0;
  await ensureInstalled(dir, { run: async () => { called++; } });
  assert.equal(called, 0);
});

test('ensureInstalled runs npm install when node_modules is missing', async () => {
  const calls = [];
  await ensureInstalled(dir, { run: async (...a) => { calls.push(a); } });
  assert.equal(calls.length, 1);
});

test('freePort skips a busy port', async () => {
  const srv = createServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const busy = srv.address().port;
  try {
    const port = await freePort(busy);
    assert.notEqual(port, busy);
  } finally {
    await new Promise((r) => srv.close(r));
  }
});

test('freePort skips a port held on the wildcard address', async () => {
  const srv = createServer();
  await new Promise((r) => srv.listen(0, r));
  const busy = srv.address().port;
  try {
    const port = await freePort(busy);
    assert.notEqual(port, busy);
  } finally {
    await new Promise((r) => srv.close(r));
  }
});
