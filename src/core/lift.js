import * as THREE from 'three';
import { morphKey } from './morph.js';

/**
 * The movement framework: what every lift is built from.
 *
 * A lift is described the way a coach would describe it, in the room the lifter stands in:
 * where the feet are on the floor, how far the trunk leans, where the bar goes. These
 * helpers turn that into the rig's own terms and keep the rules every lift must obey:
 *
 *   - The trunk is one rigid, braced piece, placed by its hips and its lean. A neutral,
 *     braced spine is the correct form for every lift in the first set, so a rounded back
 *     cannot happen by accident.
 *   - Feet are planted flat on the floor, and the legs are solved to them, so the knees
 *     fall out of this lifter's own leg lengths.
 *   - Hands are solved onto the bar and closed round it.
 *   - Standing, the bar stays over the middle of the foot, which is what balance under a
 *     load means.
 *   - The bar never passes into the body. Where it would, it rests on the skin instead.
 *
 * World space: metres, y up, the floor at y = 0, the lifter facing +z when standing, the
 * left side of the body at +x.
 */

export const d = (deg) => (deg * Math.PI) / 180;
export const lerp = (a, b, k) => a + (b - a) * k;
export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const ease = (k) => k * k * (3 - 2 * k);
/** A hump centred on `c`, `w` wide. */
export const bell = (t, c, w) => Math.exp(-(((t - c) / w) ** 2));
export const SIDES = ['l', 'r'];
export const sgn = (side) => (side === 'l' ? 1 : -1);
/** Body-cloud tags for the whole trunk: pelvis, lower back, upper back, neck and head. */
export const TRUNK = [0, 5, 6, 7, 8];
/** Changes whenever the body's size or shape does: what anything measured on the body is cached under. */
export const bodyKey = () => morphKey();
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0);

/**
 * A rep as keyframes of movement: [[t, u], ...] with t the time through the rep (0..1) and
 * u how far through the movement the body is (0 start position, 1 end position). Eased
 * between keys, so the body speeds up and slows down the way a controlled rep does.
 */
export function keyCurve(keys) {
  return (t) => {
    t = ((t % 1) + 1) % 1;
    for (let i = 0; i < keys.length - 1; i++) {
      const [t0, u0] = keys[i], [t1, u1] = keys[i + 1];
      if (t <= t1) return u0 + (u1 - u0) * ease(clamp01(t1 > t0 ? (t - t0) / (t1 - t0) : 1));
    }
    return keys[keys.length - 1][1];
  };
}

/** Phases as [{ key, name, t0, t1, hint }]: which one is on at rep time t. */
export function phaseAt(phases, t) {
  t = ((t % 1) + 1) % 1;
  return phases.find(p => t >= p.t0 && t < p.t1) || phases[phases.length - 1];
}

/**
 * Where the trunk is in the world: a lean (pitch about x, positive tips the head forward)
 * and where the hips are. Everything a lift asks about the world goes through this.
 */
export class Frame {
  constructor(rig, quat, hipWorld) {
    this.rig = rig;
    this.q = quat.clone();
    this.qi = quat.clone().invert();
    const M0 = rig.localMatrix(rig.bones[0], { quat, pos: [0, 0, 0] }, new THREE.Matrix4());
    const h0 = rig.hipCentre().applyMatrix4(M0);
    this.pos = hipWorld.clone().sub(h0);
    this.M = rig.localMatrix(rig.bones[0], this.entry(), new THREE.Matrix4());
    this.Mi = this.M.clone().invert();
    this.hip = hipWorld.clone();
  }

  static lean(rig, pitch, hipWorld) {
    return new Frame(rig, new THREE.Quaternion().setFromAxisAngle(X, pitch), hipWorld);
  }

  /** Placed so that a point of the body (shaped rest space) lands on a point in the world. */
  static touching(rig, quat, bodyPoint, worldPoint) {
    const M0 = rig.localMatrix(rig.bones[0], { quat, pos: [0, 0, 0] }, new THREE.Matrix4());
    const shift = worldPoint.clone().sub(bodyPoint.clone().applyMatrix4(M0));
    const hip = rig.hipCentre().applyMatrix4(M0).add(shift);
    return new Frame(rig, quat, hip);
  }

  /** The frame a pose's root entry already describes (lying on the bench, say). */
  static fromEntry(rig, entry) {
    const q = entry.quat ? entry.quat.clone() : new THREE.Quaternion().setFromEuler(new THREE.Euler(...(entry.rot || [0, 0, 0]), 'XYZ'));
    const M = rig.localMatrix(rig.bones[0], entry, new THREE.Matrix4());
    return new Frame(rig, q, rig.hipCentre().applyMatrix4(M));
  }

  entry() { return { quat: this.q, pos: [this.pos.x, this.pos.y, this.pos.z] }; }
  /** World point -> the body's own shaped rest space. */
  toBody(w) { return w.clone().applyMatrix4(this.Mi); }
  toWorld(b) { return b.clone().applyMatrix4(this.M); }
  dirToBody(w) { return w.clone().applyQuaternion(this.qi); }
  dirToWorld(b) { return b.clone().applyQuaternion(this.q); }
}

/** A joint of the standing body (shaped rest space), and where the frame puts it. */
export const joint = (rig, side, key) => rig.morphedJoint(side, key, new THREE.Vector3());
export const jointWorld = (rig, frame, side, key) => frame.toWorld(joint(rig, side, key));

/** A shoulder joint in the world, with the back and the shoulder blades as posed. */
export function shoulderWorld(rig, frame, pose, side) {
  const gi = rig.bones.findIndex(b => b.name === 'girdle' && b.side === side);
  const M = armSpace(rig, frame, pose).M.clone().multiply(rig.localMatrix(rig.bones[gi], pose[`girdle.${side}`], new THREE.Matrix4()));
  return joint(rig, side, 'gh').applyMatrix4(M);
}

/**
 * The space the arms hang in: the upper back. With the back straight that is the trunk's
 * own frame; with it rounded or arched, the lower and upper back's turns are added on top.
 * The arm solver works in the frame its shoulder girdle hangs from, so every target the
 * arms reach for goes through this first.
 */
export function armSpace(rig, frame, pose) {
  const spine = ['lumbar', 'thorax'].map(n => pose[n]);
  if (!spine.some(Boolean)) {
    return { M: frame.M, q: frame.q, toArm: (w) => frame.toBody(w), dirToArm: (w) => frame.dirToBody(w) };
  }
  const bi = (n) => rig.bones.findIndex(b => b.name === n);
  const U = rig.localMatrix(rig.bones[bi('lumbar')], pose.lumbar, new THREE.Matrix4())
    .multiply(rig.localMatrix(rig.bones[bi('thorax')], pose.thorax, new THREE.Matrix4()));
  const Ui = U.clone().invert();
  const uq = new THREE.Quaternion().setFromRotationMatrix(U);
  return {
    M: frame.M.clone().multiply(U),
    q: frame.q.clone().multiply(uq),
    toArm: (w) => frame.toBody(w).applyMatrix4(Ui),
    dirToArm: (w) => frame.dirToBody(w).applyQuaternion(uq.clone().invert()),
  };
}

/**
 * Bend the spine: `lumbar` and `thorax` round the back forward (positive) or arch it
 * (negative), `neck` and `head` nod the head forward or tip it back. Radians.
 */
export function bendSpine(pose, { lumbar = 0, thorax = 0, neck = 0, head = 0 } = {}) {
  if (lumbar) pose.lumbar = { rot: [lumbar, 0, 0] };
  if (thorax) pose.thorax = { rot: [thorax, 0, 0] };
  if (neck) pose.neck = { rot: [neck, 0, 0] };
  if (head) pose.head = { rot: [head, 0, 0] };
  return pose;
}

/**
 * The middle of the foot, in the world: where the bar has to stay over for a standing lift
 * to be in balance. Taken as a little over half-way from the ankle to the ball of the foot,
 * which is under the arch, in front of the ankle bone.
 */
export function midfoot(rig, feet) {
  const a = joint(rig, 'l', 'ankle'), t = joint(rig, 'l', 'toe');
  const ankleZ = feet?.z ?? a.z;
  return ankleZ + 0.55 * (t.z - a.z);
}

/**
 * Plant both feet flat on the floor and solve the legs up to the trunk's hips.
 *
 * feet.spread  half the distance between the ankles (world x); default is where they are standing
 * feet.toeOut  how far the toes turn out, radians; the knees follow the toes
 * feet.z       the ankles' world z; default is where they are standing
 * feet.rise    heels raised this far, radians of ankle extension, with the ball of the foot
 *              staying where it is on the floor (a calf raise)
 */
export function plantFeet(rig, frame, pose, feet = {}) {
  for (const side of SIDES) {
    const m = sgn(side);
    // The heel rises round the ball of the foot (the big toe's knuckle), not the tip of the
    // toe: round the tip, the ball came 3 cm off the floor and the lifter stood on the tip
    // of the big toe.
    const A = joint(rig, side, 'ankle'), T = joint(rig, side, 'mtp');
    const toeOut = feet.toeOut ?? 0;
    const yaw = new THREE.Quaternion().setFromAxisAngle(Y, m * toeOut);
    const rise = feet.rise ?? 0;
    const pitch = new THREE.Quaternion().setFromAxisAngle(X, rise);
    const orient = yaw.clone().multiply(pitch);
    const ax = feet.spread != null ? m * feet.spread : A.x;
    const az = feet.z ?? A.z;
    let aw = new THREE.Vector3(ax, A.y, az);
    if (rise) {
      // Up on the ball of the foot: the ball stays put, and the ankle goes where the raised
      // foot puts it.
      const ball = new THREE.Vector3(ax, T.y, az).add(T.clone().sub(A).setY(0).applyQuaternion(yaw));
      const v = T.clone().sub(A).applyQuaternion(orient);
      aw = ball.sub(v);
    }
    // The knee tracks over the toes, which is what keeps it safe under load.
    const pole = new THREE.Vector3(Math.sin(m * toeOut) * 1.2, 0, Math.cos(toeOut)).normalize();
    const leg = rig.solveLeg(side, frame.toBody(aw), frame.dirToBody(pole), { targetIsMorphed: true });
    Object.assign(pose, leg);
    pose[`foot.${side}`] = {
      quat: frame.q.clone().multiply(leg[`thigh.${side}`].quat).multiply(leg[`shin.${side}`].quat).invert().multiply(orient),
    };
    // The toes stay flat on the floor as the heel comes up.
    if (rise) pose[`toes.${side}`] = { quat: new THREE.Quaternion().setFromAxisAngle(X, -rise) };
  }
  return pose;
}

/**
 * Where the hips and knees go for a bent-knee stance, the way a squat is coached: the shins
 * lean forward by `shinLean` along the line of the toes, and the thighs lean back from the
 * knees by `thighAngle` (from straight up; negative carries on forward in line with the
 * shin, which is a straight leg). Driving the two together keeps the hips and knees moving
 * as one; lowering the hips at a steady rate instead let them drift back first and the
 * squat turned into a bend at the waist. Returns the world points halfway between the two
 * hip joints and between the two knees.
 */
export function squatStance(rig, feet, shinLean, thighAngle) {
  const A = joint(rig, 'l', 'ankle'), K = joint(rig, 'l', 'knee'), H = joint(rig, 'l', 'hip');
  const shin = A.distanceTo(K), thigh = K.distanceTo(H);
  const toeOut = feet.toeOut ?? 0;
  const ax = feet.spread ?? Math.abs(A.x), az = feet.z ?? A.z;
  const toe = new THREE.Vector3(Math.sin(toeOut), 0, Math.cos(toeOut));
  const knee = new THREE.Vector3(ax, A.y, az).addScaledVector(toe, shin * Math.sin(shinLean)).addScaledVector(Y, shin * Math.cos(shinLean));
  const dx = Math.abs(H.x) - knee.x;
  const r = Math.sqrt(Math.max(0, thigh * thigh - dx * dx));
  const hip = new THREE.Vector3(0, knee.y + r * Math.cos(thighAngle), knee.z - r * Math.sin(thighAngle));
  return { hip, knee: knee.setX(0), r };
}

/** The shin's length on this body, and the thigh's: ankle to knee, knee to hip. */
export const legLengths = (rig) => {
  const A = joint(rig, 'l', 'ankle'), K = joint(rig, 'l', 'knee'), H = joint(rig, 'l', 'hip');
  return { shin: A.distanceTo(K), thigh: K.distanceTo(H) };
};

/**
 * The trunk lean that keeps the lifter in balance: the bar and the body together over the
 * middle of the foot. `load` is the bar's share of the combined weight (about half for a
 * working set). The body's own weight is taken as the head, arms and trunk, centred about
 * 30 cm up the trunk from the hips, plus the thighs, centred between hips and knees.
 * Solved, not chosen: in a squat the back angle is whatever balance needs.
 */
export function leanToBalance(rig, hip, bodyPoint, z, { knee = null, load = 0.55 } = {}) {
  const hipR = rig.hipCentre();
  const bar = bodyPoint.clone().sub(hipR), upper = new THREE.Vector3(0, 0.30, 0);
  const at = (th) => {
    const c = Math.cos(th), s = Math.sin(th);
    const zBar = hip.z + bar.y * s + bar.z * c;
    const zUpper = hip.z + upper.y * s;
    const zThigh = knee ? (hip.z + knee.z) / 2 : hip.z;
    return load * zBar + (1 - load) * (0.72 * zUpper + 0.28 * zThigh) - z;
  };
  let lo = d(-20), hi = d(80);
  if (at(lo) > 0) return lo;
  if (at(hi) < 0) return hi;
  for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (at(mid) < 0) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

/**
 * Put both hands on a bar lying along the world's x axis, and close them round it.
 *
 * bar.at     the bar's centre, world
 * bar.half   half the distance between the hands
 * bar.align  +1 overhand (palms facing away from the lifter's face), -1 underhand
 * bar.pole   side -> the world direction the elbow should point, or 'upright' for
 *            forearms as near vertical under the bar as the arm allows
 * bar.radius, bar.flesh  the shaft's radius and the tissue between bar and finger bone
 * bar.wrist  how far the wrists bend back, radians, if not the usual slight extension
 */
export function handsOnBar(rig, frame, pose, bar) {
  const A = armSpace(rig, frame, pose);
  for (const side of SIDES) {
    const m = sgn(side);
    const girdle = pose[`girdle.${side}`] || null;
    const grip = A.toArm(bar.at.clone().add(new THREE.Vector3(m * bar.half, 0, 0)));
    let pole = typeof bar.pole === 'function' ? bar.pole(side) : bar.pole;
    if (pole === 'upright' || pole?.upright) {
      const hint = A.dirToArm(pole.hint || new THREE.Vector3(m * 0.4, -0.5, 0.6).normalize());
      pole = rig.uprightPole(side, grip, girdle, hint, A.dirToArm(Y), { morphed: true, across: A.dirToArm(X) });
    } else pole = A.dirToArm(pole.clone().normalize());
    // The bar's line through this hand. A straight bar runs along x; an EZ bar's grips are
    // angled, and `bar.line(side)` gives the angled line in the world.
    const lineW = bar.line ? bar.line(side).normalize() : X.clone();
    const align = lineW.clone().multiplyScalar(m * (bar.align ?? 1));
    const arm = rig.solveArm(side, grip, pole, { girdle, rootQ: A.q, align, morphed: true, ...(bar.wrist != null ? { wrist: bar.wrist } : {}) });
    Object.assign(pose, arm);
    // The fingers wrap at right angles to the bar, and which way that is depends on how the
    // hand is turned right now, so it is worked out from the solved arm.
    const girdleQ = girdle?.rot ? new THREE.Quaternion().setFromEuler(new THREE.Euler(...girdle.rot, 'XYZ')) : new THREE.Quaternion();
    const handQ = A.q.clone().multiply(girdleQ)
      .multiply(arm[`upperarm.${side}`].quat)
      .multiply(arm[`forearm1.${side}`].quat)
      .multiply(arm[`forearm2.${side}`].quat)
      .multiply(arm[`hand.${side}`].quat);
    const barAxis = lineW.clone().applyQuaternion(handQ.invert());
    Object.assign(pose, rig.gripAround(side, bar.radius, bar.flesh, barAxis));
  }
  return pose;
}

/**
 * Where the points of the elbows face with the arms hanging and an overhand grip: out to
 * the sides and back, with the upper arms turned in. The palms face back, a turn a forearm
 * alone can barely make, and in a real hang the shoulder takes part of it. With the
 * elbows pointing straight back, the forearm made the whole turn, 172 degrees.
 */
export const HANG_POLE = (side) => new THREE.Vector3(sgn(side) * 1.0, 0, -0.7);

/**
 * The lowest the bar can hang at world depth z with the arms straight: the height where the
 * straighter arm reaches lockout.
 */
export function hangHeight(rig, frame, pose, half, z) {
  const sh = shoulderWorld(rig, frame, pose, 'l');
  const A = armSpace(rig, frame, pose);
  const fits = (y) => SIDES.every(side => rig.reachRatio(side,
    A.toArm(new THREE.Vector3(sgn(side) * half, y, z)), pose[`girdle.${side}`] || null, true) <= rig.lockoutReach);
  let lo = sh.y - 1.2, hi = sh.y;
  for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid; }
  return hi;
}

/**
 * The highest the bar can go at world depth z with the arms straight overhead: the height
 * where the shorter reach runs out.
 */
export function pressHeight(rig, frame, pose, half, z) {
  const sh = shoulderWorld(rig, frame, pose, 'l');
  const A = armSpace(rig, frame, pose);
  const fits = (y) => SIDES.every(side => rig.reachRatio(side,
    A.toArm(new THREE.Vector3(sgn(side) * half, y, z)), pose[`girdle.${side}`] || null, true) <= rig.lockoutReach);
  let lo = sh.y, hi = sh.y + 1.2;
  for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }
  return lo;
}

/**
 * Keep a bar out of the body. Moves the bar from `at` along `dir` until its surface is
 * `clear` from the skin, and returns where that is. If it was already clear, it stays.
 *
 * The search comes in from outside, the way a real bar arrives, and stops at the first
 * touch. Distance to the nearest skin point cannot tell inside from outside on its own:
 * deep in the trunk the nearest skin is far away too.
 */
export function clearOfBody(rig, cloud, at, dir, radius, { clear = 0.004, only = null, reach = 0.35 } = {}) {
  if (!cloud) return at.clone();
  // Worked out exactly, in one pass over the skin. The bar lies along x, so each skin point
  // is a point in the y-z plane, and the bar (grown by the gap wanted) is a circle sliding
  // along `dir`. Each point blocks one stretch of that slide; the bar stops at the far end
  // of the outermost stretch it meets coming in from `reach`.
  //
  // This used to be found by trying the bar at every centimetre and measuring the whole
  // skin each time, some sixty passes a call and four calls a pose: 60 ms for one pose of
  // a deadlift, a second and a half of frozen page when the lift opened.
  const p = cloud.pts, tag = cloud.tag, R = radius + clear, R2 = R * R;
  let mask = null;
  if (only) { mask = new Uint8Array(32); for (const t of only) mask[t] = 1; }
  const dy = dir.y, dz = dir.z, dd = dy * dy + dz * dz;
  if (dd < 1e-12) return at.clone();
  let best = 0;
  for (let i = 0, k = 0; i < p.length; i += 3, k++) {
    if (mask && !mask[tag[k]]) continue;
    const wy = p[i + 1] - at.y, wz = p[i + 2] - at.z;
    const b = (dy * wy + dz * wz) / dd, c = (wy * wy + wz * wz - R2) / dd;
    const disc = b * b - c;
    if (disc <= 0) continue;
    const root = Math.sqrt(disc), k2 = b + root;
    if (k2 <= best) continue;
    if (k2 > reach) {
      // Already touching where the search starts: it can come no closer than that.
      if (b - root < reach) return at.clone().addScaledVector(dir, reach);
      continue;
    }
    best = k2;
  }
  return at.clone().addScaledVector(dir, best);
}

/**
 * A bar hanging from straight arms in front of the legs: as low as the arms reach, and
 * resting against the thighs or shins wherever they are in this pose, never inside them.
 * How low it hangs depends on how far forward the legs push it, and the other way round,
 * so the two are settled together. `z` is where it would hang if nothing were in the way.
 */
export function hangingBar(rig, frame, pose, half, z, radius, { clear = 0.004, only = [1, 2, 3, 4], snug = false } = {}) {
  const cloud = rig.bodyCloud(pose);
  let y = 0;
  for (let i = 0; i < 4; i++) {
    y = hangHeight(rig, frame, pose, half, z);
    // Snug: the lats pull the bar back against the legs, as in a deadlift, so it comes to
    // rest on the front of the thighs or shins wherever it would otherwise hang.
    const from = snug ? new THREE.Vector3(0, y, -0.25) : new THREE.Vector3(0, y, z);
    z = clearOfBody(rig, cloud, from, new THREE.Vector3(0, 0, 1), radius, { clear, only, reach: snug ? 0.6 : 0.3 }).z;
  }
  return new THREE.Vector3(0, y, z);
}

/**
 * Where a bar resting on the body sits, in the body's own shaped rest space: at height y,
 * pushed out from the skin on the front (side +1) or the back (side -1) until it just
 * touches. Standing, before any pose, so it can ride with the trunk through the lift.
 */
export function restingOn(rig, y, side, radius, { clear = 0.003, only = TRUNK } = {}) {
  const cloud = rig.bodyCloud({});
  return clearOfBody(rig, cloud, new THREE.Vector3(0, y, 0), new THREE.Vector3(0, 0, side), radius, { clear, only, reach: 0.4, step: 0.005 });
}

/**
 * The EZ bar's shape, one half: [distance from the middle, how far the bar is bent out].
 * The inner grips are the angled stretch from 10 to 20 cm out.
 */
export const EZ_BENDS = [[0, 0], [0.10, 0], [0.20, 0.032], [0.30, 0], [0.60, 0]];

/**
 * An EZ bar held with the hands `half` out from the middle, and the forearm running along
 * `forearm` (world): which way the bar's bends lie, how far the grip sits off the straight
 * middle, and each hand's line along the bar. The bends lie across the forearms, the way
 * the bar hangs when it is picked up, and turn each hand a little towards thumbs-up, which
 * is the point of the bar: less twist at the wrist than a straight bar forces.
 */
export function ezGrip(half, forearm) {
  let k = 1;
  while (k < EZ_BENDS.length - 1 && EZ_BENDS[k][0] < half) k++;
  const [x0, o0] = EZ_BENDS[k - 1], [x1, o1] = EZ_BENDS[k];
  const slope = (o1 - o0) / (x1 - x0);
  const offset = o0 + slope * (half - x0);
  const c = X.clone().cross(forearm).normalize();
  return {
    c, offset,
    line: (side) => X.clone().addScaledVector(c, (side === 'l' ? 1 : -1) * slope),
  };
}

/** A short caption list turned into the `form` block's shape, for authoring convenience. */
export const form = (setup, move, mistakes, breathe) => ({ setup, move, mistakes, breathe });

// ---------- solid equipment ----------

/**
 * A dumbbell's heads for the weight it holds: two steel cylinders, each a little shorter
 * than it is wide, sized from the steel they must contain (7850 kg/m³), with the handle's
 * own 0.6 kg taken off. The handle is 15 cm, and each head starts 6.2 cm from its middle.
 * Drawn and tested against the body with these same numbers. The heads used to grow by a
 * rule of thumb that made a 15 kg dumbbell's plates a fifth wider than real ones.
 */
export function dumbbellSize(totalKg) {
  const each = Math.max(1, (totalKg || 10) / 2);
  const steel = Math.max(0.2, (each - 0.6) / 2);
  const R = Math.max(0.038, Math.cbrt(steel / (7850 * Math.PI * 0.85)));
  const L = Math.max(0.03, 0.85 * R);
  return { R, L, at: 0.062 + L / 2, handle: 0.15 };
}

/** Where a held dumbbell is in the room: its middle and the line through its handle. The rig must be posed. */
export function dumbbellAt(rig, side, size) {
  const c = rig.jointAt('grip', side, new THREE.Vector3());
  const axis = rig.barInHand(side).applyQuaternion(rig.boneQuat('hand', side)).normalize();
  return { c, axis, size };
}

/**
 * How a dumbbell has to move to come out of the body: the smallest push, in the room,
 * that takes both heads clear of every point of `cloud` by `margin`, worked out point by
 * point (out sideways from the handle's line, or off the end of a head, whichever is
 * shorter) and summed. Zero if it is clear. Floor and the other dumbbell are added by the
 * caller.
 */
export function pushOutOfBody(db, cloud, margin = 0.008) {
  const { c, axis, size } = db;
  const R = size.R + margin, H = size.L / 2 + margin, reach2 = R * R + H * H;
  const sum = new THREE.Vector3(), w = new THREE.Vector3();
  let most = 0;
  const p = cloud.pts;
  for (const s of [-1, 1]) {
    const hx = c.x + axis.x * s * size.at, hy = c.y + axis.y * s * size.at, hz = c.z + axis.z * s * size.at;
    for (let i = 0; i < p.length; i += 3) {
      const dx = p[i] - hx, dy = p[i + 1] - hy, dz = p[i + 2] - hz;
      if (dx * dx + dy * dy + dz * dz > reach2) continue;
      const a = dx * axis.x + dy * axis.y + dz * axis.z;
      if (Math.abs(a) >= H) continue;
      w.set(dx - a * axis.x, dy - a * axis.y, dz - a * axis.z);
      const r = w.length();
      if (r >= R) continue;
      const radial = R - r, along = H - Math.abs(a);
      if (radial <= along && r > 1e-6) { sum.addScaledVector(w, -radial / r); most = Math.max(most, radial); }
      else { sum.addScaledVector(axis, -Math.sign(a || 1) * along); most = Math.max(most, along); }
    }
  }
  if (most === 0) return sum;
  // Pushed from both sides at once (between the thighs) the pulls cancel; out to the side
  // is then the way a real arm goes.
  if (sum.length() < most * 0.3) sum.set(Math.sign(c.x || 1), 0, 0);
  return sum.normalize().multiplyScalar(most);
}

/** How far two dumbbells overlap, and the way to push `a` off `b` (half the overlap each). */
export function pushApart(a, b, margin = 0.006) {
  // Each head as a stack of three spheres along its line: close enough for two weights
  // meeting side by side or end to end.
  const balls = (db) => {
    const out = [];
    const r = Math.max(db.size.R, db.size.L / 2);
    for (const s of [-1, 1]) for (const k of [-0.33, 0, 0.33]) {
      out.push(db.c.clone().addScaledVector(db.axis, s * db.size.at + k * db.size.L));
    }
    return { out, r: Math.min(r, db.size.R) };
  };
  const A = balls(a), B = balls(b);
  let most = 0;
  for (const p of A.out) for (const q of B.out) most = Math.max(most, A.r + B.r + margin - p.distanceTo(q));
  if (most <= 0) return new THREE.Vector3();
  const dir = a.c.clone().sub(b.c);
  if (dir.lengthSq() < 1e-10) dir.set(1, 0, 0);
  return dir.normalize().multiplyScalar(most / 2);
}

/**
 * How far a posed body sinks into a bench pad, in metres (negative if it floats above).
 * `bench` is the equipment description: top, width, length, centre [x, z], along 'x'|'z'.
 * Read off the trunk and leg skin, so it follows this body's own back and buttocks.
 */
export function benchSink(rig, pose, bench) {
  const cloud = rig.bodyCloud(pose);
  if (!cloud) return 0;
  const along = bench.along === 'x';
  const hx = (along ? bench.length : bench.width) / 2, hz = (along ? bench.width : bench.length) / 2;
  const [cx, cz] = bench.center;
  const p = cloud.pts;
  let most = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    if (Math.abs(p[i] - cx) > hx || Math.abs(p[i + 2] - cz) > hz) continue;
    const y = p[i + 1];
    if (y > bench.top + 0.08 || y < bench.top - 0.12) continue;
    most = Math.max(most, bench.top - y);
  }
  return most === -Infinity ? 0 : most;
}

/** A padded bench gives this much under a lying body. */
export const BENCH_GIVE = 0.006;

/**
 * The shortest move of a held dumbbell that takes it clear of the body, searched along the
 * ways an arm can move a hand: out to the side, forward, back, up, down and between them.
 * For each way, the dumbbell is slid along it until no point of `cloud` is within `margin`
 * of its heads or its handle; the way with the shortest slide wins, with a small cost for
 * straying from `prev` (the move chosen a moment earlier) so the arm moves smoothly through
 * the rep. Ways the arm cannot reach (`reach`: { S, max }, the shoulder and how far the
 * hand can get from it) are skipped. Returns a vector in the room; zero if already clear.
 *
 * A push summed point by point, tried first, picked a different way out at every step as
 * the weight moved, and wandered.
 */
export function clearanceMove(db, cloud, side, { margin = 0.008, prev = null, reach = null, maxT = 0.22 } = {}) {
  const { c, axis, size } = db;
  const parts = [
    { o: size.at, R: size.R + margin, H: size.L / 2 + margin },
    { o: -size.at, R: size.R + margin, H: size.L / 2 + margin },
    { o: 0, R: 0.016 + margin * 0.5, H: size.handle / 2 },
  ];
  const e1 = new THREE.Vector3(1, 0, 0).cross(axis);
  if (e1.lengthSq() < 1e-6) e1.set(0, 1, 0).cross(axis);
  e1.normalize();
  const e2 = new THREE.Vector3().crossVectors(axis, e1);
  const p = cloud.pts;
  const reachR = size.at + size.L / 2 + size.R + margin;
  // First, cheaply: does it touch anything where it is? Most moments it does not.
  let touching = false;
  for (let i = 0; i < p.length && !touching; i += 3) {
    const dx = p[i] - c.x, dy = p[i + 1] - c.y, dz = p[i + 2] - c.z;
    if (dx * dx + dy * dy + dz * dz >= reachR * reachR) continue;
    const a = dx * axis.x + dy * axis.y + dz * axis.z, u = dx * e1.x + dy * e1.y + dz * e1.z, v = dx * e2.x + dy * e2.y + dz * e2.z;
    for (const q of parts) if (Math.abs(a - q.o) < q.H && u * u + v * v < q.R * q.R) { touching = true; break; }
  }
  if (!touching) return new THREE.Vector3();
  // Then the points it could reach on any slide, in the dumbbell's own terms (along its
  // handle, and across it), filed in 1 cm slices along the handle, so each test looks only
  // at the slices its heads and handle cover.
  const box = reachR + maxT, SL = 0.01, base = -box, nS = Math.ceil((2 * box) / SL) + 1;
  const count = new Int32Array(nS + 1);
  const keep = [];
  for (let i = 0; i < p.length; i += 3) {
    const dx = p[i] - c.x, dy = p[i + 1] - c.y, dz = p[i + 2] - c.z;
    if (dx * dx + dy * dy + dz * dz >= box * box) continue;
    const a = dx * axis.x + dy * axis.y + dz * axis.z;
    keep.push(a, dx * e1.x + dy * e1.y + dz * e1.z, dx * e2.x + dy * e2.y + dz * e2.z);
    count[Math.min(nS - 1, Math.max(0, Math.floor((a - base) / SL))) + 1]++;
  }
  for (let k = 1; k <= nS; k++) count[k] += count[k - 1];
  const n = keep.length / 3, U = new Float32Array(n), V = new Float32Array(n), At = new Float32Array(n), fill = count.slice(0, nS);
  for (let k = 0; k < n; k++) {
    const a = keep[k * 3], slot = fill[Math.min(nS - 1, Math.max(0, Math.floor((a - base) / SL)))]++;
    At[slot] = a; U[slot] = keep[k * 3 + 1]; V[slot] = keep[k * 3 + 2];
  }
  const inside = (ox, oy, oz) => {
    const oa = ox * axis.x + oy * axis.y + oz * axis.z, ou = ox * e1.x + oy * e1.y + oz * e1.z, ov = ox * e2.x + oy * e2.y + oz * e2.z;
    for (const q of parts) {
      const from = oa + q.o - q.H, to = oa + q.o + q.H, r2 = q.R * q.R;
      const s0 = Math.max(0, Math.floor((from - base) / SL)), s1 = Math.min(nS - 1, Math.floor((to - base) / SL));
      if (s1 < 0 || s0 > nS - 1) continue;
      for (let k = count[s0]; k < count[s1 + 1]; k++) {
        const a = At[k];
        if (a <= from || a >= to) continue;
        const du = U[k] - ou, dv = V[k] - ov;
        if (du * du + dv * dv < r2) return true;
      }
    }
    return false;
  };
  if (!inside(0, 0, 0)) return new THREE.Vector3();
  const m = side === 'l' ? 1 : -1;
  // The way the hand already went a moment ago is tried first: it is nearly always the
  // answer again, and once a short slide is found every other way stops early.
  const ways = prev && prev.lengthSq() > 1e-6 ? [[prev.x, prev.y, prev.z, 0.98]] : [];
  ways.push(
    [m, 0, 0, 1], [0, 0, 1, 1], [0, 0, -1, 1.25], [0, 1, 0, 1.1], [0, -1, 0, 1.1],
    [m, 0, 1, 1.02], [m, 0, -1, 1.15], [m, 1, 0, 1.05], [m, -1, 0, 1.05], [0, 1, 1, 1.1], [0, -1, 1, 1.1],
  );
  let best = null, bestCost = Infinity;
  const v = new THREE.Vector3();
  for (const [x, y, z, w] of ways) {
    v.set(x, y, z).normalize();
    let lo = 0, hi = -1;
    // A slide longer than the best so far, weighed, can never win: stop there.
    const limit = Math.min(maxT, bestCost / w);
    for (let t = 0.012; t <= limit + 0.012; t += 0.012) { if (!inside(v.x * t, v.y * t, v.z * t)) { hi = t; break; } lo = t; }
    if (hi < 0) continue;
    for (let k = 0; k < 5; k++) { const mid = (lo + hi) / 2; if (inside(v.x * mid, v.y * mid, v.z * mid)) lo = mid; else hi = mid; }
    const move = v.clone().multiplyScalar(hi);
    if (reach && move.clone().add(c).distanceTo(reach.S) > reach.max) continue;
    const cost = hi * w;
    if (cost < bestCost) { bestCost = cost; best = move; }
  }
  return best || new THREE.Vector3();
}
