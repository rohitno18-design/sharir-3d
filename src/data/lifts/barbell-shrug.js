import * as THREE from 'three';
import { d, lerp, clamp01, bell, keyCurve, Frame, plantFeet, handsOnBar, joint, shoulderWorld, hangHeight, clearOfBody, SIDES, sgn, form, HANG_POLE } from '../../core/lift.js';

/**
 * Barbell shrug: standing, arms straight, the shoulders lifted straight up to the ears.
 *
 * Nothing moves but the shoulder girdle. The arms hang straight the whole time and only
 * carry the bar, so the bar rises exactly as far as the shoulders do, and it stays resting
 * against the front of the thighs.
 */
const BAR = { radius: 0.0145, flesh: 0.011 };
const Z = new THREE.Vector3(0, 0, 1);
const LIFT = d(26);         // how far the collarbones swing up at the top
const DROP = d(-4);         // a little below neutral at the bottom: the stretch

export const BARBELL_SHRUG = {
  id: 'barbell-shrug',
  part: 'Traps',
  name: 'Barbell shrug',
  sub: 'Standing, arms straight, shoulders straight up and down',
  source: 'Frédéric Delavier, Strength Training Anatomy — Barbell Shrugs; standard strength-coaching technique',
  duration: 3.0,
  bar: BAR,

  u: keyCurve([[0, 0], [0.30, 1], [0.45, 1], [0.85, 0], [1, 0]]),
  phases: [
    { key: 'lift', name: 'Shoulders up', t0: 0.00, t1: 0.30, work: true, hint: 'Lift the shoulders straight up towards the ears. The arms stay straight and just hold the bar.' },
    { key: 'top', name: 'Hold at the top', t0: 0.30, t1: 0.45, hint: 'Hold the shoulders high for a moment. This is where the upper trapezius works hardest.' },
    { key: 'lower', name: 'Lowering', t0: 0.45, t1: 0.85, hint: 'Let the shoulders down slowly, all the way, until you feel the stretch.' },
    { key: 'bottom', name: 'Full stretch', t0: 0.85, t1: 1.00, hint: 'The shoulders hang low and the trapezius is stretched. Start the next rep from here.' },
  ],
  marks: [{ label: '⤓ Bottom', t: 0 }, { label: '⤒ Top', t: 0.38 }],
  poster: 0.36,
  ready: 'Standing tall, arms straight, the bar resting against the thighs.',

  form: form(
    [
      'Stand tall with your feet at hip width and the bar against the front of your thighs.',
      'Hold the bar with your palms facing you, hands a little wider than your thighs.',
      'Keep your arms straight and your chest up. Look straight ahead.',
    ],
    [
      'Lift your shoulders straight up towards your ears, as high as they will go.',
      'Hold at the top for a moment.',
      'Lower your shoulders slowly, all the way down, until you feel a stretch in your neck and upper back.',
      'Keep your arms straight the whole time. They only hold the bar.',
    ],
    [
      'Rolling the shoulders in a circle. It adds nothing for the trapezius, and it grinds the shoulder joint.',
      'Bending the elbows to help lift. The biceps then do part of the work.',
      'Pushing the head forward or tipping the chin down. Keep the neck long and in line with the back.',
      'Cutting the range short. Go all the way up and all the way down.',
    ],
    'Breathe out as you lift your shoulders. Breathe in as you lower them.',
  ),

  equipment: { floor: true, bar: 'olympic' },

  camera(ctx) {
    const s = (ctx.height || 1.7433) / 1.7433;
    return {
      target: [0, 1.10 * s, 0.05],
      offset: [1.35, 0.35, 1.95],
      box: [[-0.55, 0.0, -0.30], [0.55, 1.80 * s, 0.50]],
    };
  },

  pose(u, { rig }) {
    const p = {};
    const frame = Frame.lean(rig, 0, rig.hipCentre());
    p.root = frame.entry();
    plantFeet(rig, frame, p);
    // The collarbones swing up about the breastbone. Left is +x, so the left side turns
    // one way about z and the right the other.
    const e = lerp(DROP, LIFT, u);
    for (const side of SIDES) p[`girdle.${side}`] = { rot: [0, sgn(side) * d(2), sgn(side) * e] };
    const half = Math.abs(joint(rig, 'l', 'gh').x) + 0.035;
    // Arms straight down, the bar against the thighs: how low the bar hangs depends on how
    // far forward the thighs push it, and the other way round, so settle the two together.
    const cloud = rig.bodyCloud(p);
    let z = shoulderWorld(rig, frame, p, 'l').z, y = 0;
    for (let i = 0; i < 4; i++) {
      y = hangHeight(rig, frame, p, half, z);
      z = clearOfBody(rig, cloud, new THREE.Vector3(0, y, z), Z, BAR.radius, { clear: 0.004, reach: 0.3 }).z;
    }
    handsOnBar(rig, frame, p, { at: new THREE.Vector3(0, y, z), half, align: 1, pole: (side) => HANG_POLE(side), ...BAR });
    return p;
  },

  muscles: [
    {
      key: 'trap-upper', label: 'Upper trapezius', role: 'Prime mover',
      note: 'The top of the trapezius, from the skull and neck out to the collarbone. It lifts the shoulders, and works hardest at the top.',
      match: /descending part of trapezius/i,
      effort: (t) => clamp01(0.30 + 0.62 * bell(t, 0.34, 0.14) + 0.35 * bell(t, 0.62, 0.14)),
    },
    {
      key: 'levator', label: 'Levator scapulae', role: 'Prime mover',
      note: 'Runs from the neck to the top corner of the shoulder blade, under the trapezius. It lifts the shoulder blade with it.',
      match: /levator scapulae/i,
      effort: (t) => clamp01(0.25 + 0.55 * bell(t, 0.34, 0.15) + 0.30 * bell(t, 0.62, 0.14)),
    },
    {
      key: 'trap-mid', label: 'Middle trapezius', role: 'Synergist',
      note: 'Keeps the shoulder blades from sliding forward as they rise.',
      match: /transverse part of trapezius/i,
      effort: (t) => clamp01(0.18 + 0.35 * bell(t, 0.36, 0.16)),
    },
    {
      key: 'rhomboid', label: 'Rhomboids', role: 'Synergist',
      note: 'Between the spine and the shoulder blades. They help lift the blades and hold them in place.',
      match: /rhomboid/i,
      effort: (t) => clamp01(0.15 + 0.32 * bell(t, 0.36, 0.16)),
    },
    {
      key: 'grip', label: 'Grip and forearm', role: 'Grip',
      note: 'A heavy bar hangs from the fingers the whole time. The grip is often what gives out first.',
      match: /flexor carpi|flexor digitorum|palmaris longus|flexor pollicis|brachioradialis/i,
      effort: () => 0.62,
    },
    {
      key: 'erector', label: 'Back muscles', role: 'Stabiliser',
      note: 'Hold the back straight and upright under the bar.',
      match: /iliocostalis|longissimus thoracis|spinalis thoracis|multifidus/i,
      effort: (t) => clamp01(0.30 + 0.12 * bell(t, 0.36, 0.2)),
    },
  ],
};
