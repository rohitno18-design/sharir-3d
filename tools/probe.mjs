/**
 * Run a snippet in the app, in a real browser with no window, and print what it returns.
 * For measuring and debugging from the command line, where a hung page can be killed.
 *
 *   node tools/probe.mjs "<javascript returning a value>" [--timeout 60] [--gpu]
 *
 * The snippet runs inside an async function with `app` and `v` (the viewer) in scope.
 * --gpu uses the machine's real graphics chip instead of the software renderer.
 */
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const code = args.find((a, i) => !a.startsWith('--') && Number.isNaN(+a) && !(i > 0 && args[i - 1] === '--url'));
const ti = args.indexOf('--timeout');
const timeout = (ti >= 0 ? +args[ti + 1] : 90) * 1000;
if (!code) { console.log('Usage: node tools/probe.mjs "<js>" [--timeout seconds] [--gpu]'); process.exit(2); }

// --url http://localhost:5181 tests a server that is already running (the built app).
const ui = args.indexOf('--url');
const server = ui >= 0 ? { resolvedUrls: { local: [args[ui + 1]] }, close: async () => {} } : await createServer({ root: ROOT, logLevel: 'error', server: { port: 5191, strictPort: false } });
if (ui < 0) await server.listen();
const gl = args.includes('--gpu') ? ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ headless: true, channel: 'chrome', args: [...gl, '--enable-webgl'] });
let code_ = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', e => console.log('[page error]', String(e.message || e)));
  page.on('console', m => { if (m.type() === 'error') console.log('[console error]', m.text()); });
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'load' });
  await page.waitForFunction(() => window.app && window.app.body && window.app.body.rig && window.app.body.rig.ok, null, { timeout: 180000 });
  await page.evaluate(() => { [...document.querySelectorAll('button')].find(b => /start exploring/i.test(b.textContent))?.click(); });
  const run = page.evaluate(`(async () => { const app = window.app, v = app.viewer; ${code} })()`);
  const out = await Promise.race([run, new Promise((_, rej) => setTimeout(() => rej(new Error(`timed out after ${timeout / 1000} s: the page is hung`)), timeout))]);
  console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 1));
} catch (e) { console.log('FAILED:', e.message); code_ = 1; } finally { await browser.close().catch(() => {}); await server.close(); }
process.exit(code_);
