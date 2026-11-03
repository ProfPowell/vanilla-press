import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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
