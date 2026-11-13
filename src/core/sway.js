import * as THREE from 'three';
import { bodyKey, lerp, clamp01 } from './lift.js';
import { analyse } from './biomech.js';

/**
 * Sway: the whole body answering the weight it moves.
 *
 * Nobody stands still while a weight moves. Curl a bar and it swings out in front of you,
 * so your whole body leans back a little from the ankles to keep from tipping forward, and
 * comes upright again as the bar returns. That small lean is what makes a standing lift
 * look alive. The hand-written lifts fixed the trunk and the legs in place and moved only
 * what the lift is about, so in a curl only the arms moved.
 *
 * This wraps a standing lift and adds exactly the lean physics asks for, no more. At each
 * moment of the rep the body is posed, its real centre of mass with the bar is worked out
 * (the same model that computes muscle effort, biomech.js), and the whole body is turned
 * about the ankles until that centre of mass is over the middle of the foot. People
 * balance this way: it is the "ankle strategy" of standing balance.
 *
 * Nothing else about the lift changes. The body turns as one rigid piece about the line
 * through the two ankle joints, so the ankles stay exactly where they were, the feet are
 * turned back to lie flat on the floor, and the bar goes with the hands. Whatever the lift
 * worked out (the bar against the thighs, the grip, the bar's path past the face) is kept.
 *
 * The lean is found once per body at a few moments of the rep and read between them, so
 * playing the lift costs nothing extra.
 */

const X = new THREE.Vector3(1, 0, 0);
const KNOTS = 24;
/** No one sways further than this without taking a step. */
const MAX = 5 * Math.PI / 180;

const quatOf = (e) => {
  if (!e) return new THREE.Quaternion();
  if (e.quat) return e.quat.clone();
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(...(e.rot || [0, 0, 0]), 'XYZ'));
};

/** The pose turned by `phi` about the line through the ankles (at height `ay`, depth `az`), feet kept flat. */
function lean(pose, phi, ay, az) {
  if (Math.abs(phi) < 1e-5) return pose;
  const R = new THREE.Quaternion().setFromAxisAngle(X, phi);
  const back = new THREE.Quaternion().setFromAxisAngle(X, -phi);
  const out = { ...pose };
  const q0 = quatOf(pose.root), pos = pose.root?.pos || [0, 0, 0];
  const v = new THREE.Vector3(pos[0], pos[1] - ay, pos[2] - az).applyQuaternion(R);
  out.root = { quat: R.clone().multiply(q0), pos: [v.x, v.y + ay, v.z + az] };
  for (const side of ['l', 'r']) {
    // The foot as it lies in the room now, which is how it must still lie afterwards.
    const foot = quatOf(pose[`foot.${side}`]);
    const W = q0.clone().multiply(quatOf(pose[`thigh.${side}`])).multiply(quatOf(pose[`shin.${side}`])).multiply(foot);
    out[`foot.${side}`] = { quat: foot.multiply(W.clone().invert()).multiply(back).multiply(W) };
  }
  return out;
}

/**
 * A standing lift, with the sway that keeps it in balance. Returns the same lift object,
 * so everything that holds on to it (the player, the panel, Film mode) sees the change.
 */
export function swaying(lift) {
  if (lift.physics?.support !== 'feet' || lift._still) return lift;
  const still = lift.pose.bind(lift);
  const tables = new Map();
  lift._still = still;

  /** Work out the lean for this body (and this mistake, if one is on show). */
  lift.prepare = function (app) {
    const rig = app.body.rig;
    if (!rig?.ok) return;
    const fault = app.exercise?.ex === lift ? app.exercise.fault || '' : '';
    const key = `${bodyKey()}|${fault}`;
    if (tables.has(key)) return;
    if (tables.size > 12) tables.clear();
    const body = { massKg: app.currentWeight(), heightM: app.currentHeightM() };
    const ctx = { rig, height: app.currentHeightCm() / 100, fault: fault || null };
    const keep = rig.lastPose;
    const phi = [], ay = [], az = [];
    for (let i = 0; i <= KNOTS; i++) {
      rig.weighing = true;
      let posed; try { posed = still(i / KNOTS, ctx); } finally { rig.weighing = false; }
      rig.setPose(posed);
      const a = analyse(rig, lift.physics, body);
      const A = rig.jointAt('ankle', 'l', new THREE.Vector3()).add(rig.jointAt('ankle', 'r', new THREE.Vector3())).multiplyScalar(0.5);
      const toe = rig.jointAt('toe', 'l', new THREE.Vector3()), ball = rig.jointAt('mtp', 'l', new THREE.Vector3());
      const heel = rig.morphedJoint('l', 'ankle', new THREE.Vector3()).y;
      // Over the middle of the whole foot, heel to toe; up on the toes, over the ball of the foot.
      // The change from one to the other is eased over the first 3 cm the heel rises.
      const up = clamp01((A.y - heel) / 0.03), onToes = up * up * (3 - 2 * up);
      const target = lerp(A.z + 0.4 * (toe.z - A.z), ball.z, onToes);
      const dy = a.com.y - A.y, dz = a.com.z - A.z, r = Math.hypot(dy, dz) || 1;
      const need = Math.asin(Math.max(-1, Math.min(1, (target - A.z) / r))) - Math.atan2(dz, dy);
      phi.push(Math.max(-MAX, Math.min(MAX, need))); ay.push(A.y); az.push(A.z);
    }
    // Lightly smoothed: the lean is a slow, easy movement, never a twitch.
    const smooth = phi.map((x, i) => (phi[Math.max(0, i - 1)] + 2 * x + phi[Math.min(KNOTS, i + 1)]) / 4);
    tables.set(key, { phi: smooth, ay, az });
    if (keep) rig.setPose(keep);
  };

  lift.pose = function (u, ctx = {}) {
    const p = still(u, ctx);
    const t = tables.get(`${bodyKey()}|${ctx.fault || ''}`);
    if (!t) return p;
    const x = clamp01(u) * KNOTS, i = Math.min(KNOTS - 1, Math.floor(x)), k = x - i;
    return lean(p, lerp(t.phi[i], t.phi[i + 1], k), lerp(t.ay[i], t.ay[i + 1], k), lerp(t.az[i], t.az[i + 1], k));
  };

  /** How far the body leans through the rep, in degrees, for checking. */
  lift.swayOf = () => { const t = tables.get(`${bodyKey()}|`); return t ? t.phi.map(x => +(x * 180 / Math.PI).toFixed(1)) : null; };
  return lift;
}
