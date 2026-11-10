/**
 * Lift audit: does each lift light up the muscles it says it does, and only those?
 *
 * A lift names its muscles by pattern, and a pattern that is a little too wide lights the
 * wrong part of the body: "head of biceps" caught the biceps femoris in the thigh during a
 * bench press, and "flexor digitorum" caught the toe flexors in the sole of the foot in
 * every lift with a grip. This resolves every pattern against the registry and checks:
 *
 *   1  every muscle group matches at least one real muscle
 *   2  no muscle sits in two groups of the same lift (the second would overwrite the first)
 *   3  an arm, shoulder, chest or back group matches no leg muscle, and a leg group no arm muscle
 *   4  effort stays between 0 and 1 through the whole rep, and a prime mover peaks above 0.6
 *   5  phases cover the whole rep with no gap, and exactly one is the working phase
 *
 * Usage:  node tools/audit_lifts.mjs [--list]     (--list prints what each group resolves to)
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIST = process.argv.includes('--list');
const { EXERCISES } = await import(pathToFileURL(join(ROOT, 'src', 'data', 'exercises.js')).href);
const data = JSON.parse(readFileSync(join(ROOT, 'public', 'data', 'registry.json'), 'utf8'));

// The same name repair the app makes at load (src/core/registry.js).
const swap = new Map([
  ['Ascending part of trapezius muscle', 'Descending part of trapezius muscle'],
  ['Descending part of trapezius muscle', 'Ascending part of trapezius muscle'],
]);
for (const p of data.parts) if (swap.has(p.n)) p.n = swap.get(p.n);

// What the player itself leaves out (src/core/exercise.js).
const NOT_MUSCLE = /bursa|sheath|fascia|trochlea/i;
const muscles = data.parts.filter(p => p.k === 'mesh' && p.sys === 'muscular' && !NOT_MUSCLE.test(p.n));

const UPPER_KEY = /grip|arm|biceps|brachi|triceps|anconeus|delt|pec|cuff|lat|trap|serratus|coraco|rhomboid|levator|mid-back|hold/i;
const LOWER_KEY = /quad|glute|ham|calf|calves|gastroc|soleus|adductor|deep|legdrive/i;
const problems = [];
const bad = (lift, msg) => problems.push(`${lift}: ${msg}`);

for (const ex of EXERCISES) {
  const owner = new Map();
  if (LIST) console.log(`\n## ${ex.id}`);
  for (const def of ex.muscles) {
    const hit = muscles.filter(p => def.match.test(p.n));
    const names = [...new Set(hit.map(p => p.n))];
    if (LIST) console.log(`  ${def.key.padEnd(16)} ${def.role.padEnd(17)} ${names.join(' | ')}`);
    if (!names.length) bad(ex.id, `"${def.key}" matches no muscle`);
    for (const p of hit) {
      if (owner.has(p.n) && owner.get(p.n) !== def.key) bad(ex.id, `${p.n} is in both "${owner.get(p.n)}" and "${def.key}"`);
      owner.set(p.n, def.key);
      const leg = /lower limb/i.test(p.sub), arm = /upper limb/i.test(p.sub);
      // "hams" in a row or a hinge legitimately names leg muscles; the test is on the group's own name.
      if (leg && UPPER_KEY.test(def.key) && !LOWER_KEY.test(def.key)) bad(ex.id, `"${def.key}" lights a leg muscle: ${p.n}`);
      if (arm && LOWER_KEY.test(def.key) && !UPPER_KEY.test(def.key)) bad(ex.id, `"${def.key}" lights an arm muscle: ${p.n}`);
    }
    let peak = 0;
    for (let i = 0; i <= 200; i++) {
      const e = def.effort(i / 200);
      if (!(e >= 0 && e <= 1)) { bad(ex.id, `"${def.key}" effort is ${e} at t=${i / 200}`); break; }
      peak = Math.max(peak, e);
    }
    if (/prime mover/i.test(def.role) && peak < 0.6) bad(ex.id, `"${def.key}" is a prime mover but never works above ${peak.toFixed(2)}`);
    if (!/prime mover/i.test(def.role) && peak > 0.97) bad(ex.id, `"${def.key}" (${def.role}) peaks at ${peak.toFixed(2)}, as high as a prime mover`);
  }
  const ph = [...ex.phases].sort((a, b) => a.t0 - b.t0);
  if (ph[0].t0 !== 0 || ph[ph.length - 1].t1 !== 1) bad(ex.id, 'phases do not cover the whole rep');
  for (let i = 1; i < ph.length; i++) if (Math.abs(ph[i].t0 - ph[i - 1].t1) > 1e-9) bad(ex.id, `gap between phases "${ph[i - 1].key}" and "${ph[i].key}"`);
  if (ph.filter(p => p.work).length !== 1) bad(ex.id, `${ph.filter(p => p.work).length} working phases (should be 1)`);
  for (const k of ['id', 'part', 'name', 'source', 'duration', 'form', 'camera', 'pose']) if (ex[k] == null) bad(ex.id, `missing "${k}"`);
}

console.log(`\nLift audit: ${EXERCISES.length} lifts, ${EXERCISES.reduce((n, e) => n + e.muscles.length, 0)} muscle groups, ${muscles.length} muscles in the registry`);
if (problems.length) { for (const p of problems) console.log('   WRONG   ' + p); console.log(`\n${problems.length} wrong`); process.exit(1); }
console.log('OK: every group lights only the muscles it names');
