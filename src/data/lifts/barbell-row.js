import * as THREE from 'three';
import { d, lerp, clamp01, bell, keyCurve, Frame, plantFeet, handsOnBar, joint, shoulderWorld, hangingBar, restingOn, squatStance, midfoot, SIDES, sgn, form, bodyKey } from '../../core/lift.js';

/**
 * Bent-over barbell row.
 *
 * The body takes one position and holds it for the whole set: knees bent, hips back, the
 * back flat and tipped forward about 50 degrees from upright. Only the arms and the
 * shoulder blades move. The bar starts at arm's length under the shoulders and is pulled to
 * the bottom of the chest, where it touches the body at the point measured on this body's
 * skin, and the shoulder blades squeeze together at the top.
 */
const BAR = { radius: 0.0145, flesh: 0.011 };
const LEAN = d(50);

export const BARBELL_ROW = {
  id: 'barbell-row',
  part: 'Back',
  name: 'Bent-over barbell row',
  sub: 'Back flat and tipped forward, bar pulled to the bottom of the chest',
  source: 'Frédéric Delavier, Strength Training Anatomy — Bent-Over Rows; standard strength-coaching technique',
  duration: 3.0,
  bar: BAR,

  u: keyCurve([[0, 0], [0.34, 1], [0.46, 1], [0.88, 0], [1, 0]]),
  phases: [
    { key: 'pull', name: 'Pulling', t0: 0.00, t1: 0.34, work: true, hint: 'Lead with the elbows and pull the bar to the bottom of the chest. The body stays still.' },
    { key: 'top', name: 'Squeeze', t0: 0.34, t1: 0.46, hint: 'The bar touches the body and the shoulder blades squeeze together.' },
    { key: 'lower', name: 'Lowering', t0: 0.46, t1: 0.88, hint: 'Lower the bar under control until the arms are straight.' },
    { key: 'bottom', name: 'Arms straight', t0: 0.88, t1: 1.00, hint: 'The arms hang straight and the shoulder blades spread apart. The back is still flat.' },
  ],
  marks: [{ label: '⤓ Arms straight', t: 0 }, { label: '⤒ Top', t: 0.40 }],
  poster: 0.24,
  ready: 'Bent over with a flat back, the bar hanging at arm\'s length under the shoulders.',

  form: form(
    [
      'Stand with your feet at hip width. Hold the bar with your palms facing you, hands a little wider than your shoulders.',
      'Bend your knees slightly, push your hips back and lean your chest forward, about halfway between upright and level with the floor.',
      'Keep your back flat and your head in line with it. The bar hangs at arm\'s length under your shoulders.',
    ],
    [
      'Pull the bar up to the bottom of your chest, just above your stomach.',
      'Lead with your elbows. They travel back past your body, at about 45 degrees from your sides.',
      'Squeeze your shoulder blades together at the top.',
      'Lower the bar under control until your arms are straight and your shoulder blades spread apart.',
      'Your body stays still. Only your arms and shoulder blades move.',
    ],
    [
      'Standing up as you pull, or jerking the bar with the hips. Momentum does the work and the lower back takes the strain.',
      'Rounding the back. Keep your chest up and your back flat.',
      'Pulling the bar towards the neck with the elbows flared out. That moves the work to the shoulders.',
      'Stopping short of straight arms at the bottom. The back muscles then work through only half their range.',
    ],
    'Breathe out as you pull. Breathe in as you lower the bar.',
  ),

  equipment: { floor: true, bar: 'olympic' },

  camera(ctx) {
    const s = (ctx.height || 1.7433) / 1.7433;
    return {
      target: [0, 0.85 * s, 0.05],
      offset: [1.85, 0.45, 1.35],
      box: [[-0.55, 0.0, -0.55], [0.55, 1.75 * s, 0.70]],
    };
  },

  /** Per body, once: the held position, and the two ends of the bar's path. */
  _setup(rig) {
    const key = bodyKey();
    if (this._s?.key === key) return this._s;
    // The hips go back until the bar, hanging under the shoulders, and the body together
    // are over the middle of the foot. Placed by the knees alone, the bar hung 23 cm in
    // front of the foot, which no one could hold.
    const mf = midfoot(rig), upper = new THREE.Vector3(0, 0.30, 0);
    const place = (thigh) => Frame.lean(rig, LEAN, squatStance(rig, {}, d(-2), thigh).hip);
    const balance = (thigh) => {
      const f = place(thigh), q = { root: f.entry() };
      girdle(q, 0);
      return 0.35 * shoulderWorld(rig, f, q, 'l').z + 0.65 * f.toWorld(rig.hipCentre().add(upper)).z - mf;
    };
    let lo = d(0), hi = d(60);
    for (let i = 0; i < 26; i++) { const mid = (lo + hi) / 2; if (balance(mid) > 0) lo = mid; else hi = mid; }
    const frame = place((lo + hi) / 2);
    const p = { root: frame.entry() };
    girdle(p, 0);
    plantFeet(rig, frame, p);
    const half = Math.abs(joint(rig, 'l', 'gh').x) + 0.08;
    const start = hangingBar(rig, frame, p, half, shoulderWorld(rig, frame, p, 'l').z, BAR.radius);
    // The bottom of the chest: a little over half-way from the hips to the shoulders, on
    // the front of the body.
    const H = rig.hipCentre(), G = joint(rig, 'l', 'gh');
    const top = frame.toWorld(restingOn(rig, lerp(H.y, G.y, 0.60), +1, BAR.radius, { clear: 0.004 }));
    this._s = { key, frame, half, start, top };
    return this._s;
  },

  pose(u, { rig }) {
    const s = this._setup(rig);
    const p = { root: s.frame.entry() };
    girdle(p, u);
    plantFeet(rig, s.frame, p);
    handsOnBar(rig, s.frame, p, {
      at: s.start.clone().lerp(s.top, u), half: s.half, align: 1, ...BAR,
      // Elbows up and back past the body, about 45 degrees out from the sides.
      pole: (side) => s.frame.dirToWorld(new THREE.Vector3(sgn(side) * 0.55, -0.15, -1)),
    });
    return p;
  },

  muscles: [
    {
      key: 'lats', label: 'Latissimus dorsi', role: 'Prime mover',
      note: 'The broad muscle of the back. It pulls the upper arm back and down towards the hips.',
      match: /latissimus dorsi|teres major/i,
      effort: (t) => clamp01(0.20 + 0.70 * bell(t, 0.20, 0.12) + 0.45 * bell(t, 0.62, 0.14)),
    },
    {
      key: 'mid-back', label: 'Rhomboids and the middle and lower trapezius', role: 'Prime mover',
      note: 'Between and below the shoulder blades. They squeeze the blades together and hold them down. They work hardest at the top.',
      match: /rhomboid|transverse part of trapezius|ascending part of trapezius/i,
      effort: (t) => clamp01(0.18 + 0.75 * bell(t, 0.36, 0.10) + 0.35 * bell(t, 0.56, 0.12)),
    },
    {
      key: 'delt-rear', label: 'Back of the shoulder', role: 'Synergist',
      note: 'The rear deltoid pulls the elbow back past the body.',
      match: /scapular spinal part of deltoid/i,
      effort: (t) => clamp01(0.15 + 0.60 * bell(t, 0.30, 0.12) + 0.30 * bell(t, 0.58, 0.12)),
    },
    {
      key: 'arms', label: 'Biceps and brachialis', role: 'Synergist',
      note: 'Bend the elbows as the bar comes up. They help, but the back should do most of the pulling.',
      match: /biceps brachii|^brachialis muscle|brachioradialis/i,
      effort: (t) => clamp01(0.15 + 0.50 * bell(t, 0.24, 0.13) + 0.25 * bell(t, 0.62, 0.14)),
    },
    {
      key: 'erector', label: 'Back muscles', role: 'Stabiliser',
      note: 'Hold the back flat and still, tipped forward under the load, for the whole set.',
      match: /iliocostalis|longissimus thoracis|spinalis thoracis|multifidus/i,
      effort: () => 0.55,
    },
    {
      key: 'hams', label: 'Hamstrings and glutes', role: 'Stabiliser',
      note: 'Hold the hips in place, so the body does not rise as the bar comes up.',
      match: /biceps femoris|semitendinosus|semimembranosus|gluteus maximus/i,
      effort: () => 0.38,
    },
    {
      key: 'grip', label: 'Grip and forearm', role: 'Grip',
      note: 'Holds the bar the whole time.',
      match: /flexor carpi|flexor digitorum|palmaris longus|flexor pollicis/i,
      effort: () => 0.48,
    },
  ],
};

/** Shoulder blades spread a little at the bottom, squeezed together at the top. */
function girdle(p, u) {
  const r = lerp(d(-6), d(14), u);
  for (const side of SIDES) p[`girdle.${side}`] = { rot: [0, sgn(side) * r, 0] };
}
