/**
 * How long the built app (dist/) takes to load, and where the time goes.
 *
 *   npm run build && node tools/loadtime.mjs        two loads: cold, then with the browser cache
 *
 * Uses the machine's real graphics chip. Steps come from src/core/timing.js.
 */
import { preview } from 'vite';
import { chromium } from 'playwright-core';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = await preview({ root: ROOT, logLevel: 'error', preview: { port: 5197, strictPort: false } });
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-webgl'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  for (const run of ['cold', 'cached']) {
    const page = await ctx.newPage();
    page.on('pageerror', e => console.log('[page error]', String(e.message || e)));
    const t = Date.now();
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__loadTimes, null, { timeout: 400000 });
    const lt = await page.evaluate(() => window.__loadTimes);
    console.log(`\n${run}: ready in ${((Date.now() - t) / 1000).toFixed(1)} s (app's own clock ${(lt.total / 1000).toFixed(1)} s)`);
    for (const [l, ms] of lt.steps.filter(([, ms]) => ms >= 100).sort((a, b) => b[1] - a[1])) console.log(`  ${(ms / 1000).toFixed(2).padStart(6)} s  ${l}`);
    await page.close();
  }
} finally { await browser.close(); server.httpServer.close(); }
process.exit(0);
