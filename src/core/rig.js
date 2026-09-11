import * as THREE from 'three';
import { applyMorph } from './morph.js';

/**
 * Skeleton rig — what lets the atlas move.
 *
 * The anatomy ships in one fixed anatomical pose with no armature, so posing it means
 * building the skeleton ourselves. Two decisions make that tractable:
 *
 * 1. The joint centres are not guessed. Z-Anatomy ships the articular capsules as real
 *    meshes, so the centre of "Articular capsule of glenohumeral joint" IS the shoulder's
 *    centre of rotation. Every pivot below is read out of the registry at load time, which
 *    also means they stay correct if the meshes are ever rebuilt.
 *
 * 2. The rig covers what a lift actually uses: shoulder girdle, arm, hand and fingers, plus
 *    hip, knee and ankle. Delavier's bench press setup is explicit that the feet are planted
 *    and driving into the floor and that the bar is gripped with the thumb opposed, so both
 *    the legs and the fingers have to be real bones rather than decoration.
 *
 * Skinning is two-bone linear blending, with weights computed per vertex at load from the
 * vertex's position along the limb — no weight painting, no per-part lists to maintain.
 * The forearm is split into two segments so that pronation distributes along its length
 * instead of collapsing the wrist, which is the classic single-bone twist artefact.
 */

/** Source-space (Z-up) -> GL (Y-up). Same convention as main.js. */
export const toGl = (a) => new THREE.Vector3(a[0], a[2], -a[1]);

/**
 * Joint centres. Articular capsules where the atlas provides one; the bone itself where it
 * does not (a phalanx's centre is a fine stand-in for a fingertip).
 */
const PIVOTS = {
  sc:       'joints:Articular capsule of sternoclavicular joint',
  gh:       'joints:Articular capsule of glenohumeral joint',
  el:       'joints:Articular capsule of elbow joint',
  wr:       'joints:Articular capsule of radiocarpal joint',
  mcp:      'joints:Articular capsules of metacarpophalangeal joints',
  pip:      'joints:Articular capsules of proximal interphalangeal joints',
  tip:      'skeletal:Distal phalanx of third finger of hand',
  thumbCmc: 'skeletal:First metacarpal bone',
  thumbTip: 'skeletal:Distal phalanx of first finger of hand',
  hip:      'joints:Articular capsule of hip joint',
  knee:     'joints:Articular capsule of knee joint',
  ankle:    'skeletal:Talus',
  toe:      'skeletal:Distal phalanx of first finger of foot',
};

/**
 * One tree per side. `radius` is how far from the bone's axis a vertex may sit and still be
 * bound to it — roughly the soft-tissue envelope of that segment, in metres. `group` keeps
 * the arm's segments from competing with the leg's when binding: in anatomical position the
 * hand hangs beside the thigh, and nothing should be able to bind across that gap.
 */
const SEGMENTS = [
  { name: 'girdle',   parent: null,       from: 'sc',       to: 'gh',       radius: 0.115, group: 'arm' },
  { name: 'upperarm', parent: 'girdle',   from: 'gh',       to: 'el',       radius: 0.100, group: 'arm' },
  { name: 'forearm1', parent: 'upperarm', from: 'el',       to: 'fm',       radius: 0.080, group: 'arm' },
  { name: 'forearm2', parent: 'forearm1', from: 'fm',       to: 'wr',       radius: 0.068, group: 'arm' },
  { name: 'hand',     parent: 'forearm2', from: 'wr',       to: 'mcp',      radius: 0.072, group: 'arm' },
  { name: 'fingers1', parent: 'hand',     from: 'mcp',      to: 'pip',      radius: 0.044, group: 'arm' },
  { name: 'fingers2', parent: 'fingers1', from: 'pip',      to: 'tip',      radius: 0.038, group: 'arm' },
  { name: 'thumb',    parent: 'hand',     from: 'thumbCmc', to: 'thumbTip', radius: 0.032, group: 'arm' },
  { name: 'thigh',    parent: null,       from: 'hip',      to: 'knee',     radius: 0.140, group: 'leg' },
  { name: 'shin',     parent: 'thigh',    from: 'knee',     to: 'ankle',    radius: 0.100, group: 'leg' },
  { name: 'foot',     parent: 'shin',     from: 'ankle',    to: 'toe',      radius: 0.090, group: 'leg' },
];

const PER_SIDE = SEGMENTS.length;
export const BONE_COUNT = 1 + PER_SIDE * 2;          // root + one tree per side
const SIDES = ['l', 'r'];
/** Bone index for a named segment. root = 0, then the left tree, then the right. */
export const boneIndex = (name, side) =>
  name === 'root' ? 0 : 1 + SIDES.indexOf(side) * PER_SIDE + SEGMENTS.findIndex(s => s.name === name);

// Structures that belong to a limb outright — they move with it in full.
const UPPER_LIMB = /upper limb|pectoral girdle/i;
const LOWER_LIMB = /lower limb|bones of foot|of foot\b|regions of lower limb/i;
// The pelvis is grouped under the lower limb in this atlas, but it is not part of it for
// posing: it sits on the bench and the femur swings from it.
const PELVIC = /pelvic girdle|hip bone|ilium|ischium|\bpubis\b|acetabul/i;
// Structures that run from the trunk out into the limb: nerves and vessels that must stay
// joined to their trunk origin while their far end travels with the arm.
const REACHING_ARM = /brachial plexus|axillary (artery|vein)|subclavian/i;
// Muscles that span from the trunk onto the arm. Their trunk end stays put and their
// humeral end follows, which is what the per-vertex blend produces for free.
const SPANNING_ARM = /pectoralis (major|minor)|latissimus dorsi|trapezius|rhomboid|serratus anterior|levator scapulae|subclavius|omohyoid/i;
// The same across the hip: these run from pelvis or spine onto the femur.
const SPANNING_LEG = /glute(us|al)|iliopsoas|iliacus|psoas|piriformis|obturator (internus|externus)|gemellus|quadratus femoris|tensor fasciae latae|sartorius|rectus femoris|adductor (longus|brevis|magnus|minimus)|pectineus|gracilis|semitendinosus|semimembranosus|biceps femoris/i;
// Never movable, whatever the geometry says: the axial skeleton and everything inside it.
const AXIAL = /\brib\b|ribs|sternum|vertebra|sacrum|coccyx|skull|mandible|hyoid|cranium|costal cartilage/i;
const AXIAL_SYS = new Set(['digestive', 'respiratory', 'urinary', 'reproductive', 'endocrine', 'cavities', 'senses']);
/** Height band each limb occupies in the source model, in metres up from the soles. */
const BAND = { arm: [0.60, 1.48], leg: [0.0, 0.95] };

export class Rig {
  constructor(registry) {
    this.ok = false;
    this.registry = registry;
    this.p = {};                 // side -> { sc, gh, el, ... } rest-space GL points
    this.bones = [];             // { name, side, index, parent, pivot, radius, group }
    this.byGroup = { arm: [], leg: [] };     // side -> group -> [segment index into SEGMENTS]
    this.matrices = new Float32Array(BONE_COUNT * 16);
    this.uniform = { value: this.matrices };
    this.enabled = { value: 0 };
    this._m = Array.from({ length: BONE_COUNT }, () => new THREE.Matrix4());
    this._clsCache = new Map();
    this.reset();
    this._resolve();
  }

  // ---------- rest skeleton ----------
  _centre(id) {
    const p = this.registry.byId.get(id);
    if (!p || !p.bb) return null;
    return toGl([(p.bb[0][0] + p.bb[1][0]) / 2, (p.bb[0][1] + p.bb[1][1]) / 2, (p.bb[0][2] + p.bb[1][2]) / 2]);
  }

  _resolve() {
    for (const side of SIDES) {
      const q = {};
      for (const [k, id] of Object.entries(PIVOTS)) {
        const c = this._centre(`${id}.${side}`);
        if (!c) { console.warn('[rig] missing pivot', k, side); return; }
        q[k] = c;
      }
      q.fm = q.el.clone().lerp(q.wr, 0.5);                       // forearm twist split
      this.p[side] = q;
    }
    for (const side of SIDES) {
      for (const seg of SEGMENTS) {
        const index = boneIndex(seg.name, side);
        this.bones[index] = {
          name: seg.name, side, index, group: seg.group, radius: seg.radius,
          parent: seg.parent ? boneIndex(seg.parent, side) : 0,
          pivot: this.p[side][seg.from], tail: this.p[side][seg.to],
        };
      }
    }
    this.bones[0] = { name: 'root', side: null, index: 0, parent: -1, pivot: new THREE.Vector3(0, 0, 0) };
    // Segment order within a group, for the joint blends.
    for (const g of ['arm', 'leg']) this.byGroup[g] = SEGMENTS.map((s, i) => (s.group === g ? i : -1)).filter(i => i >= 0);
    this.ok = true;
    this.hipZ = this.p.l.hip.y;      // source height of the hip, used when classifying
  }

  // ---------- skinning ----------
  /**
   * How this part relates to the skeleton: which limb group it may follow, and whether it
   * follows in full ('limb') or fades onto the trunk at its far end ('span').
   *
   * Order matters. The ancestry tests run BEFORE the muscle-name tests, because the atlas
   * paints muscle attachment patches onto the bones they attach to and names them after the
   * muscle: "Serratus anterior muscle.e3l" is a patch on the fourth rib, not serratus. Let
   * the name win and eight rib patches per side get dragged towards the arm, which renders
   * as a web across the armpit.
   */
  classify(part) {
    const hit = this._clsCache.get(part.id);
    if (hit) return hit;
    const r = this._classify(part);
    this._clsCache.set(part.id, r);
    return r;
  }

  _classify(part) {
    const none = { group: null, mode: 'none' };
    if (AXIAL_SYS.has(part.sys)) return none;
    // Reference planes and direction markers are annotations drawn in the body's space,
    // not tissue. Binding one to a bone sends a flat sheet swinging through the scene.
    if (part.sys === 'references') return none;

    const chain = this.registry.ancestors(part.id).map(a => a.n).join(' | ');
    if (AXIAL.test(part.n) || AXIAL.test(chain)) return none;

    if (PELVIC.test(part.n) || PELVIC.test(chain)) return none;
    if (LOWER_LIMB.test(chain) || LOWER_LIMB.test(part.n)) return this._limbOrSpan(part, 'leg');
    if (UPPER_LIMB.test(chain)) return { group: 'arm', mode: 'limb' };
    if (REACHING_ARM.test(chain)) return { group: 'arm', mode: 'span' };
    if (SPANNING_ARM.test(part.n)) return { group: 'arm', mode: 'span' };
    if (SPANNING_LEG.test(part.n)) return { group: 'leg', mode: 'span' };

    // Last resort for structures the hierarchy does not label: anything living entirely
    // outside the trunk's width AND within a limb's own height band. Both tests are needed —
    // feet are lateral too, and the shoulder is as wide as the hip.
    if (!part.bb) return none;
    if (Math.min(Math.abs(part.bb[0][0]), Math.abs(part.bb[1][0])) <= 0.135) return none;
    for (const g of ['arm', 'leg']) {
      if (part.bb[1][2] > BAND[g][0] && part.bb[0][2] < BAND[g][1]) return { group: g, mode: 'limb' };
    }
    return none;
  }

  /**
   * A soft-tissue structure that reaches above the hip crosses it, so it has to fade onto
   * the pelvis. A BONE never does: it is rigid, and fading its proximal end towards the
   * root would leave the femoral head behind while the shaft swung away from it.
   */
  _limbOrSpan(part, group) {
    if (part.sys === 'skeletal') return { group, mode: 'limb' };
    if (group === 'leg' && part.bb && part.bb[1][2] > this.hipZ + 0.02) return { group, mode: 'span' };
    return { group, mode: 'limb' };
  }

  /**
   * Bind one vertex: returns [boneA, boneB, weightA]. Everything outside a limb envelope
   * binds rigidly to the root, which is most of the body.
   */
  bindVertex(x, y, z, out, mode, group) {
    const side = x >= 0 ? 'l' : 'r';
    const q = this.p[side];
    const list = this.byGroup[group];
    if (!q || !list) { out[0] = 0; out[1] = 0; out[2] = 1; return out; }

    let best = -1, bestD = Infinity, bestT = 0;
    for (const si of list) {
      const seg = SEGMENTS[si];
      const a = q[seg.from], b = q[seg.to];
      const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
      const len2 = abx * abx + aby * aby + abz * abz;
      let t = len2 > 0 ? ((x - a.x) * abx + (y - a.y) * aby + (z - a.z) * abz) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = x - (a.x + abx * t), dy = y - (a.y + aby * t), dz = z - (a.z + abz * t);
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) / seg.radius;
      // Compare against each segment's own envelope, not raw distance: a vertex 6 cm from
      // the hand is outside it, the same 6 cm from the girdle is well inside.
      if (d < bestD) { bestD = d; best = si; bestT = t; }
    }
    // Only a spanning structure can fall out of the limb; a limb structure binds to its
    // nearest bone however far from the axis it sits.
    if (best < 0 || (mode === 'span' && bestD > 1)) { out[0] = 0; out[1] = 0; out[2] = 1; return out; }

    const seg = SEGMENTS[best];
    const bone = boneIndex(seg.name, side);
    // Blend across the joint at either end of this segment, so a bent elbow or a curled
    // finger creases instead of shearing.
    const BLEND = 0.26;                        // as a fraction of the segment's length
    let other = bone, w = 1;
    if (bestT < BLEND) {
      other = seg.parent ? boneIndex(seg.parent, side) : 0;
      w = 0.5 + 0.5 * (bestT / BLEND);
    } else if (bestT > 1 - BLEND) {
      const childIdx = list.find(i => SEGMENTS[i].parent === seg.name && SEGMENTS[i].from === seg.to);
      other = childIdx === undefined ? bone : boneIndex(SEGMENTS[childIdx].name, side);
      w = 0.5 + 0.5 * ((1 - bestT) / BLEND);
    }

    // Soften the outer edge of the envelope so a muscle belly fades onto the trunk rather
    // than ending in a hard crease. Only two bone slots exist per vertex, so at the fringe
    // the joint blend gives way to a root blend — the fringe is where a part leaves the
    // limb, and that transition matters more there than which limb bone it leaves from.
    const edge = mode === 'span' ? smoothstep(1.0, 0.72, bestD) : 1;
    if (edge < 1) {
      out[0] = w >= 0.5 ? bone : other;
      out[1] = 0;
      out[2] = edge;
      return out;
    }
    out[0] = bone; out[1] = other; out[2] = w;
    return out;
  }

  /** Per-vertex (boneA, boneB, weightA) for one geometry. */
  skinGeometry(geom, part) {
    const n = geom.attributes.position.count;
    const arr = new Float32Array(n * 3);
    const cls = this.ok ? this.classify(part) : { mode: 'none' };
    if (cls.mode === 'none') {
      for (let i = 0; i < n; i++) arr[i * 3 + 2] = 1;          // root, weight 1
      return new THREE.BufferAttribute(arr, 3);
    }
    const pos = geom.attributes.position;
    const out = [0, 0, 1];
    for (let i = 0; i < n; i++) {
      this.bindVertex(pos.getX(i), pos.getY(i), pos.getZ(i), out, cls.mode, cls.group);
      arr[i * 3] = out[0]; arr[i * 3 + 1] = out[1]; arr[i * 3 + 2] = out[2];
    }
    return new THREE.BufferAttribute(arr, 3);
  }

  // ---------- posing ----------
  reset() {
    for (let i = 0; i < BONE_COUNT; i++) this._m[i].identity().toArray(this.matrices, i * 16);
    this.enabled.value = 0;
  }

  /**
   * @param pose { root?: {rot|quat, pos}, 'upperarm.l': {rot|quat}, ... }
   *             Rotations are applied about that joint's own centre, in the parent's frame.
   */
  setPose(pose) {
    if (!this.ok) return;
    const local = new THREE.Matrix4();
    for (let i = 0; i < BONE_COUNT; i++) {
      const bone = this.bones[i];
      const key = bone.name === 'root' ? 'root' : `${bone.name}.${bone.side}`;
      this.localMatrix(bone, pose[key], local);
      if (bone.parent >= 0) this._m[i].multiplyMatrices(this._m[bone.parent], local);
      else this._m[i].copy(local);
      this._m[i].toArray(this.matrices, i * 16);
    }
    this.enabled.value = 1;
  }

  /** One bone's transform in its parent's frame: rotate about its own (morphed) joint centre. */
  localMatrix(bone, p = {}, out = new THREE.Matrix4()) {
    p = p || {};
    const r = _r;
    if (p.quat) r.makeRotationFromQuaternion(p.quat);
    else {
      const rot = p.rot || [0, 0, 0];
      _e.set(rot[0], rot[1], rot[2], 'XYZ');
      r.makeRotationFromEuler(_e);
    }
    if (p.pos) r.setPosition(p.pos[0], p.pos[1], p.pos[2]);
    // The pivot has to be morphed too: the vertices reaching this matrix have already been
    // through the height/weight field, so a rest-space pivot would sit off-joint on any
    // body that is not the source model's size.
    applyMorph(bone.pivot, _v);
    return out.makeTranslation(_v.x, _v.y, _v.z)
      .multiply(r)
      .multiply(_back.makeTranslation(-_v.x, -_v.y, -_v.z));
  }

  // ---------- inverse kinematics ----------
  /**
   * Generic two-bone solve. Given a root joint S, a middle joint E and an end G — all in
   * morphed space — find the rotations that put G on `target` with the middle joint falling
   * towards `pole`.
   */
  _solve2(S, E, G, target, pole) {
    const L1 = S.distanceTo(E);
    const L2 = E.distanceTo(G);
    const restD1 = E.clone().sub(S).normalize();
    const restD2 = G.clone().sub(E).normalize();

    const toT = target.clone().sub(S);
    let dist = toT.length();
    const reach = (L1 + L2) * 0.999;
    if (dist > reach) { toT.multiplyScalar(reach / dist); dist = reach; }
    if (dist < Math.abs(L1 - L2) * 1.001) { dist = Math.abs(L1 - L2) * 1.001; toT.setLength(dist); }
    const dirT = toT.clone().normalize();

    // Law of cosines gives the angle between the line to the target and the first bone.
    const cosA = (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist);
    const a = Math.acos(Math.min(1, Math.max(-1, cosA)));

    // Rotating about (dirT x pole) by a POSITIVE angle carries dirT towards the pole:
    // (dirT x pole) x dirT is the part of the pole perpendicular to dirT.
    const axis = new THREE.Vector3().crossVectors(dirT, pole);
    if (axis.lengthSq() < 1e-8) axis.set(0, 0, 1); else axis.normalize();
    const d1 = dirT.clone().applyAxisAngle(axis, a);
    const mid = S.clone().addScaledVector(d1, L1);
    const d2 = S.clone().add(toT).sub(mid).normalize();

    const q1 = new THREE.Quaternion().setFromUnitVectors(restD1, d1);
    // The second bone's rotation is expressed in the first's rotated frame, so the target
    // direction has to come back through the first bone.
    const d2Local = d2.clone().applyQuaternion(q1.clone().invert());
    const swing2 = new THREE.Quaternion().setFromUnitVectors(restD2, d2Local);
    return { q1, swing2, restD2 };
  }

  /**
   * A joint centre after the body morph but before any pose — i.e. where it sits on a
   * standing body of the current size. The ankle's height here is exactly how far the
   * ankle sits above a flat sole, which is what a foot needs to be planted on the floor.
   */
  morphedJoint(side, key, out = new THREE.Vector3()) {
    return this.p[side] && this.p[side][key] ? applyMorph(this.p[side][key], out) : out.set(0, 0, 0);
  }
  _morphed(side, key) { return this.morphedJoint(side, key, new THREE.Vector3()); }

  /**
   * Put the grip on `target` (rest space) and let the elbow fall towards `pole`.
   *
   * Posing the arm by hand-picked joint angles does not survive contact with a barbell —
   * the hands have to be ON the bar at every frame and at every body size, and a chain of
   * three Euler rotations compounds small errors into the bar floating past the head. So
   * the lift is authored as a bar path and the angles are solved from it.
   */
  solveArm(side, target, pole, pronation = 0, girdle = null) {
    if (!this.p[side]) return {};
    // Solve in morphed space, not rest space. The bone matrices rotate vertices that have
    // already been through the height/weight field, so the arm they actually swing is the
    // morphed one — solving against rest lengths lands the grip centimetres off the bar on
    // any body that is not the source model's size.
    const S = this._morphed(side, 'gh');
    const E = this._morphed(side, 'el');
    // The grip is the palm, not the fingertips: the bar sits across the metacarpal heads.
    const G = this._morphed(side, 'mcp');
    const T = applyMorph(target, new THREE.Vector3());
    // The shoulder blade moves before the arm does, so by the time this solves, the arm's
    // whole frame has already shifted. Bring the target and the elbow hint back through
    // that rotation — otherwise a few degrees at the collarbone slides the grip several
    // centimetres along the bar, and the hands change width mid-rep.
    if (girdle) {
      const gm = this.localMatrix(this.bones[boneIndex('girdle', side)], girdle, new THREE.Matrix4());
      const inv = gm.invert();
      T.applyMatrix4(inv);
      pole = pole.clone().transformDirection(inv);
    }
    const { q1, swing2, restD2 } = this._solve2(S, E, G, T, pole);

    // A twist only leaves the grip alone if the grip lies ON the twist axis, and each
    // segment spins about its OWN pivot. Elbow, wrist and palm are near-collinear in the
    // source model, but the morph field is non-linear and bends that line, so each axis is
    // aimed from its own pivot at the grip rather than reusing the forearm's direction.
    const Fm = this._morphed(side, 'fm');
    const m = side === 'l' ? 1 : -1;
    const twist1 = new THREE.Quaternion().setFromAxisAngle(restD2, m * pronation * 0.32);
    const twist2 = new THREE.Quaternion().setFromAxisAngle(G.clone().sub(Fm).normalize(), m * pronation * 0.68);

    return {
      [`upperarm.${side}`]: { quat: q1 },
      [`forearm1.${side}`]: { quat: swing2.clone().multiply(twist1) },
      [`forearm2.${side}`]: { quat: twist2 },
    };
  }

  /**
   * Plant the ankle on `target` with the knee falling towards `pole`.
   *
   * `targetIsMorphed` matters here in a way it does not for the arm. The bar rises with a
   * taller lifter, so an arm target authored in rest space and scaled by the morph is
   * right. The floor does not move, so a foot target has to be given in already-morphed
   * space or a shorter body ends up standing on thin air.
   */
  solveLeg(side, target, pole, { targetIsMorphed = false } = {}) {
    if (!this.p[side]) return {};
    const S = this._morphed(side, 'hip');
    const E = this._morphed(side, 'knee');
    const G = this._morphed(side, 'ankle');
    const T = targetIsMorphed ? target.clone() : applyMorph(target, new THREE.Vector3());
    const { q1, swing2 } = this._solve2(S, E, G, T, pole);
    return {
      [`thigh.${side}`]: { quat: q1 },
      [`shin.${side}`]: { quat: swing2 },
    };
  }

  /** World-space position of a joint under the current pose (for props and labels). */
  jointAt(name, side, out = new THREE.Vector3()) {
    const q = this.p[side];
    if (!q || !q[name]) return out.set(0, 0, 0);
    applyMorph(q[name], out);
    const segName = JOINT_OWNER[name];
    const b = segName ? this.bones[boneIndex(segName, side)] : null;
    out.applyMatrix4(b ? this._m[b.index] : this._m[0]);
    return out;
  }
}

/**
 * Which segment's matrix moves a given joint centre. A joint is the pivot of the segment
 * distal to it, and rotating a segment about its own pivot leaves that pivot where it is —
 * so either that segment or its parent gives the same answer.
 */
const JOINT_OWNER = {
  sc: 'girdle', gh: 'upperarm', el: 'forearm1', fm: 'forearm2', wr: 'hand',
  mcp: 'fingers1', pip: 'fingers2', tip: 'fingers2',
  thumbCmc: 'thumb', thumbTip: 'thumb',
  hip: 'thigh', knee: 'shin', ankle: 'foot', toe: 'foot',
};

function smoothstep(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

// Scratch, so posing every frame allocates nothing.
const _e = new THREE.Euler();
const _r = new THREE.Matrix4();
const _back = new THREE.Matrix4();
const _v = new THREE.Vector3();

// ---------------- shader ----------------

export const RIG_GLSL = /* glsl */`
attribute vec3 aSkin;                 // boneA, boneB, weightA
uniform mat4 uBones[${BONE_COUNT}];
uniform float uPosed;
vec3 sharirPose(vec3 p) {
  if (uPosed < 0.5) return p;
  vec4 h = vec4(p, 1.0);
  vec3 a = (uBones[int(aSkin.x)] * h).xyz;
  vec3 b = (uBones[int(aSkin.y)] * h).xyz;
  return mix(b, a, clamp(aSkin.z, 0.0, 1.0));
}
`;

/**
 * Hook the rig into a material's vertex path, immediately after the body morph: the morph
 * decides how big this body is, the pose decides where its limbs are, in that order.
 */
export function patchForRig(material, rig) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    shader.uniforms.uBones = rig.uniform;
    shader.uniforms.uPosed = rig.enabled;
    const marker = 'transformed = morphBody(transformed);';
    if (!shader.vertexShader.includes(marker)) { console.warn('[rig] morph hook not found — pose disabled'); return; }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + RIG_GLSL)
      .replace(marker, 'transformed = sharirPose(morphBody(transformed));');
  };
  material.needsUpdate = true;
}
