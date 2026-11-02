import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveWorkspace, openWorkspaceDb } from '../../src/workspace/workspace.js';

function tmp() {
  return mkdtempSync(join(tmpdir(), 'vp-ws-'));
}

test('no site: fixture mode with repo db and media, sync disabled', () => {
  const ws = resolveWorkspace({ repoRoot: '/repo', env: {} });
  assert.equal(ws.siteDir, null);
  assert.equal(ws.dbPath, join('/repo', 'content.db'));
  assert.equal(ws.mediaDir, join('/repo', 'media'));
  assert.equal(ws.syncEnabled, false);
  assert.equal(ws.contentDir, null);
  assert.equal(ws.srcDir, null);
  assert.equal(ws.configDir, null);
});

test('site: workspace paths live under the site', () => {
  const dir = tmp();
  try {
    const ws = resolveWorkspace({ site: dir, repoRoot: '/repo', env: {} });
    assert.equal(ws.siteDir, dir);
    assert.equal(ws.dbPath, dir + '/.vp/content.db');
    assert.equal(ws.mediaDir, dir + '/src/media');
    assert.equal(ws.contentDir, dir + '/content');
    assert.equal(ws.srcDir, dir + '/src');
    assert.equal(ws.configDir, dir + '/config');
    assert.equal(ws.syncEnabled, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('VP_SITE is used when site is absent; site beats env', () => {
  const a = tmp();
  const b = tmp();
  try {
    assert.equal(resolveWorkspace({ repoRoot: '/repo', env: { VP_SITE: a } }).siteDir, a);
    assert.equal(resolveWorkspace({ site: b, repoRoot: '/repo', env: { VP_SITE: a } }).siteDir, b);
  } finally {
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
});

test('missing site directory throws naming the path', () => {
  const missing = join(tmpdir(), 'vp-ws-does-not-exist-xyz');
  assert.throws(
    () => resolveWorkspace({ site: missing, repoRoot: '/repo', env: {} }),
    (err) => err.message === `Site directory not found: ${missing}`,
  );
});

test('openWorkspaceDb creates .vp/content.db with migrations applied', () => {
  const dir = tmp();
  try {
    const ws = resolveWorkspace({ site: dir, repoRoot: '/repo', env: {} });
    const db = openWorkspaceDb(ws);
    try {
      assert.ok(existsSync(join(dir, '.vp', 'content.db')));
      const row = db.prepare("SELECT name FROM sqlite_master WHERE name = 'documents'").get();
      assert.equal(row.name, 'documents');
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
