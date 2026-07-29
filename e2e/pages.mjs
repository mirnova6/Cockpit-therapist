/**
 * Deployment verification for the GitHub Pages build.
 *
 * Serves dist/ the way GitHub Pages actually does — under the repository
 * subpath, with 404.html returned for unknown paths — and drives a real browser
 * against it. This catches the failure modes a plain `vite build` never would:
 * assets resolving to the wrong base, a nested route 404ing on refresh, the
 * public-demonstration labelling being absent, or the page reaching out to an
 * external host.
 *
 * Run: npm run build:pages && npm run test:pages
 */
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';

const BASE_PATH = 'Cockpit-therapist';
const DIST = new URL('../dist/', import.meta.url).pathname;

/** Same resolution order as smoke.mjs: env, container binary, then default. */
function chromiumExecutablePath() {
  if (process.env.E2E_CHROMIUM_PATH) return process.env.E2E_CHROMIUM_PATH;
  return existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
}

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('dist/index.html not found — run `npm run build:pages` first.');
  process.exit(1);
}

// Stage dist/ under the repo subpath, mirroring the published layout.
const ROOT = mkdtempSync(join(tmpdir(), 'cockpit-pages-'));
mkdirSync(join(ROOT, BASE_PATH), { recursive: true });
cpSync(DIST, join(ROOT, BASE_PATH), { recursive: true });

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let p = join(ROOT, decodeURIComponent(url.pathname));
  if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
  if (existsSync(p) && statSync(p).isFile()) {
    res.writeHead(200, { 'content-type': TYPES[extname(p)] ?? 'application/octet-stream' });
    res.end(readFileSync(p));
    return;
  }
  const notFound = join(ROOT, BASE_PATH, '404.html');
  res.writeHead(404, { 'content-type': 'text/html' });
  res.end(existsSync(notFound) ? readFileSync(notFound) : 'not found');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const SITE = `http://127.0.0.1:${PORT}/${BASE_PATH}/`;
console.log('serving', SITE);

let fails = 0;
const check = (n, c) => { console.log(`  ${c ? '✓' : '✗'} ${n}`); if (!c) fails++; };

const CHROMIUM = chromiumExecutablePath();
console.log('chromium:', CHROMIUM ?? 'playwright default');
const browser = await chromium.launch({ ...(CHROMIUM ? { executablePath: CHROMIUM } : {}) });
const ctx = await browser.newContext();
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('requestfailed', (r) => errors.push(`${r.url()} ${r.failure()?.errorText}`));

// 1. Root loads with assets resolving under the subpath.
await page.goto(SITE);
await page.waitForSelector('text=first-time setup', { timeout: 20000 });
check('root URL loads the app under the subpath', true);
check('no console/page errors or failed requests', errors.length === 0);
if (errors.length) console.log('    ', errors.slice(0, 3));

// 2. The permanent public-demo banner is visible before any setup.
check('public-demo banner shown on first load',
  await page.locator('.public-demo-banner').isVisible());
const bannerText = await page.locator('.public-demo-banner').innerText();
check('banner says fictional / de-identified only', /fictional or fully de-identified/i.test(bannerText));
check('banner says NOT approved for real client information', /NOT approved for real client information/i.test(bannerText));
check('banner says data stays in this browser', /stays encrypted in this browser/i.test(bannerText));

// 3. Set up a workspace, then test nested-route refresh.
await page.fill('input[autocomplete="name"]', 'Dr. Pages');
const pw = page.locator('input[type="password"]');
await pw.nth(0).fill('pages-deploy-passphrase');
await pw.nth(1).fill('pages-deploy-passphrase');
await page.click('text=Create encrypted workspace');
await page.waitForSelector('h1:has-text("Choose client")', { timeout: 20000 });
check('workspace created on the deployed path', true);

await page.goto(`${SITE}#/governance`);
await page.waitForSelector('text=readiness', { timeout: 20000 });
check('nested route opens directly from a pasted URL', page.url().includes('#/governance'));

// THE refresh test: reload a nested route.
await page.reload();
await page.waitForSelector('text=Workspace locked', { timeout: 20000 });
check('refresh on a nested route serves the app (not a 404)', true);
check('nested route survives refresh in the URL', page.url().includes('#/governance'));
check('banner still shown after refresh', await page.locator('.public-demo-banner').isVisible());

// 4. A bare non-hash path hits 404.html and is redirected into the app.
const resp = await page.goto(`${SITE}clients/some-id`);
await page.waitForSelector('text=Workspace locked', { timeout: 20000 });
check('bare nested path recovers into the app via 404.html', page.url().includes('#/'));
check('404.html served with a 404 status (as Pages does)', resp === null || resp.status() === 404);

// 5. Data locality: nothing leaves the browser.
const external = [];
page.on('request', (r) => { if (!r.url().startsWith(`http://127.0.0.1:${PORT}`) && !r.url().startsWith('data:')) external.push(r.url()); });
await page.goto(SITE);
await page.waitForSelector('text=Workspace locked', { timeout: 20000 });
await page.waitForTimeout(1500);
check('no outbound requests to any external host', external.length === 0);
if (external.length) console.log('    ', external.slice(0, 5));

await browser.close();
server.close();
rmSync(ROOT, { recursive: true, force: true });
console.log(fails === 0 ? '\nAll deployment checks passed.' : `\n${fails} check(s) FAILED`);
process.exit(fails === 0 ? 0 : 1);
