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
  sub: 'Flat bench, set up the way Delavier teaches it',
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
  },

  /** The bar is a real object with a real thickness, and the grip is solved against it. */
  bar: {
    radius: 0.0145,                 // standard 29 mm barbell shaft
    flesh: 0.011,                   // from the bar surface out to a phalanx's own axis
  },

  /**
   * The lift is authored as a bar path, not as joint angles: the grip points below are
   * where the hands must be at press phase u, in the model's own rest space (y up the
   * standing body, +z out of its chest). The rig solves the shoulder and elbow from them,
   * so the hands stay on the bar at any body size.
   */
  gripPath(u, side, chest = 0.170) {
    const m = side === 'l' ? 1 : -1;
    // The hands cannot move along a rigid bar, so the half-grip is constant and only the
    // bar's height and position along the torso change. The bar touches the chest at the
    // nipple line, which is where Delavier brings it down, and tracks back towards the
    // shoulders as it rises: the J-path a real press follows, not a straight vertical line.
    // `chest` is the bar's height on the chest, measured off this body's skin by the rig.
    return new THREE.Vector3(
      m * (this.grip / 2),
      lerp(1.272, 1.352, u),
      lerp(chest, 0.605, u),
    );
  },

  /** Where the bar rests on this lifter's chest: its surface just touching the skin. */
  chest(rig) {
    return rig ? rig.chestTouch(this.gripPath(0, 'l'), this.bar.radius) : 0.170;
  },

  /**
   * How far along the bar path this lifter can actually press, from 0 to 1. The path above
   * is drawn for an average arm, and a shorter one runs out of reach before the end of it.
   * The IK then stops the hand short while the bar carries on, so one hand hangs below the
   * bar and the other pushes up into it. Lockout is where the shorter of the two arms is
   * straight, so it is found by searching along the path, not picked.
   */
  pressTop(rig, chest = this.chest(rig)) {
    if (!rig) return 1;
    const lock = rig.lockoutReach;
    const fits = (k) => ['l', 'r'].every(side =>
      rig.reachRatio(side, this.gripPath(k, side, chest), this.girdle(1, side)) <= lock);
    if (fits(1)) return 1;
    let lo = 0, hi = 1;
    for (let i = 0; i < 20; i++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }
    return lo;
  },

  /**
   * The shoulder blades stay pinned back on the chest and only give a little at lockout,
   * which is the serratus at work at the top of the rep.
   */
  girdle(u, side) {
    const m = side === 'l' ? 1 : -1;
    return { rot: [0, -m * d(lerp(-3, 6, u)), 0] };
  },

  /**
   * Where the elbow falls if the arm is too straight for the upright solve to choose:
   * down towards the floor, out, and a little towards the feet.
   */
  elbowPole(u, side) {
    const m = side === 'l' ? 1 : -1;
    return new THREE.Vector3(m * 0.3, lerp(-0.62, -0.30, u), -1).normalize();
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

    const chest = this.chest(rig);
    const top = this.pressTop(rig, chest);
    for (const side of ['l', 'r']) {
      const m = side === 'l' ? 1 : -1;
      p[`girdle.${side}`] = this.girdle(u, side);
      if (rig) {
        // An overhand grip: palms towards the feet, thumbs pointing in along the bar, so the
        // bar runs across the palm from the index finger out to the little finger, away
        // from the middle. The forearm's twist and the wrist's side-bend are solved to keep
        // it there at every moment of the rep.
        const grip = this.gripPath(u * top, side, chest);
        // Wrist over elbow: the elbow is solved to sit as nearly straight under the bar as
        // this arm allows, rather than aimed by hand.
        const pole = rig.uprightPole(side, grip, p[`girdle.${side}`], this.elbowPole(u, side));
        const arm = rig.solveArm(side, grip, pole, {
          girdle: p[`girdle.${side}`], rootQ: ROOT_Q, align: new THREE.Vector3(m, 0, 0), pronation: d(95),
        });
        Object.assign(p, arm);

        // Closed round the bar, solved against its actual radius so the fingers stop on the
        // steel instead of closing through it. The arm has to be solved first: the fingers
        // wrap in the plane at right angles to the bar, and where that plane lies depends
        // on how the hand is currently turned, which changes through the whole rep.
        const girdleQ = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(...(p[`girdle.${side}`].rot), 'XYZ'));
        const handQ = ROOT_Q.clone().multiply(girdleQ)
          .multiply(arm[`upperarm.${side}`].quat)
          .multiply(arm[`forearm1.${side}`].quat)
          .multiply(arm[`forearm2.${side}`].quat)
          .multiply(arm[`hand.${side}`].quat);
        // The bar lies along world x; this is that direction as the hand sees it.
        const barAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(handQ.invert());
        // Delavier's warning panel is that a thumbless grip lets the bar roll out of the
        // hand onto the neck, so the thumb comes round to oppose the fingers.
        Object.assign(p, rig.gripAround(side, this.bar.radius, this.bar.flesh, barAxis));
      }

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
      note: 'Drives the bar up off the chest. It works hardest in the first third of the press.',
      match: /^(sternocostal|clavicular|abdominal)?\s*\(?part of pectoralis major|pectoralis major/i,
      effort: (t) => clamp01(0.35 + 0.45 * bell(t, 0.62, 0.16) + 0.30 * bell(t, 0.45, 0.13) + 0.15 * (1 - pressPhase(t))),
    },
    {
      key: 'delt-ant', label: 'Anterior deltoid', role: 'Prime mover',
      note: 'Shares the drive with the chest. The wider the elbows go, the more of the work it takes.',
      match: /clavicular part of deltoid|anterior.*deltoid/i,
      effort: (t) => clamp01(0.30 + 0.55 * bell(t, 0.60, 0.17) + 0.20 * bell(t, 0.45, 0.12)),
    },
    {
      key: 'triceps', label: 'Triceps brachii', role: 'Prime mover',
      note: 'Straightens the elbow. It peaks last. The top half of the press is mostly triceps.',
      match: /triceps brachii|head of triceps|anconeus/i,
      effort: (t) => clamp01(0.18 + 0.75 * bell(t, 0.82, 0.16) + 0.20 * bell(t, 0.10, 0.14)),
    },
    {
      key: 'coraco', label: 'Coracobrachialis', role: 'Prime mover',
      note: 'Delavier names it among the muscles the press uses. It pulls the upper arm forward across the chest.',
      match: /coracobrachialis/i,
      effort: (t) => clamp01(0.22 + 0.40 * bell(t, 0.58, 0.18)),
    },
    {
      key: 'serratus', label: 'Serratus anterior', role: 'Stabiliser',
      note: 'Holds the shoulder blade flat against the ribs. It works hardest at lockout.',
      match: /serratus anterior/i,
      effort: (t) => clamp01(0.22 + 0.55 * bell(t, 0.93, 0.14) + 0.25 * bell(t, 0.05, 0.12)),
    },
    {
      key: 'pecminor', label: 'Pectoralis minor', role: 'Stabiliser',
      note: 'Sits under the big chest muscle. It pulls the shoulder blade down and forward against the ribs.',
      match: /pectoralis minor/i,
      effort: (t) => clamp01(0.20 + 0.35 * bell(t, 0.88, 0.16) + 0.18 * bell(t, 0.10, 0.14)),
    },
    {
      key: 'lat', label: 'Latissimus dorsi', role: 'Eccentric control',
      note: 'Works on the way down. It guides the bar to the chest. It does little on the way up.',
      match: /latissimus dorsi|teres major/i,
      effort: (t) => clamp01(0.12 + 0.50 * bell(t, 0.28, 0.16)),
    },
    {
      key: 'cuff', label: 'Rotator cuff', role: 'Stabiliser',
      note: 'Keeps the ball of the shoulder centred in its socket. It is loaded most at the bottom, where the shoulder is most open.',
      match: /infraspinatus|supraspinatus|subscapularis|teres minor/i,
      effort: (t) => clamp01(0.25 + 0.40 * bell(t, 0.47, 0.18)),
    },
    {
      key: 'biceps', label: 'Biceps brachii', role: 'Antagonist',
      note: 'Does very little work here. It never switches off, because it helps keep the bar steady.',
      match: /biceps brachii|head of biceps|brachialis(?! muscle of)/i,
      effort: (t) => clamp01(0.10 + 0.18 * bell(t, 0.45, 0.20)),
    },
    {
      key: 'grip', label: 'Grip and forearm', role: 'Grip',
      note: 'Delavier says to grip the bar tightly. A tight grip is what keeps the wrists steady under load. The effort stays the same all through the rep.',
      match: /flexor carpi|flexor digitorum|palmaris longus|pronator teres|brachioradialis|extensor carpi|flexor pollicis|adductor pollicis/i,
      effort: () => 0.48,
    },
    {
      key: 'brace', label: 'Trunk brace', role: 'Stabiliser',
      note: 'The abs and the back muscles hold the body firm. That gives the press something solid to push from.',
      match: /rectus abdominis|external oblique|internal oblique|erector spinae|iliocostalis|longissimus/i,
      effort: (t) => clamp01(0.28 + 0.18 * bell(t, 0.65, 0.22)),
    },
    {
      key: 'legdrive', label: 'Leg drive', role: 'Stabiliser',
      note: 'Delavier says to keep the heels on the ground. The thighs and the glutes push the body back into the bench as the bar goes up.',
      match: /vastus (lateralis|medialis|intermedius)|rectus femoris|glute(us maximus|us medius)|soleus|gastrocnemius/i,
      effort: (t) => clamp01(0.20 + 0.38 * bell(t, 0.68, 0.18)),
    },
  ],
};

export const EXERCISES = [BENCH_PRESS];
export const exerciseById = (id) => EXERCISES.find((e) => e.id === id) || null;
