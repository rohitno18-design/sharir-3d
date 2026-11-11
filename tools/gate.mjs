/**
 * The gate: one command that decides whether a movement may be shown.
 *
 * It starts the app, opens it in a real browser with no window, and puts each movement
 * through the gates in src/dev/posecheck.js (joint range, balance, floor, tissue stretch
 * against the hand-written lifts' worst). For a scripted movement it also prints what the
 * effort model worked out, and it saves photographs from four sides so that whoever wrote
 * the movement can look at it before saying it is done.
 *
 *   npm run gate -- lateral-raise          one movement, with photos
 *   npm run gate -- lateral-raise --no-shots
 *   npm run gate -- --all                  every scripted movement
 *   npm run gate -- --lifts                the ten hand-written lifts
 *   npm run gate -- --model                test the effort model against the hand-written lifts
 *   npm run gate -- --rebaseline           measure the hand-written lifts again and save the bar
 *
 * Photos go to gate-shots/<id>/ (not committed). Exit code 1 if any movement fails.
 * Uses the Chrome already installed on this machine.
 */
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const ids = args.filter(a => !a.startsWith('--'));
const BASE_FILE = join(ROOT, 'tools', 'gate-baseline.json');
const SHOTS = join(ROOT, 'gate-shots');

if (!ids.length && !['--all', '--lifts', '--model', '--rebaseline'].some(flag)) {
  console.log('Usage: npm run gate -- <movement-id> [--no-shots] | --all | --lifts | --model | --rebaseline');
  process.exit(2);
}

const server = await createServer({ root: ROOT, logLevel: 'error', server: { port: 5190, strictPort: false } });
await server.listen();
const url = server.resolvedUrls.local[0];

let browser;
const launch = async (opts) => chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'], ...opts });
try { browser = await launch({ channel: 'chrome' }); }
catch { try { browser = await launch({ channel: 'msedge' }); } catch (e) { console.error('Could not start Chrome or Edge:', e.message); await server.close(); process.exit(2); } }

let failed = 0;
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.app && window.app.body && window.app.body.rig && window.app.body.rig.ok, null, { timeout: 180000 });
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find(b => /start exploring/i.test(b.textContent))?.click();
    window.app.setMode('move');
  });

  if (flag('--rebaseline')) {
    const b = await page.evaluate(async () => (await import('/src/dev/posecheck.js')).baseline());
    writeFileSync(BASE_FILE, JSON.stringify(b.base, null, 2) + '\n');
    console.log('Baseline saved to tools/gate-baseline.json:', JSON.stringify(b.base));
    for (const r of b.rows) console.log('   ' + r);
  }
  if (!existsSync(BASE_FILE)) { console.error('No tools/gate-baseline.json. Run: npm run gate -- --rebaseline'); process.exit(2); }
  const base = JSON.parse(readFileSync(BASE_FILE, 'utf8'));
  await page.evaluate((b) => { window.__sharirBaseline = b; }, base);

  if (flag('--model')) {
    const rows = await page.evaluate(async () => (await import('/src/dev/validate-biomech.js')).run());
    console.log('\nEffort model against the hand-written lifts (rank 1 = same order of muscles):');
    for (const r of rows) console.log(`   ${String(r.rank).padStart(5)}  ${r.id.padEnd(26)} prime movers come out ${r.primeRanks.join(' ')}`);
    const good = rows.filter(r => r.rank >= 0.3).length;
    console.log(`   ${good} of ${rows.length} agree. The row and the Romanian deadlift are known to differ (see docs/movement-scripts.md).`);
    if (good < 8) { console.log('   WRONG: fewer than 8 agree. The model has been made worse.'); failed++; }
  }

  let list = [...ids];
  const known = await page.evaluate(async () => {
    const m = await import('/src/data/exercises.js');
    return m.EXERCISES.map(e => ({ id: e.id, scripted: !!e.scripted }));
  });
  if (flag('--all')) list.push(...known.filter(k => k.scripted).map(k => k.id));
  if (flag('--lifts')) list.push(...known.filter(k => !k.scripted).map(k => k.id));
  list = [...new Set(list)];
  for (const id of list) if (!known.some(k => k.id === id)) { console.log(`FAIL  ${id}: no such movement. Known: ${known.map(k => k.id).join(', ')}`); failed++; }
  list = list.filter(id => known.some(k => k.id === id));

  const shots = !flag('--no-shots') && (ids.length > 0 || flag('--shots'));
  // Only the body in the photographs: the panels and bars would cover its head and feet.
  if (shots) await page.addStyleTag({ content: '#topbar,#left,#right,#dock,#stage-toolbar,#context-bar,#stage-hint,#legend,#left-collapse,#right-collapse,#labels,#label-lines,#hover-tip{visibility:hidden!important}' });
  for (const id of list) {
    const r = await page.evaluate(async (id) => (await import('/src/dev/posecheck.js')).check(id), id);
    // The hand-written squat bends the hip past the limit new movements are held to. It
    // was approved as it is, so for the hand-written lifts range is reported, not failed.
    const hard = r.scripted ? r.problems : r.problems.filter(p => !p.startsWith('range:'));
    const ok = !hard.length;
    if (!ok) failed++;
    console.log(`\n${ok ? 'PASS' : 'FAIL'}  ${id}  (${r.part}: ${r.name})`);
    console.log(`   tissue: ${r.muscle} muscle edges, ${r.skin} skin edges stretched (bar: ${base.muscular}, ${base.integumentary}; fail above ${Math.round(base.muscular * 1.15 + 20)}, ${Math.round(base.integumentary * 1.15 + 20)})`);
    console.log(`   balance: ${r.offBalanceCm} cm off`);
    for (const p of r.problems) console.log(`   ${hard.includes(p) ? 'WRONG ' : 'note  '} ${p}`);
    if (r.report) {
      console.log(`   load: ${r.report.kg} kg in all. Hardest muscle works at ${Math.round(r.report.top * 100)}% of its strength.`);
      console.log(`   muscles: ${r.muscles.slice(0, 8).map(m => `${m.key} (${m.role.toLowerCase()})`).join(', ')}`);
      console.log(`   effort:  ${Object.entries(r.report.peaks).slice(0, 10).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    }
    if (r.muscleParts?.length) console.log(`   most stretched: ${r.muscleParts.slice(0, 4).join(', ')}`);

    if (shots) {
      const dir = join(SHOTS, id);
      mkdirSync(dir, { recursive: true });
      const views = { front: [0.15, 0.25, 3.3], side: [3.3, 0.25, 0.2], back: [-0.5, 0.35, -3.2], below: [1.6, -0.9, 2.2], above: [0.4, 3.0, 1.0] };
      for (const [moment, t] of Object.entries(r.marks)) {
        for (const [view, offset] of Object.entries(views)) {
          await page.evaluate(async ({ id, t, offset }) => {
            const app = window.app;
            if (app.exercise.ex?.id !== id) app.setExercise(id);
            app.togglePanel('left', false); app.togglePanel('right', false);
            app.exercise.pause(); app.exercise.seek(t);
            const v = app.viewer, c = app.exercise.ex.camera({ height: app.currentHeightCm() / 100 });
            const target = [(c.box[0][0] + c.box[1][0]) / 2, (c.box[0][1] + c.box[1][1]) / 2, (c.box[0][2] + c.box[1][2]) / 2];
            for (let pass = 0; pass < 2; pass++) {
              app.exercise.autoFrame = false; clearTimeout(app.exercise._frameT); v._tween = null;
              v.controls.target.set(...target);
              v.camera.position.set(target[0] + offset[0], target[1] + offset[1], target[2] + offset[2]);
              v.camera.lookAt(...target); v.controls.update(); v.requestRender();
              await new Promise(res => setTimeout(res, 450));
            }
          }, { id, t, offset });
          await page.screenshot({ path: join(dir, `${moment}-${view}.png`) });
        }
      }
      console.log(`   photos: gate-shots/${id}/  (start and top, each from front, side, back, below, above)`);
    }
  }
  if (errors.length) { console.log('\nErrors in the page:'); for (const e of [...new Set(errors)].slice(0, 8)) console.log('   ' + e); failed++; }
  console.log(`\n${failed ? failed + ' failed' : 'All passed'}`);
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
