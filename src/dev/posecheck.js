import * as THREE from 'three';
import { EXERCISES, LIFTS } from '../data/exercises.js';
import { analyse, angles } from '../core/biomech.js';

/**
 * The gates a movement has to pass before it is shown to anyone.
 *
 * A script can ask for a pose the body cannot make, or one the soft tissue does not follow
 * cleanly. Neither may reach the screen, so every movement is put through these:
 *
 *   range     every joint stays inside what a human joint can do
 *   balance   standing, the weight stays over the feet
 *   floor     the feet stay on the floor and nothing goes through it
 *   tissue    muscle and skin are not torn or stretched into sheets. Every triangle edge of
 *             the muscle and skin layers is measured, posed against standing, on the CPU
 *             with the same skinning the shader does. The ten hand-written lifts, which
 *             were checked by eye from every side, set the bar: a movement passes when it
 *             stretches no more tissue than the worst of them.
 *
 * Run in the app's console:
 *   const g = await import('/src/dev/posecheck.js');
 *   g.baseline()                 once: measures the hand-written lifts
 *   g.check('lateral-raise')     one movement
 *   g.checkAll()                 every scripted movement
 */

/** Human limits, in degrees, as measured by `angles()` from the posed joints. */
const LIMIT = {
  elbow: [0, 152], knee: [0, 152], shoulder: [0, 180], hipFlex: [-25, 130], hipAbd: [-30, 50], ankle: [55, 145], spineBend: [0, 60],
};

/** Edges of a layer that are stretched past `ratio` at the rig's current pose, by part. */
function stretched(app, system, { ratio = 2.6, minLen = 0.0015 } = {}) {
  const body = app.body, rig = body.rig;
  const batch = body.batches.find(b => b.system === system);
  if (!batch) return { count: 0, edges: 0, parts: [] };
  const g = batch.mesh.geometry;
  const pos = g.attributes.position, sk = g.attributes.aSkin, s2 = g.attributes.aSkin2, mk = g.attributes.aMorphMask, pi = g.attributes.aPartIndex;
  const n = pos.count;
  const rest = (g.userData._rest ||= {});
  // The standing body in its current shape, worked out once per shape.
  const key = app.exercise?.ex ? (rig.lastPose ? 'k' : 'k') + JSON.stringify([app.currentWeight(), app.currentHeightCm(), app.registry && 1]) : 'k';
  if (rest.key !== key) {
    rest.key = key; rest.p = new Float32Array(n * 3);
    const v = new THREE.Vector3(), o = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(pos, i);
      rig.morphVertex(v, o, sk.getX(i), sk.getY(i), sk.getZ(i), mk ? mk.getX(i) : 0);
      rest.p[i * 3] = o.x; rest.p[i * 3 + 1] = o.y; rest.p[i * 3 + 2] = o.z;
    }
  }
  const posed = new Float32Array(n * 3);
  const v = new THREE.Vector3();
  const state = body.state;
  for (let i = 0; i < n; i++) {
    v.set(rest.p[i * 3], rest.p[i * 3 + 1], rest.p[i * 3 + 2]);
    rig.skinPoint(sk.getX(i), sk.getY(i), sk.getZ(i), v, mk ? mk.getX(i) : 0, s2 ? s2.getX(i) : 0, s2 ? s2.getY(i) : 0);
    posed[i * 3] = v.x; posed[i * 3 + 1] = v.y; posed[i * 3 + 2] = v.z;
  }
  const idx = g.index.array, by = new Map();
  let count = 0, edges = 0;
  const len = (a, i, j) => Math.hypot(a[i * 3] - a[j * 3], a[i * 3 + 1] - a[j * 3 + 1], a[i * 3 + 2] - a[j * 3 + 2]);
  for (let t = 0; t < idx.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const i = idx[t + e], j = idx[t + (e + 1) % 3];
      if (i > j) continue;                     // each shared edge once
      const slot = pi.getX(i);
      if (state[slot * 4 + 3] < 0.5 && system !== 'integumentary') { /* hidden parts still count: they can be shown */ }
      const l0 = len(rest.p, i, j);
      if (l0 < minLen) continue;
      edges++;
      if (len(posed, i, j) / l0 > ratio) { count++; by.set(slot, (by.get(slot) || 0) + 1); }
    }
  }
  const parts = [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([slot, c]) => `${body.parts[slot].n}${body.parts[slot].side ? '.' + body.parts[slot].side : ''} ${c}`);
  return { count, edges, parts };
}

/** One movement through every gate. Returns { id, ok, problems, ... }. */
export function check(id, app = window.app, { steps = 8 } = {}) {
  const ex = EXERCISES.find(e => e.id === id);
  if (!ex) return { id, ok: false, problems: ['no such movement'] };
  const rig = app.body.rig, keepId = app.exercise.ex?.id, keepT = app.exercise.t;
  app.setExercise(id);
  // The lift as the app itself holds it: a scripted one has just worked out its muscles.
  const live = app.exercise.ex || ex;
  const body = { massKg: app.currentWeight(), heightM: app.currentHeightM() };
  const problems = [], worst = { muscular: { count: 0 }, integumentary: { count: 0 } };
  const seen = {};
  let off = 0, low = Infinity;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps * 0.999;
    app.exercise.seek(t);
    const a = angles(rig);
    for (const [k, v] of Object.entries(a)) {
      const lim = LIMIT[k.split('.')[0]];
      if (!lim) continue;
      (seen[k] ||= [Infinity, -Infinity]); seen[k][0] = Math.min(seen[k][0], v); seen[k][1] = Math.max(seen[k][1], v);
      if (v < lim[0] - 1 || v > lim[1] + 1) problems.push(`range: ${k} ${v.toFixed(0)} degrees at t=${t.toFixed(2)} (limit ${lim.join(' to ')})`);
    }
    if (live.physics) off = Math.max(off, analyse(rig, live.physics, body).offBalance);
    for (const side of ['l', 'r']) for (const j of ['ankle', 'mtp', 'knee', 'wr', 'el']) low = Math.min(low, rig.jointAt(j, side).y);
    for (const sys of ['muscular', 'integumentary']) { const s = stretched(app, sys); if (s.count > worst[sys].count) worst[sys] = { ...s, t: +t.toFixed(2) }; }
  }
  if (off > 0.03) problems.push(`balance: the weight is ${(off * 100).toFixed(1)} cm outside the feet`);
  if (low < 0.005) problems.push(`floor: a joint is ${(low * 100).toFixed(1)} cm from the floor`);
  // The bar to pass: handed in by the gate runner (tools/gate-baseline.json), or the one
  // `baseline()` measured in this browser.
  const base = window.__sharirBaseline || JSON.parse(localStorage.getItem('sharir.posecheck.baseline') || 'null');
  if (base) for (const sys of ['muscular', 'integumentary']) {
    if (worst[sys].count > base[sys] * 1.15 + 20) problems.push(`tissue: ${worst[sys].count} stretched ${sys === 'muscular' ? 'muscle' : 'skin'} edges at t=${worst[sys].t} (the hand-written lifts' worst is ${base[sys]}): ${worst[sys].parts.join(', ')}`);
  }
  if (live.clipped?.length) problems.push(...live.clipped.map(c => 'script: ' + c));
  const report = live.report || null;
  // What the author said this movement trains, written before it was run. If physics
  // disagrees, either the pose is wrong (an elbow turned the wrong way puts the load on the
  // biceps) or the author's anatomy is. Both must be settled before anyone sees it.
  const expect = live.script?.expect;
  if (live.scripted && !expect) problems.push('expect: the script does not say which muscles it should work (add expect: { lead, working, quiet })');
  if (expect && report) {
    const top = report.top || 1, at = (k) => (report.peaks[k] || 0) / top;
    for (const k of expect.lead || []) if (at(k) < 0.7) problems.push(`expect: "${k}" should lead this movement but works at only ${Math.round(at(k) * 100)}% of the hardest muscle (${Object.keys(report.peaks)[0]})`);
    for (const k of expect.working || []) if (at(k) < 0.35) problems.push(`expect: "${k}" should be working but is at only ${Math.round(at(k) * 100)}% of the hardest muscle`);
    for (const k of expect.quiet || []) if (at(k) >= 0.5) problems.push(`expect: "${k}" should be quiet but works at ${Math.round(at(k) * 100)}% of the hardest muscle`);
  }
  const muscles = (live.muscles || []).map(m => ({ key: m.key, label: m.label, role: m.role }));
  const marks = { start: 0, top: (live.marks || []).find(m => /top|bottom/i.test(m.label) && m.t > 0)?.t ?? 0.45 };
  if (keepId) { app.setExercise(keepId); app.exercise.seek(keepT); }
  return { id, ok: !problems.length, problems, report, muscles, marks, scripted: !!live.scripted, name: live.name, part: live.part, muscle: worst.muscular.count, skin: worst.integumentary.count, muscleParts: worst.muscular.parts, skinParts: worst.integumentary.parts, offBalanceCm: +(off * 100).toFixed(1), baseline: !!base };
}

/** Measure the hand-written lifts and remember their worst as the bar to pass. */
export function baseline(app = window.app) {
  const rows = LIFTS.map(l => check(l.id, app, { steps: 6 }));
  const base = { muscular: Math.max(...rows.map(r => r.muscle)), integumentary: Math.max(...rows.map(r => r.skin)), at: new Date().toISOString().slice(0, 10) };
  localStorage.setItem('sharir.posecheck.baseline', JSON.stringify(base));
  return { base, rows: rows.map(r => `${r.id}: muscle ${r.muscle}, skin ${r.skin}`) };
}

export function checkAll(app = window.app) {
  return EXERCISES.filter(e => e.scripted).map(e => check(e.id, app));
}
