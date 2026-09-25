import * as THREE from 'three';
import { d, lerp, clamp01, bell, keyCurve, Frame, handsOnBar, joint, shoulderWorld, ezGrip, SIDES, sgn, form, bodyKey, TRUNK } from '../../core/lift.js';
import { BENCH_PRESS } from './bench-press.js';

/**
 * Lying triceps extension, the "skull crusher".
 *
 * Lying on the flat bench exactly as for the bench press, feet planted. The upper arms are
 * held still, tilted a little back towards the head, and only the elbows bend: the bar
 * travels on an arc about the elbow down towards the forehead, and stops a few centimetres
 * short of it. That gap is checked against this body's head, not assumed.
 */
const BAR = { radius: 0.0125, flesh: 0.011 };
const TILT = d(14);              // upper arms tilted back towards the head
const BEND = d(118);             // the most the elbows bend, unless the head is closer
const X = new THREE.Vector3(1, 0, 0);

export const LYING_TRICEPS_EXTENSION = {
  id: 'lying-triceps-extension',
  part: 'Triceps',
  name: 'Lying triceps extension',
  sub: 'On a flat bench with an EZ bar, upper arms still',
  source: 'Frédéric Delavier, Strength Training Anatomy — Lying Triceps Extensions; standard strength-coaching technique',
  duration: 3.2,
  bar: BAR,

  u: keyCurve([[0, 0], [0.42, 1], [0.50, 1], [0.88, 0], [1, 0]]),
  phases: [
    { key: 'lower', name: 'Lowering', t0: 0.00, t1: 0.42, hint: 'Bend only at the elbows. The upper arms stay still and the bar comes down towards the forehead.' },
    { key: 'bottom', name: 'The stretch', t0: 0.42, t1: 0.50, hint: 'The bar stops a few centimetres above the forehead. The long head of the triceps is stretched most here.' },
    { key: 'press', name: 'Straightening', t0: 0.50, t1: 0.88, work: true, hint: 'Straighten the elbows to lift the bar. The elbows keep pointing up, about shoulder width apart.' },
    { key: 'top', name: 'Arms straight', t0: 0.88, t1: 1.00, hint: 'Arms straight, tilted a little back. Do not lock the elbows hard.' },
  ],
  marks: [{ label: '⤒ Arms straight', t: 0 }, { label: '⤓ Bottom', t: 0.46 }],
  poster: 0.62,
  ready: 'Lying on the bench, arms straight, the bar above the forehead.',

  form: form(
    [
      'Lie on a flat bench with your feet flat on the floor.',
      'Hold an EZ bar on its inner angled grips, palms facing away from you. The angle turns your thumbs up a little, which is easier on the wrists and elbows than a straight bar.',
      'Start with your arms straight up, tilted a little back towards your head, so the bar is above your forehead.',
    ],
    [
      'Keep your upper arms still. Bend only at the elbows and lower the bar towards your forehead.',
      'Stop a few centimetres above your forehead.',
      'Straighten your elbows to lift the bar back up. Do not lock them hard at the top.',
      'Keep your elbows pointing up and about shoulder width apart all the way.',
    ],
    [
      'Letting the elbows flare out to the sides. The triceps lose their leverage and the elbow joint takes the strain.',
      'Moving the upper arms. The lift turns into a pullover and the triceps do less.',
      'Dropping the bar quickly towards the head. Lower it slowly and under control.',
      'Arching the back off the bench.',
    ],
    'Breathe in as you lower the bar. Breathe out as you straighten your arms.',
  ),

  equipment: {
    floor: true,
    bar: 'ez',
    bench: BENCH_PRESS.equipment.bench,
  },

  camera() {
    const top = BENCH_PRESS.equipment.bench.top;
    return {
      target: [0, top + 0.42, -0.72],
      offset: [1.55, 0.55, 0.55],
      box: [[-0.45, top - 0.05, -1.25], [0.45, top + 0.85, 0.10]],
    };
  },

  /** Per body, once: lying on the bench, the elbows' fixed places, and the forearm reach. */
  _setup(rig, ctx) {
    const key = bodyKey();
    if (this._s?.key === key) return this._s;
    // The body on the bench, feet planted, exactly as the bench press lays it down.
    const lying = BENCH_PRESS.pose(1, { ...ctx, rig });
    const frame = Frame.fromEntry(rig, lying.root);
    const base = { root: lying.root };
    for (const k of Object.keys(lying)) if (/^(thigh|shin|foot)\./.test(k)) base[k] = lying[k];
    for (const side of SIDES) base[`girdle.${side}`] = { rot: [0, sgn(side) * d(6), 0] };
    const gh = shoulderWorld(rig, frame, base, 'l');
    const L1 = joint(rig, 'l', 'gh').distanceTo(joint(rig, 'l', 'el'));
    const L2 = joint(rig, 'l', 'el').distanceTo(joint(rig, 'l', 'grip'));
    // Upper arm straight up from the shoulder, tilted back towards the head (the head is
    // towards -z while lying down).
    const upper = new THREE.Vector3(0, Math.cos(TILT), -Math.sin(TILT));
    const elbow = gh.clone().setX(0).addScaledVector(upper, L1);
    const half = Math.abs(gh.x) - 0.01;
    // How far the elbows may bend before the bar comes within 3 cm of the head.
    const cloud = rig.bodyCloud(base);
    const barAt = (bend) => elbow.clone().addScaledVector(upper.clone().applyAxisAngle(X, -bend), L2);
    let most = BEND;
    if (rig.barGap(cloud, barAt(most), BAR.radius, TRUNK) < 0.03) {
      let lo = d(60), hi = BEND;
      for (let i = 0; i < 20; i++) { const mid = (lo + hi) / 2; if (rig.barGap(cloud, barAt(mid), BAR.radius, TRUNK) >= 0.03) lo = mid; else hi = mid; }
      most = lo;
    }
    this._s = { key, frame, base, barAt, half, most, elbow };
    return this._s;
  },

  pose(u, ctx) {
    const s = this._setup(ctx.rig, ctx);
    const p = { ...s.base };
    const at = s.barAt(lerp(d(4), s.most, u));
    // The bar's bends lie across the forearms and turn the hands a little thumbs-up.
    const ez = ezGrip(s.half, at.clone().sub(s.elbow).normalize());
    p._bar = { c: ez.c, offset: ez.offset };
    handsOnBar(ctx.rig, s.frame, p, {
      at, half: s.half, align: 1, ...BAR, line: ez.line,
      // The elbows point up at the ceiling and stay there.
      pole: (side) => new THREE.Vector3(sgn(side) * 0.05, 1, 0.35),
    });
    return p;
  },

  muscles: [
    {
      key: 'triceps-long', label: 'Triceps, long head', role: 'Prime mover',
      note: 'The long head crosses the shoulder too. With the arms tilted back towards the head it is stretched, which is why this lift trains it so well.',
      match: /long head of triceps brachii/i,
      effort: (t) => clamp01(0.20 + 0.45 * bell(t, 0.40, 0.12) + 0.75 * bell(t, 0.60, 0.12)),
    },
    {
      key: 'triceps-short', label: 'Triceps, outer and inner heads', role: 'Prime mover',
      note: 'The lateral and medial heads straighten the elbow. They work hardest as the bar leaves the bottom.',
      match: /lateral head of triceps brachii|medial head of triceps brachii/i,
      effort: (t) => clamp01(0.20 + 0.40 * bell(t, 0.40, 0.12) + 0.70 * bell(t, 0.58, 0.12)),
    },
    {
      key: 'anconeus', label: 'Anconeus', role: 'Synergist',
      note: 'A small muscle at the back of the elbow. It helps the triceps straighten the arm.',
      match: /anconeus/i,
      effort: (t) => clamp01(0.15 + 0.45 * bell(t, 0.62, 0.14)),
    },
    {
      key: 'hold', label: 'Lats and rear shoulder', role: 'Stabiliser',
      note: 'Hold the upper arms still, tilted back, so only the elbows move.',
      match: /latissimus dorsi|teres major|scapular spinal part of deltoid/i,
      effort: (t) => clamp01(0.20 + 0.25 * bell(t, 0.48, 0.2)),
    },
    {
      key: 'grip', label: 'Grip and forearm', role: 'Grip',
      note: 'Holds the bar and keeps the wrists straight.',
      match: /flexor carpi|flexor digitorum|palmaris longus|flexor pollicis|extensor carpi/i,
      effort: () => 0.40,
    },
  ],
};
