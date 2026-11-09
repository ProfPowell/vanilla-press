// Render brand PNGs from the SVG masters. Usage: node raster.js <brand_dir>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
const read = (p) => fs.readFileSync(path.join(dir, p), 'utf8');
const uri = (p) => 'data:image/svg+xml;base64,' + Buffer.from(read(p)).toString('base64');

// [file, size, html body]
const tile = (bg, svgFile, pct, size, radius = 0) => `
  <div style="width:${size}px;height:${size}px;background:${bg};display:grid;place-items:center;border-radius:${radius}px">
    <img src="${uri(svgFile)}" style="width:${pct}%;height:${pct}%">
  </div>`;
const bare = (svgFile, size) => `<img src="${uri(svgFile)}" style="width:${size}px;height:${size}px;display:block">`;

const jobs = [
  ['png/favicon-16.png', 16, 16, bare('svg/seal-ink-micro.svg', 16)],
  ['png/favicon-32.png', 32, 32, bare('svg/seal-ink-medium.svg', 32)],
  ['png/favicon-48.png', 48, 48, bare('svg/seal-ink-medium.svg', 48)],
  ['png/seal-ink-256.png', 256, 256, bare('svg/seal-ink.svg', 256)],
  ['png/seal-ink-512.png', 512, 512, bare('svg/seal-ink.svg', 512)],
  ['png/seal-vanilla-256.png', 256, 256, bare('svg/seal-vanilla.svg', 256)],
  ['png/seal-vanilla-512.png', 512, 512, bare('svg/seal-vanilla.svg', 512)],
  ['png/apple-touch-icon.png', 180, 180, tile('#F3E7B8', 'svg/seal-ink.svg', 80, 180)],
  ['png/icon-192.png', 192, 192, tile('#F3E7B8', 'svg/seal-ink.svg', 80, 192)],
  ['png/icon-512.png', 512, 512, tile('#F3E7B8', 'svg/seal-ink.svg', 80, 512)],
  ['png/icon-maskable-512.png', 512, 512, tile('#F3E7B8', 'svg/seal-ink.svg', 62, 512)],
  ['png/icon-dark-512.png', 512, 512, tile('#23314F', 'svg/seal-vanilla.svg', 80, 512)],
  ['png/og-image.png', 1200, 630, `
    <div style="width:1200px;height:630px;background:#23314F;display:grid;place-items:center">
      <img src="${uri('svg/lockup-horizontal-vanilla.svg')}" style="width:820px">
    </div>`],
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const [out, w, h, body] of jobs) {
    await page.setViewportSize({ width: w, height: h });
    await page.setContent(`<!doctype html><html><head><style>html,body{margin:0;background:transparent}</style></head><body>${body}</body></html>`);
    await page.waitForLoadState('load');
    fs.mkdirSync(path.dirname(path.join(dir, out)), { recursive: true });
    await page.screenshot({ path: path.join(dir, out), omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } });
  }
  await browser.close();
  console.log('rendered', jobs.length);
})();
