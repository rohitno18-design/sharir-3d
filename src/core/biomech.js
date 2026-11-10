import * as THREE from 'three';

/**
 * Muscle effort, worked out from the pose instead of drawn by hand.
 *
 * A muscle works because a joint has to hold a turning force. So for the body as it is
 * posed right now, this works out the turning force every joint must hold, and from that
 * which muscles must be working and how hard:
 *
 *   1. The body is split into the standard segments (head, three pieces of trunk, upper
 *      arm, forearm, hand, thigh, shank, foot), each with its share of the body's weight
 *      at its centre of mass (de Leva 1996, the table biomechanics labs use).
 *   2. Whatever is carried is a weight at the hands, on the upper back or across the hips.
 *   3. The floor and the bench push back. How that push is shared between the feet and the
 *      bench is solved so the whole body is in balance: nothing left over to tip it.
 *   4. At each joint, everything on the far side of it (weights, loads, the floor's push)
 *      makes a turning force about the joint. The muscles must make the opposite one.
 *   5. That turning force is read in the joint's own terms: the elbow wants flexion, the
 *      shoulder wants the arm pulled across the chest, the hip wants extension. Each of
 *      those is a known job of known muscles (the table below), and how hard they work is
 *      the turning force against what that muscle group can produce at its strongest.
 *
 * This is what makes any movement possible without hand-drawn effort curves: pose the
 * body, say what it carries and what it rests on, and the muscles follow from physics.
 *
 * What it does not do. It treats the pose as held still (no swing, no bounce), it gives
 * each joint action a fixed set of muscles, and its strength figures are those of a
 * typical trained adult scaled by size. It is a teaching model. It is tested against the
 * ten hand-written lifts, whose efforts were shaped from EMG studies (see `rankAgainst`).
 *
 * World space as everywhere else: metres, y up, the lifter facing +z, the body's left +x.
 */

const G = 9.81;
const SIDES = ['l', 'r'];
const sgn = (side) => (side === 'l' ? 1 : -1);
const V = () => new THREE.Vector3();
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);

/** Share of body mass per segment, and how far along it the centre of mass lies (de Leva 1996, men). */
const MASS = {
  pelvis: 0.1117, abdomen: 0.1633, thorax: 0.1596, head: 0.0694,
  upperarm: 0.0271, forearm: 0.0162, hand: 0.0061,
  thigh: 0.1416, shank: 0.0433, foot: 0.0137,
};
const COM_AT = { upperarm: 0.5772, forearm: 0.4574, thigh: 0.4095, shank: 0.4459, foot: 0.5 };

/**
 * The strongest turning force each joint action can make, in newton metres per side, for a
 * trained adult of 75 kg and 1.75 m. Rounded from isokinetic and isometric norms. The spine
 * figures are for the whole trunk. Shoulder girdle and grip are forces, in newtons.
 * Scaled to the body on screen by its weight and height.
 */
const STRENGTH = {
  elbowFlex: 75, elbowExt: 60,
  shFlex: 95, shExt: 115, shAbd: 80, shAdd: 110, shIn: 115, shOut: 75, shRotIn: 60, shRotOut: 40,
  hipExt: 290, hipFlex: 170, hipAbd: 150, hipAdd: 190,
  kneeExt: 270, kneeFlex: 140,
  anklePlantar: 190, ankleDorsi: 50,
  trunkExt: 400, trunkFlex: 230, trunkSide: 200, trunkTwist: 130,
  neckExt: 45, neckFlex: 25,
  girdleLift: 850, girdleForward: 900, girdleBack: 900, grip: 600,
  wristFlex: 20, wristExt: 12,
};
const REF_SIZE = 75 * 1.75;
/**
 * How a muscle group's strength changes with its joint's bend: `low` of its best with the
 * joint straight, rising to all of it by about a right angle (sooner for a larger `rate`).
 */
const curve = (bend, low, rate) => low + (1 - low) * Math.sin(Math.min(Math.PI / 2, Math.max(0, bend) * rate));

/**
 * The muscle groups the model reports, with the pattern that finds their parts in the
 * atlas and a plain line on what each does. `side: false` groups are single (the trunk).
 */
export const GROUPS = [
  { key: 'pec', label: 'Chest (pectoralis major)', match: /pectoralis major/i, job: 'Pulls the upper arm across the chest and forward.' },
  { key: 'delt-front', label: 'Front of the shoulder', match: /clavicular part of deltoid/i, job: 'Lifts the arm forward.' },
  { key: 'delt-side', label: 'Side of the shoulder', match: /acromial part of deltoid/i, job: 'Lifts the arm out to the side.' },
  { key: 'delt-rear', label: 'Back of the shoulder', match: /scapular spinal part of deltoid/i, job: 'Pulls the arm back and out.' },
  { key: 'lats', label: 'Lats', match: /latissimus dorsi|teres major/i, job: 'Pull the arm down and back towards the body.' },
  { key: 'cuff', label: 'Rotator cuff', match: /infraspinatus|supraspinatus|subscapularis|teres minor/i, job: 'Holds the ball of the shoulder in its socket and turns the arm.' },
  { key: 'trap-upper', label: 'Upper trapezius', match: /descending part of trapezius|levator scapulae/i, job: 'Holds the shoulders up against a weight and turns the shoulder blade up.' },
  { key: 'mid-back', label: 'Middle back (rhomboids, middle and lower trapezius)', match: /rhomboid|transverse part of trapezius|ascending part of trapezius/i, job: 'Pulls the shoulder blades together and holds them down.' },
  { key: 'serratus', label: 'Serratus anterior', match: /serratus anterior|pectoralis minor/i, job: 'Holds the shoulder blade against the ribs and pushes it forward.' },
  { key: 'biceps', label: 'Biceps and brachialis', match: /biceps brachii|^brachialis muscle|brachioradialis/i, job: 'Bend the elbow.' },
  { key: 'triceps', label: 'Triceps', match: /triceps brachii|anconeus/i, job: 'Straightens the elbow.' },
  { key: 'forearm', label: 'Grip and forearm', match: /flexor carpi|flexor digitorum (superficialis|profundus)|palmaris longus|flexor pollicis longus|extensor carpi/i, job: 'Closes the hand and holds the wrist firm.' },
  { key: 'erector', label: 'Back muscles (spinal erectors)', match: /iliocostalis (lumborum|thoracis)|longissimus thoracis|spinalis thoracis|multifidus (lumborum|thoracis)|quadratus lumborum/i, job: 'Hold the spine straight against a forward bend.' },
  { key: 'abs', label: 'Abdominals', match: /rectus abdominis|external abdominal oblique|internal abdominal oblique|transversus abdominis/i, job: 'Bend and twist the trunk, and brace it under load.' },
  { key: 'neck', label: 'Neck muscles', match: /splenius|semispinalis capitis|sternocleidomastoid|longus colli/i, job: 'Hold the head up.' },
  { key: 'glute-max', label: 'Gluteus maximus', match: /gluteus maximus/i, job: 'Straightens the hip.' },
  { key: 'glute-med', label: 'Side of the hip (gluteus medius)', match: /gluteus medius|gluteus minimus|tensor fasciae latae/i, job: 'Lifts the leg out to the side and keeps the pelvis level on one leg.' },
  { key: 'hip-flexors', label: 'Hip flexors', match: /^iliacus|^psoas major|^iliopsoas/i, job: 'Lift the thigh forward.' },
  { key: 'adductors', label: 'Inner thigh (adductors)', match: /adductor (magnus|longus|brevis)|^gracilis|^pectineus/i, job: 'Pull the thigh in, and help straighten a deeply bent hip.' },
  { key: 'hams', label: 'Hamstrings', match: /biceps femoris|semitendinosus|semimembranosus/i, job: 'Straighten the hip and bend the knee.' },
  { key: 'quads', label: 'Quadriceps', match: /vastus (lateralis|medialis|intermedius)|rectus femoris/i, job: 'Straighten the knee.' },
  { key: 'calves', label: 'Calves', match: /gastrocnemius|^soleus/i, job: 'Push the ball of the foot down.' },
  { key: 'shin', label: 'Front of the shin', match: /tibialis anterior/i, job: 'Lifts the front of the foot.' },
];
export const GROUP_BY_KEY = Object.fromEntries(GROUPS.map(g => [g.key, g]));

/**
 * What the body carries and what it rests on.
 *   load:    { at: 'hands' | 'back' | 'hips' | 'none', kg }   the whole implement's mass
 *   support: 'feet' | 'bench' | 'bench-edge' | 'hands-feet'
 */
const DEFAULT_PHYSICS = { load: { at: 'none', kg: 0 }, support: 'feet' };

/** Every landmark the model needs, read off the posed rig once. */
function readBody(rig) {
  const B = { side: {} };
  B.hipC = rig.jointAt('hip', 'l', V()).add(rig.jointAt('hip', 'r', V())).multiplyScalar(0.5);
  B.lumbar = rig.pivotAt('lumbar');
  B.thoracic = rig.pivotAt('thorax');
  B.neck = rig.pivotAt('neck');
  B.headTop = rig.pivotAt('head', null, V(), true);
  B.qPelvis = rig.boneQuat('root');
  B.qThorax = rig.boneQuat('thorax');
  for (const side of SIDES) {
    const j = (k) => rig.jointAt(k, side, V());
    const s = { gh: j('gh'), el: j('el'), wr: j('wr'), grip: j('grip'), hip: j('hip'), knee: j('knee'), ankle: j('ankle'), mtp: j('mtp'), toe: j('toe') };
    // The heel: under and a little behind the ankle on the standing foot, carried by the foot.
    const a0 = rig.morphedJoint(side, 'ankle', V()), m0 = rig.morphedJoint(side, 'mtp', V());
    const back = a0.clone().sub(m0).setY(0).normalize();
    s.heel = rig.carry('foot', side, new THREE.Vector3(a0.x, m0.y, a0.z).addScaledVector(back, 0.045));
    s.hinge = rig.p[side].hinge.clone().applyQuaternion(rig.boneQuat('upperarm', side)).normalize();
    s.kneeHinge = rig.p[side].kneeHinge.clone().applyQuaternion(rig.boneQuat('thigh', side)).normalize();
    s.qShin = rig.boneQuat('shin', side);
    s.qForearm = rig.boneQuat('forearm2', side);
    const bendOf = (a, b, c) => Math.acos(Math.max(-1, Math.min(1, b.clone().sub(a).normalize().dot(c.clone().sub(b).normalize()))));
    s.elbowBend = bendOf(s.gh, s.el, s.wr);
    s.kneeBend = bendOf(s.hip, s.knee, s.ankle);
    B.side[side] = s;
  }
  return B;
}

/** The body's segments as weights: [{ key, body, p, m }], m as a share of body mass. */
function segments(B) {
  const out = [
    { body: 'pelvis', p: B.hipC.clone().lerp(B.lumbar, 0.5), m: MASS.pelvis },
    { body: 'abdomen', p: B.lumbar.clone().lerp(B.thoracic, 0.5), m: MASS.abdomen },
    { body: 'thorax', p: B.thoracic.clone().lerp(B.neck, 0.5), m: MASS.thorax },
    { body: 'head', p: B.neck.clone().lerp(B.headTop, 0.55), m: MASS.head },
  ];
  for (const side of SIDES) {
    const s = B.side[side];
    out.push(
      { body: `upperarm.${side}`, p: s.gh.clone().lerp(s.el, COM_AT.upperarm), m: MASS.upperarm },
      { body: `forearm.${side}`, p: s.el.clone().lerp(s.wr, COM_AT.forearm), m: MASS.forearm },
      { body: `hand.${side}`, p: s.grip.clone(), m: MASS.hand },
      { body: `thigh.${side}`, p: s.hip.clone().lerp(s.knee, COM_AT.thigh), m: MASS.thigh },
      { body: `shank.${side}`, p: s.knee.clone().lerp(s.ankle, COM_AT.shank), m: MASS.shank },
      { body: `foot.${side}`, p: s.heel.clone().lerp(s.mtp, COM_AT.foot), m: MASS.foot },
    );
  }
  return out;
}

/** Everything beyond each joint, going outwards from the pelvis. */
function beyond(joint) {
  const [name, side] = joint.split('.');
  const arm = (s) => [`upperarm.${s}`, `forearm.${s}`, `hand.${s}`];
  switch (name) {
    case 'lumbar': return ['abdomen', 'thorax', 'head', ...arm('l'), ...arm('r')];
    case 'thoracic': return ['thorax', 'head', ...arm('l'), ...arm('r')];
    case 'neck': return ['head'];
    case 'shoulder': return arm(side);
    case 'elbow': return [`forearm.${side}`, `hand.${side}`];
    case 'wrist': return [`hand.${side}`];
    case 'hip': return [`thigh.${side}`, `shank.${side}`, `foot.${side}`];
    case 'knee': return [`shank.${side}`, `foot.${side}`];
    case 'ankle': return [`foot.${side}`];
    default: return [];
  }
}

/**
 * Share the body's weight between the places it rests on, so that nothing is left over to
 * tip it: the pushes add up to the weight and balance it front to back and side to side.
 * With more places than that needs, the weight goes mostly where `cap` says it can
 * (a bench carries a lying body; the feet beside it carry little). A push can only push,
 * so a place that would have to pull is dropped and the rest are solved again.
 * Returns the pushes in newtons and how far out of balance the body is, in metres.
 */
function shareWeight(points, weight, com) {
  let live = points.map((_, i) => i);
  const r = new Array(points.length).fill(0);
  let off = 0;
  for (let pass = 0; pass < points.length; pass++) {
    // Rows: sum, moment front-to-back, moment side-to-side, about the centre of mass.
    const A = live.map(i => [1, points[i].p.z - com.z, points[i].p.x - com.x]);
    const C = live.map(i => points[i].cap ?? 1);
    const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let k = 0; k < live.length; k++) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) M[a][b] += A[k][a] * C[k] * A[k][b];
    // A touch of damping keeps this solvable when the places lie on one line (two feet side by side).
    const lam = 1e-6 * (M[0][0] || 1);
    M[1][1] += lam; M[2][2] += lam;
    const y = solve3(M, [weight, 0, 0]);
    r.fill(0);
    let worst = -1, min = -1e-6 * weight;
    for (let k = 0; k < live.length; k++) {
      const v = C[k] * (A[k][0] * y[0] + A[k][1] * y[1] + A[k][2] * y[2]);
      r[live[k]] = v;
      if (v < min) { min = v; worst = k; }
    }
    if (worst < 0) {
      let mz = 0, mx = 0;
      for (const i of live) { mz += r[i] * (points[i].p.z - com.z); mx += r[i] * (points[i].p.x - com.x); }
      off = Math.hypot(mz, mx) / weight;
      break;
    }
    live.splice(worst, 1);
    if (!live.length) { off = Infinity; break; }
  }
  return { r, off };
}

function solve3(M, b) {
  const [a, bb, c] = M[0], [d, e, f] = M[1], [g, h, i] = M[2];
  const det = a * (e * i - f * h) - bb * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-12) return [b[0] / (a || 1), 0, 0];
  const inv = [
    [(e * i - f * h), -(bb * i - c * h), (bb * f - c * e)],
    [-(d * i - f * g), (a * i - c * g), -(a * f - c * d)],
    [(d * h - e * g), -(a * h - bb * g), (a * e - bb * d)],
  ];
  return inv.map(row => (row[0] * b[0] + row[1] * b[1] + row[2] * b[2]) / det);
}

/**
 * The model, for the body as the rig has it posed right now.
 *
 * @param rig      the posed Rig
 * @param physics  { load: { at, kg }, support }
 * @param body     { massKg, heightM }
 * @returns { effort: { groupKey: 0..1+ }, demand, torque, com, offBalance, reactions }
 */
export function analyse(rig, physics = DEFAULT_PHYSICS, body = { massKg: 70, heightM: 1.7 }) {
  const B = readBody(rig);
  const mass = body.massKg, W = mass * G;
  const load = physics.load || DEFAULT_PHYSICS.load;
  const forces = [];                                   // { p, f (N, world), body }
  const segs = segments(B);
  for (const s of segs) forces.push({ p: s.p, f: new THREE.Vector3(0, -s.m * W, 0), body: s.body });

  // ---- what is carried ----
  const Lw = (load.kg || 0) * G;
  if (Lw > 0) {
    if (load.at === 'hands') for (const side of SIDES) forces.push({ p: B.side[side].grip, f: new THREE.Vector3(0, -Lw / 2, 0), body: `hand.${side}`, load: true });
    else if (load.at === 'hand.l' || load.at === 'hand.r') { const side = load.at.slice(-1); forces.push({ p: B.side[side].grip, f: new THREE.Vector3(0, -Lw, 0), body: `hand.${side}`, load: true }); }
    else {
      // A bar across the upper back or the hips is held there by the hands, so it is where
      // they are; the trunk or the pelvis carries it, not the arms.
      const bar = B.side.l.grip.clone().lerp(B.side.r.grip, 0.5);
      if (load.at === 'back') forces.push({ p: bar, f: new THREE.Vector3(0, -Lw, 0), body: 'thorax', load: true });
      else if (load.at === 'hips') forces.push({ p: bar, f: new THREE.Vector3(0, -Lw, 0), body: 'pelvis', load: true });
    }
    // A bar hanging in straight arms against the front of the thighs is steadied by them:
    // the legs push it forward and the arms carry it like ropes, with nothing for the
    // shoulders to hold. The push is whatever leaves the shoulder no turning force from the
    // load, and only ever away from the body, so a bar hanging clear of the legs gets none.
    if (load.at === 'hands' && load.against === 'legs') {
      const fwd = Z.clone().applyQuaternion(B.qPelvis).setY(0).normalize();
      for (const side of SIDES) {
        const s = B.side[side], dy = s.gh.y - s.grip.y, dz = s.grip.clone().sub(s.gh).dot(fwd);
        if (dy < 0.3 || dz <= 0) continue;
        const push = Math.min(0.5, dz / dy) * (Lw / 2);
        forces.push({ p: s.grip, f: fwd.clone().multiplyScalar(push), body: `hand.${side}`, contact: true });
        forces.push({ p: B.hipC, f: fwd.clone().multiplyScalar(-push), body: 'pelvis', contact: true });
      }
    }
  }

  // ---- centre of mass of the body and what it carries ----
  const com = V(); let total = 0;
  for (const F of forces) { com.addScaledVector(F.p, -F.f.y); total += -F.f.y; }
  com.divideScalar(total);

  // ---- where it rests ----
  const support = physics.support || 'feet';
  const points = [];
  const feetCap = support === 'bench' ? 0.04 : 1;
  if (support !== 'hang') for (const side of SIDES) {
    if (physics.feet && physics.feet[side] === false) continue;
    const s = B.side[side];
    // A raised heel carries nothing: the weight is on the ball of the foot.
    if (s.heel.y < s.mtp.y + 0.02) points.push({ p: s.heel, body: `foot.${side}`, cap: feetCap });
    points.push({ p: s.mtp, body: `foot.${side}`, cap: feetCap });
    points.push({ p: s.toe, body: `foot.${side}`, cap: feetCap * 0.5 });
  }
  if (support === 'bench') {
    points.push({ p: B.thoracic.clone().lerp(B.neck, 0.6), body: 'thorax', cap: 1 });
    points.push({ p: B.hipC.clone(), body: 'pelvis', cap: 1 });
  } else if (support === 'bench-edge') {
    points.push({ p: B.thoracic.clone().lerp(B.neck, 0.5), body: 'thorax', cap: 1 });
  } else if (support === 'hands-feet' || support === 'hang') {
    for (const side of SIDES) points.push({ p: B.side[side].grip, body: `hand.${side}`, cap: 1 });
  }
  const { r, off } = shareWeight(points, total, com);
  points.forEach((pt, i) => { if (r[i] > 0) forces.push({ p: pt.p, f: new THREE.Vector3(0, r[i], 0), body: pt.body, reaction: true }); });

  // ---- the turning force the muscles must make at each joint ----
  const at = {
    lumbar: B.lumbar, thoracic: B.thoracic, neck: B.neck,
    ...Object.fromEntries(SIDES.flatMap(s => [[`shoulder.${s}`, B.side[s].gh], [`elbow.${s}`, B.side[s].el], [`wrist.${s}`, B.side[s].wr],
      [`hip.${s}`, B.side[s].hip], [`knee.${s}`, B.side[s].knee], [`ankle.${s}`, B.side[s].ankle]])),
  };
  const torque = {}, through = {};
  const arm = V();
  for (const [joint, J] of Object.entries(at)) {
    const set = new Set(beyond(joint));
    const t = V(), f = V();
    for (const F of forces) {
      if (!set.has(F.body)) continue;
      t.add(arm.copy(F.p).sub(J).cross(F.f));
      f.add(F.f);
    }
    torque[joint] = t.negate();      // what the muscles make, against what the weights make
    through[joint] = f;              // the force the far side hangs on this joint with
  }

  // ---- read each turning force in its joint's own terms ----
  const k = (mass * body.heightM) / REF_SIZE;          // bigger bodies are stronger, in proportion
  const need = {};                                     // demand per action per side, 0..1+
  const pos = (x) => (x > 0 ? x : 0);
  const Xp = X.clone().applyQuaternion(B.qPelvis), Zp = Z.clone().applyQuaternion(B.qPelvis), Yp = Y.clone().applyQuaternion(B.qPelvis);
  const Xt = X.clone().applyQuaternion(B.qThorax), Yt = Y.clone().applyQuaternion(B.qThorax), Zt = Z.clone().applyQuaternion(B.qThorax);
  const info = {};
  for (const side of SIDES) {
    const m = sgn(side), s = B.side[side], n = {};
    // Elbow and knee: one hinge each. A positive turn bends them.
    const te = torque[`elbow.${side}`].dot(s.hinge);
    // A lift here never locks the elbow, so a hanging arm is drawn a few degrees short of
    // straight. A real arm carrying a heavy weight hangs straight and holds it through the
    // joint, not the biceps, so the first few degrees of bend ask nothing of the flexors.
    const hang = Math.min(1, Math.max(0, (s.elbowBend - 0.17) / 0.21));
    n.elbowFlex = pos(te) * hang * hang * (3 - 2 * hang) / (STRENGTH.elbowFlex * k * curve(s.elbowBend, 0.62, 1.1)); n.elbowExt = pos(-te) / (STRENGTH.elbowExt * k);
    const tk = torque[`knee.${side}`].dot(s.kneeHinge);
    n.kneeFlex = pos(tk) / (STRENGTH.kneeFlex * k); n.kneeExt = pos(-tk) / (STRENGTH.kneeExt * k * curve(s.kneeBend, 0.6, 1.3));
    // Ankle: about the shin's side-to-side axis. A positive turn points the toes down.
    const ta = torque[`ankle.${side}`].dot(X.clone().applyQuaternion(s.qShin));
    n.anklePlantar = pos(ta) / (STRENGTH.anklePlantar * k); n.ankleDorsi = pos(-ta) / (STRENGTH.ankleDorsi * k);
    // Hip, in the pelvis's frame. Forward is a negative turn about the side-to-side axis.
    const th = torque[`hip.${side}`];
    const hx = th.dot(Xp), hz = th.dot(Zp) * m;
    const thighDir = s.knee.clone().sub(s.hip).normalize();
    n.hipBend = Math.acos(Math.max(-1, Math.min(1, thighDir.dot(Yp.clone().negate()))));      // 0 standing straight
    // The glutes are weakest with the hip straight, where they are shortest, and strongest
    // with it bent to a right angle. That is why a hip thrust, loaded at the top, takes so
    // much of them.
    n.hipExt = pos(hx) / (STRENGTH.hipExt * k * curve(n.hipBend, 0.55, 1)); n.hipFlex = pos(-hx) / (STRENGTH.hipFlex * k);
    n.hipAbd = pos(hz) / (STRENGTH.hipAbd * k); n.hipAdd = pos(-hz) / (STRENGTH.hipAdd * k);
    // Shoulder, in the upper back's frame.
    const ts = torque[`shoulder.${side}`];
    const d = s.el.clone().sub(s.gh).normalize();
    const lift = 1 - d.dot(Yt) ** 2;                    // 0 with the arm along the body, 1 with it straight out
    const sx = ts.dot(Xt), sz = ts.dot(Zt) * m, sy = -ts.dot(Yt) * m;
    n.shFlex = pos(-sx) / (STRENGTH.shFlex * k); n.shExt = pos(sx) / (STRENGTH.shExt * k);
    n.shAbd = pos(sz) / (STRENGTH.shAbd * k); n.shAdd = pos(-sz) / (STRENGTH.shAdd * k);
    // About the body's long axis: with the arm out, that is pulling it across the chest or
    // back; with the arm down, it is turning the arm in or out.
    n.shIn = pos(sy) * lift / (STRENGTH.shIn * k); n.shOut = pos(-sy) * lift / (STRENGTH.shOut * k);
    n.shRotIn = pos(sy) * (1 - lift) / (STRENGTH.shRotIn * k); n.shRotOut = pos(-sy) * (1 - lift) / (STRENGTH.shRotOut * k);
    n.armUp = Math.acos(Math.max(-1, Math.min(1, d.dot(Yt.clone().negate()))));              // 0 hanging, pi overhead
    // Shoulder girdle: what the arm hangs on the trunk with, or pushes into it with.
    const fa = through[`shoulder.${side}`];
    n.girdleLift = pos(-fa.dot(Yt)) / (STRENGTH.girdleLift * k);
    n.girdleForward = pos(-fa.dot(Zt)) / (STRENGTH.girdleForward * k);      // the arm pushed back into the trunk
    n.girdleBack = pos(fa.dot(Zt)) / (STRENGTH.girdleBack * k);             // the arm pulled forward off it
    // Grip: only what the hand carries of the load. Hanging from the fingers takes all of
    // it; a bar resting in the heel of the hand takes about half the squeeze.
    let grip = 0;
    for (const F of forces) if (F.load && F.body === `hand.${side}`) {
      const along = s.el.clone().sub(s.wr).normalize().dot(F.f.clone().normalize());   // +1 pressing into the forearm
      grip += F.f.length() * (along > 0 ? 0.45 + 0.55 * (1 - along) : 1);
    }
    n.grip = grip / (STRENGTH.grip * k);
    const tw = torque[`wrist.${side}`].dot(X.clone().applyQuaternion(s.qForearm));
    n.wrist = Math.abs(tw) / (STRENGTH.wristFlex * k);
    need[side] = n;
  }
  // Spine: the whole trunk above the joint, about the pelvis's axes. Forward is a positive turn.
  const tl = torque.lumbar;
  const trunk = {
    ext: pos(-tl.dot(Xp)) / (STRENGTH.trunkExt * k), flex: pos(tl.dot(Xp)) / (STRENGTH.trunkFlex * k),
    side: Math.abs(tl.dot(Zp)) / (STRENGTH.trunkSide * k), twist: Math.abs(tl.dot(Yp)) / (STRENGTH.trunkTwist * k),
    // How hard the trunk is squeezed end to end: the brace that keeps it one piece.
    squeeze: pos(-through.lumbar.dot(Yp) - 0.6 * W) / (2.2 * W),
  };
  const tn = torque.neck, Xh = Xt;
  const neck = Math.max(pos(-tn.dot(Xh)) / (STRENGTH.neckExt * k), pos(tn.dot(Xh)) / (STRENGTH.neckFlex * k));

  // ---- from joint actions to muscles ----
  const effort = {};
  const both = (fn) => { const a = fn(need.l), b = fn(need.r); return { l: a, r: b, max: Math.max(a, b) }; };
  const put = (key, v) => { effort[key] = v.max; (info[key] ||= {}).l = v.l; info[key].r = v.r; };
  const up = (n) => Math.sin(Math.min(Math.PI, n.armUp) / 2) ** 2 * (n.shFlex + n.shAbd);     // turning the shoulder blade up under a raised, loaded arm
  // Muscles that cross two joints pull on both, wanted or not, and another muscle has to
  // cancel the pull that is not wanted:
  //   - the hamstrings straighten the hip but also bend the knee, so in a squat the
  //     quadriceps work against them as well as against the load;
  //   - the calf's gastrocnemius bends the knee a little too;
  //   - the biceps bends the elbow but also lifts the arm forward, so in a row or a
  //     pull-up the lats and the back of the shoulder hold the arm back against it.
  for (const side of SIDES) {
    const n = need[side];
    // How much of the hip's work the knee's own need to straighten takes off the hamstrings,
    // read from the load alone, before their pull on the knee is added back in.
    n.kneeShare = Math.min(1, n.kneeExt / (n.hipExt + 1e-6));
    const hamsAtHip = n.hipExt * (1 - 0.55 * n.kneeShare);
    n.kneeExt += 0.32 * hamsAtHip + 0.1 * n.anklePlantar;
    n.shExt += 0.25 * pos(n.elbowFlex - n.shFlex);
  }
  put('pec', both(n => Math.max(n.shIn, 0.4 * n.shFlex * (n.armUp < 2 ? 1 : 0.4), 0.6 * n.shAdd, 0.5 * n.shRotIn)));
  put('delt-front', both(n => Math.max(n.shFlex, 0.7 * n.shIn, 0.45 * n.shAbd)));
  put('delt-side', both(n => Math.max(n.shAbd, 0.3 * n.shFlex)));
  put('delt-rear', both(n => Math.max(n.shOut, 0.6 * n.shExt, 0.35 * n.shRotOut)));
  put('lats', both(n => Math.max(n.shExt, n.shAdd, 0.4 * n.shRotIn)));
  put('cuff', both(n => Math.max(n.shRotOut, n.shRotIn, 0.45 * Math.max(n.shFlex, n.shAbd, n.shExt, n.shAdd, n.shIn, n.shOut))));
  put('trap-upper', both(n => Math.max(n.girdleLift, 0.75 * up(n))));
  put('mid-back', both(n => Math.max(n.girdleBack, 0.6 * n.shOut, 0.5 * n.shExt, 0.35 * up(n))));
  put('serratus', both(n => Math.max(n.girdleForward, 0.8 * up(n))));
  put('biceps', both(n => Math.max(n.elbowFlex, 0.15 * n.shFlex)));
  put('triceps', both(n => Math.max(n.elbowExt, 0.2 * n.shExt)));
  put('forearm', both(n => Math.max(n.grip, 0.6 * n.wrist)));
  // The hamstrings cross the knee too. When the knee itself needs straightening they would
  // fight the quadriceps, so the glutes and the big adductor take more of the hip.
  put('glute-max', both(n => n.hipExt * (0.85 + 0.15 * n.kneeShare)));
  put('hams', both(n => Math.max(n.kneeFlex, n.hipExt * (1 - 0.55 * n.kneeShare))));
  put('adductors', both(n => Math.max(n.hipAdd, 0.8 * n.hipExt * Math.sin(Math.min(Math.PI / 2, n.hipBend)))));
  put('glute-med', both(n => Math.max(n.hipAbd, 0.25 * n.hipExt)));
  put('hip-flexors', both(n => n.hipFlex));
  put('quads', both(n => Math.max(n.kneeExt, 0.3 * n.hipFlex)));
  put('calves', both(n => Math.max(n.anklePlantar, 0.35 * n.kneeFlex)));
  put('shin', both(n => n.ankleDorsi));
  effort.erector = trunk.ext;
  effort.abs = Math.max(trunk.flex, 0.7 * trunk.side, 0.8 * trunk.twist, 0.55 * trunk.squeeze + 0.25 * trunk.ext);
  effort.neck = neck;

  return { effort, sides: info, need, trunk, torque, com, offBalance: off, reactions: points.map((pt, i) => ({ body: pt.body, n: r[i] })), weight: total };
}

/**
 * Joint angles as a physiotherapist would read them, in degrees, for the range-of-motion
 * gate. Measured from the posed joints, so they are true whatever built the pose.
 */
export function angles(rig) {
  const B = readBody(rig), out = {};
  const deg = (r) => r * 180 / Math.PI;
  const ang = (a, b) => deg(Math.acos(Math.max(-1, Math.min(1, a.clone().normalize().dot(b.clone().normalize())))));
  const down = Y.clone().negate();
  const Yp = Y.clone().applyQuaternion(B.qPelvis), Zp = Z.clone().applyQuaternion(B.qPelvis), Xp = X.clone().applyQuaternion(B.qPelvis);
  const Yt = Y.clone().applyQuaternion(B.qThorax);
  out.trunkLean = ang(B.neck.clone().sub(B.hipC), Y);
  out.spineBend = ang(Yt, Yp);
  for (const side of SIDES) {
    const s = B.side[side], m = sgn(side);
    out[`elbow.${side}`] = ang(s.el.clone().sub(s.gh), s.wr.clone().sub(s.el));
    out[`knee.${side}`] = ang(s.knee.clone().sub(s.hip), s.ankle.clone().sub(s.knee));
    out[`shoulder.${side}`] = ang(s.el.clone().sub(s.gh), Yt.clone().negate());
    const thigh = s.knee.clone().sub(s.hip).normalize();
    // Forward of the pelvis's own down is flexion; behind it is extension (negative).
    const fwd = thigh.dot(Zp), dn = -thigh.dot(Yp), out2 = thigh.dot(Xp) * m;
    out[`hipFlex.${side}`] = deg(Math.atan2(fwd, dn));
    out[`hipAbd.${side}`] = deg(Math.asin(Math.max(-1, Math.min(1, out2))));
    out[`ankle.${side}`] = ang(s.knee.clone().sub(s.ankle), s.mtp.clone().sub(s.ankle));
    out[`reach.${side}`] = s.grip.distanceTo(s.gh);
  }
  void down;
  return out;
}

/**
 * How well two sets of efforts agree on which muscles work hardest: Spearman's rank
 * correlation, 1 for the same order, 0 for unrelated. Used to test this model against the
 * hand-written lifts.
 */
export function rankAgainst(a, b) {
  const keys = Object.keys(a).filter(k => k in b);
  if (keys.length < 3) return NaN;
  const rank = (o) => {
    const sorted = keys.slice().sort((x, y) => o[y] - o[x]);
    const r = {};
    for (let i = 0; i < sorted.length;) {
      let j = i;
      while (j + 1 < sorted.length && Math.abs(o[sorted[j + 1]] - o[sorted[i]]) < 1e-9) j++;
      for (let q = i; q <= j; q++) r[sorted[q]] = (i + j) / 2;
      i = j + 1;
    }
    return r;
  };
  const ra = rank(a), rb = rank(b), n = keys.length;
  const mean = (n - 1) / 2;
  let num = 0, da = 0, db = 0;
  for (const key of keys) { num += (ra[key] - mean) * (rb[key] - mean); da += (ra[key] - mean) ** 2; db += (rb[key] - mean) ** 2; }
  return num / Math.sqrt(da * db || 1);
}
