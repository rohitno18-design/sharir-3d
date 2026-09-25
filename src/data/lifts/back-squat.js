import * as THREE from 'three';
import { d, lerp, clamp01, ease, bell, keyCurve, Frame, plantFeet, handsOnBar, joint, restingOn, midfoot, squatStance, leanToBalance, SIDES, sgn, form, bodyKey, bendSpine, armSpace } from '../../core/lift.js';

/**
 * Barbell back squat, bar high on the upper back.
 *
 * Built the way it is coached. The feet are planted a little wider than the hips with the
 * toes turned out. The shins lean forward along the line of the toes, the hips drop until
 * the hip joint is just below the knee (thighs a little past level), and the thigh's own
 * length decides how far back the hips sit. The back angle is not chosen at all: it is
 * solved so that the bar stays over the middle of the foot, which is what balance under a
 * bar on the back requires. The back stays straight the whole way, because the trunk is
 * one braced piece.
 */
const BAR = { radius: 0.0145, flesh: 0.011 };
const TOE_OUT = d(24);
const SHIN_LEAN = d(33);         // how far the shins lean forward at the bottom
const BELOW = 0.035;             // hip joint this far below the knee at the bottom
const STAND_LEAN = d(3);         // the whole straight leg leans this far forward, standing

export const BACK_SQUAT = {
  id: 'back-squat',
  part: 'Quads',
  name: 'Barbell back squat',
  sub: 'Bar high on the upper back, down to just below parallel',
  source: 'Frédéric Delavier, Strength Training Anatomy — Squats; Mark Rippetoe, Starting Strength — The Squat',
  duration: 3.6,
  bar: BAR,

  u: keyCurve([[0, 0], [0.42, 1], [0.50, 1], [0.90, 0], [1, 0]]),
  phases: [
    { key: 'down', name: 'Going down', t0: 0.00, t1: 0.42, hint: 'Hips back and knees forward together. The knees follow the toes, and the bar stays over the middle of the foot.' },
    { key: 'bottom', name: 'The bottom', t0: 0.42, t1: 0.50, hint: 'The hip crease is just below the top of the knee. The back is still straight and the heels are still down.' },
    { key: 'up', name: 'Driving up', t0: 0.50, t1: 0.90, work: true, hint: 'Push the floor away. The hips and the chest rise together, and the knees stay out.' },
    { key: 'stand', name: 'Standing tall', t0: 0.90, t1: 1.00, hint: 'Hips and knees straight. Take a breath and brace again before the next rep.' },
  ],
  marks: [{ label: '⤒ Standing', t: 0 }, { label: '⤓ Bottom', t: 0.46 }],
  poster: 0.62,
  ready: 'Standing tall, the bar on the upper back, stomach tight.',
  progress: (u) => (u > 0.97 ? 'At full depth' : `${Math.round(u * 100)}% of the way down`),

  form: form(
    [
      'Rest the bar on your upper back, on the trapezius just above the back of your shoulders. Not on your neck.',
      'Grip the bar a little wider than your shoulders. Pull your shoulder blades together, with your elbows pointing down and back.',
      'Stand with your heels about shoulder width apart and your toes turned out about 20 to 30 degrees.',
      'Take a big breath and tighten your stomach. Your back stays straight from here to the end of the rep.',
    ],
    [
      'Push your hips back and bend your knees at the same time.',
      'Let your knees travel forward and out, in line with your toes.',
      'Keep the bar over the middle of your feet. Your chest leans forward as much as it needs to, and no more.',
      'Go down until the crease of your hip is just below the top of your knee.',
      'Drive back up the same way. Your hips and chest rise together.',
    ],
    [
      'Knees falling inward. Push them out, over your toes.',
      'Heels lifting off the floor. Keep your weight over the middle of your foot.',
      'Rounding the lower back at the bottom. Only go as deep as your back stays straight.',
      'Hips shooting up first on the way up. The squat turns into a bend at the waist, and the lower back takes the load.',
    ],
    'Take a big breath at the top and hold it on the way down. Breathe out near the top on the way up.',
  ),

  faults: [{
    key: 'butt-wink', label: 'Lower back rounding at the bottom',
    note: 'At the bottom the pelvis tucks under and the lower back rounds. Under a heavy bar that squeezes the spinal discs. Stop just above the depth where it starts.',
  }],

  equipment: { floor: true, bar: 'olympic' },

  camera(ctx) {
    const s = (ctx.height || 1.7433) / 1.7433;
    return {
      target: [0, 0.95 * s, 0.0],
      offset: [1.75, 0.55, 1.55],
      box: [[-0.55, 0.0, -0.55], [0.55, 1.95 * s, 0.60]],
    };
  },

  /** Per body, once: the feet, the bar's place on the back, and how far the thighs go. */
  _setup(rig) {
    const key = bodyKey();
    if (this._s?.key === key) return this._s;
    const gh = joint(rig, 'l', 'gh');
    const feet = { spread: Math.abs(gh.x) + 0.02, toeOut: TOE_OUT };
    // On the upper trapezius, just above the back of the shoulders.
    const bar = restingOn(rig, gh.y + 0.035, -1, BAR.radius, { clear: 0.004 });
    // At the bottom the hip joint is BELOW under the knee: thighs a little past level.
    const { r } = squatStance(rig, feet, SHIN_LEAN, 0);
    const bottom = Math.acos(-BELOW / r);
    this._s = { key, feet, bar, bottom, half: Math.abs(gh.x) + 0.13, mf: midfoot(rig) };
    return this._s;
  },

  /** `hip` moved along the line from the ankles until the legs are straight. */
  _straight(rig, s, hip) {
    const A = joint(rig, 'l', 'ankle'), K = joint(rig, 'l', 'knee'), H = joint(rig, 'l', 'hip');
    const full = (A.distanceTo(K) + K.distanceTo(H)) * 0.999;
    const ankle = new THREE.Vector3(s.feet.spread, A.y, A.z);
    const hipJoint = hip.clone().setX(Math.abs(H.x));
    const dir = hipJoint.clone().sub(ankle).normalize();
    return ankle.addScaledVector(dir, full).setX(0);
  },

  pose(u, { rig, fault }) {
    const s = this._setup(rig);
    // Standing, the legs are straight and lean forward a touch from the ankles, which is
    // how a body carries its weight over the middle of the foot.
    // The knees start forward early, together with the hips going back: a squat breaks at
    // both joints at once. Moving the knees on the same schedule as the hips let the hips
    // go back first, and the chest dipped further halfway down than at the bottom.
    const shin = lerp(STAND_LEAN, SHIN_LEAN, 1 - Math.pow(1 - u, 1.7));
    const { hip, knee } = squatStance(rig, s.feet, shin, lerp(-STAND_LEAN, s.bottom, u));
    // Standing, the knees are straight. Near straight, a centimetre of leg length reads as a
    // clear bend, so the top is set exactly: the hips pushed out along the leg until each
    // leg is at its full length, blended into the squat's own path over the first part of
    // the way down.
    if (u < 0.2) hip.lerp(this._straight(rig, s, hip), 1 - u / 0.2);
    // A working set with a bar of about 80% of bodyweight: the bar is 0.45 of the weight.
    const lean = leanToBalance(rig, hip, s.bar, s.mf, { knee, load: 0.45 });
    // The mistake: in the last part of the descent the pelvis tucks under (it tips back)
    // while the lower back rounds forward by the same amount, so the chest stays where it was.
    const wink = fault === 'butt-wink' ? d(18) * Math.max(0, (u - 0.7) / 0.3) ** 1.5 : 0;
    const frame = Frame.lean(rig, lean - wink, hip);
    const p = { root: frame.entry() };
    if (wink) bendSpine(p, { lumbar: wink });
    plantFeet(rig, frame, p, s.feet);
    // Shoulder blades squeezed together: that is what makes the shelf the bar sits on.
    for (const side of SIDES) p[`girdle.${side}`] = { rot: [0, sgn(side) * d(9), 0] };
    handsOnBar(rig, frame, p, {
      at: s.bar.clone().applyMatrix4(armSpace(rig, frame, p).M), half: s.half, align: 1, ...BAR,
      pole: (side) => frame.dirToWorld(new THREE.Vector3(sgn(side) * 0.25, -1, -0.45)),
    });
    return p;
  },

  muscles: [
    {
      key: 'quads', label: 'Quadriceps', role: 'Prime mover',
      note: 'The front of the thigh straightens the knee. It works hardest coming out of the bottom.',
      match: /vastus lateralis|vastus medialis|vastus intermedius|rectus femoris/i,
      effort: (t) => clamp01(0.20 + 0.45 * bell(t, 0.38, 0.12) + 0.75 * bell(t, 0.58, 0.12)),
    },
    {
      key: 'glutes', label: 'Gluteus maximus', role: 'Prime mover',
      note: 'Straightens the hip. It is stretched most at the bottom, and drives the hips up from there.',
      match: /gluteus maximus/i,
      effort: (t) => clamp01(0.15 + 0.40 * bell(t, 0.42, 0.10) + 0.70 * bell(t, 0.60, 0.13)),
    },
    {
      key: 'adductor', label: 'Adductor magnus', role: 'Synergist',
      note: 'The big muscle on the inside of the thigh. Deep in the squat it helps straighten the hip.',
      match: /adductor magnus/i,
      effort: (t) => clamp01(0.15 + 0.60 * bell(t, 0.52, 0.12)),
    },
    {
      key: 'erector', label: 'Back muscles', role: 'Stabiliser',
      note: 'Hold the back straight under the bar. The more the chest leans forward, the harder they work.',
      match: /iliocostalis|longissimus thoracis|spinalis thoracis|multifidus|quadratus lumborum/i,
      effort: (t) => clamp01(0.35 + 0.40 * bell(t, 0.50, 0.18)),
    },
    {
      key: 'hams', label: 'Hamstrings', role: 'Stabiliser',
      note: 'The back of the thigh. They help hold the hips and knees steady and share a little of the hip drive.',
      match: /biceps femoris|semitendinosus|semimembranosus/i,
      effort: (t) => clamp01(0.15 + 0.30 * bell(t, 0.56, 0.14)),
    },
    {
      key: 'brace', label: 'Stomach brace', role: 'Stabiliser',
      note: 'The breath you hold and the tight stomach make the trunk one solid piece that the bar can sit on.',
      match: /rectus abdominis|external abdominal oblique|internal abdominal oblique/i,
      effort: (t) => clamp01(0.35 + 0.25 * bell(t, 0.50, 0.2)),
    },
    {
      key: 'calves', label: 'Calves', role: 'Stabiliser',
      note: 'Keep the shins and the ankles steady, with the heels down.',
      match: /gastrocnemius|soleus/i,
      effort: (t) => clamp01(0.15 + 0.25 * bell(t, 0.50, 0.16)),
    },
  ],
};
