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
  // The finger envelopes have to clear the digital nerves and vessels that run along the
  // sides of every finger, not just the bone: anything they miss falls back to the root and
  // is left behind beside the thigh when the arm lifts.
  { name: 'hand',     parent: 'forearm2', from: 'wr',       to: 'mcp',      radius: 0.085, group: 'arm' },
  { name: 'fingers1', parent: 'hand',     from: 'mcp',      to: 'pip',      radius: 0.060, group: 'arm' },
  { name: 'fingers2', parent: 'fingers1', from: 'pip',      to: 'tip',      radius: 0.055, group: 'arm' },
  { name: 'thumb',    parent: 'hand',     from: 'thumbCmc', to: 'thumbTip', radius: 0.042, group: 'arm' },
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
 * How far palmar of the knuckle joints a held bar's axis sits, in metres. In anatomical
 * position the palm faces forward, so palmar is +z. Tuned against a penetration test: the
 * nearest hand vertex to the bar axis must sit at or outside the bar's own radius.
 */
const GRIP_DEPTH = 0.048;
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
  constructor(registry) {
    this.ok = false;
    this.registry = registry;
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
      // Where a bar actually lies when this hand holds one: in the channel of the palm,
      // clear of the knuckles, not at the knuckle joint centres — which are inside the
      // bone, so a bar placed there passes straight through the hand.
      q.grip = q.mcp.clone().add(new THREE.Vector3(0, 0, GRIP_DEPTH));
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
      const a = q[seg.from], b = q[seg.to];
      const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
      const len2 = abx * abx + aby * aby + abz * abz;
      let t = len2 > 0 ? ((x - a.x) * abx + (y - a.y) * aby + (z - a.z) * abz) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = x - (a.x + abx * t), dy = y - (a.y + aby * t), dz = z - (a.z + abz * t);
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) / seg.radius;
      if (d < bestD) { bestD = d; best = si; bestT = t; }
    }
    return { best, d: bestD, t: bestT };
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
        applyMorph(e.point, I);
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
    // Solve to the point where the bar lies in the palm, so the hand arrives holding it.
    const G = this._morphed(side, 'grip');
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
   * Close the hand round a bar of the given radius.
   *
   * The angles are not picked, they are solved: the bar is a real cylinder lying at the
   * grip point, and each finger link is swung about its own joint until its far end sits
   * exactly `clear` from the bar's axis. That is the law of cosines on the triangle
   * joint-bar-joint, and it is why the fingers stop ON the bar instead of closing through
   * it — and why the same call would work for a thicker bar or a dumbbell handle.
   *
   * `clear` is the distance from the bar's axis to a phalanx's own axis: the bar's radius
   * plus the flesh between the two.
   */
  gripAround(side, clear, barAxis = BAR_AXIS) {
    if (!this.p[side]) return {};
    const C = this._morphed(side, 'grip');
    const out = {};
    // The bar's direction as the HAND sees it. The hand turns through the rep, so a fixed
    // axis here would be right at one phase and wrong at every other — the fingers would
    // close correctly on the chest and cut through the steel at lockout.
    const N = barAxis.clone().normalize();
    const perp = (v, o) => o.copy(v).addScaledVector(N, -v.dot(N));

    // `origin` is where this joint actually sits once its parent has turned, which is not
    // its rest position for anything past the first link.
    const wrap = (origin, fromKey, toKey, radius, parentQ) => {
      const P0 = origin;
      const rest = this._morphed(side, toKey).sub(this._morphed(side, fromKey));  // parent frame
      const dir = rest.clone().applyQuaternion(parentQ).normalize();    // where it points now
      const L = rest.length();
      const idq = new THREE.Quaternion();
      const fallback = { quat: idq, end: P0.clone().addScaledVector(dir, L) };
      if (L < 1e-6) return fallback;

      // A bar is a cylinder, not a point. Fingers close round it in the plane at right
      // angles to its axis, so both the distance to it and the direction of the curl are
      // measured with the along-the-bar component taken out. Treating it as a point tilts
      // the curl out of that plane and lets the fingers close past the steel instead of
      // onto it.
      const hinge = perp(C.clone().sub(P0), new THREE.Vector3());   // to the bar's axis
      const dperp = perp(dir, new THREE.Vector3());
      const a = hinge.length();
      if (a < 1e-6 || dperp.lengthSq() < 1e-12) return fallback;
      // Signed angle from the link to the bar, measured about the bar's own axis.
      const cross = new THREE.Vector3().crossVectors(dperp, hinge);
      const signed = Math.atan2(cross.dot(N), dperp.dot(hinge));
      // Tangency: put both ends of a straight bone on the circle and the bone between them
      // is a chord, which cuts through the steel. What "lying on the bar" actually means is
      // that the perpendicular distance equals the radius — the angle whose sine is
      // radius over the distance from this joint to the axis.
      const want = Math.asin(Math.min(1, radius / Math.max(radius, a)));
      const turn = Math.sign(signed) * (Math.abs(signed) - want);
      const world = new THREE.Quaternion().setFromAxisAngle(N, turn);
      const end = P0.clone().addScaledVector(dir.clone().applyQuaternion(world), L);
      // The pose wants this link's rotation in its PARENT's frame, not the world's.
      const target = dir.clone().applyQuaternion(world).applyQuaternion(parentQ.clone().invert()).normalize();
      return { quat: new THREE.Quaternion().setFromUnitVectors(rest.clone().normalize(), target), end };
    };

    const id = new THREE.Quaternion();
    const f1 = wrap(this._morphed(side, 'mcp'), 'mcp', 'pip', clear, id);
    out[`fingers1.${side}`] = { quat: f1.quat };
    // The middle joint has moved, so the second link is solved from where it now is.
    const f2 = wrap(f1.end, 'pip', 'tip', clear, f1.quat);
    out[`fingers2.${side}`] = { quat: f2.quat };
    // The thumb comes round the other face of the bar — the side it already starts on — so
    // the same solve locks it opposite the fingers, which is the grip Delavier insists on.
    const th = wrap(this._morphed(side, 'thumbCmc'), 'thumbCmc', 'thumbTip', clear, id);
    out[`thumb.${side}`] = { quat: th.quat };
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
    const T = targetIsMorphed ? target.clone() : applyMorph(target, new THREE.Vector3());
    const { q1, swing2 } = this._solve2(S, E, G, T, pole);
    return {
      [`thigh.${side}`]: { quat: q1 },
      [`shin.${side}`]: { quat: swing2 },
    };
  }

  /** Put a rest-space point through the body morph, so it matches what the shader poses. */
  morphPoint(v, out = new THREE.Vector3()) { return applyMorph(v, out); }

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
  // The grip rides on the hand, not on the fingers: curling the fingers must close them
  // round the bar without dragging the bar along with them.
  grip: 'hand', mcp: 'fingers1', pip: 'fingers2', tip: 'fingers2',
  thumbCmc: 'thumb', thumbTip: 'thumb',
  hip: 'thigh', knee: 'shin', ankle: 'foot', toe: 'foot',
};

function smoothstep(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

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
attribute vec3 aSkin;   // boneA, boneB, weightA — or trunkBone, anchorSlot, 2 + fraction
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
