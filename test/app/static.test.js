import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startApp } from '../../src/app/server.js';

describe('app static pages', () => {
  let root, app;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), 'vp-app-static-'));
    app = await startApp({ port: 0, env: { VP_CONFIG_DIR: join(root, 'config') } });
  });
  after(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('/ serves the Sites page', async () => {
    const res = await fetch(`${app.url}/`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /<title>Sites/);
  });

  it('/app/site.html serves the site page', async () => {
    const res = await fetch(`${app.url}/app/site.html`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /<title>Site/);
  });

  it('/app/services.html serves the Services page; Sites and the site rail link to it', async () => {
    const res = await fetch(`${app.url}/app/services.html`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /<title>Services/);
    for (const page of ['/', '/app/site.html']) {
      const html = await (await fetch(`${app.url}${page}`)).text();
      assert.match(html, /<a href="\/app\/services\.html"[^>]*>Services<\/a>/, page);
    }
  });

  it('both pages load Vanilla Breeze as a module', async () => {
    for (const page of ['/', '/app/site.html']) {
      const html = await (await fetch(`${app.url}${page}`)).text();
      assert.match(html, /<script type="module" src="\/assets\/vb\/vanilla-breeze\.js"/, page);
    }
  });

  it('serves the page scripts and styles', async () => {
    for (const p of ['app.css', 'js/app-api.js', 'js/sites-page.js', 'js/site-page.js', 'js/services-page.js', 'js/services-view.js']) {
      const res = await fetch(`${app.url}/app/assets/${p}`);
      assert.equal(res.status, 200, p);
    }
  });
});
