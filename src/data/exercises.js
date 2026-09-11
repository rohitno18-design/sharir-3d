/**
 * Exercises: what the body does, and what it costs each muscle.
 *
 * An exercise is two things kept deliberately separate — a `pose(u)` that says where the
 * bones are at press-phase u, and a list of muscles with an `effort(t)` curve over the rep.
 * They are separate because they peak at different moments: the bar moves fastest in
 * mid-press, but the triceps peak at lockout and the pectorals peak coming off the chest.
 * Tying effort to bar position would lose exactly the thing worth showing.
 *
 * Phase conventions:
 *   u — press phase. 0 = bar on the chest, 1 = elbows locked out.
 *   t — rep phase.   0 = top, lower through 0.45, pause, press, back to 1 = top.
 *
 * Effort values are 0..1 relative to that muscle's own maximum in this lift, not to each
 * other, and are shaped from EMG literature on the flat barbell bench press rather than
 * measured here. They are a teaching aid, not a lab reading.
 */

import * as THREE from 'three';

const d = (deg) => (deg * Math.PI) / 180;
const lerp = (a, b, k) => a + (b - a) * k;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const ease = (k) => k * k * (3 - 2 * k);
/** A hump centred on `c`, `w` wide. */
const bell = (t, c, w) => Math.exp(-(((t - c) / w) ** 2));

/** The quarter-turn that lays a standing body onto its back. */
const ROOT_Q = new THREE.Quaternion().setFromEuler(new THREE.Euler(d(-90), 0, 0, 'XYZ'));

/** Rep phase -> press phase. Lowering is slower than pressing, with a pause on the chest. */
export function pressPhase(t) {
  if (t < 0.42) return 1 - ease(t / 0.42);              // eccentric, controlled
  if (t < 0.52) return 0;                                // paused on the chest
  if (t < 0.92) return ease((t - 0.52) / 0.40);          // concentric drive
  return 1;                                              // locked out
}

export const BENCH_PRESS = {
  id: 'bench-press',
  name: 'Barbell bench press',
  sub: 'Flat bench · setup per Delavier',
  source: 'Frédéric Delavier, Strength Training Anatomy — Bench Presses (p.64) and Positioning for a Power Bench Press (p.65)',
  duration: 3.4,                    // seconds for one full rep
  /** Distance between the hands. Delavier: "an overhand grip wider than shoulder width". */
  grip: 0.62,

  /**
   * The setup Delavier draws, point by point: buttocks on the bench, head on the bench,
   * feet fixed with the heels on the ground, and the bar gripped tightly with the thumb
   * opposing the fingers. The lower body is not scenery here — the book is explicit that
   * planted feet are what stabilises the press.
   */
  setup: {
    footSpread: 0.205,              // half-distance between the feet, wider than the hips
    footReach: 0.30,                // how far the ankle sits towards the feet end of the hip
    fingerMcp: d(-72),              // knuckles closed round the bar
    fingerPip: d(-82),
    thumb: [d(-46), d(38), d(30)],  // thumb brought across to oppose the fingers
  },

  /**
   * The lift is authored as a bar path, not as joint angles: the grip points below are
   * where the hands must be at press phase u, in the model's own rest space (y up the
   * standing body, +z out of its chest). The rig solves the shoulder and elbow from them,
   * so the hands stay on the bar at any body size.
   */
  gripPath(u, side) {
    const m = side === 'l' ? 1 : -1;
    // The hands cannot move along a rigid bar, so the half-grip is constant and only the
    // bar's height and position along the torso change. The bar tracks back towards the
    // shoulders as it rises, which is the J-path a real press follows rather than a
    // straight vertical line.
    return new THREE.Vector3(
      m * (this.grip / 2),
      lerp(1.272, 1.352, u),
      lerp(0.170, 0.605, u),
    );
  },

  /** Where the elbow is pulled towards — out to the side and down towards the feet. */
  elbowPole(u, side) {
    const m = side === 'l' ? 1 : -1;
    return new THREE.Vector3(m * 1, lerp(-0.62, -0.30, u), lerp(-0.20, -0.05, u)).normalize();
  },

  pose(u, ctx = {}) {
    const height = ctx.height || 1.7433;
    const rig = ctx.rig;
    const s = this.setup;
    const p = {};
    // The whole body rotates onto its back. The pivot is the floor origin, so the body
    // swings down flat and is then lifted so its back rests on the bench pad.
    const py = (ctx.benchTop ?? 0.46) + 0.115;
    const pz = height * 0.52;
    p.root = { rot: [d(-90), 0, 0], pos: [0, py, pz] };
    // The root lays the body down as world = (x, z + py, -y + pz), so anything that has to
    // meet the world — the floor, in this case — comes back through that.
    const restFromWorld = (wx, wy, wz) => new THREE.Vector3(wx, pz - wz, wy - py);

    for (const side of ['l', 'r']) {
      const m = side === 'l' ? 1 : -1;
      // The shoulder blades stay pinned back on the chest and only give a little at
      // lockout — which is what the serratus is doing at the top of the rep.
      p[`girdle.${side}`] = { rot: [0, -m * d(lerp(-3, 6, u)), 0] };
      // The wrist stays straight. Any wrist angle here would swing the grip point off the
      // solved target, since the IK ends at the palm — and under a loaded bar a stacked,
      // neutral wrist is what you want anyway.
      p[`hand.${side}`] = { rot: [0, 0, 0] };
      // Closed round the bar. Delavier's warning panel is that a thumbless grip lets the
      // bar roll out of the hand onto the neck, so the thumb comes across to oppose.
      p[`fingers1.${side}`] = { rot: [s.fingerMcp, 0, 0] };
      p[`fingers2.${side}`] = { rot: [s.fingerPip, 0, 0] };
      p[`thumb.${side}`] = { rot: [s.thumb[0], m * s.thumb[1], m * s.thumb[2]] };

      // Anatomical position already has the palms half-turned, so a barbell grip is about
      // a quarter turn from here, not a half. Overstating it only buys twist artefacts:
      // blending two rotations far apart pinches the forearm along its length.
      if (rig) Object.assign(p, rig.solveArm(side, this.gripPath(u, side), this.elbowPole(u, side), d(95), p[`girdle.${side}`]));

      // Feet planted. The ankle is driven to a fixed point on the floor, so the knee angle
      // falls out of the lifter's own leg length rather than being a number I picked.
      if (rig) {
        const hipWorldZ = pz - rig.p[side].hip.y;
        // How high the ankle sits above a flat sole is a property of this body, not a
        // constant: read it off the standing skeleton so the sole lands on the floor at
        // any height rather than hovering a few centimetres over it.
        const ankleY = rig.morphedJoint(side, 'ankle').y;
        const foot = restFromWorld(m * s.footSpread, ankleY, hipWorldZ + s.footReach);
        // The knee rises towards the ceiling — which is the body's own front while it lies
        // on its back — and tracks just slightly outside the foot, as it should over a
        // planted foot. Pulling it further out reads as bow-legged.
        const pole = new THREE.Vector3(m * 0.10, 0, 1).normalize();
        const leg = rig.solveLeg(side, foot, pole, { targetIsMorphed: true });
        Object.assign(p, leg);
        // The sole is flat on the floor when the foot's orientation in the world is the
        // one it has standing up — so cancel everything the root, thigh and shin did to it
        // rather than hand-picking an ankle angle that only works for one leg length.
        p[`foot.${side}`] = {
          quat: ROOT_Q.clone()
            .multiply(leg[`thigh.${side}`].quat)
            .multiply(leg[`shin.${side}`].quat)
            .invert(),
        };
      }
    }
    return p;
  },

  /**
   * Muscles worth showing, most important first. `match` is tested against part names
   * within `sys`, and resolves to real parts once at load.
   */
  muscles: [
    {
      key: 'pec', label: 'Pectoralis major', role: 'Prime mover',
      note: 'Drives the bar off the chest. Hardest worked in the first third of the press.',
      match: /^(sternocostal|clavicular|abdominal)?\s*\(?part of pectoralis major|pectoralis major/i,
      effort: (t) => clamp01(0.35 + 0.45 * bell(t, 0.62, 0.16) + 0.30 * bell(t, 0.45, 0.13) + 0.15 * (1 - pressPhase(t))),
    },
    {
      key: 'delt-ant', label: 'Anterior deltoid', role: 'Prime mover',
      note: 'Shares the drive with the chest, and takes more of it the wider the elbows flare.',
      match: /clavicular part of deltoid|anterior.*deltoid/i,
      effort: (t) => clamp01(0.30 + 0.55 * bell(t, 0.60, 0.17) + 0.20 * bell(t, 0.45, 0.12)),
    },
    {
      key: 'triceps', label: 'Triceps brachii', role: 'Prime mover',
      note: 'Straightens the elbow. Peaks last — the top half of the press is mostly triceps.',
      match: /triceps brachii|head of triceps|anconeus/i,
      effort: (t) => clamp01(0.18 + 0.75 * bell(t, 0.82, 0.16) + 0.20 * bell(t, 0.10, 0.14)),
    },
    {
      key: 'coraco', label: 'Coracobrachialis', role: 'Prime mover',
      note: 'Named by Delavier among the muscles the press engages. Pulls the humerus forward across the chest.',
      match: /coracobrachialis/i,
      effort: (t) => clamp01(0.22 + 0.40 * bell(t, 0.58, 0.18)),
    },
    {
      key: 'serratus', label: 'Serratus anterior', role: 'Stabiliser',
      note: 'Holds the shoulder blade flat against the ribs, hardest at lockout.',
      match: /serratus anterior/i,
      effort: (t) => clamp01(0.22 + 0.55 * bell(t, 0.93, 0.14) + 0.25 * bell(t, 0.05, 0.12)),
    },
    {
      key: 'pecminor', label: 'Pectoralis minor', role: 'Stabiliser',
      note: 'Under the big chest muscle. Draws the shoulder blade down and forward against the ribs.',
      match: /pectoralis minor/i,
      effort: (t) => clamp01(0.20 + 0.35 * bell(t, 0.88, 0.16) + 0.18 * bell(t, 0.10, 0.14)),
    },
    {
      key: 'lat', label: 'Latissimus dorsi', role: 'Eccentric control',
      note: 'Works on the way down, guiding the bar to the chest — not on the way up.',
      match: /latissimus dorsi|teres major/i,
      effort: (t) => clamp01(0.12 + 0.50 * bell(t, 0.28, 0.16)),
    },
    {
      key: 'cuff', label: 'Rotator cuff', role: 'Stabiliser',
      note: 'Keeps the humeral head centred. Loaded most at the bottom, where the shoulder is open.',
      match: /infraspinatus|supraspinatus|subscapularis|teres minor/i,
      effort: (t) => clamp01(0.25 + 0.40 * bell(t, 0.47, 0.18)),
    },
    {
      key: 'biceps', label: 'Biceps brachii', role: 'Antagonist',
      note: 'Barely works, but never switches off — it steadies the bar path.',
      match: /biceps brachii|head of biceps|brachialis(?! muscle of)/i,
      effort: (t) => clamp01(0.10 + 0.18 * bell(t, 0.45, 0.20)),
    },
    {
      key: 'grip', label: 'Grip and forearm', role: 'Grip',
      note: 'Delavier: grip the bar tightly — it is what stabilises the wrists under load. Constant through the rep.',
      match: /flexor carpi|flexor digitorum|palmaris longus|pronator teres|brachioradialis|extensor carpi|flexor pollicis|adductor pollicis/i,
      effort: () => 0.48,
    },
    {
      key: 'brace', label: 'Trunk brace', role: 'Stabiliser',
      note: 'Abs and spinal erectors hold the arch so the press has something to push from.',
      match: /rectus abdominis|external oblique|internal oblique|erector spinae|iliocostalis|longissimus/i,
      effort: (t) => clamp01(0.28 + 0.18 * bell(t, 0.65, 0.22)),
    },
    {
      key: 'legdrive', label: 'Leg drive', role: 'Stabiliser',
      note: 'Delavier: heels stay on the ground to stabilise the lift. Quads and glutes push the body back into the bench as the bar goes up.',
      match: /vastus (lateralis|medialis|intermedius)|rectus femoris|glute(us maximus|us medius)|soleus|gastrocnemius/i,
      effort: (t) => clamp01(0.20 + 0.38 * bell(t, 0.68, 0.18)),
    },
  ],
};

export const EXERCISES = [BENCH_PRESS];
export const exerciseById = (id) => EXERCISES.find((e) => e.id === id) || null;
