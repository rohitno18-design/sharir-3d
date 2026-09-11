import * as THREE from 'three';
import { applyMorph } from './morph.js';

/**
 * Upper-body rig — what lets the atlas move.
 *
 * The anatomy ships in one fixed anatomical pose with no armature, so posing it means
 * building the skeleton ourselves. Two decisions make that tractable:
 *
 * 1. The joint centres are not guessed. Z-Anatomy ships the articular capsules as real
 *    meshes, so the centre of "Articular capsule of glenohumeral joint" IS the shoulder's
 *    centre of rotation. Every pivot below is read out of the registry at load time, which
 *    also means they stay correct if the meshes are ever rebuilt.
 *
 * 2. Only the upper body is rigged. A bench press moves the shoulder girdle, arms and
 *    hands; the legs, pelvis and head ride along on the root. Rigging what does not move
 *    would add failure modes for no visible gain.
 *
 * Skinning is two-bone linear blending, with weights computed per vertex at load from the
 * vertex's position along the limb — no weight painting, no per-part lists to maintain.
 * The forearm is split into two segments so that pronation (the palms turn through ~180°
 * between anatomical position and a barbell grip) distributes along its length instead of
 * collapsing the wrist, which is the classic single-bone twist artefact.
 */

/** Source-space (Z-up) -> GL (Y-up). Same convention as main.js. */
export const toGl = (a) => new THREE.Vector3(a[0], a[2], -a[1]);

/** Joint centre = centre of that joint's articular capsule. */
const PIVOTS = {
  sc: 'joints:Articular capsule of sternoclavicular joint',
  gh: 'joints:Articular capsule of glenohumeral joint',
  el: 'joints:Articular capsule of elbow joint',
  wr: 'joints:Articular capsule of radiocarpal joint',
};

/**
 * One chain per side. `radius` is how far from the bone's axis a vertex may sit and still
 * be bound to it — roughly the soft-tissue envelope of that segment, in metres.
 */
const CHAIN = [
  { name: 'girdle',   from: 'sc', to: 'gh', radius: 0.115 },
  { name: 'upperarm', from: 'gh', to: 'el', radius: 0.100 },
  { name: 'forearm1', from: 'el', to: 'fm', radius: 0.080 },
  { name: 'forearm2', from: 'fm', to: 'wr', radius: 0.068 },
  { name: 'hand',     from: 'wr', to: 'hd', radius: 0.090 },
];

export const BONE_COUNT = 1 + CHAIN.length * 2;      // root + 5 per side
const SIDES = ['l', 'r'];
/** Bone index for a named segment. root = 0, then the left chain, then the right. */
export const boneIndex = (name, side) =>
  name === 'root' ? 0 : 1 + SIDES.indexOf(side) * CHAIN.length + CHAIN.findIndex(c => c.name === name);

/**
 * Which parts may follow the arm at all.
 *
 * The geometric test alone is not enough: in anatomical position the arm hangs against the
 * ribcage, so the chest wall sits well inside the humerus' envelope and would be dragged
 * along with it. So the envelope only gets consulted for parts that could plausibly move.
 */
// Structures that belong to the limb outright — they move with it in full.
const LIMB_ANCESTOR = /upper limb|pectoral girdle/i;
// Structures that run from the trunk out into the limb: nerves and vessels that must stay
// joined to their trunk origin while their far end travels with the arm.
const REACHING_ANCESTOR = /brachial plexus|axillary (artery|vein)|subclavian/i;
// Muscles that span from the trunk onto the arm. Their trunk end stays put and their
// humeral end follows, which is what the per-vertex blend produces for free.
const SPANNING = /pectoralis (major|minor)|latissimus dorsi|trapezius|rhomboid|serratus anterior|levator scapulae|subclavius|omohyoid/i;
// Never movable, whatever the geometry says: the axial skeleton and everything inside it.
const AXIAL = /\brib\b|ribs|sternum|vertebra|sacrum|coccyx|skull|mandible|hyoid|cranium|costal cartilage/i;
const AXIAL_SYS = new Set(['digestive', 'respiratory', 'urinary', 'reproductive', 'endocrine', 'cavities', 'senses']);
// The other limb. Hands and feet are named almost identically in this atlas ("fifth finger
// of foot"), so the lower limb has to be excluded by ancestry before any name test runs.
const LOWER_LIMB = /lower limb|bones of foot|of foot\b|regions of lower limb|trochanteric/i;
/** Height band the arm occupies in the source model, in metres up from the soles. */
const ARM_BAND = [0.60, 1.48];

export class Rig {
  constructor(registry) {
    this.ok = false;
    this.registry = registry;
    this.p = {};                 // side -> { sc, gh, el, fm, wr, hd } rest-space GL points
    this.bones = [];             // { name, side, index, parent, pivot }
    this.matrices = new Float32Array(BONE_COUNT * 16);
    this.uniform = { value: this.matrices };
    this.enabled = { value: 0 };
    this._m = Array.from({ length: BONE_COUNT }, () => new THREE.Matrix4());
    this._pose = null;
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
      const dir = q.wr.clone().sub(q.el).normalize();
      q.hd = q.wr.clone().addScaledVector(dir, 0.185);            // through the palm
      this.p[side] = q;
    }
    for (const side of SIDES) {
      let parent = 0;
      for (const seg of CHAIN) {
        const index = boneIndex(seg.name, side);
        this.bones[index] = { name: seg.name, side, index, parent, pivot: this.p[side][seg.from], radius: seg.radius };
        parent = index;
      }
    }
    this.bones[0] = { name: 'root', side: null, index: 0, parent: -1, pivot: new THREE.Vector3(0, 0, 0) };
    this.ok = true;
  }

  // ---------- skinning ----------
  /**
   * How this part relates to the arm:
   *   'limb' — belongs to it, moves with it in full
   *   'span' — reaches onto it from the trunk, so it fades from one to the other
   *   'none' — stays with the root
   *
   * The distinction matters: skin, bone and muscle of the arm itself must bind fully, or
   * the outermost layer (which sits farthest from the bone axis) gets partly left behind
   * and the arm visibly collapses.
   */
  classify(part) {
    if (AXIAL_SYS.has(part.sys)) return 'none';
    // Reference planes and direction markers are annotations drawn in the body's space,
    // not tissue. Binding one to a bone sends a flat sheet swinging through the scene.
    if (part.sys === 'references') return 'none';
    if (SPANNING.test(part.n)) return 'span';

    const chain = this.registry.ancestors(part.id).map(a => a.n).join(' | ');
    if (LOWER_LIMB.test(chain) || LOWER_LIMB.test(part.n)) return 'none';
    // Test the ancestry as well as the name: a muscle attachment painted on the seventh rib
    // is named after the muscle, and only its parent says it is part of the ribcage.
    if (AXIAL.test(part.n) || AXIAL.test(chain)) return 'none';

    if (LIMB_ANCESTOR.test(chain)) return 'limb';
    if (REACHING_ANCESTOR.test(chain)) return 'span';

    // Last resort for structures the hierarchy does not label: anything living entirely
    // outside the trunk's width AND within the arm's own height band. Both tests are
    // needed — feet are lateral too, and the shoulder is as wide as the hip.
    if (!part.bb) return 'none';
    const lateral = Math.min(Math.abs(part.bb[0][0]), Math.abs(part.bb[1][0])) > 0.135;
    const inBand = part.bb[1][2] > ARM_BAND[0] && part.bb[0][2] < ARM_BAND[1];
    return lateral && inBand ? 'limb' : 'none';
  }

  /**
   * Bind one vertex: returns [boneA, boneB, weightA]. Everything outside a limb envelope
   * binds rigidly to the root, which is most of the body.
   */
  bindVertex(x, y, z, out, mode = 'span') {
    const side = x >= 0 ? 'l' : 'r';
    const q = this.p[side];
    if (!q) { out[0] = 0; out[1] = 0; out[2] = 1; return out; }
    const pts = [q.sc, q.gh, q.el, q.fm, q.wr, q.hd];

    let best = -1, bestD = Infinity, bestT = 0;
    for (let i = 0; i < CHAIN.length; i++) {
      const a = pts[i], b = pts[i + 1];
      const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
      const len2 = abx * abx + aby * aby + abz * abz;
      let t = len2 > 0 ? ((x - a.x) * abx + (y - a.y) * aby + (z - a.z) * abz) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = x - (a.x + abx * t), dy = y - (a.y + aby * t), dz = z - (a.z + abz * t);
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      // Compare against each segment's own envelope, not raw distance: a vertex 6 cm from
      // the hand is outside it, the same 6 cm from the girdle is well inside.
      if (d / CHAIN[i].radius < bestD) { bestD = d / CHAIN[i].radius; best = i; bestT = t; }
    }
    // Only a spanning structure can fall out of the limb; a limb structure binds to its
    // nearest bone however far from the axis it sits.
    if (best < 0 || (mode === 'span' && bestD > 1)) { out[0] = 0; out[1] = 0; out[2] = 1; return out; }

    const bone = boneIndex(CHAIN[best].name, side);
    // Blend across the joint at either end of this segment, so a bent elbow creases
    // instead of shearing.
    const BLEND = 0.26;                        // as a fraction of the segment's length
    let other = bone, w = 1;
    if (bestT < BLEND) {
      other = best === 0 ? 0 : boneIndex(CHAIN[best - 1].name, side);
      w = 0.5 + 0.5 * (bestT / BLEND);
    } else if (bestT > 1 - BLEND) {
      other = best === CHAIN.length - 1 ? bone : boneIndex(CHAIN[best + 1].name, side);
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
    const mode = this.ok ? this.classify(part) : 'none';
    if (mode === 'none') {
      for (let i = 0; i < n; i++) arr[i * 3 + 2] = 1;          // root, weight 1
      return new THREE.BufferAttribute(arr, 3);
    }
    const pos = geom.attributes.position;
    const out = [0, 0, 1];
    for (let i = 0; i < n; i++) {
      this.bindVertex(pos.getX(i), pos.getY(i), pos.getZ(i), out, mode);
      arr[i * 3] = out[0]; arr[i * 3 + 1] = out[1]; arr[i * 3 + 2] = out[2];
    }
    return new THREE.BufferAttribute(arr, 3);
  }

  // ---------- posing ----------
  reset() {
    for (let i = 0; i < BONE_COUNT; i++) this._m[i].identity().toArray(this.matrices, i * 16);
    this.enabled.value = 0;
    this._pose = null;
  }

  /**
   * @param pose { root?: {rot:[x,y,z], pos:[x,y,z]}, 'upperarm.l': {rot:[x,y,z]}, ... }
   *             Rotations are XYZ Euler in radians, applied about that joint's own centre.
   */
  setPose(pose) {
    if (!this.ok) return;
    this._pose = pose;
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

  /**
   * Two-bone IK for one arm: put the grip on `target` (rest space) and let the elbow fall
   * towards `pole`.
   *
   * Posing the arm by hand-picked joint angles does not survive contact with a barbell —
   * the hands have to be ON the bar at every frame and at every body size, and a chain of
   * three Euler rotations compounds small errors into the bar floating past the head. So
   * the lift is authored as a bar path and the angles are solved from it.
   *
   * Returns pose entries for the arm's segments.
   */
  solveArm(side, target, pole, pronation = 0, girdle = null) {
    const q = this.p[side];
    if (!q) return {};
    // Solve in morphed space, not rest space. The bone matrices rotate vertices that have
    // already been through the height/weight field, so the arm they actually swing is the
    // morphed one — solving against rest lengths lands the grip centimetres off the bar on
    // any body that is not the source model's size.
    const S = applyMorph(q.gh, new THREE.Vector3());
    const E = applyMorph(q.el, new THREE.Vector3());
    const G = applyMorph(q.hd, new THREE.Vector3());
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
    const L1 = S.distanceTo(E);
    const L2 = E.distanceTo(G);
    const restD1 = E.clone().sub(S).normalize();
    const restD2 = G.clone().sub(E).normalize();

    const toT = T.clone().sub(S);
    let dist = toT.length();
    const reach = (L1 + L2) * 0.999;
    if (dist > reach) { toT.multiplyScalar(reach / dist); dist = reach; }
    if (dist < Math.abs(L1 - L2) * 1.001) { dist = Math.abs(L1 - L2) * 1.001; toT.setLength(dist); }
    const dirT = toT.clone().normalize();

    // Law of cosines gives the angle between the line to the target and the upper arm.
    const cosA = (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist);
    const a = Math.acos(Math.min(1, Math.max(-1, cosA)));

    // Swing the upper arm off that line, in the plane that carries the elbow to the pole.
    // Rotating about (dirT x pole) by a POSITIVE angle carries dirT towards the pole:
    // (dirT x pole) x dirT is the part of the pole perpendicular to dirT.
    const axis = new THREE.Vector3().crossVectors(dirT, pole);
    if (axis.lengthSq() < 1e-8) axis.set(0, 0, 1); else axis.normalize();
    const d1 = dirT.clone().applyAxisAngle(axis, a);
    const elbow = S.clone().addScaledVector(d1, L1);
    const d2 = S.clone().add(toT).sub(elbow).normalize();

    const q1 = new THREE.Quaternion().setFromUnitVectors(restD1, d1);
    // The forearm's rotation is expressed in the upper arm's rotated frame, so the target
    // direction has to come back through the upper arm first.
    const d2Local = d2.clone().applyQuaternion(q1.clone().invert());
    const swing2 = new THREE.Quaternion().setFromUnitVectors(restD2, d2Local);
    // A twist only leaves the grip alone if the grip lies ON the twist axis, and each
    // segment spins about its OWN pivot. Elbow, wrist and palm are collinear in the source
    // model, but the morph field is non-linear and bends that line, so each axis is aimed
    // from its own pivot at the grip rather than reusing the forearm's overall direction.
    const Fm = applyMorph(q.fm, new THREE.Vector3());
    const m = side === 'l' ? 1 : -1;
    const twist1 = new THREE.Quaternion().setFromAxisAngle(restD2, m * pronation * 0.32);
    const twist2 = new THREE.Quaternion().setFromAxisAngle(G.clone().sub(Fm).normalize(), m * pronation * 0.68);

    return {
      [`upperarm.${side}`]: { quat: q1 },
      [`forearm1.${side}`]: { quat: swing2.clone().multiply(twist1) },
      [`forearm2.${side}`]: { quat: twist2 },
    };
  }

  /** World-space position of a joint under the current pose (for props and labels). */
  jointAt(name, side, out = new THREE.Vector3()) {
    const q = this.p[side];
    if (!q || !q[name]) return out.set(0, 0, 0);
    applyMorph(q[name], out);
    const b = this.bones[boneIndex(nameToSeg(name), side)];
    if (b) out.applyMatrix4(this._m[b.index]);
    else out.applyMatrix4(this._m[0]);
    return out;
  }
}

/** Which segment's matrix moves a given joint centre. */
function nameToSeg(joint) {
  return { sc: 'girdle', gh: 'upperarm', el: 'forearm1', fm: 'forearm2', wr: 'hand', hd: 'hand' }[joint] || 'girdle';
}

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
 * decides how big this body is, the pose decides where its arms are, in that order.
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
