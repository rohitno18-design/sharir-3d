import { LIFTS as EXERCISES } from '../data/exercises.js';
import { analyse, rankAgainst, GROUPS } from '../core/biomech.js';

/**
 * Test the computed-effort model against the ten hand-written lifts.
 *
 * Each lift's efforts were shaped by hand from EMG studies. If the model is sound, then
 * given only the pose and the load it should pick out the same muscles: the lift's prime
 * movers near the top of its list, and the two orders in broad agreement.
 *
 * Run in the app's console:  (await import('/src/dev/validate-biomech.js')).run()
 */

/** Which of the model's groups each hand-written group corresponds to. */
const MAP = {
  'bench-press': { pec: 'pec', 'delt-ant': 'delt-front', triceps: 'triceps', serratus: 'serratus', lat: 'lats', cuff: 'cuff', biceps: 'biceps', grip: 'forearm' },
  'barbell-row': { lats: 'lats', 'mid-back': 'mid-back', 'delt-rear': 'delt-rear', arms: 'biceps', erector: 'erector', hams: 'hams', grip: 'forearm' },
  'overhead-press': { 'delt-front': 'delt-front', 'delt-side': 'delt-side', triceps: 'triceps', 'trap-upper': 'trap-upper', serratus: 'serratus', brace: 'abs', cuff: 'cuff' },
  'barbell-curl': { biceps: 'biceps', grip: 'forearm', 'delt-ant': 'delt-front', brace: 'abs', triceps: 'triceps' },
  'lying-triceps-extension': { 'triceps-long': 'triceps', hold: 'lats', grip: 'forearm' },
  'barbell-shrug': { 'trap-upper': 'trap-upper', 'trap-mid': 'mid-back', grip: 'forearm', erector: 'erector' },
  'back-squat': { quads: 'quads', glutes: 'glute-max', adductor: 'adductors', erector: 'erector', hams: 'hams', brace: 'abs', calves: 'calves' },
  'romanian-deadlift': { hams: 'hams', glutes: 'glute-max', erector: 'erector', adductor: 'adductors', lats: 'lats', grip: 'forearm', traps: 'trap-upper' },
  'hip-thrust': { glutes: 'glute-max', hams: 'hams', 'glute-med': 'glute-med', quads: 'quads', adductor: 'adductors', brace: 'abs' },
  'calf-raise': { gastroc: 'calves', brace: 'abs', trap: 'trap-upper' },
};

export function run(app = window.app, { steps = 40 } = {}) {
  const rig = app.body.rig;
  const body = { massKg: app.currentWeight(), heightM: app.currentHeightM() };
  const report = [];
  const before = app.exercise.ex?.id;
  for (const ex of EXERCISES) {
    if (!ex.physics) { report.push({ id: ex.id, error: 'no physics' }); continue; }
    app.setExercise(ex.id);
    const peak = {}, authored = {};
    let off = 0;
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      app.exercise.seek(t);
      const a = analyse(rig, ex.physics, body);
      off = Math.max(off, a.offBalance);
      for (const g of GROUPS) peak[g.key] = Math.max(peak[g.key] || 0, a.effort[g.key] || 0);
      for (const def of ex.muscles) authored[def.key] = Math.max(authored[def.key] || 0, def.effort(t));
    }
    const map = MAP[ex.id] || {};
    const a = {}, c = {};
    for (const [k, g] of Object.entries(map)) { if (k in authored) { a[k] = authored[k]; c[k] = peak[g]; } }
    const top = Object.entries(peak).sort((x, y) => y[1] - x[1]).slice(0, 6).map(([k, v]) => `${k} ${v.toFixed(2)}`);
    const primes = ex.muscles.filter(d => /prime/i.test(d.role)).map(d => map[d.key]).filter(Boolean);
    const order = Object.entries(peak).sort((x, y) => y[1] - x[1]).map(([k]) => k);
    const primeRanks = [...new Set(primes)].map(p => `${p}#${order.indexOf(p) + 1}`);
    report.push({ id: ex.id, rank: +rankAgainst(a, c).toFixed(2), primeRanks, top, offBalanceCm: +(off * 100).toFixed(1),
      pairs: Object.keys(a).map(k => `${k} ${a[k].toFixed(2)}/${c[k].toFixed(2)}`) });
  }
  if (before) app.setExercise(before);
  return report;
}
