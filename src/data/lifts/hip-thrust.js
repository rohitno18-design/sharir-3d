import * as THREE from 'three';
import { d, lerp, clamp01, bell, keyCurve, Frame, plantFeet, handsOnBar, joint, restingOn, clearOfBody, legLengths, SIDES, sgn, form, bodyKey, bendSpine } from '../../core/lift.js';

/**
 * Barbell hip thrust.
 *
 * The upper back rests on the edge of a bench set crosswise behind the lifter, the feet are
 * planted, and the bar lies across the crease of the hips. The trunk pivots about the bench
 * edge: the hips drop to just above the floor and are driven up until the body is straight
 * from the shoulders to the knees. The feet are placed so the shins are upright at the top,
 * which is the setup coaches check first.
 */
const BAR = { radius: 0.0145, flesh: 0.011 };
const BENCH_TOP = 0.42;
const DROP = d(34);              // how far the trunk tips down from level at the bottom
const X = new THREE.Vector3(1, 0, 0);

export const HIP_THRUST = {
  id: 'hip-thrust',
  part: 'Glutes',
  name: 'Barbell hip thrust',
  sub: 'Upper back on a bench, bar across the hips',
  source: 'Bret Contreras, the barbell hip thrust; Frédéric Delavier, Strength Training Anatomy — gluteal work; standard strength-coaching technique',
  duration: 3.0,
  bar: BAR,

  u: keyCurve([[0, 0], [0.34, 1], [0.46, 1], [0.86, 0], [1, 0]]),
  phases: [
    { key: 'drive', name: 'Driving up', t0: 0.00, t1: 0.34, work: true, hint: 'Drive through the heels and push the hips up. The upper back pivots on the bench edge.' },
    { key: 'top', name: 'Squeeze at the top', t0: 0.34, t1: 0.46, hint: 'Shoulders to knees in a straight line, shins upright. Squeeze the glutes hard.' },
    { key: 'lower', name: 'Lowering', t0: 0.46, t1: 0.86, hint: 'Lower the hips under control. Keep the ribs down and the feet flat.' },
    { key: 'bottom', name: 'Hips low', t0: 0.86, t1: 1.00, hint: 'The hips hang just above the floor, and the glutes are stretched.' },
  ],
  marks: [{ label: '⤓ Hips low', t: 0 }, { label: '⤒ Top', t: 0.40 }],
  poster: 0.30,
  ready: 'Upper back on the bench edge, feet planted, the bar across the hips.',

  form: form(
    [
      'Sit on the floor with your upper back against the edge of a bench, just below your shoulder blades.',
      'Roll the bar over your legs until it sits in the crease of your hips. A thick pad on the bar makes this comfortable.',
      'Plant your feet flat, about shoulder width apart, so your shins will be upright at the top.',
      'Hold the bar with both hands just outside your hips, to keep it steady.',
    ],
    [
      'Tuck your chin a little and look forward. Drive through your heels and push your hips up.',
      'Rise until your body is straight from your shoulders to your knees, level with the floor.',
      'Squeeze your glutes hard at the top for a moment.',
      'Lower your hips under control until they are just above the floor.',
    ],
    [
      'Arching the lower back at the top instead of finishing with the glutes. Keep the ribs down.',
      'Pushing through the toes. Keep the heels down.',
      'Feet too far forward or too close. Set them so the shins are upright at the top.',
      'Letting the knees fall inward. Push them out, in line with the feet.',
    ],
    'Breathe out as you push up. Breathe in as you lower your hips.',
  ),

  equipment: {
    floor: true,
    bar: 'olympic',
    bench: { top: BENCH_TOP, length: 1.20, width: 0.33, center: [0, -0.20], along: 'x' },
  },

  camera() {
    return {
      target: [0, 0.48, 0.30],
      offset: [1.75, 0.55, 1.10],
      box: [[-0.55, 0.0, -0.40], [0.55, 1.00, 1.05]],
    };
  },

  /** Per body, once: where the back touches the bench, the bar's place, and the feet. */
  _setup(rig) {
    const key = bodyKey();
    if (this._s?.key === key) return this._s;
    const gh = joint(rig, 'l', 'gh');
    // The back meets the bench just below the shoulder blades: a point on the skin there.
    // (A probe with no thickness is never "inside" anything, so it is given a centimetre.)
    const back = restingOn(rig, gh.y - 0.15, -1, 0.01, { clear: 0.001 });
    back.z += 0.01;
    const edge = new THREE.Vector3(0, BENCH_TOP, -0.035);
    // Across the crease of the hips.
    const H = rig.hipCentre();
    const bar = restingOn(rig, H.y + 0.02, +1, BAR.radius, { clear: 0.006 });
    // Feet: where the knees land over the ankles, shins upright, at the top.
    const top = this._frame(rig, 1, back, edge);
    const hipTop = top.hip;
    const { thigh } = legLengths(rig);
    const A = joint(rig, 'l', 'ankle');
    const feet = { spread: Math.abs(gh.x) - 0.01, z: hipTop.z + thigh * 0.93 };
    this._s = { key, back, edge, bar, feet, half: Math.abs(H.x) + 0.17, ankleY: A.y };
    return this._s;
  },

  /** The trunk pivoting about the bench edge: level at the top, tipped down at the bottom. */
  _frame(rig, u, back, edge) {
    const q = new THREE.Quaternion().setFromAxisAngle(X, d(-90) + DROP * (1 - u));
    return Frame.touching(rig, q, back, edge);
  },

  pose(u, { rig }) {
    const s = this._setup(rig);
    const frame = this._frame(rig, u, s.back, s.edge);
    const p = { root: frame.entry() };
    // Chin tucked and eyes forward, not up at the ceiling. The higher the hips, the more the
    // neck has to bend to keep looking forward, and a tucked chin keeps the ribs down.
    bendSpine(p, { neck: lerp(d(14), d(30), u), head: lerp(d(6), d(16), u) });
    for (const side of SIDES) p[`girdle.${side}`] = { rot: [0, sgn(side) * d(4), 0] };
    plantFeet(rig, frame, p, { spread: s.feet.spread, z: s.feet.z });
    // The bar rides on the hip crease. With the hips low the thighs fold up towards it, so
    // it is lifted clear of them along the front of the body, never into them.
    const at = clearOfBody(rig, rig.bodyCloud(p), frame.toWorld(s.bar), frame.dirToWorld(new THREE.Vector3(0, 0, 1)), BAR.radius, { clear: 0.005, reach: 0.15, step: 0.004 });
    handsOnBar(rig, frame, p, {
      at, half: s.half, align: 1, ...BAR,
      // Elbows out to the sides and down towards the floor.
      pole: (side) => new THREE.Vector3(sgn(side), -0.6, 0.1),
    });
    return p;
  },

  muscles: [
    {
      key: 'glutes', label: 'Gluteus maximus', role: 'Prime mover',
      note: 'Straightens the hip against the bar. Unlike in a squat, it works hardest right at the top, where the hips are fully straight.',
      match: /gluteus maximus/i,
      effort: (t) => clamp01(0.25 + 0.80 * bell(t, 0.36, 0.13) + 0.40 * bell(t, 0.58, 0.12)),
    },
    {
      key: 'hams', label: 'Hamstrings', role: 'Synergist',
      note: 'Help straighten the hip. With the knees bent they are short, so they help less than in a deadlift.',
      match: /biceps femoris|semitendinosus|semimembranosus/i,
      effort: (t) => clamp01(0.15 + 0.40 * bell(t, 0.30, 0.13) + 0.20 * bell(t, 0.60, 0.12)),
    },
    {
      key: 'glute-med', label: 'Gluteus medius', role: 'Stabiliser',
      note: 'On the side of the hip. It keeps the knees from falling inward.',
      match: /gluteus medius|gluteus minimus/i,
      effort: (t) => clamp01(0.20 + 0.40 * bell(t, 0.36, 0.14)),
    },
    {
      key: 'quads', label: 'Quadriceps', role: 'Synergist',
      note: 'Hold the knees at about a right angle and push the feet into the floor.',
      match: /vastus lateralis|vastus medialis|vastus intermedius|rectus femoris/i,
      effort: (t) => clamp01(0.18 + 0.35 * bell(t, 0.34, 0.14)),
    },
    {
      key: 'adductor', label: 'Adductor magnus', role: 'Synergist',
      note: 'The big inner-thigh muscle helps straighten the hip.',
      match: /adductor magnus/i,
      effort: (t) => clamp01(0.15 + 0.35 * bell(t, 0.32, 0.14)),
    },
    {
      key: 'brace', label: 'Trunk brace', role: 'Stabiliser',
      note: 'The stomach keeps the ribs down, so the hips finish the lift and the lower back does not arch.',
      match: /rectus abdominis|external abdominal oblique|internal abdominal oblique|iliocostalis|longissimus thoracis/i,
      effort: (t) => clamp01(0.25 + 0.25 * bell(t, 0.38, 0.16)),
    },
  ],
};
