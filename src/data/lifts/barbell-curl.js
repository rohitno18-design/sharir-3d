import * as THREE from 'three';
import { d, lerp, clamp01, bell, keyCurve, Frame, plantFeet, handsOnBar, joint, shoulderWorld, hangHeight, clearOfBody, SIDES, sgn, form, bodyKey } from '../../core/lift.js';

/**
 * Barbell curl: standing, a short bar, palms facing forward.
 *
 * Only the forearms move. The body stands still and the elbows stay pinned at the sides,
 * which is the whole point of the strict curl: the moment the trunk swings, momentum does
 * the work and the lower back takes the load. So the trunk here is simply upright, and the
 * bar travels on an arc about the elbow.
 */
const BAR = { radius: 0.0125, flesh: 0.011 };        // a 25 mm curl bar
const Z = new THREE.Vector3(0, 0, 1);
const TOP = d(132);                                  // forearm angle from straight down, at the top
const ELBOW_DRIFT = d(6);                            // the small forward drift a strict curl allows

export const BARBELL_CURL = {
  id: 'barbell-curl',
  part: 'Biceps',
  name: 'Barbell curl',
  sub: 'Standing, with a short bar and an underhand grip',
  source: 'Frédéric Delavier, Strength Training Anatomy — Barbell Curls; standard strength-coaching technique',
  duration: 3.2,
  bar: BAR,

  // Up in 0.40 of the rep, a short squeeze, down slower than up, a moment at the bottom.
  u: keyCurve([[0, 0], [0.40, 1], [0.50, 1], [0.92, 0], [1, 0]]),
  phases: [
    { key: 'lift', name: 'Curling up', t0: 0.00, t1: 0.40, work: true, hint: 'Only the forearms move. The elbows stay pinned at your sides and the body stays still.' },
    { key: 'top', name: 'Squeeze at the top', t0: 0.40, t1: 0.50, hint: 'Hold the bar in front of your upper chest for a moment and squeeze the biceps.' },
    { key: 'lower', name: 'Lowering', t0: 0.50, t1: 0.92, hint: 'Lower the bar slowly. The biceps are still working as they lengthen.' },
    { key: 'bottom', name: 'Arms straight', t0: 0.92, t1: 1.00, hint: 'Straighten the arms fully, so the biceps work through their whole range.' },
  ],
  marks: [{ label: '⤓ Bottom', t: 0 }, { label: '⤒ Top', t: 0.45 }],
  poster: 0.24,
  ready: 'Standing tall, the bar resting against the thighs, arms straight.',

  form: form(
    [
      'Stand tall with your feet at hip width. Keep your knees soft, not locked.',
      'Hold the bar with your palms facing forward and your hands at shoulder width.',
      'Keep your elbows close to your sides, and your shoulders back and down.',
      'Tighten your stomach. Your back stays straight for the whole set.',
    ],
    [
      'Bend your elbows and curl the bar up in an arc. Only your forearms move.',
      'Keep your elbows at your sides. They may drift forward a little at the top, but no more.',
      'Squeeze your biceps at the top for a moment, with the bar in front of your upper chest.',
      'Lower the bar slowly. Take about twice as long to lower it as you took to lift it.',
      'Straighten your arms fully at the bottom before the next rep.',
    ],
    [
      'Swinging the body or leaning back to throw the bar up. Momentum does the work, and the lower back takes the strain.',
      'Letting the elbows travel forward and up. The shoulders then take over from the biceps.',
      'Stopping halfway down. A half rep trains only half of the muscle.',
      'Bending the wrists back or curling them in. Keep them straight and firm.',
    ],
    'Breathe out as you curl the bar up. Breathe in as you lower it.',
  ),

  equipment: { floor: true, bar: 'short' },

  camera(ctx) {
    const s = (ctx.height || 1.7433) / 1.7433;
    return {
      target: [0, 1.02 * s, 0.10],
      offset: [1.55, 0.30, 1.85],
      box: [[-0.42, 0.0, -0.30], [0.42, 1.80 * s, 0.62]],
    };
  },

  /**
   * The start of the rep, worked out once for each body: standing, the bar resting against
   * the front of the thighs with the arms straight. Where it rests is measured on this
   * body's thighs, and how low it hangs comes from this body's arms.
   */
  _start(rig) {
    const key = bodyKey();
    if (this._s?.key === key) return this._s;
    const p = {};
    const frame = Frame.lean(rig, 0, rig.hipCentre());
    p.root = frame.entry();
    plantFeet(rig, frame, p);
    girdle(p);
    const half = Math.abs(joint(rig, 'l', 'gh').x) + 0.015;
    const cloud = rig.bodyCloud(p);
    let z = shoulderWorld(rig, frame, p, 'l').z, y = 0;
    for (let i = 0; i < 4; i++) {
      y = hangHeight(rig, frame, p, half, z);
      z = clearOfBody(rig, cloud, new THREE.Vector3(0, y, z), Z, BAR.radius, { clear: 0.004, reach: 0.3 }).z;
    }
    const at = new THREE.Vector3(0, y, z);
    handsOnBar(rig, frame, p, { at, half, align: -1, pole: pole, ...BAR });
    // The elbow where that leaves it, and the forearm from there to the bar: the arc the
    // bar travels is about this point.
    const sides = {};
    for (const side of SIDES) {
      const fi = rig.bones.findIndex(b => b.name === 'forearm1' && b.side === side);
      const E = joint(rig, side, 'el').applyMatrix4(rig.poseMatrix(p, fi));
      const G = new THREE.Vector3(sgn(side) * half, y, z);
      const L2 = Math.hypot(G.y - E.y, G.z - E.z);
      sides[side] = { E, L2, phi0: Math.atan2(G.z - E.z, E.y - G.y), gh: shoulderWorld(rig, frame, p, side) };
    }
    this._s = { key, frame, half, sides };
    return this._s;
  },

  pose(u, { rig }) {
    const s = this._start(rig);
    const p = { root: s.frame.entry() };
    plantFeet(rig, s.frame, p);
    girdle(p);
    // The forearm sweeps up about the elbow, and the elbow drifts forward a touch as the bar
    // rises. Both sides are the same, so the bar's centre follows the left hand's arc.
    const L = s.sides.l;
    const drift = -ELBOW_DRIFT * u;
    const v = L.E.clone().sub(L.gh);
    const E = L.gh.clone().add(new THREE.Vector3(0, v.y * Math.cos(drift) - v.z * Math.sin(drift), v.y * Math.sin(drift) + v.z * Math.cos(drift)));
    const phi = lerp(L.phi0, TOP, u);
    const at = new THREE.Vector3(0, E.y - L.L2 * Math.cos(phi), E.z + L.L2 * Math.sin(phi));
    handsOnBar(rig, s.frame, p, { at, half: s.half, align: -1, pole, ...BAR });
    return p;
  },

  muscles: [
    {
      key: 'biceps', label: 'Biceps brachii', role: 'Prime mover',
      note: 'Bends the elbow and turns the palm up. It works hardest with the elbow at a right angle, halfway up.',
      match: /biceps brachii/i,
      effort: (t) => clamp01(0.16 + 0.78 * bell(t, 0.22, 0.12) + 0.30 * bell(t, 0.45, 0.06) + 0.52 * bell(t, 0.70, 0.14)),
    },
    {
      key: 'brachialis', label: 'Brachialis', role: 'Prime mover',
      note: 'Lies under the biceps and does as much of the curl as the biceps does. It is the pure elbow bender.',
      match: /^brachialis muscle/i,
      effort: (t) => clamp01(0.18 + 0.72 * bell(t, 0.24, 0.14) + 0.50 * bell(t, 0.70, 0.15)),
    },
    {
      key: 'brachioradialis', label: 'Brachioradialis', role: 'Synergist',
      note: 'The long muscle on the thumb side of the forearm. It helps bend the elbow, most in the middle of the lift.',
      match: /brachioradialis/i,
      effort: (t) => clamp01(0.12 + 0.55 * bell(t, 0.26, 0.13) + 0.35 * bell(t, 0.68, 0.14)),
    },
    {
      key: 'grip', label: 'Grip and forearm', role: 'Grip',
      note: 'Holds the bar and keeps the wrists straight and firm all through the rep.',
      match: /flexor carpi|flexor digitorum|palmaris longus|pronator teres|extensor carpi|flexor pollicis/i,
      effort: (t) => clamp01(0.40 + 0.12 * bell(t, 0.30, 0.2)),
    },
    {
      key: 'delt-ant', label: 'Front of the shoulder', role: 'Stabiliser',
      note: 'Holds the upper arm still. It works more near the top, where the elbows want to drift forward.',
      match: /clavicular part of deltoid/i,
      effort: (t) => clamp01(0.10 + 0.35 * bell(t, 0.38, 0.12) + 0.15 * bell(t, 0.55, 0.10)),
    },
    {
      key: 'brace', label: 'Trunk brace', role: 'Stabiliser',
      note: 'The stomach and the back muscles keep the body still, so the bar is lifted by the arms and not by a swing.',
      match: /rectus abdominis|external abdominal oblique|internal abdominal oblique|iliocostalis|longissimus thoracis/i,
      effort: (t) => clamp01(0.18 + 0.20 * bell(t, 0.25, 0.15)),
    },
    {
      key: 'triceps', label: 'Triceps brachii', role: 'Antagonist',
      note: 'The muscle on the back of the arm. It relaxes to let the elbow bend, and helps settle the arm at the bottom.',
      match: /triceps brachii/i,
      effort: (t) => clamp01(0.06 + 0.14 * bell(t, 0.93, 0.08)),
    },
  ],
};

/** Shoulders set back and down, and kept there. */
function girdle(p) { for (const side of SIDES) p[`girdle.${side}`] = { rot: [0, sgn(side) * d(3), 0] }; }
/**
 * The elbow points down, a little back, and stays by the side. Mostly down: at the top of
 * the curl the arm's own line runs forward, so a pole aimed back has nothing to work with
 * and its small sideways part flared the elbows out.
 */
function pole(side) { return new THREE.Vector3(sgn(side) * 0.03, -1, -0.35); }
