import * as THREE from 'three';
import { d, lerp, clamp01, ease, bell, keyCurve, Frame, plantFeet, handsOnBar, joint, shoulderWorld, pressHeight, clearOfBody, restingOn, midfoot, SIDES, sgn, form, bodyKey } from '../../core/lift.js';

/**
 * Standing overhead press.
 *
 * The bar goes straight up over the middle of the foot, from the front of the shoulders to
 * arms locked overhead. The face is in the way, so the lifter leans the whole body back a
 * little at the start (from the ankles, the back staying straight) and the bar passes close
 * in front of the chin. Once it is past the forehead, the body moves forward under it, so
 * at lockout the bar sits over the shoulder joints and over mid-foot. The shoulders shrug
 * up at the top, which is the shoulder blades turning upward to make room for the arm.
 */
const BAR = { radius: 0.0145, flesh: 0.011 };
const Z = new THREE.Vector3(0, 0, 1);
const LEAN = d(-6);          // the whole-body lean back at the start

export const OVERHEAD_PRESS = {
  id: 'overhead-press',
  part: 'Shoulders',
  name: 'Standing overhead press',
  sub: 'Barbell, standing, from the front of the shoulders to overhead',
  source: 'Frédéric Delavier, Strength Training Anatomy — Front Presses; Mark Rippetoe, Starting Strength — The Press',
  duration: 3.2,
  bar: BAR,

  u: keyCurve([[0, 0], [0.38, 1], [0.48, 1], [0.90, 0], [1, 0]]),
  phases: [
    { key: 'press', name: 'Pressing up', t0: 0.00, t1: 0.38, work: true, hint: 'Push the bar straight up. Lean back only a little to let it pass your face, then move under it.' },
    { key: 'lock', name: 'Lockout', t0: 0.38, t1: 0.48, hint: 'Arms straight, the bar over your shoulders and the middle of your feet. Shrug up to finish.' },
    { key: 'lower', name: 'Lowering', t0: 0.48, t1: 0.90, hint: 'Bring the bar back down in a straight line, close in front of the face.' },
    { key: 'rack', name: 'On the shoulders', t0: 0.90, t1: 1.00, hint: 'The bar rests on the front of the shoulders, elbows a little in front of it. Brace again.' },
  ],
  marks: [{ label: '⤓ Shoulders', t: 0 }, { label: '⤒ Overhead', t: 0.43 }],
  poster: 0.2,
  ready: 'The bar rests on the front of the shoulders. Stomach tight, glutes squeezed.',
  progress: (u) => `Bar ${Math.round(u * 100)}% of the way up`,

  form: form(
    [
      'Stand with your feet between hip and shoulder width, knees straight.',
      'Hold the bar just outside your shoulders, palms facing forward, thumbs round the bar.',
      'Rest the bar on the front of your shoulders. Your elbows sit a little in front of the bar, with your forearms upright.',
      'Squeeze your glutes and tighten your stomach, so your body is one solid piece.',
    ],
    [
      'Press the bar straight up. Pull your head back a little so the bar can pass close in front of your chin.',
      'Once the bar is past your forehead, move your head and chest forward, under the bar.',
      'Lock your elbows at the top, with the bar over your shoulders and the middle of your feet. Shrug your shoulders up to finish.',
      'Lower the bar the same way, in a straight line, back to the front of your shoulders.',
    ],
    [
      'Leaning far back and arching the lower back. That turns the press into a poor incline press and loads the spine.',
      'Pushing the bar forward, round the face. It moves away from the balance point and the shoulders lose leverage.',
      'Bending the knees to drive the bar up. That is a push press, a different lift.',
      'Letting the wrists bend back. Keep the bar over the forearm bones.',
    ],
    'Take a big breath and hold it at the bottom. Breathe out once the bar is past your head, or at the top.',
  ),

  equipment: { floor: true, bar: 'olympic' },

  camera(ctx) {
    const s = (ctx.height || 1.7433) / 1.7433;
    return {
      target: [0, 1.25 * s, 0.05],
      offset: [1.65, 0.20, 1.65],
      box: [[-0.55, 0.0, -0.35], [0.55, 2.25 * s, 0.50]],
    };
  },

  /**
   * The two ends of the lift, worked out once per body: where the bar rests on the front
   * of the shoulders, and where the hips go so that the bar is over mid-foot at the start
   * (leaning back) and at lockout (upright, under the bar).
   */
  _ends(rig) {
    const key = bodyKey();
    if (this._e?.key === key) return this._e;
    const gh = joint(rig, 'l', 'gh');
    const half = Math.abs(gh.x) + 0.05;
    // On top of the front of the shoulders, at the collarbones: a few centimetres above the
    // centre of the shoulder joint. That height matters. With the bar level with the joint,
    // every elbow position the arm can reach sits behind the bar; a little higher, the
    // elbows come forward under it, which is the rack a coach looks for.
    const rack = restingOn(rig, gh.y + 0.045, +1, BAR.radius, { clear: 0.004 });
    rack.z += 0.015;                         // on the deltoids, which the trunk skin leaves out
    const mf = midfoot(rig);
    const hip = rig.hipCentre();
    // Start: leaning back, the bar on the shoulders over mid-foot.
    const f0 = Frame.lean(rig, LEAN, hip);
    const start = hip.clone().setZ(hip.z + (mf - f0.toWorld(rack).z));
    // Lockout: upright, shoulder joints under the bar, the bar over mid-foot.
    const top = hip.clone().setZ(hip.z + (mf - gh.z));
    this._e = { key, half, rack, mf, start, top };
    return this._e;
  },

  pose(u, { rig }) {
    const e = this._ends(rig);
    const k = ease(clamp01(u * 1.25));      // the body is under the bar well before lockout
    const frame = Frame.lean(rig, lerp(LEAN, 0, k), e.start.clone().lerp(e.top, k));
    const p = { root: frame.entry() };
    plantFeet(rig, frame, p);
    // The shoulder blades turn up at the top: the shrug that finishes the press.
    const shrug = d(12) * u * u;
    for (const side of SIDES) p[`girdle.${side}`] = { rot: [0, 0, sgn(side) * shrug] };
    const y0 = frame.toWorld(e.rack).y;
    const y1 = pressHeight(rig, frame, p, e.half, e.mf);
    let at = new THREE.Vector3(0, lerp(y0, y1, u), e.mf);
    if (u > 0) at = clearOfBody(rig, rig.bodyCloud(p), at, Z, BAR.radius, { clear: 0.006, only: [0], reach: 0.25 });
    // Elbows a little in front of the bar and pointing forward, not flared out. At the start
    // the arm is folded too far for an upright forearm, and "as upright as possible" then
    // dropped the elbows behind the bar, which is the wrong rack.
    // In the rack the wrist bends well back, so the bar sits in the heel of the hand over
    // the forearm bones; that is what lets the elbows come forward. It straightens as the
    // bar rises, and is only slightly bent at lockout.
    handsOnBar(rig, frame, p, {
      at, half: e.half, align: 1, ...BAR,
      wrist: lerp(d(62), d(16), ease(clamp01(u * 2.2))),
      pole: (side) => new THREE.Vector3(sgn(side) * 0.3, -0.45, 0.85),
    });
    return p;
  },

  muscles: [
    {
      key: 'delt-front', label: 'Front of the shoulder', role: 'Prime mover',
      note: 'The front of the deltoid lifts the arm up and forward. It does most of the work low in the press.',
      match: /clavicular part of deltoid/i,
      effort: (t) => clamp01(0.30 + 0.62 * bell(t, 0.14, 0.13) + 0.40 * bell(t, 0.68, 0.16)),
    },
    {
      key: 'delt-side', label: 'Side of the shoulder', role: 'Prime mover',
      note: 'The middle of the deltoid takes over as the arms go higher.',
      match: /acromial part of deltoid/i,
      effort: (t) => clamp01(0.25 + 0.55 * bell(t, 0.24, 0.13) + 0.35 * bell(t, 0.66, 0.16)),
    },
    {
      key: 'triceps', label: 'Triceps brachii', role: 'Prime mover',
      note: 'Straightens the elbows. It finishes the press and holds the lockout.',
      match: /triceps brachii/i,
      effort: (t) => clamp01(0.20 + 0.65 * bell(t, 0.30, 0.12) + 0.30 * bell(t, 0.52, 0.12)),
    },
    {
      key: 'trap-upper', label: 'Upper trapezius', role: 'Synergist',
      note: 'Shrugs the shoulders up at the top, which turns the shoulder blades up and makes room for the arm.',
      match: /descending part of trapezius/i,
      effort: (t) => clamp01(0.18 + 0.60 * bell(t, 0.40, 0.10)),
    },
    {
      key: 'serratus', label: 'Serratus anterior', role: 'Synergist',
      note: 'Turns the shoulder blade upward alongside the trapezius, so the arm can go straight overhead.',
      match: /serratus anterior/i,
      effort: (t) => clamp01(0.18 + 0.55 * bell(t, 0.36, 0.12)),
    },
    {
      key: 'brace', label: 'Trunk brace', role: 'Stabiliser',
      note: 'The stomach, the back muscles and the glutes hold the body as one solid piece under the bar.',
      match: /rectus abdominis|external abdominal oblique|internal abdominal oblique|iliocostalis|longissimus thoracis|gluteus maximus/i,
      effort: (t) => clamp01(0.35 + 0.25 * bell(t, 0.20, 0.18)),
    },
    {
      key: 'cuff', label: 'Rotator cuff', role: 'Stabiliser',
      note: 'Keeps the ball of the shoulder centred in its socket while the arm is overhead.',
      match: /infraspinatus|supraspinatus|subscapularis|teres minor/i,
      effort: (t) => clamp01(0.22 + 0.35 * bell(t, 0.36, 0.16)),
    },
  ],
};
