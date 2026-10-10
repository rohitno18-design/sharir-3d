import * as THREE from 'three';
import { d, lerp, clamp01, bell, keyCurve, Frame, plantFeet, handsOnBar, joint, shoulderWorld, hangingBar, midfoot, squatStance, SIDES, sgn, form, bodyKey, bendSpine, HANG_POLE } from '../../core/lift.js';

/**
 * Romanian deadlift: a hip hinge with the knees slightly bent.
 *
 * How far the trunk tips forward is what drives the lift. The knees hold a slight bend,
 * the shins stay nearly upright, and the hips go back as the chest comes forward. The bar
 * hangs from straight arms, held back against the legs by the lats, so it slides down the
 * thighs and stops just below the knees, which is as far as most people can go with a flat
 * back. That keeps it close over the foot, where the balance is.
 */
const BAR = { radius: 0.0145, flesh: 0.011 };
const HINGE = d(72);             // trunk angle from upright at the bottom

export const ROMANIAN_DEADLIFT = {
  id: 'romanian-deadlift',
  part: 'Hamstrings',
  name: 'Romanian deadlift',
  sub: 'Barbell, hips back, knees slightly bent, back flat',
  source: 'Frédéric Delavier, Strength Training Anatomy — Stiff-Legged Deadlifts; standard strength-coaching technique',
  duration: 3.8,
  bar: BAR,

  u: keyCurve([[0, 0], [0.42, 1], [0.50, 1], [0.90, 0], [1, 0]]),
  phases: [
    { key: 'down', name: 'Hinging down', t0: 0.00, t1: 0.42, hint: 'Push the hips back. The bar slides down the thighs and the back stays flat.' },
    { key: 'bottom', name: 'The stretch', t0: 0.42, t1: 0.50, hint: 'The bar is just below the knees and the hamstrings are stretched. The back is still flat.' },
    { key: 'up', name: 'Standing up', t0: 0.50, t1: 0.90, work: true, hint: 'Drive the hips forward. The hamstrings and the glutes pull the trunk back up.' },
    { key: 'top', name: 'Standing tall', t0: 0.90, t1: 1.00, hint: 'Hips straight and glutes squeezed. Do not lean back.' },
  ],
  marks: [{ label: '⤒ Standing', t: 0 }, { label: '⤓ Bottom', t: 0.46 }],
  poster: 0.60,
  ready: 'Standing tall with the bar against the thighs, knees slightly bent.',

  form: form(
    [
      'Stand with your feet at hip width, holding the bar against your thighs. Hands just outside your legs, palms facing you.',
      'Bend your knees slightly and keep them at that bend for the whole rep.',
      'Pull your shoulder blades back a little and lift your chest. Your back is flat from here on.',
    ],
    [
      'Push your hips back as if closing a car door behind you. Your chest tips forward as the hips go back.',
      'Let the bar slide down the front of your thighs. Keep it touching or very close.',
      'Go down until you feel a strong stretch in the back of your thighs, usually with the bar just below the knees.',
      'Drive your hips forward to stand up. Squeeze your glutes at the top.',
    ],
    [
      'Rounding the back to reach lower. Stop where your back is still flat.',
      'Bending the knees more as you go down. It turns into a squat and takes the stretch off the hamstrings.',
      'Letting the bar drift away from the legs. It pulls you forward and loads the lower back.',
      'Leaning back at the top. Stand straight and squeeze the glutes instead.',
    ],
    'Breathe in and brace at the top. Hold it on the way down. Breathe out as you stand up.',
  ),

  faults: [{
    key: 'rounded-back', label: 'Rounded back',
    note: 'The hips hardly go back, and the back curls forward to reach the bar lower. The lower back takes the load the hamstrings should take, and the front of the spinal discs is squeezed.',
  }],

  equipment: { floor: true, bar: 'olympic' },

  camera(ctx) {
    const s = (ctx.height || 1.7433) / 1.7433;
    return {
      target: [0, 0.85 * s, 0.0],
      offset: [1.85, 0.50, 1.45],
      box: [[-0.55, 0.0, -0.55], [0.55, 1.85 * s, 0.65]],
    };
  },

  pose(u, { rig, fault }) {
    const rounded = fault === 'rounded-back';
    // The knees keep a slight bend and the shins stay nearly upright; the trunk tips
    // forward from the hips. Letting the hips drift back until the bar hung straight under
    // the shoulders bent the knees to 55 degrees, which is a squat, not a Romanian deadlift.
    // "Hips back" shifts the weight towards the heels, and the shins tip a few degrees past
    // upright; that is where most of the hips' travel comes from.
    // Rounded: the hips stop short, and the back curls to make up the depth.
    const lean = lerp(d(4), rounded ? d(48) : HINGE, u);
    const shin = lerp(d(3), d(-4), u);
    const knee = lerp(d(10), d(21), u);
    const { hip } = squatStance(rig, {}, shin, knee - shin);
    const frame = Frame.lean(rig, lean, hip);
    const p = { root: frame.entry() };
    if (rounded) bendSpine(p, { lumbar: d(26) * u, thorax: d(20) * u, neck: d(8) * u });
    for (const side of SIDES) p[`girdle.${side}`] = { rot: [0, sgn(side) * (rounded ? d(-6) * u : d(4)), 0] };
    plantFeet(rig, frame, p);
    // The lats hold the bar back against the legs, so the arms angle back from the
    // shoulders and the bar slides down the thighs and then the shins.
    const half = Math.abs(joint(rig, 'l', 'gh').x) + 0.035;
    const at = hangingBar(rig, frame, p, half, shoulderWorld(rig, frame, p, 'l').z, BAR.radius, { snug: true });
    handsOnBar(rig, frame, p, { at, half, align: 1, ...BAR, pole: (side) => frame.dirToWorld(HANG_POLE(side)) });
    return p;
  },

  muscles: [
    {
      key: 'hams', label: 'Hamstrings', role: 'Prime mover',
      note: 'The back of the thigh. They stretch as the hips go back and pull the trunk up again. They work hardest at the bottom.',
      match: /biceps femoris|semitendinosus|semimembranosus/i,
      effort: (t) => clamp01(0.20 + 0.45 * bell(t, 0.36, 0.12) + 0.72 * bell(t, 0.56, 0.12)),
    },
    {
      key: 'glutes', label: 'Gluteus maximus', role: 'Prime mover',
      note: 'Straightens the hip, together with the hamstrings. It takes over near the top.',
      match: /gluteus maximus/i,
      effort: (t) => clamp01(0.15 + 0.30 * bell(t, 0.40, 0.12) + 0.65 * bell(t, 0.68, 0.14)),
    },
    {
      key: 'erector', label: 'Back muscles', role: 'Stabiliser',
      note: 'Hold the back flat while it is tipped forward under the bar. They work hard, but without moving.',
      match: /iliocostalis|longissimus thoracis|spinalis thoracis|multifidus|quadratus lumborum/i,
      effort: (t) => clamp01(0.30 + 0.50 * bell(t, 0.48, 0.16)),
    },
    {
      key: 'adductor', label: 'Adductor magnus', role: 'Synergist',
      note: 'The big inner-thigh muscle. Part of it works like a hamstring and helps straighten the hip.',
      match: /adductor magnus/i,
      effort: (t) => clamp01(0.15 + 0.45 * bell(t, 0.54, 0.13)),
    },
    {
      key: 'lats', label: 'Latissimus dorsi', role: 'Stabiliser',
      note: 'Keeps the bar pulled in against the legs all the way down and up.',
      match: /latissimus dorsi/i,
      effort: (t) => clamp01(0.25 + 0.25 * bell(t, 0.46, 0.2)),
    },
    {
      key: 'grip', label: 'Grip and forearm', role: 'Grip',
      note: 'Holds the bar the whole time.',
      match: /flexor carpi|flexor digitorum|palmaris longus|flexor pollicis/i,
      effort: () => 0.50,
    },
    {
      key: 'traps', label: 'Upper back', role: 'Stabiliser',
      note: 'The trapezius and rhomboids keep the shoulder blades set, so the upper back does not round.',
      match: /trapezius|rhomboid/i,
      effort: (t) => clamp01(0.25 + 0.20 * bell(t, 0.46, 0.2)),
    },
  ],
};
