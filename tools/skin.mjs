/**
 * How whole the skin is in every movement, with and without the mending round the
 * shoulders (src/core/skinfix.js): torn edges (stretched past 4 times their standing
 * length) and the worst stretch anywhere, at four moments of each rep. Lower is better.
 *
 *   npm run skin
 */
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const code = `
const Q = await import('/src/dev/skincheck.js');
const { EXERCISES } = await import('/src/data/exercises.js');
app.setMode('move'); const out = [];
for (const ex0 of EXERCISES) {
  app.setExercise(ex0.id);
  const P = app.exercise; let w = 0; while (P.skinFix && !(P.skinFix.current?.done) && w < 30000) { await new Promise(r => setTimeout(r, 50)); w += 50; }
  let a = 0, b = 0, wa = 0, wb = 0;
  for (const t of [0, 0.25, 0.5, 0.75]) {
    P.seek(t);
    const q1 = Q.skinQuality(app); a += q1.total.torn; wa = Math.max(wa, q1.total.worst);
    P.skinFix?.clear();
    const q0 = Q.skinQuality(app); b += q0.total.torn; wb = Math.max(wb, q0.total.worst);
  }
  out.push([ex0.id, b, a, +wb.toFixed(1), +wa.toFixed(1)]);
}
return out;`;
const r = spawnSync(process.execPath, [join(HERE, 'probe.mjs'), code, '--gpu', '--timeout', '1200'], { encoding: 'utf8' });
let rows;
try { rows = JSON.parse(r.stdout.slice(r.stdout.indexOf('['))); } catch { console.log(r.stdout, r.stderr); process.exit(1); }
console.log('movement                      torn edges (bones only -> mended)   worst stretch');
let tb = 0, ta = 0;
for (const [id, b, a, wb, wa] of rows) { tb += b; ta += a; console.log(`${id.padEnd(30)}${String(b).padStart(6)} -> ${String(a).padEnd(26)}${wb}x -> ${wa}x`); }
console.log(`${'all'.padEnd(30)}${String(tb).padStart(6)} -> ${ta}`);
process.exit(ta > tb ? 1 : 0);
