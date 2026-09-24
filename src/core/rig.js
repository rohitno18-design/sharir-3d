import * as THREE from 'three';
import { applyMorph, setSkeleton, segmentGirth, trunkWidth, morphKey, uniforms as morphU } from './morph.js';

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
  hip:      'joints:Articular capsule of hip joint',
  knee:     'joints:Articular capsule of knee joint',
  ankle:    'skeletal:Talus',
  toe:      'skeletal:Distal phalanx of first finger of foot',
};

/**
 * The hand's own joints, one set per finger. There is one capsule mesh covering all four
 * knuckles, so a single pivot there was a crude average: every finger bent about the same
 * point, and the hand closed like a mitten. These are read instead from where each pair
 * of bones actually meets.
 */
const DIGITS = [
  { n: 2, word: 'second' }, { n: 3, word: 'third' }, { n: 4, word: 'fourth' }, { n: 5, word: 'fifth' },
];
const ORD = { 1: 'First', 2: 'Second', 3: 'Third', 4: 'Fourth', 5: 'Fifth' };

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
  { name: 'hand',     parent: 'forearm2', from: 'wr',       to: 'mcp',      radius: 0.070, group: 'arm' },
  // Three links per finger, from the knuckle out to the tip. Each envelope has to clear the
  // digital nerves and vessels running along the sides of its finger: anything a finger
  // misses falls back to the palm and gets left behind when the finger curls.
  ...DIGITS.flatMap(({ n }) => [
    { name: `f${n}a`, parent: 'hand',    from: `mcp${n}`, to: `pip${n}`, radius: 0.021, group: 'arm' },
    { name: `f${n}b`, parent: `f${n}a`,  from: `pip${n}`, to: `dip${n}`, radius: 0.019, group: 'arm' },
    { name: `f${n}c`, parent: `f${n}b`,  from: `dip${n}`, to: `tip${n}`, radius: 0.017, group: 'arm' },
  ]),
  // The thumb has no middle phalanx; its first link is the thumb metacarpal, which swings
  // across the palm to oppose the fingers.
  { name: 't1',       parent: 'hand',     from: 'cmc1',     to: 'mcp1',     radius: 0.026, group: 'arm' },
  { name: 't2',       parent: 't1',       from: 'mcp1',     to: 'ip1',      radius: 0.021, group: 'arm' },
  { name: 't3',       parent: 't2',       from: 'ip1',      to: 'tip1',     radius: 0.019, group: 'arm' },
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
const SEG_INDEX = Object.fromEntries(SEGMENTS.map((s, i) => [s.name, i]));

// Structures that belong to a limb outright — they move with it in full.
const UPPER_LIMB = /upper limb|pectoral girdle/i;
const LOWER_LIMB = /lower limb|bones of foot|of foot\b|regions of lower limb/i;
// The pelvis is grouped under the lower limb in this atlas, but it is not part of it for
// posing: it sits on the bench and the femur swings from it.
const PELVIC = /pelvic girdle|hip bone|ilium|ischium|\bpubis\b|acetabul/i;
// Structures that run from the trunk out into the limb: nerves and vessels that must stay
// joined to their trunk origin while their far end travels with the arm.
const REACHING_ARM = /brachial plexus|axillary (artery|vein)|subclavian/i;
// Muscles that span from the trunk onto the arm. Their trunk end stays put and their far
// end follows, which is what the per-vertex blend produces for free. Which bones they may
// follow is an anatomical fact, not a guess: a muscle can only be moved by a bone it
// actually attaches to.
//   ...ONTO THE HUMERUS — these cross the shoulder and reach the upper arm.
const SPANNING_TO_ARM = /pectoralis major|latissimus dorsi|teres major/i;
//   ...ONTO THE SHOULDER BLADE — these stop at the scapula and never touch the humerus.
//   Letting them reach the upper arm is what tore serratus anterior's rib attachments off
//   the ribcage: its digitations sit close enough to the humerus that the envelope claimed
//   them, and the arm then swung them out through the chest wall.
const SPANNING_TO_GIRDLE = /pectoralis minor|trapezius|rhomboid|serratus anterior|levator scapulae|subclavius|omohyoid/i;
// The same across the hip: these run from pelvis or spine onto the femur.
const SPANNING_LEG = /glute(us|al)|iliopsoas|iliacus|psoas|piriformis|obturator (internus|externus)|gemellus|quadratus femoris|tensor fasciae latae|sartorius|rectus femoris|adductor (longus|brevis|magnus|minimus)|pectineus|gracilis|semitendinosus|semimembranosus|biceps femoris/i;
// Never movable, whatever the geometry says: the axial skeleton and everything inside it.
const AXIAL = /\brib\b|ribs|sternum|vertebra|sacrum|coccyx|skull|mandible|hyoid|cranium|costal cartilage/i;
const AXIAL_SYS = new Set(['digestive', 'respiratory', 'urinary', 'reproductive', 'endocrine', 'cavities', 'senses']);
/** Height band each limb occupies in the source model, in metres up from the soles. */
const BAND = { arm: [0.60, 1.48], leg: [0.0, 0.95] };
/** Systems whose parts are named after their trunk origin rather than where they run. */
const TUBULAR = new Set(['cardiovascular', 'nervous', 'lymphoid']);
/**
 * Does this bounding box reach out of the trunk along that limb? Heights are source-space
 * metres up from the soles: 1.05 is below the elbow, 0.70 is clear of the pelvic floor.
 * Being merely lateral is enough for the arm, since the arm hangs outside the ribcage.
 */
const REACHES_INTO = {
  arm: (bb) => bb[0][2] < 1.05 || Math.min(Math.abs(bb[0][0]), Math.abs(bb[1][0])) > 0.135,
  leg: (bb) => bb[0][2] < 0.70,
};
/**
 * Where along the palm the bar sits, from the wrist (0) to the knuckles (1). A pressing
 * grip holds the bar low, over the heel of the hand, so the load stacks down the forearm.
 * Up by the knuckles it would be a hammer grip with the weight hanging off the fingers.
 * Not right on the wrist crease either: the skin there is shared with the forearm, and it
 * stays behind when the wrist bends back.
 */
const GRIP_ALONG = 0.55;
/** A standard 29 mm barbell shaft. */
const BAR_RADIUS = 0.0145;
/** How far the skin of the palm gives under a loaded bar. */
const PALM_SQUASH = 0.002;
/** Flesh between the thumb's metacarpal and a bar: the thenar pad, the hand's thickest. */
const THENAR_PAD = 0.016;
/** The palm's binding envelope, a slab: half its width across the knuckles, half its depth. */
const PALM_HALF_WIDTH = 0.050;
const PALM_HALF_THICK = 0.028;
/** Segments whose borders are blended rather than switched, and how wide the band is. */
const SHARED_WITH = { hand: 't1', t1: 'hand' };
const SHARED_BAND = 0.35;
/**
 * The wrist bends back a little under a loaded bar. That tilts the palm up under the bar so
 * it rests on the heel of the hand, over the forearm bones. Kept small, because Delavier's
 * point is that a tight grip is what stops the wrist folding back any further.
 */
const WRIST_EXTENSION = 16 * Math.PI / 180;
/**
 * A closed hand does not hold a bar at right angles to the forearm. The bar lies obliquely
 * across the palm, from the heel under the little finger up to the base of the index
 * finger, which is the line of the palm's own creases (Napier's power grip). The knuckle
 * line slants the same way. This is how far the bar leans from square, towards it.
 *
 * 6 degrees centres the wrist's work on a straight wrist: it bends about 16 degrees
 * towards the thumb at lockout, where a wide grip leaves the hands outside the elbows, and
 * about as far the other way halfway down.
 */
const GRIP_OBLIQUE = 6 * Math.PI / 180;
/** How far the wrist may bend to the little-finger side, and to the thumb side, under load. */
const WRIST_ULNAR_MAX = 25 * Math.PI / 180;
const WRIST_RADIAL_MAX = 20 * Math.PI / 180;
/**
 * How far the arm straightens at lockout, as a fraction of its full length from shoulder
 * to palm. 0.996 is an elbow at about 172 degrees: locked, but not hyperextended.
 */
const LOCKOUT_REACH = 0.996;
/** How much more a forearm leaning across the body counts than one leaning along it. */
const ACROSS_WEIGHT = 3;
/**
 * The held bar's own axis, in the model's rest space. The root only ever turns the body
 * about x, so a bar lying across the body stays parallel to x whatever the pose.
 */
const BAR_AXIS = new THREE.Vector3(1, 0, 0);
/** Segments a scapular muscle is allowed to follow. */
const GIRDLE_ONLY = new Set(['girdle']);

/**
 * Muscles that cross the shoulder or the hip, bound by where they actually insert.
 *
 * Binding these by closeness to a bone is wrong in anatomical position. The arm hangs flat
 * against the side of the trunk, so the whole length of latissimus dorsi, from the armpit
 * down to the waist, lies right next to the arm bones. Bind by proximity and all of it goes
 * up with the arm, which drew a long triangular sail from the waist to the elbow. In a real
 * body only the tendon travels with the humerus. So each of these is weighted by distance
 * from its insertion: fully with the limb at the tendon, fading to the trunk by `far`.
 *
 * Insertion points come from the atlas's own landmarks. Where the atlas records the
 * insertion directly, that record is used instead.
 */
//
// Two kinds of motion, because muscles move in two different ways:
//
//   'wrap'  — short muscles that cup the joint (the rotator cuff). They swing round it
//             with the bone, so they are blended as a rotation about the joint.
//   'fibre' — long muscles whose belly lies far from the joint (lat, pectoral, psoas).
//             Swinging those round the shoulder would throw a belly that lies on the back
//             30 cm away clean off the body. What a long muscle really does is stretch:
//             every fibre runs from a fixed origin to the moving insertion, so each point
//             shifts towards the insertion's new position in proportion to how far along
//             the fibre it sits. The whole muscle lengthens evenly, like the real thing.
const ANCHORED = [
  // The lat's tendon runs into the floor of the bicipital groove. Its record in this atlas
  // lists only the slip on the scapula, so the landmark is the source here.
  { re: /^latissimus dorsi/i, limb: 'upperarm', trunk: 'root', at: 'Intertubercular sulcus', mode: 'fibre' },
  { re: /^teres major/i, limb: 'upperarm', trunk: 'girdle', at: 'Crest of lesser tubercle', mode: 'fibre' },
  { re: /pectoralis major/i, limb: 'upperarm', trunk: 'root', at: 'Crest of greater tubercle',
    record: { muscle: 'Pectoralis major muscle', bone: 'Humerus' }, mode: 'fibre' },
  // The rotator cuff: from the shoulder blade onto the ball of the humerus.
  { re: /^(supraspinatus|infraspinatus|teres minor)/i, limb: 'upperarm', trunk: 'girdle', at: 'Greater tubercle', mode: 'wrap', near: 0.02, far: 0.10 },
  { re: /^subscapularis/i, limb: 'upperarm', trunk: 'girdle', at: 'Lesser tubercle', mode: 'wrap', near: 0.02, far: 0.10 },
  // Psoas and iliacus: from the lumbar spine and pelvis onto the lesser trochanter.
  { re: /^(psoas|iliacus|iliopsoas)/i, limb: 'thigh', trunk: 'root', at: 'Lesser trochanter', mode: 'fibre' },
];
/** One slot per anchored muscle per side, for the insertion displacements the shader reads. */
const ANCHOR_SLOTS = ANCHORED.length * 2;
const anchorSlot = (def, side) => ANCHORED.indexOf(def) + (side === 'r' ? ANCHORED.length : 0);

export class Rig {
  constructor(registry, groups = null) {
    this.ok = false;
    this.registry = registry;
    // partId -> geometries, for reading joints straight off the bones.
    this._geoms = new Map();
    if (groups) for (const [, items] of groups) for (const it of items) {
      if (!this._geoms.has(it.part.id)) this._geoms.set(it.part.id, []);
      this._geoms.get(it.part.id).push(it.geometry);
    }
    this.p = {};                 // side -> { sc, gh, el, ... } rest-space GL points
    this.bones = [];             // { name, side, index, parent, pivot, radius, group }
    this.byGroup = { arm: [], leg: [] };     // side -> group -> [segment index into SEGMENTS]
    // Each bone's world transform, kept as a matrix for the CPU (props, labels, framing)…
    this.matrices = new Float32Array(BONE_COUNT * 16);
    // …and as a unit dual quaternion for the GPU, which is what the skinning blends.
    this.dqReal = new Float32Array(BONE_COUNT * 4);
    this.dqDual = new Float32Array(BONE_COUNT * 4);
    this.uReal = { value: this.dqReal };
    this.uDual = { value: this.dqDual };
    // How far each anchored muscle's insertion has moved, relative to where its trunk end
    // would carry it. A 'fibre' vertex adds its share of this.
    this.anchorDisp = new Float32Array(ANCHOR_SLOTS * 3);
    this.uAnchor = { value: this.anchorDisp };
    this.enabled = { value: 0 };
    this.anchors = { l: [], r: [] };
    this._m = Array.from({ length: BONE_COUNT }, () => new THREE.Matrix4());
    this._clsCache = new Map();
    this.reset();
    this._resolve();
    this._chest = this._collectChest();
    if (this.ok) {
      this.stanceRef = this._collectStanceRef();
      this._shareSkeleton();
    }
  }

  /**
   * A joint through the body morph, as the bone it belongs to. Joints sit on their bone's
   * axis, so a limb's girth never moves them: they go where the limb's hanging joint goes.
   * The grip and the palm are the exception, being on the hand's skin rather than its bone.
   */
  _morphJoint(side, key, point, out) {
    const seg = JOINT_OWNER[key];
    const bone = seg ? boneIndex(seg, side) : 0;
    return applyMorph(point, out, { tissue: key === 'grip' || key === 'palm' ? 'skin' : 'bone', bone });
  }

  /** Tell the morph where each bone lies, so limbs can thicken round their own bones. */
  _shareSkeleton() {
    const chainOf = (b) => {
      if (!b || b.name === 'root' || b.name === 'girdle') return -1;
      const leg = b.group === 'leg';
      return (leg ? 2 : 0) + (b.side === 'r' ? 1 : 0);
    };
    const segs = this.bones.map(b => ({
      name: b.name, chain: chainOf(b),
      a: (b.pivot || new THREE.Vector3()).clone(),
      b: (b.tail || b.pivot || new THREE.Vector3()).clone(),
    }));
    const anchorLimb = new Array(ANCHOR_SLOTS).fill(0);
    for (const side of SIDES) for (const def of ANCHORED) anchorLimb[anchorSlot(def, side)] = boneIndex(def.limb, side);
    setSkeleton({ segs, roots: [this.p.l.gh, this.p.r.gh, this.p.l.hip, this.p.r.hip], anchorLimb });
  }

  /**
   * How much room there is, in the source body, between the trunk and each arm and between
   * the thighs, read off the skin. A bigger body closes these gaps, and the stance opens
   * them again.
   */
  _collectStanceRef() {
    const ref = {};
    for (const side of SIDES) {
      const m = side === 'l' ? 1 : -1, q = this.p[side];
      const yEl = q.el.y, yWr = q.wr.y, yTh = (q.hip.y + q.knee.y) / 2;
      const r = { flankEl: 0, innerEl: Infinity, hipWr: 0, hipWrLeg: false, innerWr: Infinity, innerTh: Infinity };
      for (const [id, gs] of this._geoms) {
        const part = this.registry.byId.get(id);
        if (!part || part.sys !== 'integumentary' || (part.sx && part.sx !== 'm')) continue;
        const group = this.classify(part).group;
        for (const g of gs) {
          const pos = g.attributes.position;
          for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i) * m, y = pos.getY(i);
            if (x <= 0) continue;
            if (Math.abs(y - yEl) < 0.012) {
              if (group === 'arm') r.innerEl = Math.min(r.innerEl, x);
              else if (!group) r.flankEl = Math.max(r.flankEl, x);
            }
            if (Math.abs(y - yWr) < 0.012) {
              if (group === 'arm') r.innerWr = Math.min(r.innerWr, x);
              else if (x > r.hipWr) { r.hipWr = x; r.hipWrLeg = group === 'leg'; }
            }
            if (Math.abs(y - yTh) < 0.012 && group === 'leg') r.innerTh = Math.min(r.innerTh, x);
          }
        }
      }
      ref[side] = r;
    }
    return ref;
  }

  /**
   * The standing pose that goes with this body. A thicker trunk and thicker arms close the
   * gap under the arms, so the shoulders turn the arms out until the old gap is back; wider
   * hips against thicker forearms turn the forearms out at the elbow. Thicker thighs press
   * together and the legs part to take half of that, the rest being soft tissue giving.
   * The shins turn back so the feet stay flat, a little wider apart. Heavier and more
   * muscular people stand exactly like this, which is why a body made bigger without it
   * looked pasted on.
   *
   * Returns null when there is nothing to turn.
   */
  stance() {
    if (!this.ok || !this.stanceRef) return null;
    const s = morphU.uScale.value || 1;
    const rotZ = (a) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), a);
    const pose = {};
    let biggest = 0, drop = 0;
    for (const side of SIDES) {
      const m = side === 'l' ? 1 : -1, q = this.p[side], r = this.stanceRef[side];
      const chain = side === 'l' ? 0 : 1;
      const armShift = (morphU.uRootD.value[chain].x / s) * m;
      const legShift = (morphU.uRootD.value[chain + 2].x / s) * m;
      const g = (name, tissue = 'skin') => segmentGirth(boneIndex(name, side), tissue);
      const L1 = q.gh.distanceTo(q.el), L2 = q.el.distanceTo(q.wr);

      // Elbow against the waist.
      let a1 = 0;
      if (Number.isFinite(r.innerEl) && r.flankEl > 0) {
        const axis = q.el.x * m;
        const flank = r.flankEl * trunkWidth(q.el.y, 'skin');
        const inner = axis + armShift - (axis - r.innerEl) * (g('upperarm') + g('forearm1')) / 2;
        const need = Math.max(0, (r.innerEl - r.flankEl) - (inner - flank));
        a1 = Math.asin(Math.min(0.45, need / L1));
      }
      // Wrist against the hip, after the shoulder has already carried it out.
      let a2 = 0;
      if (Number.isFinite(r.innerWr) && r.hipWr > 0) {
        const axis = q.wr.x * m;
        const thighAxis = ((q.hip.x + q.knee.x) / 2) * m;
        const hip = r.hipWrLeg
          ? thighAxis + legShift + (r.hipWr - thighAxis) * g('thigh')
          : r.hipWr * trunkWidth(q.wr.y, 'skin');
        const carried = (q.gh.y - q.wr.y) * Math.sin(a1);
        const inner = axis + armShift + carried - (axis - r.innerWr) * g('forearm2');
        const need = Math.max(0, (r.innerWr - r.hipWr) - (inner - hip));
        a2 = Math.asin(Math.min(0.45, need / L2));
      }
      // Thighs against each other.
      let a3 = 0;
      if (Number.isFinite(r.innerTh)) {
        const mid = q.hip.clone().lerp(q.knee, 0.5);
        const offset = mid.x * m - r.innerTh;
        const grow = offset * (g('thigh') - 1) - legShift;
        a3 = Math.asin(Math.min(0.2, Math.max(0, grow) * 0.5 / q.hip.distanceTo(mid)));
        drop = Math.max(drop, q.hip.distanceTo(q.knee) * (1 - Math.cos(a3)));
      }
      biggest = Math.max(biggest, a1, a2, a3);
      pose[`upperarm.${side}`] = { quat: rotZ(m * a1) };
      pose[`forearm1.${side}`] = { quat: rotZ(m * a2) };
      pose[`thigh.${side}`] = { quat: rotZ(m * a3) };
      pose[`shin.${side}`] = { quat: rotZ(-m * a3) };
    }
    if (biggest < 0.004) return null;
    // Parting the legs shortens them a little; lower the body by as much, so the soles
    // stay on the floor instead of lifting off it.
    pose.root = { pos: [0, -drop * s, 0] };
    this.stanceAngles = pose;
    return pose;
  }

  /**
   * The source geometry is only needed while the rig reads joints off the bones. Holding on
   * to it afterwards keeps a second full copy of the atlas in memory for nothing.
   */
  releaseGeometry() { this._geoms = null; }

  /**
   * The skin over the front of the chest, kept as a small point set so a bar can be laid
   * on it. Anything a bar is pressed to has to be measured, not guessed: a height tuned by
   * eye puts the bar a centimetre and more into the chest of any body it was not tuned on.
   */
  _collectChest() {
    const pts = [];
    for (const [id, gs] of this._geoms) {
      const part = this.registry.byId.get(id);
      if (!part || part.sys !== 'integumentary') continue;
      // The atlas carries a female chest surface as well, standing up to 5 cm proud of the
      // pectorals. It is never drawn on the male body, and laying the bar on it would leave
      // the bar hovering over his chest. The male skin is the region patches.
      if (part.sx && part.sx !== 'm') continue;
      for (const g of gs) {
        const p = g.attributes.position;
        for (let i = 0; i < p.count; i++) {
          const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
          if (Math.abs(x) < 0.17 && y > 1.10 && y < 1.46 && z > 0.04) pts.push(x, y, z);
        }
      }
    }
    return new Float32Array(pts);
  }

  /**
   * The rest-space height for a bar lying across the chest at `target`'s level, so that
   * the bar's surface sits exactly `clear` from the skin at its closest point. Found by
   * bisection on the bar's height, against the chest as it is morphed right now.
   */
  chestTouch(target, radius, clear = 0.002) {
    const pts = this._chest;
    if (!pts || !pts.length) return target.z;
    // Any change to the body's shape changes the chest, so the cache is keyed on the
    // morph's own numbers rather than on one probe point that most of them do not reach.
    const key = `${morphKey()}|${target.x.toFixed(4)},${target.y.toFixed(4)}|${radius}|${clear}`;
    if (this._touch?.key === key) return this._touch.z;
    // The chest as this body has it, once.
    const m = new Float32Array(pts.length), v = new THREE.Vector3();
    for (let i = 0; i < pts.length; i += 3) {
      applyMorph(v.set(pts[i], pts[i + 1], pts[i + 2]), v, { tissue: 'skin' });
      m[i] = v.x; m[i + 1] = v.y; m[i + 2] = v.z;
    }
    const need = radius + clear;
    const gap = (z) => {
      const B = applyMorph(new THREE.Vector3(target.x, target.y, z), new THREE.Vector3(), { tissue: 'bone' });
      let best = Infinity;
      for (let i = 0; i < m.length; i += 3) {
        const dy = m[i + 1] - B.y;
        if (dy > need || dy < -need) continue;
        best = Math.min(best, Math.hypot(dy, m[i + 2] - B.z));
      }
      return best;
    };
    let lo = target.z - 0.10, hi = target.z + 0.10;
    for (let i = 0; i < 22; i++) { const mid = (lo + hi) / 2; if (gap(mid) < need) lo = mid; else hi = mid; }
    this._touch = { key, z: hi };
    return hi;
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
      if (!this._resolveHand(side, q)) { console.warn('[rig] hand joints missing', side); return; }
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
    for (const side of SIDES) {
      for (const def of ANCHORED) {
        const point = this._insertion(def, side);
        if (point) this.anchors[side].push({ def, point });
        else console.warn('[rig] no insertion found for', def.at, side);
      }
    }
    this.ok = true;
    this.hipZ = this.p.l.hip.y;      // source height of the hip, used when classifying
  }

  // ---------- the hand, read off its bones ----------
  _points(id) {
    const gs = this._geoms.get(id);
    if (!gs) return null;
    const pts = [];
    for (const g of gs) {
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) pts.push(new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)));
    }
    return pts.length ? pts : null;
  }

  /** Where two neighbouring bones meet: halfway between each one's end nearest the other. */
  _joint(a, b) {
    const pa = this._points(a), pb = this._points(b);
    if (!pa || !pb) return null;
    const ca = pa.reduce((s, v) => s.add(v), new THREE.Vector3()).divideScalar(pa.length);
    const cb = pb.reduce((s, v) => s.add(v), new THREE.Vector3()).divideScalar(pb.length);
    let na = pa[0], nb = pb[0];
    for (const v of pa) if (v.distanceToSquared(cb) < na.distanceToSquared(cb)) na = v;
    for (const v of pb) if (v.distanceToSquared(ca) < nb.distanceToSquared(ca)) nb = v;
    return na.clone().add(nb).multiplyScalar(0.5);
  }

  /** The tip of a bone: its point farthest from the joint it hangs from. */
  _tip(id, from) {
    const pts = this._points(id);
    if (!pts) return null;
    let far = pts[0];
    for (const v of pts) if (v.distanceToSquared(from) > far.distanceToSquared(from)) far = v;
    return far.clone();
  }

  _resolveHand(side, q) {
    const bone = (name) => `skeletal:${name}.${side}`;
    for (const { n, word } of DIGITS) {
      const mc = bone(`${ORD[n]} metacarpal bone`);
      const p1 = bone(`Proximal phalanx of ${word} finger of hand`);
      const p2 = bone(`Middle phalanx of ${word} finger of hand`);
      const p3 = bone(`Distal phalanx of ${word} finger of hand`);
      q[`mcp${n}`] = this._joint(mc, p1);
      q[`pip${n}`] = this._joint(p1, p2);
      q[`dip${n}`] = this._joint(p2, p3);
      if (!q[`mcp${n}`] || !q[`pip${n}`] || !q[`dip${n}`]) return false;
      q[`tip${n}`] = this._tip(p3, q[`dip${n}`]);
    }
    q.cmc1 = this._joint(bone('Trapezium bone'), bone('First metacarpal bone'));
    q.mcp1 = this._joint(bone('First metacarpal bone'), bone('Proximal phalanx of first finger of hand'));
    q.ip1 = this._joint(bone('Proximal phalanx of first finger of hand'), bone('Distal phalanx of first finger of hand'));
    if (!q.cmc1 || !q.mcp1 || !q.ip1) return false;
    q.tip1 = this._tip(bone('Distal phalanx of first finger of hand'), q.ip1);

    // Where a bar lies when this hand presses one: low in the palm, over the heel of the
    // hand, so the load runs down the forearm instead of hanging off the fingers.
    //
    // Its height is fitted to the hand itself. The bar is a line across the palm, not a
    // point on it, and the palm is not flat: it rises into the pads at the base of the
    // thumb and of the little finger. Measured at one spot, the bar sat right on the palm
    // there and a centimetre into the skin either side. So the bar is lifted until nothing
    // along the whole strip it crosses is inside it, less a little for the skin to squash.
    // The palm's own frame, for binding: across the knuckles, and out of its face.
    const h = q.mcp.clone().sub(q.wr).normalize();
    const k = q.mcp5.clone().sub(q.mcp2);
    q.palmAcross = k.addScaledVector(h, -k.dot(h)).normalize();
    q.palmNormal = new THREE.Vector3().crossVectors(h, q.palmAcross).normalize();
    if (q.palmNormal.z < 0) q.palmNormal.negate();

    const heel = q.wr.clone().lerp(q.mcp, GRIP_ALONG);
    const e1 = barLine(q.wr, q.mcp, q.mcp2, q.mcp5);
    const nrm = new THREE.Vector3(0, 0, 1).addScaledVector(e1, -e1.z).normalize();   // out of the palm
    const e2 = new THREE.Vector3().crossVectors(e1, nrm);
    const halfWidth = q.mcp2.distanceTo(q.mcp5) / 2 + 0.008;
    const need = BAR_RADIUS - PALM_SQUASH;
    // The thumb lifts away round the bar on its own, so the tissue that goes with it is not
    // what the bar lies on. "Goes with it" is decided exactly as the skinning decides it.
    const handSeg = SEGMENTS[SEG_INDEX.hand], thumbSeg = SEGMENTS[SEG_INDEX.t1];
    const thumbOwns = (p) => this._segDist(p.x, p.y, p.z, q, thumbSeg).d < this._segDist(p.x, p.y, p.z, q, handSeg).d;
    const ownSide = new RegExp(`\\.${side}(\\.\\d+)?$`);
    const P = new THREE.Vector3(), rel = new THREE.Vector3();
    let lift = -Infinity;
    for (const [id, gs] of this._geoms) {
      const part = this.registry.byId.get(id);
      if (!part || !part.bb) continue;
      // Only this hand's own tissue. The atlas's direction markers are geometry too, and
      // one ("Palmar") floats just in front of the right palm: reading it as the palm put
      // the right hand's grip 6.7 cm out in the air.
      if (part.sys === 'references' || !ownSide.test(id)) continue;
      if (part.sx && part.sx !== 'm') continue;
      // Only parts near this hand: a coarse bounding-box test before looking at vertices.
      const gl0 = toGl(part.bb[0]), gl1 = toGl(part.bb[1]);
      const minX = Math.min(gl0.x, gl1.x), maxX = Math.max(gl0.x, gl1.x);
      const minY = Math.min(gl0.y, gl1.y), maxY = Math.max(gl0.y, gl1.y);
      if (heel.x < minX - 0.05 || heel.x > maxX + 0.05 || heel.y < minY - 0.05 || heel.y > maxY + 0.05) continue;
      for (const g of gs) {
        const p = g.attributes.position;
        for (let i = 0; i < p.count; i++) {
          P.set(p.getX(i), p.getY(i), p.getZ(i));
          rel.subVectors(P, heel);
          if (Math.abs(rel.dot(e1)) > halfWidth) continue;
          const across = rel.dot(e2);
          if (Math.abs(across) >= need) continue;
          if (thumbOwns(P)) continue;
          lift = Math.max(lift, rel.dot(nrm) + Math.sqrt(need * need - across * across));
        }
      }
    }
    if (!Number.isFinite(lift)) lift = 0.02 + BAR_RADIUS;
    q.grip = heel.clone().addScaledVector(nrm, lift);
    q.palm = q.grip.clone().addScaledVector(nrm, -BAR_RADIUS);
    return true;
  }

  /** Where a muscle meets its limb bone, in rest-space GL coordinates. */
  _insertion(def, side) {
    if (def.record) {
      const rec = this.registry.parts.find(p => (p.k === 'insertion' || p.k === 'origin') && p.side === side
        && p.muscle === def.record.muscle && p.bone === def.record.bone && p.bb);
      if (rec) return toGl([(rec.bb[0][0] + rec.bb[1][0]) / 2, (rec.bb[0][1] + rec.bb[1][1]) / 2, (rec.bb[0][2] + rec.bb[1][2]) / 2]);
    }
    // Landmarks carry no side label in this atlas, so the side is read off the coordinate:
    // the body's left is +x.
    const want = side === 'l' ? 1 : -1;
    const lm = this.registry.parts.find(p => p.k === 'landmark' && p.n === def.at && p.pos && Math.sign(p.pos[0]) === want);
    return lm ? toGl(lm.pos) : null;
  }

  /** The insertion-anchored binding that applies to this part, if any. */
  _anchorDef(part) {
    if (part.sys !== 'muscular') return null;             // not the painted attachment patches
    return ANCHORED.find(d => d.re.test(part.n)) || null;
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
    if (SPANNING_TO_GIRDLE.test(part.n)) return { group: 'arm', mode: 'span', only: GIRDLE_ONLY };
    if (SPANNING_TO_ARM.test(part.n)) return { group: 'arm', mode: 'span' };
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
  /**
   * Nearest segment of a group, measured in units of that segment's own envelope: a vertex
   * 6 cm from the hand is outside it, the same 6 cm from the girdle is well inside.
   */
  _nearest(x, y, z, side, group, only = null) {
    const q = this.p[side];
    const list = this.byGroup[group];
    let best = -1, bestD = Infinity, bestT = 0;
    if (!q || !list) return { best, d: bestD, t: bestT };
    for (const si of list) {
      const seg = SEGMENTS[si];
      if (only && !only.has(seg.name)) continue;
      const { d, t } = this._segDist(x, y, z, q, seg);
      if (d < bestD) { bestD = d; best = si; bestT = t; }
    }
    return { best, d: bestD, t: bestT };
  }

  /**
   * Distance from a point to one segment, in units of that segment's envelope, and how
   * far along it the nearest point is.
   *
   * The palm is the one segment that is not round. It is a slab: about ten centimetres
   * across and three thick. Measured as a cylinder wide enough to hold its edges, it also
   * swallowed the pad at the base of the thumb, which stands up off the palm's face, so
   * that pad stayed on the palm while the thumb moved. Measured as a slab, the pad goes to
   * the thumb it belongs to.
   */
  _segDist(x, y, z, q, seg) {
    const a = q[seg.from], b = q[seg.to];
    const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
    const len2 = abx * abx + aby * aby + abz * abz;
    let t = len2 > 0 ? ((x - a.x) * abx + (y - a.y) * aby + (z - a.z) * abz) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = x - (a.x + abx * t), dy = y - (a.y + aby * t), dz = z - (a.z + abz * t);
    if (seg.name === 'hand' && q.palmAcross) {
      const w = dx * q.palmAcross.x + dy * q.palmAcross.y + dz * q.palmAcross.z;
      const n = dx * q.palmNormal.x + dy * q.palmNormal.y + dz * q.palmNormal.z;
      const rest = Math.sqrt(Math.max(0, dx * dx + dy * dy + dz * dz - w * w - n * n));
      return { d: Math.hypot(w / PALM_HALF_WIDTH, n / PALM_HALF_THICK, rest / PALM_HALF_WIDTH), t };
    }
    return { d: Math.sqrt(dx * dx + dy * dy + dz * dz) / seg.radius, t };
  }

  bindVertex(x, y, z, out, mode, group, only = null) {
    const side = x >= 0 ? 'l' : 'r';
    const { best, d: bestD, t: bestT } = this._nearest(x, y, z, side, group, only);
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
      other = seg.parent && (!only || only.has(seg.parent)) ? boneIndex(seg.parent, side) : 0;
      w = 0.5 + 0.5 * (bestT / BLEND);
    } else if (bestT > 1 - BLEND) {
      const childIdx = this.byGroup[group].find(i => SEGMENTS[i].parent === seg.name && SEGMENTS[i].from === seg.to
        && (!only || only.has(SEGMENTS[i].name)));
      other = childIdx === undefined ? bone : boneIndex(SEGMENTS[childIdx].name, side);
      w = 0.5 + 0.5 * ((1 - bestT) / BLEND);
    }

    // The thumb's base sits inside the palm, and the pad over it is shared: it is carried
    // by the thumb when the thumb lifts, but it is also the edge of the palm. A hard switch
    // from one to the other tears the skin there once the thumb moves, so the band where
    // the two are about equally close is blended between them.
    const pair = SHARED_WITH[seg.name];
    if (pair && group === 'arm' && (!only || only.has(pair))) {
      const gap = this._segDist(x, y, z, this.p[side], SEGMENTS[SEG_INDEX[pair]]).d - bestD;
      const wp = gap < SHARED_BAND ? 0.5 + 0.5 * (gap / SHARED_BAND) : 1;
      if (wp < w) { other = boneIndex(pair, side); w = wp; }
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

  /** What share of this geometry sits inside a limb group's envelope. */
  insideFraction(geom, group, step = 11, only = null) {
    const pos = geom.attributes.position;
    let in_ = 0, n = 0;
    for (let i = 0; i < pos.count; i += step) {
      const x = pos.getX(i);
      const { best, d } = this._nearest(x, pos.getY(i), pos.getZ(i), x >= 0 ? 'l' : 'r', group, only);
      if (best >= 0 && d <= 1) in_++;
      n++;
    }
    return n ? in_ / n : 0;
  }

  /**
   * The hierarchy says what a structure belongs to; its own geometry says where it lies.
   * Both are needed, because every artery and nerve in the arm traces its ancestry back to
   * the subclavian artery or the brachial plexus — including the ones that live entirely
   * inside a finger. Trusting ancestry alone made those 'span', which let any vertex
   * outside a finger's envelope fall back to the root: it stayed beside the thigh while the
   * rest of the same nerve flew up to the bar, drawing a line across the whole body.
   *
   * So: a spanning structure that turns out to lie wholly inside the limb is promoted to
   * move with it in full, and a structure the hierarchy could not place at all is given to
   * whichever limb its geometry actually reaches into.
   */
  resolveBinding(geom, part) {
    const cls = this.classify(part);
    if (cls.mode === 'span') {
      return this.insideFraction(geom, cls.group, 11, cls.only) > 0.9
        ? { group: cls.group, mode: 'limb', only: cls.only } : cls;
    }
    if (cls.mode !== 'none' || !TUBULAR.has(part.sys) || !part.bb) return cls;
    // Vessels, nerves and lymphatics are named after where they come from, not where they
    // run, so the hierarchy rarely places them in a limb. Let the geometry decide — but it
    // needs a gate first. In anatomical position the arm lies flat against the ribcage and
    // the thigh sits right under the pelvic floor, so a limb envelope reaches well inside
    // the trunk: the lung's own arteries score as "mostly inside the shoulder" and the
    // pelvic veins as "mostly inside the thigh". A structure only counts as belonging to a
    // limb if it actually reaches out of the trunk along it.
    let bestGroup = null, bestShare = 0.5;
    for (const g of ['arm', 'leg']) {
      if (!REACHES_INTO[g](part.bb)) continue;
      const share = this.insideFraction(geom, g);
      if (share > bestShare) { bestShare = share; bestGroup = g; }
    }
    if (!bestGroup) return cls;
    return { group: bestGroup, mode: bestShare > 0.9 ? 'limb' : 'span' };
  }

  /** Per-vertex (boneA, boneB, weightA) for one geometry. */
  skinGeometry(geom, part) {
    const n = geom.attributes.position.count;
    const arr = new Float32Array(n * 3);
    const anchor = this.ok ? this._anchorDef(part) : null;
    if (anchor) return this._skinAnchored(geom, anchor, arr);
    const cls = this.ok ? this.resolveBinding(geom, part) : { mode: 'none' };
    if (cls.mode === 'none') {
      for (let i = 0; i < n; i++) arr[i * 3 + 2] = 1;          // root, weight 1
      return new THREE.BufferAttribute(arr, 3);
    }
    const pos = geom.attributes.position;
    const out = [0, 0, 1];
    for (let i = 0; i < n; i++) {
      this.bindVertex(pos.getX(i), pos.getY(i), pos.getZ(i), out, cls.mode, cls.group, cls.only);
      arr[i * 3] = out[0]; arr[i * 3 + 1] = out[1]; arr[i * 3 + 2] = out[2];
    }
    return new THREE.BufferAttribute(arr, 3);
  }

  /**
   * Weight every vertex by its distance from the muscle's insertion: fully with the limb
   * within `near` of the tendon, fully with the trunk beyond `far`, smooth in between.
   */
  _skinAnchored(geom, def, arr) {
    const pos = geom.attributes.position;
    const pt = new THREE.Vector3();
    const anchorOf = { l: this.anchors.l.find(e => e.def === def), r: this.anchors.r.find(e => e.def === def) };
    // The landmark sits on the bone's surface, and the muscle mesh often stops a few
    // centimetres short of it: the tendon's last stretch is not modelled. Measured from the
    // landmark alone, no vertex would ever reach full weight, and the muscle's end would
    // trail behind the arm. So the ramp starts from this muscle's own closest point.
    const closest = { l: Infinity, r: Infinity };
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), side = x >= 0 ? 'l' : 'r', a = anchorOf[side];
      if (!a) continue;
      pt.set(x, pos.getY(i), pos.getZ(i));
      closest[side] = Math.min(closest[side], pt.distanceTo(a.point));
    }
    if (def.mode === 'fibre') return this._skinFibre(geom, def, arr, anchorOf, closest);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const side = x >= 0 ? 'l' : 'r';
      const a = anchorOf[side];
      if (!a) { arr[i * 3] = 0; arr[i * 3 + 1] = 0; arr[i * 3 + 2] = 1; continue; }
      pt.set(x, pos.getY(i), pos.getZ(i));
      const near = Math.max(def.near, closest[side] + 0.01);
      const far = Math.max(def.far, near + 0.08);
      const w = smoothstep(far, near, pt.distanceTo(a.point));
      arr[i * 3] = boneIndex(def.limb, side);
      arr[i * 3 + 1] = def.trunk === 'root' ? 0 : boneIndex(def.trunk, side);
      arr[i * 3 + 2] = w;
    }
    return new THREE.BufferAttribute(arr, 3);
  }

  /**
   * Fibre binding. Each vertex records its trunk bone, which insertion it belongs to, and
   * how far along the muscle it sits: 1 at the tendon, falling in a straight line to 0 at
   * the far edge of the muscle. Linear, not eased, because a stretched muscle lengthens by
   * the same fraction all the way along; easing would bunch the stretch into the middle.
   *
   * Encoded as (trunkBone, anchorSlot, 2 + fraction), so a weight of 2 or more tells the
   * shader this vertex stretches rather than swings.
   */
  _skinFibre(geom, def, arr, anchorOf, closest) {
    const pos = geom.attributes.position;
    const pt = new THREE.Vector3();
    const farthest = { l: 0, r: 0 };
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), side = x >= 0 ? 'l' : 'r', a = anchorOf[side];
      if (!a) continue;
      pt.set(x, pos.getY(i), pos.getZ(i));
      farthest[side] = Math.max(farthest[side], pt.distanceTo(a.point));
    }
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), side = x >= 0 ? 'l' : 'r', a = anchorOf[side];
      const trunk = def.trunk === 'root' ? 0 : boneIndex(def.trunk, side);
      if (!a) { arr[i * 3] = trunk; arr[i * 3 + 1] = 0; arr[i * 3 + 2] = 1; continue; }
      pt.set(x, pos.getY(i), pos.getZ(i));
      const span = Math.max(0.02, farthest[side] - closest[side]);
      const f = Math.min(1, Math.max(0, 1 - (pt.distanceTo(a.point) - closest[side]) / span));
      arr[i * 3] = trunk;
      arr[i * 3 + 1] = anchorSlot(def, side);
      arr[i * 3 + 2] = 2 + f;
    }
    return new THREE.BufferAttribute(arr, 3);
  }

  /**
   * Where each fibre-bound insertion has gone. Measured against the trunk bone, because a
   * fibre vertex is first carried by its trunk and then shifted by its share of this.
   */
  _writeAnchors() {
    const I = new THREE.Vector3(), A = new THREE.Vector3(), B = new THREE.Vector3();
    for (const side of SIDES) {
      for (const e of this.anchors[side]) {
        if (e.def.mode !== 'fibre') continue;
        const s = anchorSlot(e.def, side) * 3;
        applyMorph(e.point, I, { tissue: 'muscle', bone: boneIndex(e.def.limb, side) });
        const limb = this._m[boneIndex(e.def.limb, side)];
        const trunk = this._m[e.def.trunk === 'root' ? 0 : boneIndex(e.def.trunk, side)];
        A.copy(I).applyMatrix4(limb);
        B.copy(I).applyMatrix4(trunk);
        this.anchorDisp[s] = A.x - B.x; this.anchorDisp[s + 1] = A.y - B.y; this.anchorDisp[s + 2] = A.z - B.z;
      }
    }
  }

  // ---------- posing ----------
  reset() {
    for (let i = 0; i < BONE_COUNT; i++) {
      this._m[i].identity().toArray(this.matrices, i * 16);
      this.dqReal.set([0, 0, 0, 1], i * 4);
      this.dqDual.set([0, 0, 0, 0], i * 4);
    }
    this.anchorDisp.fill(0);
    this.enabled.value = 0;
  }

  /**
   * Store one bone's rigid transform as a unit dual quaternion. Every bone transform here is
   * rotation plus translation with no scale (the body morph runs before the pose), which is
   * exactly the case a dual quaternion represents.
   */
  _writeDual(i, m) {
    _q.setFromRotationMatrix(m);
    const qx = _q.x, qy = _q.y, qz = _q.z, qw = _q.w;
    const e = m.elements, tx = e[12], ty = e[13], tz = e[14];
    this.dqReal.set([qx, qy, qz, qw], i * 4);
    // dual = 0.5 * t * q, with t as a pure quaternion
    this.dqDual.set([
      0.5 * (tx * qw + ty * qz - tz * qy),
      0.5 * (ty * qw + tz * qx - tx * qz),
      0.5 * (tz * qw + tx * qy - ty * qx),
      -0.5 * (tx * qx + ty * qy + tz * qz),
    ], i * 4);
  }

  /**
   * CPU mirror of the shader's skinning, for measurement and anything that needs to know
   * exactly where a vertex ends up. Takes a point already in morphed rest space.
   */
  skinPoint(a, b, w, v) {
    if (w >= 1.5) {
      // Fibre vertex: carried by its trunk bone, then shifted by its share of the stretch.
      const f = w - 2, s = b * 3;
      this.skinPoint(a, a, 1, v);
      return v.set(v.x + f * this.anchorDisp[s], v.y + f * this.anchorDisp[s + 1], v.z + f * this.anchorDisp[s + 2]);
    }
    const R = this.dqReal, D = this.dqDual;
    let qa0 = R[a * 4], qa1 = R[a * 4 + 1], qa2 = R[a * 4 + 2], qa3 = R[a * 4 + 3];
    let qb0 = R[b * 4], qb1 = R[b * 4 + 1], qb2 = R[b * 4 + 2], qb3 = R[b * 4 + 3];
    let db0 = D[b * 4], db1 = D[b * 4 + 1], db2 = D[b * 4 + 2], db3 = D[b * 4 + 3];
    if (qa0 * qb0 + qa1 * qb1 + qa2 * qb2 + qa3 * qb3 < 0) {
      qb0 = -qb0; qb1 = -qb1; qb2 = -qb2; qb3 = -qb3; db0 = -db0; db1 = -db1; db2 = -db2; db3 = -db3;
    }
    const u = 1 - w;
    let q0 = qa0 * w + qb0 * u, q1 = qa1 * w + qb1 * u, q2 = qa2 * w + qb2 * u, q3 = qa3 * w + qb3 * u;
    let d0 = D[a * 4] * w + db0 * u, d1 = D[a * 4 + 1] * w + db1 * u, d2 = D[a * 4 + 2] * w + db2 * u, d3 = D[a * 4 + 3] * w + db3 * u;
    const len = Math.hypot(q0, q1, q2, q3) || 1;
    q0 /= len; q1 /= len; q2 /= len; q3 /= len; d0 /= len; d1 /= len; d2 /= len; d3 /= len;
    const x = v.x, y = v.y, z = v.z;
    // rotate: v + 2 r x (r x v + w v)
    const cx = q1 * z - q2 * y + q3 * x, cy = q2 * x - q0 * z + q3 * y, cz = q0 * y - q1 * x + q3 * z;
    const rx = x + 2 * (q1 * cz - q2 * cy), ry = y + 2 * (q2 * cx - q0 * cz), rz = z + 2 * (q0 * cy - q1 * cx);
    // translate: 2 (w d - d.w r + r x d)
    const tx = 2 * (q3 * d0 - d3 * q0 + (q1 * d2 - q2 * d1));
    const ty = 2 * (q3 * d1 - d3 * q1 + (q2 * d0 - q0 * d2));
    const tz = 2 * (q3 * d2 - d3 * q2 + (q0 * d1 - q1 * d0));
    return v.set(rx + tx, ry + ty, rz + tz);
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
      this._writeDual(i, this._m[i]);
    }
    this._writeAnchors();
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
    applyMorph(bone.pivot, _v, { tissue: 'bone', bone: bone.index });
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
    return this.p[side] && this.p[side][key] ? this._morphJoint(side, key, this.p[side][key], out) : out.set(0, 0, 0);
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
  /**
   * The hand's own rotation for a pressing grip: the wrist bent back by WRIST_EXTENSION
   * about its side-to-side axis. Returned in the forearm's frame.
   */
  /**
   * The wrist's rotation, in the forearm's frame: bent back by WRIST_EXTENSION, and bent
   * `dev` radians sideways — positive towards the little finger. Side-bend turns about the
   * axis through the back of the hand and the palm, which in the rest pose is z.
   */
  wristQuat(side = 'l', dev = 0) {
    const ext = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), WRIST_EXTENSION);
    if (!dev) return ext;
    const sideways = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), dev * this._ulnarSign(side));
    return ext.multiply(sideways);
  }

  /** Which way round z turns this hand towards its little finger. Read off the hand. */
  _ulnarSign(side) {
    const h = this._morphed(side, 'mcp').sub(this._morphed(side, 'wr'));
    const k = this._morphed(side, 'mcp5').sub(this._morphed(side, 'mcp2'));
    return Math.sign(new THREE.Vector3(0, 0, 1).cross(h).dot(k)) || 1;
  }

  /**
   * The line the bar lies along in this hand, in the hand's own rest frame. It runs from
   * the index finger's side to the little finger's, square to the hand's long axis and then
   * leaned by GRIP_OBLIQUE towards the wrist on the little-finger side.
   *
   * This is fixed for the whole lift. A bar does not roll about in a closed hand: once it
   * is gripped, its place in the palm stays put and the wrist and forearm do the moving.
   */
  barInHand(side) {
    const j = (k) => this._morphed(side, k);
    return barLine(j('wr'), j('mcp'), j('mcp2'), j('mcp5'));
  }

  /** Where the grip point sits once the wrist is set, in the forearm's rest frame. */
  _gripAfterWrist(side, wq = this.wristQuat(side)) {
    const W = this._morphed(side, 'wr');
    return this._morphed(side, 'grip').sub(W).applyQuaternion(wq).add(W);
  }

  /** `target` (rest space) brought into the arm's own frame: morphed, then undone through the girdle. */
  _armTarget(side, target, girdle) {
    const T = applyMorph(target, new THREE.Vector3(), { tissue: 'bone' });
    if (!girdle) return { T, inv: null };
    const inv = this.localMatrix(this.bones[boneIndex('girdle', side)], girdle, new THREE.Matrix4()).invert();
    return { T: T.applyMatrix4(inv), inv };
  }

  /**
   * How far `target` is from the shoulder, as a fraction of the whole arm. Over 1 cannot be
   * reached at all; LOCKOUT_REACH is as straight as an elbow should go.
   */
  reachRatio(side, target, girdle = null) {
    if (!this.p[side]) return 0;
    const S = this._morphed(side, 'gh'), E = this._morphed(side, 'el');
    const G = this._gripAfterWrist(side);
    const { T } = this._armTarget(side, target, girdle);
    return S.distanceTo(T) / (S.distanceTo(E) + E.distanceTo(G));
  }

  get lockoutReach() { return LOCKOUT_REACH; }

  /**
   * An elbow hint that puts the forearm as nearly upright under the bar as the arm allows.
   *
   * With the shoulder and the grip fixed, the elbow can only sit somewhere on one circle.
   * The coaching rule is "wrist over elbow": the forearm vertical, so the bar is pushed
   * straight up and not sideways. This searches the circle for the elbow that leaves the
   * forearm leaning least, counting a lean across the body ACROSS_WEIGHT times as much as
   * a lean towards the head.
   *
   * On a lifter's real proportions the forearm cannot be exactly upright at the chest.
   * Forcing it upright seen from the feet alone tucks the elbows into the ribs and throws
   * the forearm back towards the head. Taking the least lean overall flares the elbows
   * wider than the hands, and then the wrist has to bend nearly 40 degrees over one rep to
   * keep hold of the bar. The weighting sits between the two.
   *
   * `up` is the world's up in rest space: the body lies on its back, so it is rest +z.
   * Returned in rest space, ready to hand to solveArm as its pole.
   */
  uprightPole(side, target, girdle, hint, up = new THREE.Vector3(0, 0, 1)) {
    if (!this.p[side]) return hint;
    const S = this._morphed(side, 'gh'), E0 = this._morphed(side, 'el');
    const G = this._gripAfterWrist(side);
    const { T, inv } = this._armTarget(side, target, girdle);
    const L1 = S.distanceTo(E0), L2 = E0.distanceTo(G);
    const toT = T.clone().sub(S);
    const dist = Math.min(toT.length(), (L1 + L2) * 0.999);
    const n = toT.normalize();
    const cosA = Math.min(1, Math.max(-1, (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist)));
    const C = S.clone().addScaledVector(n, L1 * cosA);
    const r = L1 * Math.sqrt(Math.max(0, 1 - cosA * cosA));
    // A straight arm has no circle left to choose on, and the hint is as good as anything.
    if (r < 1e-4) return hint;
    const fwd = inv ? inv.clone().invert() : new THREE.Matrix4();
    // The circle, and the forearm each point on it gives, in rest space where "up" and
    // "across the body" are plain axes.
    const u = new THREE.Vector3(0, 0, 1).cross(n);
    if (u.lengthSq() < 1e-6) u.set(1, 0, 0).cross(n);
    u.normalize();
    const v = n.clone().cross(u).normalize();
    const Tr = T.clone().applyMatrix4(fwd);
    const across = up.clone().cross(new THREE.Vector3(0, 1, 0)).normalize();   // body's side-to-side
    const along = up.clone().cross(across).normalize();                        // head to feet
    // Leaning across the body counts for more than leaning along it. Seen from the feet,
    // a tilted forearm pushes the bar sideways, which is the fault a coach calls first; a
    // forearm leaning towards the head is the ordinary tucked-elbow press.
    const cost = (th) => {
      const E = C.clone().addScaledVector(u, r * Math.cos(th)).addScaledVector(v, r * Math.sin(th)).applyMatrix4(fwd);
      const f = Tr.clone().sub(E);
      const fu = f.dot(up);
      if (fu <= 0) return Infinity;                                            // elbow above the bar
      const a = f.dot(across) / fu, b = f.dot(along) / fu;
      return ACROSS_WEIGHT * a * a + b * b;
    };
    let best = 0, bestC = Infinity;
    for (let i = 0; i < 72; i++) { const th = i * Math.PI / 36, c = cost(th); if (c < bestC) { bestC = c; best = th; } }
    for (let step = Math.PI / 72; step > 1e-4; step /= 2) {
      for (const th of [best - step, best + step]) { const c = cost(th); if (c < bestC) { bestC = c; best = th; } }
    }
    if (!Number.isFinite(bestC)) return hint;
    return u.multiplyScalar(Math.cos(best)).addScaledVector(v, Math.sin(best)).transformDirection(fwd);
  }

  /**
   * @param opts.pronation  fallback forearm twist, radians, if no alignment is asked for
   * @param opts.girdle     this side's girdle pose entry, so the arm solves in its frame
   * @param opts.rootQ      the root's rotation, needed to know which way the hand faces
   * @param opts.align      world direction the bar runs, from this hand's index finger side
   *                        to its little finger side
   */
  solveArm(side, target, pole, opts = {}) {
    const { pronation = 0, girdle = null, rootQ = null, align = null } = opts;
    if (!this.p[side]) return {};
    // Solve in morphed space, not rest space. The bone matrices rotate vertices that have
    // already been through the height/weight field, so the arm they actually swing is the
    // morphed one — solving against rest lengths lands the grip centimetres off the bar on
    // any body that is not the source model's size.
    const S = this._morphed(side, 'gh');
    const E = this._morphed(side, 'el');
    // The shoulder blade moves before the arm does, so by the time this solves, the arm's
    // whole frame has already shifted. Bring the target and the elbow hint back through
    // that rotation — otherwise a few degrees at the collarbone slides the grip several
    // centimetres along the bar, and the hands change width mid-rep.
    const { T, inv } = this._armTarget(side, target, girdle);
    if (inv) pole = pole.clone().transformDirection(inv);
    const girdleQ = girdle?.rot ? new THREE.Quaternion().setFromEuler(new THREE.Euler(...girdle.rot, 'XYZ')) : new THREE.Quaternion();
    const outer = (rootQ ? rootQ.clone() : new THREE.Quaternion()).multiply(girdleQ);

    // The hand has to hold the bar the same way all through the rep, and that takes two
    // turns: the forearm twisting about its own axis, and the wrist bending sideways. The
    // twist can only line the bar up if the bar already makes the right angle with the
    // forearm, and setting that angle is the wrist's job. The wrist also moves the grip,
    // which moves the arm, so the three are settled together over a few passes.
    const bh = this.barInHand(side);
    let dev = 0, sol = null, G = null, wq = null;
    const passes = align ? 3 : 1;
    for (let pass = 0; pass < passes; pass++) {
      wq = this.wristQuat(side, dev);
      G = this._gripAfterWrist(side, wq);
      sol = this._solve2(S, E, G, T, pole);
      if (!align) break;
      const base = outer.clone().multiply(sol.q1).multiply(sol.swing2);
      const a = sol.restD2;
      // The bar's direction as the forearm sees it, before any twist.
      const want = align.clone().normalize().applyQuaternion(base.clone().invert()).dot(a);
      const along = (x) => bh.clone().applyQuaternion(this.wristQuat(side, x)).dot(a);
      // Bisect for the side-bend that gives the bar that angle to the forearm. Out of the
      // wrist's range, it stops at the limit and the forearm twist does what it can.
      let lo = -WRIST_RADIAL_MAX, hi = WRIST_ULNAR_MAX;
      const rising = along(hi) > along(lo);
      if ((want - along(lo)) * (rising ? 1 : -1) <= 0) dev = lo;
      else if ((want - along(hi)) * (rising ? 1 : -1) >= 0) dev = hi;
      else {
        for (let i = 0; i < 24; i++) {
          const mid = (lo + hi) / 2;
          if ((along(mid) < want) === rising) lo = mid; else hi = mid;
        }
        dev = (lo + hi) / 2;
      }
    }
    const { q1, swing2, restD2 } = sol;

    // How far to turn the forearm. A fixed guess is right at one moment of the rep and off
    // at the others, and the bar then lies diagonally across the fingers. So it is solved:
    // turn the forearm about its own axis until the bar line in the palm runs along the
    // real bar. That turn keeps the grip point where it is, because the grip lies on the
    // forearm's axis.
    const m = side === 'l' ? 1 : -1;
    let phi = m * pronation;
    if (align) {
      const base = outer.clone().multiply(q1).multiply(swing2);
      const f = restD2.clone().applyQuaternion(base).normalize();
      const k = bh.clone().applyQuaternion(wq).applyQuaternion(base);
      const w = align.clone().normalize();
      k.addScaledVector(f, -k.dot(f)).normalize();
      w.addScaledVector(f, -w.dot(f)).normalize();
      phi = Math.atan2(new THREE.Vector3().crossVectors(k, w).dot(f), k.dot(w));
    }

    // A twist only leaves the grip alone if the grip lies ON the twist axis, and each
    // segment spins about its OWN pivot. Elbow, wrist and palm are near-collinear in the
    // source model, but the morph field is non-linear and bends that line, so each axis is
    // aimed from its own pivot at the grip rather than reusing the forearm's direction.
    // The turn is shared out along the forearm so it spirals instead of wringing the wrist.
    const Fm = this._morphed(side, 'fm');
    const twist1 = new THREE.Quaternion().setFromAxisAngle(restD2, phi * 0.32);
    const twist2 = new THREE.Quaternion().setFromAxisAngle(G.clone().sub(Fm).normalize(), phi * 0.68);
    (this.wristDev ||= {})[side] = dev;

    return {
      [`upperarm.${side}`]: { quat: q1 },
      [`forearm1.${side}`]: { quat: swing2.clone().multiply(twist1) },
      [`forearm2.${side}`]: { quat: twist2 },
      [`hand.${side}`]: { quat: wq },
    };
  }

  /**
   * Close the hand round a bar, the way a hand actually closes.
   *
   * Every joint of a finger bends at once, the middle joint fastest, which is how a fist
   * forms. The moment a bone meets the bar, it and every joint behind it stop, because
   * bending them further would push that bone into the steel. The joints past it carry on
   * curling until their own bones land on the bar too, or reach how far a real finger can
   * bend. This is the closing rule robot grasp planners use. It is also why the grip looks
   * like a grip: the fingers wrap round the bar instead of hooking over it as straight
   * sticks.
   *
   * An earlier version swung each bone until it was tangent to the bar. Once the first
   * bone touched, the next one started on the bar already, "tangent" meant carrying on in
   * a straight line, and the middle joint of every finger stayed at two degrees.
   *
   * `radius` is the bar's. `flesh` is the tissue between a phalanx's bone and the bar,
   * thickest under the first bone and thinnest under the fingertip pad.
   */
  gripAround(side, radius, flesh, barAxis = BAR_AXIS) {
    if (!this.p[side]) return {};
    const C = this._morphed(side, 'grip');
    const out = {};
    // The bar's direction as the HAND sees it. The hand turns through the rep, so a fixed
    // axis here would be right at one phase and wrong at every other.
    const N = barAxis.clone().normalize();
    const deg = Math.PI / 180;
    const clear = [radius + flesh, radius + flesh * 0.88, radius + flesh * 0.8];

    // How close a stretch of bone comes to the bar's axis, measured across the bar: the
    // bar is a cylinder, so distance along it does not count.
    const across = (P, o) => o.subVectors(P, C).addScaledVector(N, -o.dot(N));
    const a2 = new THREE.Vector3(), b2 = new THREE.Vector3(), ab = new THREE.Vector3();
    const reach = (A, B) => {
      across(A, a2); across(B, b2); ab.subVectors(b2, a2);
      const len2 = ab.lengthSq();
      const t = len2 > 0 ? Math.max(0, Math.min(1, -a2.dot(ab) / len2)) : 0;
      return a2.addScaledVector(ab, t).length();
    };

    // Closest approach of two bones, for the thumb coming down on top of the fingers.
    const segSeg = (p1, q1, p2, q2) => {
      const d1 = q1.clone().sub(p1), d2 = q2.clone().sub(p2), r = p1.clone().sub(p2);
      const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r), c = d1.dot(r), b = d1.dot(d2);
      const den = a * e - b * b;
      let s1 = den > 1e-12 ? Math.max(0, Math.min(1, (b * f - c * e) / den)) : 0;
      let t1 = e > 1e-12 ? (b * s1 + f) / e : 0;
      if (t1 < 0) { t1 = 0; s1 = a > 1e-12 ? Math.max(0, Math.min(1, -c / a)) : 0; }
      else if (t1 > 1) { t1 = 1; s1 = a > 1e-12 ? Math.max(0, Math.min(1, (b - c) / a)) : 0; }
      return p1.clone().addScaledVector(d1, s1).distanceTo(p2.clone().addScaledVector(d2, t1));
    };

    /**
     * One digit. `keys` are its four joint names, base to tip. `rate` is how fast each
     * joint bends relative to the others and `limit` how far it can go, both base first.
     * `turn` says which way round the bar each joint bends. `start` holds joints already
     * set, and `solid` lists other bones this digit must not pass through.
     */
    const close = (keys, rate, limit, names, { turn = null, start = [0, 0, 0], solid = [] } = {}) => {
      const J = keys.map(k => this._morphed(side, k));
      const d = [0, 1, 2].map(i => J[i + 1].clone().sub(J[i]));
      // Bend towards the bar, whichever way round the axis that is for this digit.
      const toward = Math.sign(new THREE.Vector3().crossVectors(d[0], C.clone().sub(J[0])).dot(N)) || 1;
      const sg = turn || [toward, toward, toward];
      const th = start.slice(), done = start.map(v => v !== 0);
      const q = new THREE.Quaternion(), P = [J[0].clone(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
      const place = (ang) => {
        let sum = 0;
        for (let i = 0; i < 3; i++) {
          sum += sg[i] * ang[i];
          q.setFromAxisAngle(N, sum);
          P[i + 1].copy(P[i]).add(d[i].clone().applyQuaternion(q));
        }
      };
      // A joint is a hinge sitting on its neighbour's bone, so the first quarter of each
      // bone is left out of the contact test: that stretch is the joint itself, and it is
      // guarded by the bone before it.
      // A joint set beforehand has already been placed clear, and is not re-tested.
      const preset = start.map(v => v !== 0);
      const touching = () => {
        for (let i = 0; i < 3; i++) {
          if (preset[i]) continue;
          const A = P[i].clone().lerp(P[i + 1], 0.25);
          if (reach(A, P[i + 1]) < clear[i]) return i;
          for (const [S0, S1, gap] of solid) if (segSeg(A, P[i + 1], S0, S1) < gap) return i;
        }
        return -1;
      };
      const STEP = 1 * deg;
      for (let n = 0; n < 240 && done.includes(false); n++) {
        const next = th.map((t, i) => (done[i] ? t : Math.min(limit[i], t + rate[i] * STEP)));
        place(next);
        const hit = touching();
        if (hit >= 0) {
          // That bone is on the bar: it and every joint behind it hold where they were.
          for (let i = 0; i <= hit; i++) done[i] = true;
          continue;
        }
        for (let i = 0; i < 3; i++) { th[i] = next[i]; if (th[i] >= limit[i]) done[i] = true; }
      }
      place(th);
      // All three bend about the bar's axis, so each bone's turn in its parent's frame is
      // just its own share of the angle.
      names.forEach((name, i) => { out[`${name}.${side}`] = { quat: new THREE.Quaternion().setFromAxisAngle(N, sg[i] * th[i]) }; });
      return { th, P: P.map(v => v.clone()), sg };
    };

    // Flexion limits from a real hand: knuckle about 90°, middle joint about 110°, end joint
    // about 80°. The middle joint leads and the end joint follows at two-thirds of its rate,
    // which is the coupling the tendons impose.
    (this.gripAngles ||= {})[side] = {};
    const fingers = {};
    for (const { n } of DIGITS) {
      fingers[n] = close([`mcp${n}`, `pip${n}`, `dip${n}`, `tip${n}`],
        [0.8, 1.0, 0.67], [90 * deg, 110 * deg, 80 * deg], [`f${n}a`, `f${n}b`, `f${n}c`]);
      this.gripAngles[side][n] = fingers[n].th;
    }

    // The thumb comes round the other face of the bar and locks it in, opposite the fingers.
    // That is the grip Delavier insists on: without it the bar can roll out onto the neck.
    //
    // It takes two movements. At rest the thumb lies along the palm, straight under the
    // bar, so first it lifts away from the palm (palmar abduction at its base joint) until
    // its metacarpal clears the near face of the bar. Then its two outer joints bend the
    // other way round from the fingers, over the top of the bar, and come to rest on the
    // index and middle fingers that are already there.
    //
    // Seen down the bar, the metacarpal points just below the bar's centre, so lifting it
    // away from the palm swings it towards the bar, past its centre line and up the near
    // face until it is clear. The outer joints then curl back the other way, over the top.
    const tJ = ['cmc1', 'mcp1', 'ip1', 'tip1'].map(k => this._morphed(side, k));
    const lift = Math.sign(new THREE.Vector3().crossVectors(tJ[1].clone().sub(tJ[0]), C.clone().sub(tJ[0])).dot(N)) || 1;
    const meta = tJ[1].clone().sub(tJ[0]);
    // The pad of muscle on the thumb's metacarpal is the thickest flesh in the hand, so it
    // needs more room from the bar than a finger does.
    const padClear = radius + THENAR_PAD;
    let abd = 0;
    for (; abd < 75 * deg; abd += 1 * deg) {
      const end = tJ[0].clone().add(meta.clone().applyAxisAngle(N, lift * abd));
      if (reach(tJ[0].clone().lerp(end, 0.25), end) >= padClear) break;
    }
    const solid = [];
    for (const n of [2, 3]) {
      const Pf = fingers[n].P;
      for (let i = 1; i < 3; i++) solid.push([Pf[i], Pf[i + 1], 0.017]);
    }
    const thumb = close(['cmc1', 'mcp1', 'ip1', 'tip1'], [0, 0.8, 1.0], [abd, 55 * deg, 80 * deg], ['t1', 't2', 't3'],
      { turn: [lift, -lift, -lift], start: [abd || 1e-6, 0, 0], solid });
    this.gripAngles[side][1] = thumb.th;
    return out;
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
    const T = targetIsMorphed ? target.clone() : applyMorph(target, new THREE.Vector3(), { tissue: 'bone' });
    const { q1, swing2 } = this._solve2(S, E, G, T, pole);
    return {
      [`thigh.${side}`]: { quat: q1 },
      [`shin.${side}`]: { quat: swing2 },
    };
  }

  /** Put a rest-space point through the body morph, so it matches what the shader poses. */
  morphPoint(v, out = new THREE.Vector3()) { return applyMorph(v, out); }

  /**
   * One vertex through the morph exactly as the shader sees it: its bones (a, b, w) and
   * its tissue bits (1 skin, 2 breast, 4 bone, 8 muscle).
   */
  morphVertex(v, out, a, b, w, mask = 0) {
    const tissue = mask & 4 ? 'bone' : mask & 1 ? 'skin' : mask & 8 ? 'muscle' : 'other';
    return applyMorph(v, out, { tissue, skin: [a, b, w], breast: !!(mask & 2) });
  }

  /** Move a point by one bone's current transform, in place. */
  applyBone(index, v) {
    const m = this.matrices, i = index * 16;
    const x = v.x, y = v.y, z = v.z;
    v.set(
      m[i] * x + m[i + 4] * y + m[i + 8] * z + m[i + 12],
      m[i + 1] * x + m[i + 5] * y + m[i + 9] * z + m[i + 13],
      m[i + 2] * x + m[i + 6] * y + m[i + 10] * z + m[i + 14],
    );
    return v;
  }

  /** World-space position of a joint under the current pose (for props and labels). */
  jointAt(name, side, out = new THREE.Vector3()) {
    const q = this.p[side];
    if (!q || !q[name]) return out.set(0, 0, 0);
    this._morphJoint(side, name, q[name], out);
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
  // The grip rides on the hand, not on the fingers: curling the fingers must close them
  // round the bar without dragging the bar along with them.
  grip: 'hand', palm: 'hand', mcp: 'hand',
  ...Object.fromEntries(DIGITS.flatMap(({ n }) => [
    [`mcp${n}`, `f${n}a`], [`pip${n}`, `f${n}b`], [`dip${n}`, `f${n}c`], [`tip${n}`, `f${n}c`],
  ])),
  cmc1: 't1', mcp1: 't2', ip1: 't3', tip1: 't3',
  hip: 'thigh', knee: 'shin', ankle: 'foot', toe: 'foot',
};

function smoothstep(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

/**
 * The line a held bar lies along across a palm, from the index finger's side to the little
 * finger's: square to the hand's long axis (wrist to knuckles), then leaned by GRIP_OBLIQUE
 * towards the wrist on the little-finger side.
 */
function barLine(wr, mcp, mcp2, mcp5) {
  const h = new THREE.Vector3().subVectors(mcp, wr).normalize();
  const k = new THREE.Vector3().subVectors(mcp5, mcp2);
  const across = k.addScaledVector(h, -k.dot(h)).normalize();
  return across.multiplyScalar(Math.cos(GRIP_OBLIQUE)).addScaledVector(h, -Math.sin(GRIP_OBLIQUE)).normalize();
}

// Scratch, so posing every frame allocates nothing.
const _e = new THREE.Euler();
const _r = new THREE.Matrix4();
const _back = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

// ---------------- shader ----------------

/**
 * Dual-quaternion skinning.
 *
 * Linear blending averages the two positions a vertex would have under each bone, and the
 * average of two points on an arc lies inside the arc. So tissue between two bones that
 * turn a long way apart, like the pectoral and the lat when the arm goes from hanging to
 * overhead, is pulled straight across the corner into a thin flat sheet. Blending the two
 * transforms as dual quaternions rotates the vertex part of the way round the joint
 * instead, so it keeps its distance from the joint and the muscle fans round the shoulder
 * the way a real axillary fold does.
 *
 * The surface normal is turned by the same rotation. Before this, only positions were
 * posed, so the raised arms were lit as if they still hung by the sides.
 */
export const RIG_GLSL = /* glsl */`
// aSkin (boneA, boneB, weightA, or trunkBone, anchorSlot, 2 + fraction) is declared by the morph patch.
uniform vec4 uBoneReal[${BONE_COUNT}];
uniform vec4 uBoneDual[${BONE_COUNT}];
uniform vec3 uAnchorDisp[${ANCHOR_SLOTS}];
uniform float uPosed;
vec4 sharirQ; vec4 sharirD;
bool sharirReady = false;
void sharirBlend() {
  // The normal is posed before the position, and both need the same blend: work it out
  // once per vertex, not twice.
  if (sharirReady) return;
  sharirReady = true;
  int ia = int(aSkin.x + 0.5), ib = int(aSkin.y + 0.5);
  // Most of the body follows the trunk alone. Reading bone 0 by a constant index and
  // skipping the blend keeps those vertices as cheap as they were before posing existed.
  if (ia == 0 && ib == 0 && aSkin.z < 1.5) { sharirQ = uBoneReal[0]; sharirD = uBoneDual[0]; return; }
  if (aSkin.z > 1.5) {                              // fibre vertex: its trunk bone only
    sharirQ = uBoneReal[ia]; sharirD = uBoneDual[ia];
    return;
  }
  float w = clamp(aSkin.z, 0.0, 1.0);
  vec4 qa = uBoneReal[ia], da = uBoneDual[ia];
  vec4 qb = uBoneReal[ib], db = uBoneDual[ib];
  if (dot(qa, qb) < 0.0) { qb = -qb; db = -db; }   // same hemisphere: the short way round
  vec4 q = qa * w + qb * (1.0 - w);
  vec4 d = da * w + db * (1.0 - w);
  float len = length(q);
  sharirQ = q / len; sharirD = d / len;
}
vec3 sharirRotate(vec3 v) { return v + 2.0 * cross(sharirQ.xyz, cross(sharirQ.xyz, v) + sharirQ.w * v); }
vec3 sharirPoseNormal(vec3 n) {
  if (uPosed < 0.5) return n;
  sharirBlend();
  return sharirRotate(n);
}
vec3 sharirPose(vec3 p) {
  if (uPosed < 0.5) return p;
  sharirBlend();
  vec3 r = sharirQ.xyz;
  vec3 t = 2.0 * (sharirQ.w * sharirD.xyz - sharirD.w * r + cross(r, sharirD.xyz));
  vec3 q = sharirRotate(p) + t;
  if (aSkin.z > 1.5) q += (aSkin.z - 2.0) * uAnchorDisp[int(aSkin.y + 0.5)];
  return q;
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
    shader.uniforms.uBoneReal = rig.uReal;
    shader.uniforms.uBoneDual = rig.uDual;
    shader.uniforms.uAnchorDisp = rig.uAnchor;
    shader.uniforms.uPosed = rig.enabled;
    const marker = 'transformed = morphBody(transformed);';
    if (!shader.vertexShader.includes(marker)) { console.warn('[rig] morph hook not found — pose disabled'); return; }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + RIG_GLSL)
      .replace(marker, 'transformed = sharirPose(morphBody(transformed));');
    if (shader.vertexShader.includes('#include <beginnormal_vertex>')) {
      shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>',
        '#include <beginnormal_vertex>\n objectNormal = sharirPoseNormal(objectNormal);');
    }
  };
  material.needsUpdate = true;
}
