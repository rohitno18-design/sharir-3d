import * as THREE from 'three';
import { d, lerp, clamp01, keyCurve, Frame, plantFeet, handsOnBar, joint, restingOn, squatStance, armSpace, SIDES, sgn, form, bodyKey } from './lift.js';
import { analyse, angles, GROUPS } from './biomech.js';
import { boneIndex } from './rig.js';

/**
 * Movement scripts: a movement written as data, not as code.
 *
 * A hand-written lift is a few hundred lines that work out where a bar goes. That does not
 * scale to every exercise there is. A script says only what a coach or a physiotherapist
 * would say: how the body stands, what it holds, and the position of each joint at the
 * start and at the end, in plain joint angles. This file turns that into the same thing a
 * hand-written lift is, so the player, the panel and Film mode run it unchanged:
 *
 *   - the pose at every moment, built on the rig's own solvers, so the rules every lift
 *     obeys still hold (feet planted flat, elbows and knees true hinges that never lock,
 *     hands closed round what they hold);
 *   - which muscles work and how hard, computed from the pose and the load by the
 *     joint-torque model in biomech.js, so nobody has to draw effort curves.
 *
 * See docs/movement-scripts.md for the format. In short:
 *
 *   {
 *     id, part, name, sub, duration,
 *     equipment: 'none' | 'dumbbells' | 'barbell-back',
 *     load: { kg: 20 | 'working' },          // 'working': a load that takes the hardest muscle near its limit
 *     stance: { width: 'hip' | 'shoulder' | 'wide', toeOut: 10 },
 *     balance: true | 'hips',                // keep the weight over the middle of the foot: by leaning the trunk,
 *                                            // or ('hips') by sending the hips back while the written lean is kept
 *     poses: [ { at: 0, ...pose }, { at: 1, ...pose } ],
 *     cues: { lift, top, lower, start }, form: { setup, move, mistakes, breathe },
 *   }
 *
 * A pose (all angles in degrees; anything left out keeps its standing value):
 *   legs:   { knee, shin, heel }      both feet planted: knee bend, how far the shins lean forward, heel raise
 *   trunk:  { lean, lumbar, thorax, neck, head, side, twist }
 *   arms:   { raise, plane, turn, elbow, palm, wrist }      or { l: {...}, r: {...} }
 *             raise  how far the upper arm is lifted from hanging (0 down, 90 level, 180 overhead)
 *             plane  which way it is lifted: 0 out to the side, 90 straight forward, -90 straight back
 *             turn   the upper arm turned about its own length, outward positive
 *             elbow  bend, 0 straight
 *             palm   how far the forearm is turned: 'up' (0), 'in' (90, thumbs forward, the way arms
 *                    hang), 'down' (160), or degrees up to 180
 *   girdle: { lift, back }            shoulders shrugged up, shoulder blades squeezed back
 *
 * Arm angles are measured in the room: `raise: 0` hangs plumb however far the trunk leans.
 */

const X = new THREE.Vector3(1, 0, 0);
const PALM = { up: 0, in: 90, down: 160 };
const WIDTH = { narrow: -0.03, hip: 0.0, shoulder: 0.04, wide: 0.13 };
/** What a joint can do. A script that asks for more is held to this, and the gate reports it. */
export const RANGE = {
  'legs.knee': [0, 150], 'legs.shin': [-14, 40], 'legs.heel': [0, 45],
  'trunk.lean': [-20, 95], 'trunk.lumbar': [-25, 50], 'trunk.thorax': [-20, 40], 'trunk.neck': [-40, 45], 'trunk.head': [-25, 25],
  'trunk.side': [-35, 35], 'trunk.twist': [-45, 45],
  'arm.raise': [0, 180], 'arm.plane': [-90, 135], 'arm.turn': [-80, 90], 'arm.elbow': [0, 150], 'arm.palm': [0, 180], 'arm.wrist': [-60, 60],
  'girdle.lift': [-8, 28], 'girdle.back': [-20, 20],
};
const STANDING = {
  legs: { knee: 6, shin: 2.3, heel: 0 },
  trunk: { lean: 0, lumbar: 0, thorax: 0, neck: 0, head: 0, side: 0, twist: 0 },
  arm: { raise: 0, plane: 0, turn: 0, elbow: 8, palm: 90, wrist: 0 },
  girdle: { lift: 0, back: 3 },
};
const BAR = { radius: 0.0145, flesh: 0.011 };
const HANDLE = { radius: 0.016, flesh: 0.011 };
const hold = (x, key) => { const [lo, hi] = RANGE[key]; return Math.min(hi, Math.max(lo, x)); };

/** One written pose made whole: every number present, palms as degrees, both arms spelt out, all within range. */
function complete(p = {}, prev = null, clipped = null) {
  const base = prev || { legs: STANDING.legs, trunk: STANDING.trunk, arms: { l: STANDING.arm, r: STANDING.arm }, girdle: STANDING.girdle };
  const take = (group, written, standing) => {
    const out = {};
    for (const k of Object.keys(standing)) {
      let v = written && written[k] != null ? written[k] : standing[k];
      if (group === 'arm' && k === 'palm' && typeof v === 'string') v = PALM[v] ?? 90;
      const held = hold(+v, `${group}.${k}`);
      if (clipped && Math.abs(held - v) > 1e-6) clipped.push(`${group}.${k} ${v} is outside ${RANGE[`${group}.${k}`].join(' to ')}`);
      out[k] = held;
    }
    return out;
  };
  const a = p.arms || {};
  const each = (side) => ({ ...(a.l || a.r ? {} : a), ...(a[side] || {}) });
  return {
    at: p.at ?? 0,
    legs: take('legs', p.legs, base.legs),
    trunk: take('trunk', p.trunk, base.trunk),
    arms: { l: take('arm', each('l'), base.arms.l), r: take('arm', each('r'), base.arms.r) },
    girdle: take('girdle', p.girdle, base.girdle),
  };
}

function blend(a, b, k) {
  const mix = (x, y) => Object.fromEntries(Object.keys(x).map(key => [key, lerp(x[key], y[key], k)]));
  return { legs: mix(a.legs, b.legs), trunk: mix(a.trunk, b.trunk), arms: { l: mix(a.arms.l, b.arms.l), r: mix(a.arms.r, b.arms.r) }, girdle: mix(a.girdle, b.girdle) };
}

/**
 * One free arm from its joint angles. The angles place the elbow and the hand; the rig's
 * own arm solver then turns the bones, so the elbow is the same true hinge it is in every
 * lift and stays short of locking.
 */
function poseArm(rig, side, A, pose, arm, grip, space) {
  const m = sgn(side);
  // In the room's terms by default: "down" is where gravity pulls, so an arm described as
  // hanging hangs plumb however far the trunk leans, the way a held weight does.
  const toArm = space === 'trunk' ? (v) => v : (v) => A.dirToArm(v);
  const girdle = pose[`girdle.${side}`] || null;
  const S = joint(rig, side, 'gh');
  if (girdle) S.applyMatrix4(rig.localMatrix(rig.bones[boneIndex('girdle', side)], girdle, new THREE.Matrix4()));
  const th = d(arm.raise), ps = d(arm.plane), be = d(arm.elbow), ro = d(arm.turn);
  // The way the arm is lifted, level with the floor, and the turn that lifts it there. The
  // forearm's "forward" is carried along by the same turn, so an arm lifted to the side
  // bends its elbow forwards and an arm lifted to the front bends it upwards, the way a
  // relaxed arm does.
  const h = new THREE.Vector3(Math.cos(ps) * m, 0, Math.sin(ps));
  const axis = new THREE.Vector3(-h.z, 0, h.x).normalize();
  const carry = new THREE.Quaternion().setFromAxisAngle(axis, th);
  const dir = new THREE.Vector3(0, -1, 0).applyQuaternion(carry);
  const n0 = new THREE.Vector3(0, 0, 1).applyQuaternion(carry);
  const e = new THREE.Vector3().crossVectors(dir, n0);
  const n = n0.multiplyScalar(Math.cos(ro)).addScaledVector(e, -m * Math.sin(ro)).normalize();
  const fore = dir.clone().multiplyScalar(Math.cos(be)).addScaledVector(n, Math.sin(be));
  const wq = rig.wristQuat(side, 0, d(arm.wrist));
  const L1 = joint(rig, side, 'gh').distanceTo(joint(rig, side, 'el'));
  const L2 = joint(rig, side, 'el').distanceTo(rig._gripAfterWrist(side, wq));
  const T = S.clone().addScaledVector(toArm(dir.clone()), L1).addScaledVector(toArm(fore.clone()), L2);
  const pole = toArm(n.clone().negate());
  const solved = rig.solveArm(side, T, pole, { girdle, rootQ: A.q, pronation: d(arm.palm), wrist: d(arm.wrist), morphed: true });
  // The solver was made for hands on a bar. It points the elbow's joint at its pole, and
  // with a nearly straight arm and a turned palm that is not the same as bending the right
  // way: the grip sits off the forearm's line, and the elbow came out turned a quarter of a
  // turn, so a held weight loaded the elbow sideways. Here the arm is turned about the line
  // from the shoulder to the hand, which leaves the hand where it is, until the elbow's
  // hinge lies square to the way the script says the forearm bends.
  const inv = girdle ? rig.localMatrix(rig.bones[boneIndex('girdle', side)], girdle, new THREE.Matrix4()).invert() : null;
  const S0 = joint(rig, side, 'gh');
  const line = (inv ? T.clone().applyMatrix4(inv) : T.clone()).sub(S0).normalize();
  const want = new THREE.Vector3().crossVectors(inv ? pole.clone().transformDirection(inv) : pole, line);
  const q1 = solved[`upperarm.${side}`].quat;
  const hinge = rig.p[side].hinge.clone().applyQuaternion(q1);
  hinge.addScaledVector(line, -hinge.dot(line)); want.addScaledVector(line, -want.dot(line));
  if (hinge.lengthSq() > 1e-8 && want.lengthSq() > 1e-8) {
    hinge.normalize(); want.normalize();
    const roll = Math.atan2(new THREE.Vector3().crossVectors(hinge, want).dot(line), hinge.dot(want));
    q1.premultiply(new THREE.Quaternion().setFromAxisAngle(line, roll));
  }
  Object.assign(pose, solved);
  if (grip) Object.assign(pose, grip);
}

/** How far the ankle rises and moves when the heel comes up by `rise`, the ball of the foot staying put. */
function ankleLift(rig, rise) {
  const A = joint(rig, 'l', 'ankle'), T = joint(rig, 'l', 'mtp');
  const v = T.clone().sub(A);
  const up = v.clone().applyAxisAngle(X, rise);
  return new THREE.Vector3(0, v.y - up.y, v.z - up.z);
}

/** Turn a movement script into a lift the player can run. */
export function movement(script) {
  const equipment = script.equipment || 'none';
  const loadAt = equipment === 'dumbbells' ? 'hands' : equipment === 'barbell-back' ? 'back' : 'none';
  const clipped = [];
  const written = (Array.isArray(script.poses) ? script.poses : [{ at: 0, ...script.poses.start }, { at: 1, ...script.poses.end }])
    .slice().sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  const keys = [];
  for (const p of written) keys.push(complete(p, keys[keys.length - 1] || null, clipped));
  const timing = script.timing || [[0, 0], [0.38, 1], [0.48, 1], [0.9, 0], [1, 0]];
  const tUp = timing.find(k => k[1] >= 1)?.[0] ?? 0.4;
  const tHold = [...timing].reverse().find(k => k[1] >= 1)?.[0] ?? tUp;
  const tDown = timing.slice().reverse().find(k => k[1] <= 0 && k[0] < 1)?.[0] ?? 0.9;
  const cues = script.cues || {};
  const reach = Math.max(...keys.flatMap(k => [k.arms.l, k.arms.r].map(a => (Math.abs(a.plane) < 60 ? a.raise : 0))));
  const high = Math.max(...keys.flatMap(k => [k.arms.l.raise, k.arms.r.raise]));

  const lift = {
    id: script.id, part: script.part, name: script.name, sub: script.sub || '',
    source: script.source || 'Movement script; muscle effort computed from joint torques (see biomech.js)',
    duration: script.duration || 3,
    scripted: true, script, clipped,
    bar: equipment === 'barbell-back' ? BAR : HANDLE,
    u: keyCurve(timing),
    phases: script.phases || [
      { key: 'lift', name: cues.liftName || 'Lifting', t0: 0, t1: tUp, work: true, hint: cues.lift || '' },
      { key: 'top', name: cues.topName || 'At the top', t0: tUp, t1: Math.max(tHold, tUp + 0.02), hint: cues.top || '' },
      { key: 'lower', name: cues.lowerName || 'Lowering', t0: Math.max(tHold, tUp + 0.02), t1: tDown, hint: cues.lower || '' },
      { key: 'start', name: cues.startName || 'Start position', t0: tDown, t1: 1, hint: cues.start || '' },
    ],
    marks: [{ label: '⤓ Start', t: 0 }, { label: '⤒ Top', t: (tUp + Math.max(tHold, tUp)) / 2 }],
    poster: tUp * 0.6,
    ready: script.ready || '',
    form: script.form ? form(script.form.setup || [], script.form.move || [], script.form.mistakes || [], script.form.breathe || '') : null,
    equipment: { floor: true, ...(equipment === 'barbell-back' ? { bar: 'olympic' } : {}), ...(equipment === 'dumbbells' ? { dumbbells: true } : {}) },
    physics: { load: { at: loadAt, kg: typeof script.load?.kg === 'number' ? script.load.kg : 0 }, support: 'feet' },

    camera(ctx) {
      const s = (ctx.height || 1.7433) / 1.7433;
      const w = reach > 45 ? 0.95 : 0.5, top = (high > 120 ? 2.25 : 1.9) * s;
      const view = script.view || 'three-quarter';
      const offset = view === 'front' ? [0.2, 0.25, 2.6] : view === 'side' ? [2.5, 0.3, 0.25] : view === 'back' ? [-0.4, 0.3, -2.5] : [1.6, 0.35, 1.9];
      return { target: [0, 0.98 * s, 0.05], offset, box: [[-w, 0.0, -0.45], [w, top, 0.65]] };
    },

    /** The written poses blended at movement point u. */
    _at(u) {
      u = clamp01(u);
      for (let i = 0; i < keys.length - 1; i++) {
        const a = keys[i], b = keys[i + 1];
        if (u <= b.at || i === keys.length - 2) return blend(a, b, clamp01(b.at > a.at ? (u - a.at) / (b.at - a.at) : 1));
      }
      return blend(keys[0], keys[0], 0);
    },

    /** Per body, once: the stance, where a bar sits, and the lean that keeps each moment in balance. */
    _setup(rig) {
      const key = bodyKey();
      if (this._s?.key === key) return this._s;
      const gh = joint(rig, 'l', 'gh'), A = joint(rig, 'l', 'ankle');
      const st = script.stance || {};
      const spread = typeof st.width === 'number' ? st.width : Math.abs(A.x) + (WIDTH[st.width || 'hip'] ?? 0);
      const s = { key, feet: { spread, toeOut: d(st.toeOut ?? 8) }, lean: null };
      if (equipment === 'barbell-back') {
        s.bar = restingOn(rig, gh.y + 0.035, -1, BAR.radius, { clear: 0.004 });
        s.half = Math.abs(gh.x) + 0.13;
      }
      // The fingers close round a handle the same way wherever the arm is, so it is worked
      // out once and not at every moment of the rep.
      if (equipment === 'dumbbells') s.grip = Object.fromEntries(SIDES.map(side => [side, rig.gripAround(side, HANDLE.radius, HANDLE.flesh, rig.barInHand(side))]));
      this._s = s;
      if (script.balance) {
        // The body is posed and its real centre of mass, with whatever it carries, is
        // brought over the middle of the foot: by leaning the trunk (`balance: true`), or,
        // for a hinge whose lean is the point of the movement, by sending the hips back
        // (`balance: 'hips'`), which is the shins leaning back. Solved at a few moments of
        // the movement and read between them, so the pose itself stays cheap.
        const keep = rig.lastPose;
        const byHips = script.balance === 'hips';
        const N = 8, table = [];
        const phys = { ...this.physics, load: { ...this.physics.load, kg: this._kg ?? this.physics.load.kg } };
        const A0 = joint(rig, 'l', 'ankle'), T0 = joint(rig, 'l', 'toe'), B0 = joint(rig, 'l', 'mtp');
        const [lo0, hi0] = byHips ? [d(-14), d(40)] : [d(-15), d(85)];
        for (let i = 0; i <= N; i++) {
          const u = i / N, q = this._at(u);
          // Middle of the whole foot, heel to toe; up on the toes it is the ball of the foot.
          const target = q.legs.heel > 3 ? B0.z : A0.z + 0.4 * (T0.z - A0.z);
          const off = (x) => { rig.setPose(this._build(rig, s, q, x)); return analyse(rig, phys, this._body || { massKg: 70, heightM: 1.7 }).com.z - target; };
          // The centre of mass moves forward with either unknown, steadily, so a few steps
          // of the secant rule find it.
          let a = byHips ? d(q.legs.shin) : d(q.trunk.lean), fa = off(a);
          let b = a + d(fa > 0 ? -4 : 4), fb = off(b);
          for (let k = 0; k < 6 && Math.abs(fb) > 0.002 && Math.abs(fb - fa) > 1e-6; k++) {
            const c = Math.min(hi0, Math.max(lo0, b - fb * (b - a) / (fb - fa)));
            a = b; fa = fb; b = c; fb = off(b);
          }
          table.push(Math.min(hi0, Math.max(lo0, b)));
        }
        s.solved = (u) => { const x = clamp01(u) * N, i = Math.min(N - 1, Math.floor(x)); return lerp(table[i], table[i + 1], x - i); };
        s.byHips = byHips;
        if (keep) rig.setPose(keep);
      }
      return s;
    },

    _build(rig, s, q, trial = null) {
      // What balance decides (the lean, or the shins) comes from the table, or from the
      // value being tried while the table is made.
      const x = trial != null ? trial : s.solved ? s.solved(this._u) : null;
      const byHips = script.balance === 'hips';
      const shin = x != null && byHips ? x : d(q.legs.shin), knee = d(q.legs.knee), rise = d(q.legs.heel);
      const { hip } = squatStance(rig, s.feet, shin, knee - shin);
      if (rise) hip.add(ankleLift(rig, rise));
      const lean = x != null && !byHips ? x : d(q.trunk.lean);
      const frame = Frame.lean(rig, lean, hip);
      const p = { root: frame.entry() };
      const t = q.trunk;
      // Bending and turning are shared between the lower and the upper back.
      if (t.lumbar || t.side || t.twist) p.lumbar = { rot: [d(t.lumbar), d(t.twist / 2), -d(t.side / 2)] };
      if (t.thorax || t.side || t.twist) p.thorax = { rot: [d(t.thorax), d(t.twist / 2), -d(t.side / 2)] };
      if (t.neck) p.neck = { rot: [d(t.neck), 0, 0] };
      if (t.head) p.head = { rot: [d(t.head), 0, 0] };
      plantFeet(rig, frame, p, { ...s.feet, ...(rise ? { rise } : {}) });
      for (const side of SIDES) p[`girdle.${side}`] = { rot: [0, sgn(side) * d(q.girdle.back), sgn(side) * d(q.girdle.lift)] };
      const A = armSpace(rig, frame, p);
      if (equipment === 'barbell-back') {
        for (const side of SIDES) p[`girdle.${side}`] = { rot: [0, sgn(side) * d(9), sgn(side) * d(q.girdle.lift)] };
        handsOnBar(rig, frame, p, {
          at: s.bar.clone().applyMatrix4(A.M), half: s.half, align: 1, ...BAR,
          pole: (side) => frame.dirToWorld(new THREE.Vector3(sgn(side) * 0.25, -1, -0.45)),
        });
      } else {
        for (const side of SIDES) poseArm(rig, side, A, p, q.arms[side], s.grip?.[side], script.armSpace || 'room');
      }
      return p;
    },

    pose(u, { rig }) {
      const s = this._setup(rig);
      this._u = u;
      return this._build(rig, s, this._at(u));
    },

    /**
     * Work out, for this body, how hard each muscle works through the rep. Called by the
     * player when the movement opens and again if the body changes. Poses the rig as it
     * goes and puts back the pose that was showing.
     */
    prepare(app) {
      const rig = app.body.rig;
      const key = bodyKey();
      if (this._table?.key === key) return;
      this._body = { massKg: app.currentWeight(), heightM: app.currentHeightM() };
      const keep = rig.lastPose;
      const N = 48;
      const sample = (kg, n) => {
        const phys = { ...this.physics, load: { ...this.physics.load, kg } };
        const rows = [];
        for (let i = 0; i <= n; i++) {
          rig.setPose(this.pose(this.u(i / n), { rig }));
          rows.push(analyse(rig, phys, this._body));
        }
        return rows;
      };
      const peakOf = (rows) => Math.max(...rows.flatMap(r => GROUPS.map(g => r.effort[g.key] || 0)));
      // A working set: the load that takes the hardest-working muscle to about 85% of its
      // strength somewhere in the rep. Heavier, and the rep could not be done with control.
      let kg = this.physics.load.kg;
      if (script.load?.kg === 'working' && loadAt !== 'none') {
        // Searched with the balance of a middling load, then the balance is solved once
        // more for the load it settles on.
        this._kg = this._body.massKg * (loadAt === 'back' ? 1 : 0.25); this._s = null;
        // Effort rises with the load very nearly in a straight line, so the secant rule
        // lands on it in a few tries.
        const f = (x) => peakOf(sample(x, 8)) - 0.85;
        let a = 0, fa = f(a), b = this._kg, fb = f(b);
        for (let k = 0; k < 5 && Math.abs(fb) > 0.01 && Math.abs(fb - fa) > 1e-6; k++) {
          const c = Math.min(400, Math.max(0, b - fb * (b - a) / (fb - fa)));
          a = b; fa = fb; b = c; fb = f(b);
        }
        kg = Math.max(1, Math.round(b));
      }
      this._kg = kg; this._s = null;
      this.physics = { ...this.physics, load: { ...this.physics.load, kg } };
      const rows = sample(kg, N);
      const peak = {}, table = {};
      for (const g of GROUPS) { table[g.key] = rows.map(r => r.effort[g.key] || 0); peak[g.key] = Math.max(...table[g.key]); }
      const top = Math.max(...Object.values(peak));
      // Shown against the hardest muscle in this movement. An easy movement (nothing over
      // 45% of its strength) is not blown up to look like a hard one.
      const gain = 0.95 / Math.max(top, 0.45);
      const shown = GROUPS.filter(g => peak[g.key] >= Math.max(0.07, 0.12 * top)).sort((a, b) => peak[b.key] - peak[a.key]).slice(0, 12);
      this.muscles = shown.map(g => {
        const row = table[g.key], share = peak[g.key] / top;
        return {
          key: g.key, label: g.label, match: g.match,
          role: share >= 0.7 ? 'Prime mover' : share >= 0.35 ? 'Synergist' : 'Stabiliser',
          note: `${g.job} At its hardest here it works at about ${Math.round(Math.min(1.2, peak[g.key]) * 100)}% of its strength.`,
          effort: (t) => { const x = ((t % 1) + 1) % 1 * N, i = Math.min(N - 1, Math.floor(x)); return Math.min(1, gain * lerp(row[i], row[i + 1], x - i)); },
        };
      });
      this.report = {
        kg, top: +top.toFixed(2), offBalanceCm: +(Math.max(...rows.map(r => r.offBalance)) * 100).toFixed(1),
        peaks: Object.fromEntries(Object.entries(peak).filter(([, v]) => v > 0.05).sort((a, b) => b[1] - a[1]).map(([k2, v]) => [k2, +v.toFixed(2)])),
      };
      this._table = { key };
      if (keep) rig.setPose(keep);
    },

    /** The joint angles the pose really has at each moment, for the gates. */
    measure(app, steps = 12) {
      const rig = app.body.rig, keep = rig.lastPose, out = [];
      for (let i = 0; i <= steps; i++) { rig.setPose(this.pose(i / steps, { rig })); out.push(angles(rig)); }
      if (keep) rig.setPose(keep);
      return out;
    },

    muscles: [],
  };
  return lift;
}
