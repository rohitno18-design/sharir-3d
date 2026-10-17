import * as THREE from 'three';
import { d, lerp, clamp01, bell, keyCurve, Frame, plantFeet, handsOnBar, joint, restingOn, midfoot, SIDES, sgn, form, bodyKey } from '../../core/lift.js';

/**
 * Standing calf raise with the bar on the upper back.
 *
 * The knees stay straight and the whole body rises as one piece: the heels come up, the
 * ball of each foot stays where it is on the floor, and the ankle, and everything above it,
 * goes where the raised foot puts it.
 */
const BAR = { radius: 0.0145, flesh: 0.011 };
const RISE = d(32);                  // ankle extension at the top: heels well off the floor
const X = new THREE.Vector3(1, 0, 0);

export const CALF_RAISE = {
  id: 'calf-raise',
  part: 'Calves',
  name: 'Standing calf raise',
  sub: 'Barbell on the upper back, knees straight',
  source: 'Frédéric Delavier, Strength Training Anatomy — Standing Calf Raises; standard strength-coaching technique',
  duration: 2.8,
  bar: BAR,

  u: keyCurve([[0, 0], [0.30, 1], [0.45, 1], [0.85, 0], [1, 0]]),
  phases: [
    { key: 'rise', name: 'Rising up', t0: 0.00, t1: 0.30, work: true, hint: 'Push through the balls of the feet and rise as high as you can. The knees stay straight.' },
    { key: 'top', name: 'Squeeze at the top', t0: 0.30, t1: 0.45, hint: 'Hold the top for a moment. The calves are fully shortened here.' },
    { key: 'lower', name: 'Lowering', t0: 0.45, t1: 0.85, hint: 'Lower the heels slowly. Do not drop into the bottom.' },
    { key: 'bottom', name: 'Heels down', t0: 0.85, t1: 1.00, hint: 'Heels all the way down and the calves stretched. A short pause here stops the tendon bouncing you up.' },
  ],
  marks: [{ label: '⤓ Heels down', t: 0 }, { label: '⤒ Up', t: 0.38 }],
  poster: 0.36,
  ready: 'Standing tall with the bar on the upper back, heels on the floor.',

  form: form(
    [
      'Rest the bar on your upper back, as for a squat, and stand tall.',
      'Set your feet at hip width with your toes pointing forward.',
      'Keep your knees straight, but not locked hard.',
      'Standing with the balls of your feet on a low block lets the heels drop below the toes, for a bigger stretch.',
    ],
    [
      'Push through the balls of your feet and rise as high as you can.',
      'Hold the top for a moment and squeeze your calves.',
      'Lower your heels slowly, all the way down.',
      'Pause briefly at the bottom before the next rep.',
    ],
    [
      'Bouncing at the bottom. The springy tendon then does the work instead of the muscle.',
      'Bending the knees to help. That takes the gastrocnemius out of the lift.',
      'Rolling onto the outside edge of the foot. Push through the big toe and the ball of the foot.',
      'Going only halfway up. The top is where the calf works hardest.',
    ],
    'Breathe out as you rise. Breathe in as you lower your heels.',
  ),

  equipment: { floor: true, bar: 'olympic' },

  camera(ctx) {
    const s = (ctx.height || 1.7433) / 1.7433;
    return {
      target: [0, 0.80 * s, 0.05],
      offset: [1.75, 0.10, 1.55],
      box: [[-0.55, 0.0, -0.40], [0.55, 2.00 * s, 0.50]],
    };
  },

  _setup(rig) {
    const key = bodyKey();
    if (this._s?.key === key) return this._s;
    const gh = joint(rig, 'l', 'gh');
    this._s = { key, bar: restingOn(rig, gh.y + 0.035, -1, BAR.radius, { clear: 0.004 }), half: Math.abs(gh.x) + 0.13 };
    return this._s;
  },

  pose(u, { rig }) {
    const s = this._setup(rig);
    const rise = RISE * u;
    // Up on the ball of the foot: the ankle arcs up and forward round the ball, and the
    // whole straight body goes with it.
    const A = joint(rig, 'l', 'ankle'), T = joint(rig, 'l', 'mtp');
    const v = T.clone().sub(A);
    const ankle = A.clone().setX(0).add(v.clone().sub(v.clone().applyAxisAngle(X, rise)));
    // The body leans forward from the ankles as one straight piece, just enough to keep the
    // bar and body together over the foot: over the middle of it with the heels down, over
    // the ball of the foot at the top. Upright, the bar on the back would be 20 cm behind
    // the ball of the foot, and a real lifter would topple backwards.
    const legs = rig.hipCentre().sub(A.clone().setX(0));
    const target = lerp(midfoot(rig), T.z - 0.015, u);
    const placed = (a) => {
      const hip = ankle.clone().add(legs.clone().applyAxisAngle(X, a));
      return Frame.lean(rig, a, hip);
    };
    const balance = (a) => {
      const f = placed(a);
      const bar = f.toWorld(s.bar).z, upper = f.toWorld(rig.hipCentre().add(new THREE.Vector3(0, 0.30, 0))).z;
      return 0.45 * bar + 0.55 * upper - target;
    };
    let lo = d(-8), hi = d(25);
    for (let i = 0; i < 26; i++) { const mid = (lo + hi) / 2; if (balance(mid) < 0) lo = mid; else hi = mid; }
    const frame = placed((lo + hi) / 2);
    const p = { root: frame.entry() };
    plantFeet(rig, frame, p, { rise });
    for (const side of SIDES) p[`girdle.${side}`] = { rot: [0, sgn(side) * d(9), 0] };
    handsOnBar(rig, frame, p, {
      at: frame.toWorld(s.bar), half: s.half, align: 1, ...BAR,
      // In the body's own frame, like the bar, so the elbows stay put as the body leans.
      pole: (side) => frame.dirToWorld(new THREE.Vector3(sgn(side) * 0.25, -1, -0.45)),
    });
    return p;
  },

  muscles: [
    {
      key: 'gastroc', label: 'Gastrocnemius', role: 'Prime mover',
      note: 'The two-headed calf muscle you can see. It crosses the knee too, so it works fully only with the knee straight.',
      match: /gastrocnemius/i,
      effort: (t) => clamp01(0.20 + 0.70 * bell(t, 0.24, 0.12) + 0.40 * bell(t, 0.38, 0.08) + 0.40 * bell(t, 0.62, 0.14)),
    },
    {
      key: 'soleus', label: 'Soleus', role: 'Prime mover',
      note: 'The flat calf muscle under the gastrocnemius. It lifts the heel whatever the knee is doing.',
      match: /soleus/i,
      effort: (t) => clamp01(0.20 + 0.60 * bell(t, 0.24, 0.13) + 0.35 * bell(t, 0.62, 0.14)),
    },
    {
      key: 'deep', label: 'Deep calf muscles', role: 'Synergist',
      note: 'Behind the shin bones. They help point the foot and keep the ankle from rolling out.',
      match: /tibialis posterior|flexor hallucis longus|flexor digitorum longus|plantaris|fibularis longus|fibularis brevis/i,
      effort: (t) => clamp01(0.15 + 0.40 * bell(t, 0.26, 0.14)),
    },
    {
      key: 'brace', label: 'Trunk brace', role: 'Stabiliser',
      note: 'Keeps the body straight and still under the bar, so only the ankles move.',
      match: /rectus abdominis|external abdominal oblique|iliocostalis|longissimus thoracis/i,
      effort: (t) => clamp01(0.28 + 0.12 * bell(t, 0.3, 0.2)),
    },
    {
      key: 'trap', label: 'Upper back', role: 'Stabiliser',
      note: 'The trapezius holds the shelf the bar sits on.',
      match: /descending part of trapezius|transverse part of trapezius|rhomboid/i,
      effort: () => 0.30,
    },
  ],
};
