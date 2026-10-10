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
/** Vertebrae the spine's joints sit between: each joint is at the disc between the two. */
const SPINE_JOINTS = {
  lumbar: ['skeletal:Vertebra L5', 'skeletal:Sacrum', 0.35],
  thorax: ['skeletal:Vertebra T12', 'skeletal:Vertebra L1', 0.5],
  neck:   ['skeletal:Vertebra C7', 'skeletal:Vertebra T1', 0.5],
  head:   ['skeletal:Atlas (C1)', 'skeletal:Atlas (C1)', 0.0],
};
/** How wide each joint's blend band is, top to bottom: soft tissue bends over this span. */
const SPINE_BAND = { lumbar: 0.055, thorax: 0.055, neck: 0.032, head: 0.022 };
/** Rigid parts that belong to one piece of the trunk whatever their height. */
const OF_THORAX = /\brib\b|ribs|sternum|manubrium|xiphoid|costal cartilage|clavicle/i;
const OF_HEAD = /skull|cranium|mandible|maxilla|bones of head|teeth|tooth|auditory ossicle|malleus|incus|stapes/i;
const OF_PELVIS = /sacrum|coccyx|hip bone|ilium|ischium|pubis|pelvi/i;

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
/**
 * The trunk above the pelvis, as a chain up the middle. The root is the pelvis. The lower
 * back turns at the joint between L5 and the sacrum, the upper back between T12 and L1,
 * the neck at the base of the neck (C7 on T1), and the head where the skull sits on the
 * atlas. Every lift so far holds them straight, which is correct form; they are there so a
 * rounded back, a tucked chin or a head moved back out of the bar's way can be shown.
 */
const CENTRAL = ['lumbar', 'thorax', 'neck', 'head'];
const CENTRAL_PARENT = { lumbar: 'root', thorax: 'lumbar', neck: 'thorax', head: 'neck' };
export const BONE_COUNT = 1 + CENTRAL.length + PER_SIDE * 2;
const SIDES = ['l', 'r'];
/**
 * Bone index for a named segment: root = 0, then the spine and neck, then the left tree,
 * then the right. Parents always come before children, which is the order poses are built in.
 */
export const boneIndex = (name, side) => {
  if (name === 'root') return 0;
  const c = CENTRAL.indexOf(name);
  if (c >= 0) return 1 + c;
  return 1 + CENTRAL.length + SIDES.indexOf(side) * PER_SIDE + SEGMENTS.findIndex(s => s.name === name);
};
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
//   Of those, the broad sheets that run from the ribs or the spine onto the shoulder blade
//   move by a smooth blend between the trunk and the girdle (`_skinGirdleBlend`). Bound by
//   closeness, each went from the trunk to the girdle across 3 cm at the edge of the
//   girdle's envelope, and a shrug or an overhead lockout tore them there.
const GIRDLE_BLEND = /^(serratus anterior|pectoralis minor|rhomboid major|rhomboid minor|transverse part of trapezius|ascending part of trapezius)/i;
// The same across the hip: these run from pelvis or spine onto the femur.
const SPANNING_LEG = /glute(us|al)|iliopsoas|iliacus|psoas|piriformis|obturator (internus|externus)|gemellus|quadratus femoris|tensor fasciae latae|sartorius|rectus femoris|adductor (longus|brevis|magnus|minimus)|pectineus|gracilis|semitendinosus|semimembranosus|biceps femoris/i;
// Never movable, whatever the geometry says: the axial skeleton and everything inside it.
const AXIAL = /\brib\b|ribs|sternum|vertebra|sacrum|coccyx|skull|mandible|hyoid|cranium|costal cartilage/i;
const AXIAL_SYS = new Set(['digestive', 'respiratory', 'urinary', 'reproductive', 'endocrine', 'cavities', 'senses']);
/** Height band each limb occupies in the source model, in metres up from the soles. */
const BAND = { arm: [0.60, 1.48], leg: [0.0, 0.95] };
/**
 * What hangs between the thighs: the testes and the vessels, ducts and nerves that serve
 * them and the perineum. They sit inside the thigh's reach but never move with a thigh;
 * bound to one, the testicular arteries were torn away from the testes as the hip bent.
 */
const GENITAL = /testicular|spermatic|cremaster|deferen|pampiniform|scrot|penis|penile|pudendal|perine|urethr|prostat|of bulb/i;
/** Systems whose parts are named after their trunk origin rather than where they run. */
const TUBULAR = new Set(['cardiovascular', 'nervous', 'lymphoid']);
/**
 * Does this bounding box reach out of the trunk along that limb? Heights are source-space
 * metres up from the soles: 1.05 is below the elbow, 0.70 is clear of the pelvic floor.
 * Being merely lateral is enough for the arm, since the arm hangs outside the ribcage.
 */
const REACHES_INTO = {
  arm: (bb) => bb[0][2] < 1.05 || Math.min(Math.abs(bb[0][0]), Math.abs(bb[1][0])) > 0.135,
  // Below the hip. Below 0.70 m was the old rule, and it missed nerves of the upper inner
  // thigh by millimetres. What hangs between the thighs is kept apart by name (GENITAL).
  leg: (bb) => bb[0][2] < 0.76,
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
// The elbow's range on its hinge, from the rest pose. The rest pose's elbow is a little bent,
// so the arm is straight somewhere below zero: it is found each time, between these.
const ELBOW_OPEN = -40 * Math.PI / 180;
const ELBOW_MAX = 145 * Math.PI / 180;
// The knee folds further than the elbow; past straight it does not go.
const KNEE_MAX = 155 * Math.PI / 180;
// Over how much bend (past straight) the upper arm goes from its shortest turn to aiming the
// elbow at its pole.
const ELBOW_AIM = [10 * Math.PI / 180, 35 * Math.PI / 180];
// How far the forearm turns the palm before the humerus starts to help, the way an
// overhand grip on a hanging bar is shared between the forearm and the shoulder.
const PRONATION_EASY = 140 * Math.PI / 180;
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
 * The trunk bone a fibre muscle's trunk end is carried by. One per muscle, because the
 * insertion's movement is measured against a single bone: the pecs and the lats ride on
 * the upper back, the psoas on the lower back.
 */
const trunkOf = (def, side) => def.spine ? boneIndex(def.spine) : (def.trunk === 'root' ? 0 : boneIndex(def.trunk, side));

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
  // `start`: measure how far along each fibre a point is from where the muscle starts, so
  // the start stays put however the humerus turns (see `_skinFibre`).
  { re: /^latissimus dorsi/i, limb: 'upperarm', trunk: 'root', spine: 'thorax', at: 'Intertubercular sulcus', mode: 'fibre', start: true },
  { re: /^teres major/i, limb: 'upperarm', trunk: 'girdle', at: 'Crest of lesser tubercle', mode: 'fibre', start: true },
  { re: /pectoralis major/i, limb: 'upperarm', trunk: 'root', spine: 'thorax', at: 'Crest of greater tubercle',
    record: { muscle: 'Pectoralis major muscle', bone: 'Humerus' }, mode: 'fibre', start: true },
  // The rotator cuff: from the shoulder blade onto the ball of the humerus.
  { re: /^(supraspinatus|infraspinatus|teres minor)/i, limb: 'upperarm', trunk: 'girdle', at: 'Greater tubercle', mode: 'wrap', near: 0.02, far: 0.10 },
  { re: /^subscapularis/i, limb: 'upperarm', trunk: 'girdle', at: 'Lesser tubercle', mode: 'wrap', near: 0.02, far: 0.10 },
  // From the neck onto the shoulder girdle. Bound by closeness, their shoulder ends went
  // up with the collarbone in a shrug and the rest stayed on the neck, so the shoulders
  // slid up past a neck that did not change. Bound along their fibres, they shorten from
  // the neck to the shoulder the way the real muscles do. `spineBlend`: each point is
  // carried by the spine's own blend at its height (head, neck, upper back) before it
  // shifts, so the skull end goes with the head when the chin tucks for a hip thrust and
  // the base stays on the back (`blendFibreTrunks`). Carried by the neck alone, the base
  // swung out through the skin of the back.
  { re: /^descending part of trapezius/i, limb: 'girdle', spine: 'thorax', spineBlend: true, record: { muscle: 'Descending part of trapezius muscle', bone: 'Clavicle' }, mode: 'fibre', start: true, wall: false },
  { re: /^levator scapulae/i, limb: 'girdle', spine: 'thorax', spineBlend: true, record: { muscle: 'Levator scapulae', bone: 'Scapula' }, mode: 'fibre', start: true, wall: false },
  { re: /^omohyoid/i, limb: 'girdle', spine: 'thorax', spineBlend: true, record: { muscle: 'Omohyoid muscle', bone: 'Scapula' }, mode: 'fibre', start: true, wall: false },
  // Psoas and iliacus: from the lumbar spine and pelvis onto the lesser trochanter.
  { re: /^(psoas|iliacus|iliopsoas)/i, limb: 'thigh', trunk: 'root', spine: 'lumbar', at: 'Lesser trochanter', mode: 'fibre' },
  // The glutes and the small rotators under them are not here: they follow the skin over
  // the hip instead (FOLLOW_SKIN below). This one lies in front, under the adductors.
  { re: /^obturator externus/i, limb: 'thigh', trunk: 'root', at: 'Intertrochanteric crest', mode: 'fibre' },
];

/**
 * The muscles round the back and side of the hip, and the sheets and bursae between them.
 * They take the skin's smoothed weights near them (`followSkin` in skinweld.js), so in a
 * hinge or a squat they wrap round the hip together, the way the buttock does.
 *
 * Bound along their fibres, the gluteus maximus slid down off the buttock at the bottom of
 * a Romanian deadlift: the deep rotators and the pelvic floor under it showed through as
 * blades and curled sheets. Bound by closeness to the thigh, before that, it hinged in a
 * band over the hip and ballooned out. The hamstrings and the adductors are not in this
 * list: given the skin's weights near the groin, they tore.
 */
const FOLLOW_SKIN = /^(gluteus|piriformis|superior gemellus|inferior gemellus|obturator internus|quadratus femoris|iliotibial tract|intermuscular gluteal|gluteal|tensor fasciae|trochanteric|piriformis fascia|obturator fascia)/i;

/**
 * Above the hip joint, at the side, the iliotibial tract and the fascia lata are fixed to
 * the rim of the pelvis. The skin's weights there still carried a little of the thigh, and
 * patchily: next to each other, one point went with the pelvis and the next a fifth with
 * the thigh. Once the femur turned out at the bottom of a squat, as a real one does, the
 * top of the tract tore. So within the hip's field the thigh's share fades out smoothly
 * between 1 and 8 cm above the joint. The same holds for anything bound to the thigh by
 * closeness (`bindVertex`): measured along the femur, the side of the hip above the greater
 * trochanter counted as level with the joint, and the top of the fascia lata went half
 * with the thigh.
 */
const HIP_CREST = [0.01, 0.08];

/**
 * Creases: the inside of a bent knee or elbow, where the thigh meets the calf or the upper
 * arm meets the forearm. Skinning bends each side about the joint, but nothing stopped
 * one side passing into the other: at a knee bent to 90 degrees the hamstring tendons
 * curled round the crease and into the calf. Each crease is a contact surface instead: the
 * plane through the joint that halves the angle between the two bones. Tissue that would
 * cross it is squeezed into a thin layer on its own side, deepest crossing nearest the
 * plane, so the order of the layers is kept and the skin stays outermost.
 *
 * Before that, tissue shared between the two bones is lifted out of the crease. Blended
 * half and half, a tendon behind the knee swings round the joint on a circle and sinks
 * into the crease, where it made a U-turn. A real tendon runs straight across the back of
 * a bent knee like a bowstring: out to the corner where the back of the thigh and the back
 * of the calf meet. Shared tissue on the inside of the bend is lifted that far, fully at
 * an even share and not at all where one bone carries it alone, and never by more than
 * half its depth, so a very deep bend does not throw it out.
 *
 * The front of the hip is a crease too. At the bottom of a deep squat the hip bends about
 * 120 degrees and the front of the thigh swung up into the side of the belly: in the Skin
 * view the lower belly looked folded in. There only the thigh's tissue is held back. The
 * hip joint lies deep and the belly sits well in front of it, so the contact is not a
 * plane through the joint: it is moved, pose by pose, to the underside of the belly over
 * that thigh (sampled from the skin once at load, `collectCreaseSamples`), and the thigh
 * presses flat against it. The belly itself is left where it is. What counts as thigh is
 * read from the binding, not from height, so the pelvis, the groin and the pelvic floor
 * below the joint are never moved.
 *
 * from/at/to are the joints along the two bones (or `up`, a direction in the upper bone,
 * for the pelvis); prox is the upper bone, dist the lower one(s); reach is how far from the
 * joint a point can be and still be in the crease; squeeze is the depth of the layer
 * crossing tissue is pressed into; thighOnly holds back only the lower bone's tissue;
 * bowstring lifts shared tissue out of the crease.
 */
const CREASES = [
  { from: 'hip', at: 'knee', to: 'ankle', prox: 'thigh', dist: ['shin'], reach: 0.17, squeeze: 0.012, bowstring: true },
  // No bowstring at the elbow: folded right up in a front rack, the corner it lifts to runs
  // far out and it stretched the forearm muscles and the skin of the elbow.
  { from: 'gh', at: 'el', to: 'wr', prox: 'upperarm', dist: ['forearm1', 'forearm2'], reach: 0.13, squeeze: 0.008 },
  { up: [0, 1, 0], at: 'hip', to: 'knee', prox: 'root', also: 'lumbar', dist: ['thigh'], reach: 0.32, squeeze: 0.015, thighOnly: true },
];
const CREASE_SLOTS = CREASES.length * 2;

/** The joints at either end of each limb bone a muscle can insert on, top first. */
const LIMB_AXIS = { thigh: ['hip', 'knee'], upperarm: ['gh', 'el'], girdle: ['sc', 'gh'] };
/**
 * The lat, teres major and pec lie on the wall of the trunk, and as the arm moves their
 * fibres slide along it. Moved straight towards where the insertion went, the lat over the
 * lower corner of the shoulder blade lifted 1 to 2 cm off the ribs and out of the skin
 * when the elbows went back under a squat bar. So away from the tendon, the part of the
 * shift that points out of the body (out from the trunk's long axis, at this depth) is
 * taken away; near the tendon, where the fold of the armpit really does lift away with
 * the arm, it is kept.
 */
const WALL_Z = 0.0;
const WALL_FREE = [0.5, 0.9];
/** One slot per anchored muscle per side, for the insertion displacements the shader reads. */
const ANCHOR_SLOTS = ANCHORED.length * 2;
const anchorSlot = (def, side) => ANCHORED.indexOf(def) + (side === 'r' ? ANCHORED.length : 0);

/**
 * Body-cloud tags: 0 pelvis, 1-2 thighs, 3-4 shins, 5 lower back, 6 upper back, 7 neck,
 * 8 head. The bone that carries each tag, in that order.
 */
const CLOUD_BONES = () => [0, boneIndex('thigh', 'l'), boneIndex('thigh', 'r'), boneIndex('shin', 'l'), boneIndex('shin', 'r'),
  boneIndex('lumbar'), boneIndex('thorax'), boneIndex('neck'), boneIndex('head')];
const TRUNK_TAG = { 0: 0, 1: 5, 2: 6, 3: 7, 4: 8 };

const _creaseRest = new THREE.Vector3();
const _wallN = new THREE.Vector3();

/**
 * Turn a limb with a hinge so that `reach` (root to tip, at rest) lands along `toward`, and
 * the hinge axis lies across the line to `pole`, square to both. A hinge that bends
 * positively towards the front puts the joint's point on the side the pole is on.
 */
function aimArm(reach, hinge, toward, pole) {
  const x2 = toward.clone().normalize();
  const want = new THREE.Vector3().crossVectors(pole, x2);
  if (want.lengthSq() < 1e-8) return new THREE.Quaternion().setFromUnitVectors(reach.clone().normalize(), x2);
  return turnFrame(reach, hinge, toward, want);
}

/**
 * The rotation that carries direction `a1` onto `a2`, and turns `b1` (the part of it across
 * `a1`) to point as nearly as it can along `b2`. Used to place a bent arm as one rigid piece:
 * the line to the grip onto the line to the target, the elbow towards its pole.
 */
function turnFrame(a1, b1, a2, b2) {
  const x1 = a1.clone().normalize(), x2 = a2.clone().normalize();
  const y1 = b1.clone().addScaledVector(x1, -b1.dot(x1)), y2 = b2.clone().addScaledVector(x2, -b2.dot(x2));
  if (y1.lengthSq() < 1e-12 || y2.lengthSq() < 1e-12) return new THREE.Quaternion().setFromUnitVectors(x1, x2);
  y1.normalize(); y2.normalize();
  const m1 = new THREE.Matrix4().makeBasis(x1, y1, x1.clone().cross(y1));
  const m2 = new THREE.Matrix4().makeBasis(x2, y2, x2.clone().cross(y2));
  return new THREE.Quaternion().setFromRotationMatrix(m2.multiply(m1.transpose()));
}

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
    // The limb bone each insertion sits on. Tissue that runs on past its insertion, down
    // the bone, turns with that bone.
    this.anchorBone = new Float32Array(ANCHOR_SLOTS);
    for (const side of SIDES) for (const def of ANCHORED) this.anchorBone[anchorSlot(def, side)] = boneIndex(def.limb, side);
    this.uAnchorBone = { value: this.anchorBone };
    // Which insertions' muscles lie on the trunk's wall and slide along it (see WALL_Z).
    this.anchorWall = new Float32Array(ANCHOR_SLOTS);
    for (const side of SIDES) for (const def of ANCHORED) this.anchorWall[anchorSlot(def, side)] = def.start && def.wall !== false ? 1 : 0;
    this.uAnchorWall = { value: this.anchorWall };
    // One slot per crease per side: posed joint (w on/off), posed plane normal pointing to
    // the upper bone (w squeeze), posed inside-of-the-bend direction (w reach), the rest
    // joint, the rest normal, the bones (upper, lower, second lower), and the hinge axis
    // (w: the sine of half the angle between the bones), posed and at rest, and the side
    // of the straight limb that becomes the inside of the bend.
    this.crease = ['J', 'M', 'B', 'RJ', 'RM', 'Bone', 'H', 'RH', 'RN'].reduce((o, k) => (o[k] = new Float32Array(CREASE_SLOTS * 4), o), {});
    this.uCrease = Object.fromEntries(Object.entries(this.crease).map(([k, v]) => [k, { value: v }]));
    this.enabled = { value: 0 };
    this.anchors = { l: [], r: [] };
    this._m = Array.from({ length: BONE_COUNT }, () => new THREE.Matrix4());
    this._clsCache = new Map();
    this.reset();
    this._resolve();
    this._chest = this._collectChest();
    this._cloud = this.ok ? this._collectBody() : null;
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
      if (!b || b.name === 'root' || b.name === 'girdle' || b.group === 'trunk') return -1;
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
        // The arm is held further out from the shoulder: an elbow cannot bend sideways, so
        // bending the forearm out to clear the hip was a pose no arm can make.
        a2 = Math.asin(Math.min(0.45, need / Math.max(0.2, q.gh.y - q.wr.y)));
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
      pose[`upperarm.${side}`] = { quat: rotZ(m * (a1 + a2)) };
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

  /** What `followSkin` needs: which muscles, and which bones the hip's field may use. */
  /**
   * Fibre points of the muscles marked `spineBlend` are carried by the spine's blend at
   * their height instead of one trunk bone: the first bone in `aSkin`, the second in
   * `aSkin2` (bone, share). Their shift is still measured against the ribcage.
   */
  blendFibreTrunks(geom) {
    const P = geom.attributes.position, S = geom.attributes.aSkin;
    if (!P || !S) return 0;
    if (!geom.attributes.aSkin2) geom.setAttribute('aSkin2', new THREE.BufferAttribute(new Float32Array(P.count * 2), 2));
    const S2 = geom.attributes.aSkin2, slots = new Set(), t = [0, 0, 1];
    for (const side of SIDES) for (const def of ANCHORED) if (def.spineBlend) slots.add(anchorSlot(def, side));
    let n = 0;
    for (let i = 0; i < P.count; i++) {
      const z = S.getZ(i);
      if (z < 1.5 || z >= 2.999 || !slots.has(Math.round(S.getY(i)))) continue;
      this.trunkBind(P.getY(i), t);
      S.setX(i, t[0]);
      if (t[0] !== t[1] && t[2] < 0.999) S2.setXY(i, t[1], 1 - t[2]);
      n++;
    }
    S.needsUpdate = true; S2.needsUpdate = true;
    return n;
  }

  /** What `skinOverGirdle` (skinweld.js) needs to know about the shoulder girdles. */
  girdleSkinField() {
    const arm = new Set(), girdleSlots = new Set();
    for (const side of SIDES) {
      for (const seg of SEGMENTS) if (seg.group === 'arm' && seg.name !== 'girdle') arm.add(boneIndex(seg.name, side));
      for (const def of ANCHORED) if (def.limb === 'girdle') girdleSlots.add(anchorSlot(def, side));
    }
    const trunk = new Set([0, ...CENTRAL.map(n => boneIndex(n))]);
    return {
      girdle: { l: boneIndex('girdle', 'l'), r: boneIndex('girdle', 'r') },
      arm, trunk, girdleSlots,
    };
  }

  skinField() {
    return [
      {
        match: FOLLOW_SKIN,
        bones: new Set([0, boneIndex('lumbar'), boneIndex('thigh', 'l'), boneIndex('thigh', 'r')]),
        anchorBone: this.anchorBone,
        cap: { bones: [boneIndex('thigh', 'l'), boneIndex('thigh', 'r')], to_bone: 0,
          from: this.p.l.hip.y + HIP_CREST[0], to: this.p.l.hip.y + HIP_CREST[1] },
      },
    ];
  }

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
   * The skin of the trunk and legs as one sparse point cloud, each point tagged with the
   * bone that carries it: 0 trunk (with the head and neck), 1 and 2 the left and right
   * thigh, 3 and 4 the left and right shin. Every lift checks its bar against this, so a
   * bar can rest on the upper back, slide down the thighs or pass the face without ever
   * going into the body. The arms are left out, since they hold the bar, and so are the
   * feet, which stand on the floor.
   */
  _collectBody() {
    const ARM = /\barm\b|elbow|forearm|wrist|hand|palm|cubital|bicipital|radial foveola|deltoid region|^nail plate$|^perionyx$/i;
    const FOOT = /foot|sole|heel|hallucial|metatarsal|\(foot\)/i;
    const THIGH = /thigh|femoral triangle|knee|popliteal/i;
    const SHIN = /region of leg|ankle|malleol/i;
    const kneeY = this.p.l?.knee?.y ?? 0.5;
    const pts = [], tag = [];
    for (const [id, gs] of this._geoms) {
      const part = this.registry.byId.get(id);
      if (!part || part.sys !== 'integumentary' || (part.sx && part.sx !== 'm')) continue;
      if (ARM.test(part.n) || FOOT.test(part.n) || /eyelash|eyebrow/i.test(part.n)) continue;
      const leg = THIGH.test(part.n) || SHIN.test(part.n);
      for (const g of gs) {
        const pos = g.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
          pts.push(x, y, z);
          tag.push(leg ? (y > kneeY ? 1 : 3) + (x < 0 ? 1 : 0) : TRUNK_TAG[this.trunkBone(y)]);
        }
      }
    }
    return { pts: new Float32Array(pts), tag: new Int8Array(tag) };
  }

  /** The body cloud through this body's morph, redone only when the body changes. */
  _cloudMorphed() {
    const c = this._cloud;
    if (!c) return null;
    const key = morphKey();
    if (this._cloudKey === key) return this._cloudRest;
    const bones = CLOUD_BONES().map((b, i) => (i === 0 ? null : b));
    const out = new Float32Array(c.pts.length), v = new THREE.Vector3();
    for (let i = 0, k = 0; i < c.pts.length; i += 3, k++) {
      const b = bones[c.tag[k]];
      applyMorph(v.set(c.pts[i], c.pts[i + 1], c.pts[i + 2]), v, b == null ? { tissue: 'skin' } : { tissue: 'skin', bone: b });
      out[i] = v.x; out[i + 1] = v.y; out[i + 2] = v.z;
    }
    this._cloudKey = key; this._cloudRest = out;
    return out;
  }

  /** A bone's world matrix under `pose`, without applying the pose. */
  poseMatrix(pose, index, out = new THREE.Matrix4()) {
    const bone = this.bones[index];
    const key = bone.side ? `${bone.name}.${bone.side}` : bone.name;
    this.localMatrix(bone, pose[key], out);
    if (bone.parent >= 0) out.premultiply(this.poseMatrix(pose, bone.parent, new THREE.Matrix4()));
    return out;
  }

  /**
   * The trunk and leg skin where `pose` would put it, in the world. Worked out once per
   * pose, so a lift can ask many questions of it while it settles where the bar goes.
   */
  bodyCloud(pose) {
    const rest = this._cloudMorphed();
    if (!rest) return null;
    const tag = this._cloud.tag;
    const mats = CLOUD_BONES().map(i => this.poseMatrix(pose, i).elements);
    const out = new Float32Array(rest.length);
    for (let i = 0, k = 0; i < rest.length; i += 3, k++) {
      const m = mats[tag[k]], x = rest[i], y = rest[i + 1], z = rest[i + 2];
      out[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
      out[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
      out[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    }
    return { pts: out, tag };
  }

  /**
   * How far a bar lying along the world's x axis through `c` is from the skin: the gap
   * between the bar's surface and the nearest point of `cloud`, negative if it is inside.
   * `only` limits it to some of the tags, e.g. the trunk alone.
   */
  barGap(cloud, c, radius, only = null) {
    if (!cloud) return Infinity;
    const p = cloud.pts, tag = cloud.tag;
    let best = Infinity;
    for (let i = 0, k = 0; i < p.length; i += 3, k++) {
      if (only && !only.includes(tag[k])) continue;
      const dy = p[i + 1] - c.y;
      if (dy * dy >= best) continue;
      const dz = p[i + 2] - c.z, d2 = dy * dy + dz * dz;
      if (d2 < best) best = d2;
    }
    return Math.sqrt(best) - radius;
  }

  /** Where the hips are on a standing body of this size: halfway between the two hip joints. */
  hipCentre(out = new THREE.Vector3()) {
    return out.copy(this._morphed('l', 'hip')).add(this._morphed('r', 'hip')).multiplyScalar(0.5);
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
      this._resolveForearm(side, q);
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
    // The spine and neck, from the vertebrae themselves.
    const jointAt = (name) => {
      const [a, b, k] = SPINE_JOINTS[name];
      const A = this._centre(a), B = this._centre(b);
      if (!A || !B) return null;
      // The centre of a vertebra's box includes its spinous process, behind the body of the
      // vertebra that the spine actually bends about; the joint sits 2 cm further forward.
      const J = A.clone().lerp(B, k); J.x = 0; J.z += 0.02;
      if (name === 'head') J.y += 0.012;          // on top of the atlas, under the skull
      return J;
    };
    this.spine = {};
    for (const name of CENTRAL) {
      const J = jointAt(name);
      if (!J) { console.warn('[rig] spine joint missing', name); return; }
      this.spine[name] = J;
    }
    const top = new THREE.Vector3(0, this.spine.head.y + 0.19, 0);
    CENTRAL.forEach((name, i) => {
      const index = boneIndex(name);
      this.bones[index] = {
        name, side: null, index, group: 'trunk', radius: 0.2,
        parent: boneIndex(CENTRAL_PARENT[name]),
        pivot: this.spine[name], tail: i < CENTRAL.length - 1 ? this.spine[CENTRAL[i + 1]] : top,
      };
    });
    for (const side of SIDES) this.bones[boneIndex('girdle', side)].parent = boneIndex('thorax');
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

  /**
   * The elbow and the forearm, from the bones themselves.
   *
   * The elbow is a hinge across the lower end of the humerus: `el` is moved to the middle
   * of that end (the capsule's box sits 1.4 cm higher, and a hinge turned about the wrong
   * point slides the ulna off the humerus), and `hinge` runs from the inner to the outer
   * epicondyle, which is the bend's axis to within a few degrees.
   *
   * Turning the palm down does not twist the forearm: the ulna stays on the hinge and the
   * radius rolls round it, carrying the hand, about the line from the head of the radius
   * to the head of the ulna. `pron` is that line and `fm`, the pivot of the radius, is its
   * middle.
   */
  _resolveForearm(side, q) {
    const m = side === 'l' ? 1 : -1;
    q.hinge = new THREE.Vector3(m, 0, 0);
    q.pron = q.wr.clone().sub(q.el).normalize();
    q.fm = q.el.clone().lerp(q.wr, 0.5);
    const H = this._points(`skeletal:Humerus.${side}`), R = this._points(`skeletal:Radius.${side}`), U = this._points(`skeletal:Ulna.${side}`);
    if (!H || !R || !U) { console.warn('[rig] forearm bones missing', side); return; }
    // The arm hangs straight down at rest, so a bone's ends are its highest and lowest points.
    const end = (pts, frac, top) => {
      const sorted = pts.slice().sort((a, b) => (top ? b.y - a.y : a.y - b.y));
      const n = Math.max(1, Math.ceil(pts.length * frac)), c = new THREE.Vector3();
      for (let i = 0; i < n; i++) c.add(sorted[i]);
      return c.divideScalar(n);
    };
    q.el = end(H, 0.06, false);
    const lm = (name) => this.registry.parts.find(p => p.k === 'landmark' && p.n === name && p.pos && Math.sign(p.pos[0]) === m);
    const me = lm('Medial epicondyle of humerus'), le = lm('Lateral epicondyle of humerus');
    if (me && le) q.hinge = toGl(le.pos).sub(toGl(me.pos)).normalize();
    // Bending the elbow is a positive turn: it carries the wrist forwards.
    const fore = q.wr.clone().sub(q.el);
    if (fore.clone().applyAxisAngle(q.hinge, 0.3).z < fore.z) q.hinge.negate();
    const head = end(R, 0.04, true), ulnarHead = end(U, 0.04, false);
    q.pron = ulnarHead.clone().sub(head).normalize();
    q.fm = head.clone().lerp(ulnarHead, 0.5);
    // The knee is a hinge too, across the two condyles at the lower end of the femur.
    // Bending it is a positive turn: it carries the ankle backwards.
    q.kneeHinge = new THREE.Vector3(m, 0, 0);
    const mk = lm('Medial epicondyle of femur'), lk = lm('Lateral epicondyle of femur');
    if (mk && lk) q.kneeHinge = toGl(lk.pos).sub(toGl(mk.pos)).normalize();
    const shin = q.ankle.clone().sub(q.knee);
    if (shin.clone().applyAxisAngle(q.kneeHinge, 0.3).z > shin.z) q.kneeHinge.negate();
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

  /**
   * Which piece of the trunk a point outside the limbs moves with: pelvis, lower back,
   * upper back, neck or head, by its height, blended across a band at each joint so the
   * body bends there instead of shearing. [boneA, boneB, weightA], like any other binding.
   */
  trunkBind(y, out = [0, 0, 1]) {
    const sp = this.spine;
    if (!sp) { out[0] = 0; out[1] = 0; out[2] = 1; return out; }
    let below = 0;
    for (const name of CENTRAL) {
      const J = sp[name], band = SPINE_BAND[name], bone = boneIndex(name);
      if (y < J.y - band) { out[0] = below; out[1] = below; out[2] = 1; return out; }
      if (y < J.y + band) {
        const w = smoothstep(J.y - band, J.y + band, y);
        out[0] = bone; out[1] = below; out[2] = w;
        return out;
      }
      below = bone;
    }
    out[0] = below; out[1] = below; out[2] = 1;
    return out;
  }

  /** The single trunk bone a point is mostly carried by. */
  trunkBone(y) { const b = this.trunkBind(y); return b[2] >= 0.5 ? b[0] : b[1]; }

  /** A rigid part of the axial skeleton moves as one piece: which piece. */
  _rigidTrunkBone(part) {
    const chain = part.n + ' | ' + this.registry.ancestors(part.id).map(a => a.n).join(' | ');
    if (OF_PELVIS.test(chain)) return 0;
    if (OF_HEAD.test(chain)) return boneIndex('head');
    if (OF_THORAX.test(chain)) return boneIndex('thorax');
    if (!part.bb) return 0;
    return this.trunkBone((part.bb[0][2] + part.bb[1][2]) / 2);
  }

  bindVertex(x, y, z, out, mode, group, only = null, partSide = null) {
    // A sided part's points all go with its own limb: read off each point's position, the
    // strip of the left fascia lata that crosses the midline at the groin went with the
    // right thigh.
    const side = partSide || (x >= 0 ? 'l' : 'r');
    this._bindVertex(x, y, z, out, mode, group, only, side);
    if (group !== 'leg') return out;
    // Above the hip joint, on the outer side of the hip, the thigh lets go (see HIP_CREST).
    // Behind and inside the joint the thigh's own blend already does.
    const hip = this.p[side].hip, hipY = hip.y;
    if (y <= hipY + HIP_CREST[0]) return out;
    const outer = smoothstep(0, 0.04, Math.abs(x) - Math.abs(hip.x));
    if (outer <= 0) return out;
    const thigh = boneIndex('thigh', side), w = Math.min(1, out[2]);
    const share = (out[0] === thigh ? w : 0) + (w < 1 && out[1] === thigh ? 1 - w : 0);
    if (share <= 0) return out;
    const keep = share * (1 - outer * smoothstep(hipY + HIP_CREST[0], hipY + HIP_CREST[1], y)), trunk = this.trunkBone(y);
    if (keep <= 0.001) { out[0] = trunk; out[1] = trunk; out[2] = 1; }
    else { out[0] = thigh; out[1] = trunk; out[2] = keep; }
    return out;
  }

  _bindVertex(x, y, z, out, mode, group, only = null, side = x >= 0 ? 'l' : 'r') {
    let { best, d: bestD, t: bestT } = this._nearest(x, y, z, side, group, only);
    // A point whose nearest spot on its segment is the far end lies beyond that joint, so it
    // belongs to the next segment along, measured along that one. Chosen by distance alone,
    // points on the calf just below the knee went to the thigh (its envelope is wider) while
    // their neighbours went to the shin, and a bent knee tore the calf into spikes.
    if (best >= 0 && bestT >= 0.999) {
      const seg = SEGMENTS[best];
      const ci = this.byGroup[group].find(i => SEGMENTS[i].parent === seg.name && SEGMENTS[i].from === seg.to
        && (!only || only.has(SEGMENTS[i].name)));
      if (ci !== undefined) {
        const c = this._segDist(x, y, z, this.p[side], SEGMENTS[ci]);
        if (c.t > 0 && c.d < Math.max(1, bestD * 1.6)) { best = ci; bestT = c.t; bestD = c.d; }
      }
    }
    // Only a spanning structure can fall out of the limb; a limb structure binds to its
    // nearest bone however far from the axis it sits.
    if (best < 0 || (mode === 'span' && bestD > 1)) return this.trunkBind(y, out);

    const seg = SEGMENTS[best];
    const bone = boneIndex(seg.name, side);
    // Before the limb starts: a point on the trunk side of the hip joint (or inboard of the
    // collarbone's inner end) belongs to the trunk, fading over 6 cm. The thigh's envelope
    // reaches up into the pelvis, and without this the pelvic stretch of the sciatic nerve
    // followed the thigh: a bent hip swung it out of the pelvis in long straight lines.
    let before = 1;
    if (!seg.parent && bestT <= 0.001) {
      const q = this.p[side], a = q[seg.from], b2 = q[seg.to];
      const ax = b2.x - a.x, ay = b2.y - a.y, az = b2.z - a.z, L = Math.hypot(ax, ay, az);
      const along = ((x - a.x) * ax + (y - a.y) * ay + (z - a.z) * az) / L;
      if (along < 0) before = smoothstep(-0.06, 0, along);
    }
    // Blend across the joint at either end of this segment, so a bent elbow or a curled
    // finger creases instead of shearing.
    const BLEND = 0.26;                        // as a fraction of the segment's length
    let other = bone, w = 1;
    if (bestT < BLEND) {
      // A limb's first segment blends onto what it hangs from: the pelvis for the thigh,
      // the upper back for the shoulder girdle.
      other = seg.parent && (!only || only.has(seg.parent)) ? boneIndex(seg.parent, side)
        : (seg.parent ? this.trunkBone(y) : this.bones[bone].parent);
      w = (0.5 + 0.5 * (bestT / BLEND)) * before;
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
      out[1] = this.trunkBone(y);
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
    if (cls.mode !== 'none' || !TUBULAR.has(part.sys) || !part.bb || GENITAL.test(part.n)) return cls;
    // Vessels, nerves and lymphatics are named after where they come from, not where they
    // run, so the hierarchy rarely places them in a limb. Let the geometry decide — but it
    // needs a gate first. In anatomical position the arm lies flat against the ribcage and
    // the thigh sits right under the pelvic floor, so a limb envelope reaches well inside
    // the trunk: the lung's own arteries score as "mostly inside the shoulder" and the
    // pelvic veins as "mostly inside the thigh". A structure only counts as belonging to a
    // limb if it actually reaches out of the trunk along it.
    // Any real share inside the limb counts: the femoral nerve lies mostly in the pelvis,
    // and left wholly on the trunk its thigh part stayed behind when the thigh moved and
    // stuck out of the leg. Point by point, each part follows where it actually is.
    // The arm keeps a high bar: it hangs flat against the ribcage in the source pose, so
    // nerves between the ribs sit partly inside its reach without belonging to it.
    const NEED = { arm: 0.5, leg: 0.08 };
    let bestGroup = null, bestShare = 0;
    for (const g of ['arm', 'leg']) {
      if (!REACHES_INTO[g](part.bb)) continue;
      const share = this.insideFraction(geom, g);
      if (share > NEED[g] && share > bestShare) { bestShare = share; bestGroup = g; }
    }
    if (!bestGroup) return cls;
    return { group: bestGroup, mode: bestShare > 0.9 ? 'limb' : 'span' };
  }

  /** Per-vertex (boneA, boneB, weightA) for one geometry. */
  skinGeometry(geom, part) {
    const n = geom.attributes.position.count;
    const arr = new Float32Array(n * 3);
    const anchor = this.ok ? this._anchorDef(part) : null;
    if (anchor) return this._skinAnchored(geom, anchor, arr, part.side);
    if (this.ok && part.sys === 'muscular' && part.side && GIRDLE_BLEND.test(part.n)) {
      const blend = this._skinGirdleBlend(geom, part, arr);
      if (blend) return blend;
    }
    const cls = this.ok ? this.resolveBinding(geom, part) : { mode: 'none' };
    const pos = geom.attributes.position;
    if (cls.mode === 'none') {
      if (!this.ok) { for (let i = 0; i < n; i++) arr[i * 3 + 2] = 1; return new THREE.BufferAttribute(arr, 3); }
      // The trunk. A bone moves as one piece with its part of the spine; soft tissue bends
      // smoothly across each joint of the spine and neck.
      if (part.sys === 'skeletal') {
        const b = this._rigidTrunkBone(part);
        for (let i = 0; i < n; i++) { arr[i * 3] = b; arr[i * 3 + 1] = b; arr[i * 3 + 2] = 1; }
        return new THREE.BufferAttribute(arr, 3);
      }
      const t = [0, 0, 1];
      for (let i = 0; i < n; i++) {
        this.trunkBind(pos.getY(i), t);
        arr[i * 3] = t[0]; arr[i * 3 + 1] = t[1]; arr[i * 3 + 2] = t[2];
      }
      return new THREE.BufferAttribute(arr, 3);
    }
    const out = [0, 0, 1];
    for (let i = 0; i < n; i++) {
      this.bindVertex(pos.getX(i), pos.getY(i), pos.getZ(i), out, cls.mode, cls.group, cls.only, part.side || null);
      arr[i * 3] = out[0]; arr[i * 3 + 1] = out[1]; arr[i * 3 + 2] = out[2];
    }
    // A bone is rigid. Bound point by point, its ends blended with the next bone over, so
    // a bent hip bent the head of the femur, and the lower corner of the shoulder blade,
    // lying nearer the upper arm's line than the shoulder girdle's, went with the arm and
    // tore the blade when the arms reached down. So each bone moves as one piece: the
    // shoulder blade and collarbone with the girdle, the rest with whichever segment holds
    // most of it. The ulna stays on the elbow's hinge and the radius rolls round it (see
    // `_resolveForearm`); blended, they had bent like rubber and the head of the radius
    // came 4 cm out of the elbow.
    if (part.sys !== 'skeletal' && cls.group === 'arm') this._forearmTurn(geom, arr);
    if (part.sys === 'skeletal' && cls.mode === 'limb') {
      let bone;
      // The long bones by name: a bone can arrive as several pieces, and a vote taken piece
      // by piece gave the lower end of the humerus to the forearm.
      const OWN = [[/scapula|clavicle/i, 'girdle'], [/humerus/i, 'upperarm'], [/^ulna$/i, 'forearm1'], [/^radius$/i, 'forearm2'],
        [/femur/i, 'thigh'], [/tibia|fibula|patella/i, 'shin']];
      const own = OWN.find(([re]) => re.test(part.n));
      if (own) {
        let sx = 0;
        for (let i = 0; i < n; i++) sx += pos.getX(i);
        bone = boneIndex(own[1], sx >= 0 ? 'l' : 'r');
      } else {
        const votes = new Map();
        for (let i = 0; i < n; i++) {
          const b = arr[i * 3 + 2] >= 0.5 ? arr[i * 3] : arr[i * 3 + 1];
          votes.set(b, (votes.get(b) || 0) + 1);
        }
        bone = [...votes.entries()].sort((a, b) => b[1] - a[1])[0][0];
      }
      for (let i = 0; i < n; i++) { arr[i * 3] = bone; arr[i * 3 + 1] = bone; arr[i * 3 + 2] = 1; }
    }
    return new THREE.BufferAttribute(arr, 3);
  }

  /**
   * Weight every vertex by its distance from the muscle's insertion: fully with the limb
   * within `near` of the tendon, fully with the trunk beyond `far`, smooth in between.
   */
  /**
   * Soft tissue in the forearm turns with the radius by how far down the forearm it lies:
   * not at all at the elbow, fully at the wrist, the way skin and muscle spiral round a
   * forearm turning the palm down. Only points carried by the forearm alone change; the
   * blends onto the upper arm at the elbow and the hand at the wrist are kept.
   */
  _forearmTurn(geom, arr) {
    const pos = geom.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const side = pos.getX(i) >= 0 ? 'l' : 'r', q = this.p[side];
      const f1 = boneIndex('forearm1', side), f2 = boneIndex('forearm2', side);
      const a = arr[i * 3], b = arr[i * 3 + 1], w = arr[i * 3 + 2];
      if ((a !== f1 && a !== f2) || (w < 0.999 && b !== f1 && b !== f2)) continue;
      const ax = q.wr.x - q.el.x, ay = q.wr.y - q.el.y, az = q.wr.z - q.el.z, L2 = ax * ax + ay * ay + az * az;
      const t = ((pos.getX(i) - q.el.x) * ax + (pos.getY(i) - q.el.y) * ay + (pos.getZ(i) - q.el.z) * az) / L2;
      const turn = smoothstep(0.08, 0.92, t);
      arr[i * 3] = f2; arr[i * 3 + 1] = f1; arr[i * 3 + 2] = turn;
    }
  }

  _skinAnchored(geom, def, arr, partSide = null) {
    // Which side's insertion a point belongs to is its muscle's side. Read off the point's
    // own position, the strip of the left lat that crosses the midline of the back went
    // with the right arm, and the two lats tore apart along the spine.
    const sideOf = (x) => partSide || (x >= 0 ? 'l' : 'r');
    const pos = geom.attributes.position;
    const pt = new THREE.Vector3();
    const anchorOf = { l: this.anchors.l.find(e => e.def === def), r: this.anchors.r.find(e => e.def === def) };
    // The landmark sits on the bone's surface, and the muscle mesh often stops a few
    // centimetres short of it: the tendon's last stretch is not modelled. Measured from the
    // landmark alone, no vertex would ever reach full weight, and the muscle's end would
    // trail behind the arm. So the ramp starts from this muscle's own closest point.
    const closest = { l: Infinity, r: Infinity };
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), side = sideOf(x), a = anchorOf[side];
      if (!a) continue;
      pt.set(x, pos.getY(i), pos.getZ(i));
      closest[side] = Math.min(closest[side], pt.distanceTo(a.point));
    }
    if (def.mode === 'fibre') return this._skinFibre(geom, def, arr, anchorOf, closest, sideOf);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const side = sideOf(x);
      const a = anchorOf[side];
      if (!a) { arr[i * 3] = 0; arr[i * 3 + 1] = 0; arr[i * 3 + 2] = 1; continue; }
      pt.set(x, pos.getY(i), pos.getZ(i));
      const near = Math.max(def.near, closest[side] + 0.01);
      const far = Math.max(def.far, near + 0.08);
      const w = smoothstep(far, near, pt.distanceTo(a.point));
      arr[i * 3] = boneIndex(def.limb, side);
      arr[i * 3 + 1] = def.trunk === 'root' ? this.trunkBone(pt.y) : boneIndex(def.trunk, side);
      arr[i * 3 + 2] = w;
    }
    return new THREE.BufferAttribute(arr, 3);
  }

  /**
   * A sheet of muscle from the trunk onto the shoulder blade, blended between the two by how
   * far along it each point sits: 0 where it is fixed, 1 where it meets the girdle's bones.
   *
   * Where it is fixed comes from the atlas: its attachments on the trunk's bones (the ribs
   * for serratus anterior and pectoralis minor). The trapezius and the rhomboids arise from
   * the spinous processes, which the atlas does not mark, so their edge on the midline
   * counts too. And seen from where the muscle meets the girdle, its far edge in each
   * direction is where its fibres begin: serratus anterior has eight slips on the ribs, and
   * the atlas marks only three.
   *
   * How far along is measured to the girdle's bones themselves, not to one point, because
   * these insert along a whole edge of the shoulder blade.
   */
  _skinGirdleBlend(geom, part, arr) {
    const side = part.side, pos = geom.attributes.position, n = pos.count;
    const flat = (pts, max = 3000) => {
      const step = Math.max(1, Math.floor(pts.length / max)), out = [];
      for (let k = 0; k < pts.length; k += step) out.push(pts[k].x, pts[k].y, pts[k].z);
      return new Float32Array(out);
    };
    const nearest = (f, x, y, z) => {
      let best = Infinity;
      for (let k = 0; k < f.length; k += 3) {
        const dx = f[k] - x, dy = f[k + 1] - y, dz = f[k + 2] - z, d = dx * dx + dy * dy + dz * dz;
        if (d < best) best = d;
      }
      return Math.sqrt(best);
    };
    const bones = [...(this._points(`skeletal:Scapula.${side}`) || []), ...(this._points(`skeletal:Clavicle.${side}`) || [])];
    if (!bones.length) return null;
    const girdleBones = flat(bones, 4000);
    const fixedPts = [], meetPts = [];
    for (const a of this.registry.parts) {
      if ((a.k !== 'origin' && a.k !== 'insertion') || a.side !== side || a.muscle !== part.n) continue;
      const pts = this._points(a.id);
      if (pts) (/scapula|clavicle/i.test(a.bone || '') ? meetPts : fixedPts).push(...pts);
    }
    const toBone = new Float32Array(n);
    for (let i = 0; i < n; i++) toBone[i] = nearest(girdleBones, pos.getX(i), pos.getY(i), pos.getZ(i));
    // Where the muscle meets the girdle, as one point to look out from.
    const meet = new THREE.Vector3();
    if (meetPts.length) { for (const v of meetPts) meet.add(v); meet.divideScalar(meetPts.length); }
    else {
      let c = 0;
      for (let i = 0; i < n; i++) if (toBone[i] < 0.012) { meet.x += pos.getX(i); meet.y += pos.getY(i); meet.z += pos.getZ(i); c++; }
      if (!c) return null;
      meet.divideScalar(c);
    }
    // Its far edge in each direction, seen from there (the same rule as `_skinFibre`).
    const BINS = 10;
    const binOf = (dx, dy, dz) => {
      const l = Math.abs(dx) + Math.abs(dy) + Math.abs(dz) || 1;
      let u = dx / l, v = dy / l;
      if (dz < 0) { const ou = u; u = (1 - Math.abs(v)) * (ou >= 0 ? 1 : -1); v = (1 - Math.abs(ou)) * (v >= 0 ? 1 : -1); }
      return Math.min(BINS - 1, Math.floor((u * 0.5 + 0.5) * BINS)) * BINS + Math.min(BINS - 1, Math.floor((v * 0.5 + 0.5) * BINS));
    };
    const dist = new Float32Array(n), bin = new Int16Array(n), reach = new Float32Array(BINS * BINS);
    let farthest = 0;
    for (let i = 0; i < n; i++) {
      const dx = pos.getX(i) - meet.x, dy = pos.getY(i) - meet.y, dz = pos.getZ(i) - meet.z;
      dist[i] = Math.hypot(dx, dy, dz); bin[i] = binOf(dx, dy, dz);
      reach[bin[i]] = Math.max(reach[bin[i]], dist[i]); farthest = Math.max(farthest, dist[i]);
    }
    // Nothing lying on the girdle's bones is a start, though: serratus anterior inserts all
    // along the inner edge of the shoulder blade, and seen from the middle of that edge its
    // lower corner is a far edge too. Counted as a start, the muscle there went from the
    // girdle to the ribs between neighbouring points and tore round the corner.
    const fixedFlat = flat(fixedPts, 3000);
    const start = [];
    for (let i = 0; i < n; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), r = reach[bin[i]];
      if (toBone[i] < 0.03) continue;
      if (Math.abs(x) < 0.015 || (r >= 0.4 * farthest && dist[i] >= r - 0.012)
        || (fixedFlat.length && nearest(fixedFlat, x, y, z) < 0.01)) start.push(new THREE.Vector3(x, y, z));
    }
    if (!start.length) return null;
    const startFlat = flat(start, 1500);
    const girdle = boneIndex('girdle', side), t = [0, 0, 1];
    for (let i = 0; i < n; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      // The muscle sits a centimetre or so off the bone it inserts on.
      const a = nearest(startFlat, x, y, z), b = Math.max(0, toBone[i] - 0.012);
      const f = a + b > 1e-6 ? a / (a + b) : 1;
      if (f < 0.01) { this.trunkBind(y, t); arr[i * 3] = t[0]; arr[i * 3 + 1] = t[1]; arr[i * 3 + 2] = t[2]; continue; }
      arr[i * 3] = girdle; arr[i * 3 + 1] = this.trunkBone(y); arr[i * 3 + 2] = Math.min(1, f);
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
   *
   * Some of a muscle runs on past its insertion, down along the bone (the lower glute did,
   * on its way to the iliotibial tract, when it was bound this way). Shifted with the
   * insertion but not turned, that tissue kept pointing the old way when the joint folded,
   * and stuck out in spikes. It turns with the bone
   * instead, encoded as 3 + share (0 = stretches with the insertion, 1 = rides the bone),
   * blending in over the first few centimetres past the insertion.
   */
  _skinFibre(geom, def, arr, anchorOf, closest, sideOf) {
    const pos = geom.attributes.position;
    const pt = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3();
    // The way the fibres run on each side: from the middle of the muscle to its insertion.
    // "Past the insertion" is measured along this, so the belly of a muscle that happens to
    // lie beside its bone (the lat next to a hanging arm) is never taken for tendon.
    const [j0, j1] = LIMB_AXIS[def.limb];
    const mid = { l: new THREE.Vector3(), r: new THREE.Vector3() }, count = { l: 0, r: 0 };
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), side = sideOf(x);
      if (!anchorOf[side]) continue;
      mid[side].x += x; mid[side].y += pos.getY(i); mid[side].z += pos.getZ(i); count[side]++;
    }
    const along = {};
    for (const side of SIDES) {
      const a = anchorOf[side], q = this.p[side];
      if (!a || !count[side]) continue;
      mid[side].divideScalar(count[side]);
      along[side] = { dir: a.point.clone().sub(mid[side]).normalize(), bone: new THREE.Line3(q[j0].clone(), q[j1].clone()) };
    }
    // How far along its fibre each point sits: 0 where the muscle starts on the trunk, 1 at
    // the tendon. Measured as plain distance from the insertion against the muscle's
    // farthest point, the lat's start on the spine counted as halfway along, because its
    // corner on the hip bone lies further off; it slid 3 to 5 cm out of the back when the
    // humerus turned. So the start is found in each direction: seen from the insertion, the
    // muscle's far edge that way is where its fibres begin. Directions in which the muscle
    // ends close to the insertion (round the tendon) have no start of their own.
    const BINS = 10;
    const binOf = (dx, dy, dz) => {
      const l = Math.abs(dx) + Math.abs(dy) + Math.abs(dz) || 1;
      let u = dx / l, v = dy / l;
      if (dz < 0) { const ou = u; u = (1 - Math.abs(v)) * (ou >= 0 ? 1 : -1); v = (1 - Math.abs(ou)) * (v >= 0 ? 1 : -1); }
      return Math.min(BINS - 1, Math.floor((u * 0.5 + 0.5) * BINS)) * BINS + Math.min(BINS - 1, Math.floor((v * 0.5 + 0.5) * BINS));
    };
    const dist = new Float32Array(pos.count), bin = new Int16Array(pos.count);
    const reach = { l: new Float32Array(BINS * BINS), r: new Float32Array(BINS * BINS) }, farthest = { l: 0, r: 0 };
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), side = sideOf(x), a = anchorOf[side];
      if (!a) continue;
      const dx = x - a.point.x, dy = pos.getY(i) - a.point.y, dz = pos.getZ(i) - a.point.z;
      dist[i] = Math.hypot(dx, dy, dz); bin[i] = binOf(dx, dy, dz);
      reach[side][bin[i]] = Math.max(reach[side][bin[i]], dist[i]);
      farthest[side] = Math.max(farthest[side], dist[i]);
    }
    // Any part of the muscle on the body's midline is on its start too: the lat's line
    // along the spine, the pec's along the breastbone.
    const start = { l: [], r: [] };
    for (let i = 0; i < pos.count && def.start; i++) {
      const x = pos.getX(i), side = sideOf(x), r = reach[side][bin[i]];
      if (!anchorOf[side]) continue;
      if (Math.abs(x) < 0.015 || (r >= 0.4 * farthest[side] && dist[i] >= r - 0.012)) start[side].push(i);
    }
    // A few hundred of them, in a flat array, are plenty to measure against and quick to search.
    const starts = {};
    for (const side of SIDES) {
      const list = start[side], step = Math.max(1, Math.floor(list.length / 400)), flat = [];
      for (let k = 0; k < list.length; k += step) flat.push(pos.getX(list[k]), pos.getY(list[k]), pos.getZ(list[k]));
      starts[side] = new Float32Array(flat);
    }
    const nearestStart = (side, x, y, z) => {
      const f = starts[side];
      let best = Infinity;
      for (let k = 0; k < f.length; k += 3) {
        const dx = f[k] - x, dy = f[k + 1] - y, dz = f[k + 2] - z, d = dx * dx + dy * dy + dz * dz;
        if (d < best) best = d;
      }
      return Math.sqrt(best);
    };
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), side = sideOf(x), a = anchorOf[side];
      const trunk = trunkOf(def, side);
      if (!a) { arr[i * 3] = trunk; arr[i * 3 + 1] = 0; arr[i * 3 + 2] = 1; continue; }
      pt.set(x, pos.getY(i), pos.getZ(i));
      const toEnd = Math.max(0, dist[i] - closest[side]);
      let f;
      if (def.start) {
        let toStart = nearestStart(side, pt.x, pt.y, pt.z);
        if (!Number.isFinite(toStart)) toStart = farthest[side];
        f = toStart + toEnd > 1e-6 ? toStart / (toStart + toEnd) : 1;
      } else {
        // The small fans round the hip turn with the thigh about a joint they wrap closely;
        // plain distance from the insertion suits them.
        f = Math.min(1, Math.max(0, 1 - toEnd / Math.max(0.02, farthest[side] - closest[side])));
      }
      // How far past the insertion, along the fibres, and how close to the bone itself.
      const past = _d.copy(pt).sub(a.point).dot(along[side].dir);
      const onBone = smoothstep(0.06, 0.035, pt.distanceTo(along[side].bone.closestPointToPoint(pt, true, _e)));
      f = Math.max(f, smoothstep(-0.03, 0.0, past) * onBone);   // all the way by the insertion, where riding takes over
      const ride = smoothstep(0.0, 0.04, past) * onBone;
      arr[i * 3] = trunk;
      arr[i * 3 + 1] = anchorSlot(def, side);
      arr[i * 3 + 2] = ride > 0.001 ? 3 + ride : 2 + f;
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
        const trunk = this._m[trunkOf(e.def, side)];
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
    this.crease.J.fill(0);
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
  skinPoint(a, b, w, v, mask = 0, c = 0, wc = 0) {
    const rest = _creaseRest.copy(v);
    if (wc > 0 && w < 1.5) this._skin3(a, b, w, c, wc, v);
    else this._skin(a, b, w, v, wc > 0 ? c : -1, wc);
    return this.creasePoint(rest, v, a, b, w, mask);
  }

  /** The skin's three-bone blend: `a` and `b` as usual, then `c` taking a share `wc` of the whole. */
  _skin3(a, b, w, c, wc, v) {
    const R = this.dqReal, D = this.dqDual;
    const q = [0, 0, 0, 0], d = [0, 0, 0, 0];
    const add = (bone, k, ref) => {
      let s = k;
      if (ref && R[bone * 4] * ref[0] + R[bone * 4 + 1] * ref[1] + R[bone * 4 + 2] * ref[2] + R[bone * 4 + 3] * ref[3] < 0) s = -k;
      for (let j = 0; j < 4; j++) { q[j] += s * R[bone * 4 + j]; d[j] += s * D[bone * 4 + j]; }
    };
    const wa = Math.min(1, Math.max(0, w));
    add(a, wa * (1 - wc), null);
    add(b, (1 - wa) * (1 - wc), [R[a * 4], R[a * 4 + 1], R[a * 4 + 2], R[a * 4 + 3]]);
    add(c, wc, q.slice());
    const len = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
    const [q0, q1, q2, q3] = q.map(x => x / len), [d0, d1, d2, d3] = d.map(x => x / len);
    const x = v.x, y = v.y, z = v.z;
    const cx = q1 * z - q2 * y + q3 * x, cy = q2 * x - q0 * z + q3 * y, cz = q0 * y - q1 * x + q3 * z;
    const rx = x + 2 * (q1 * cz - q2 * cy), ry = y + 2 * (q2 * cx - q0 * cz), rz = z + 2 * (q0 * cy - q1 * cx);
    const tx = 2 * (q3 * d0 - d3 * q0 + (q1 * d2 - q2 * d1));
    const ty = 2 * (q3 * d1 - d3 * q1 + (q2 * d0 - q0 * d2));
    const tz = 2 * (q3 * d2 - d3 * q2 + (q0 * d1 - q1 * d0));
    return v.set(rx + tx, ry + ty, rz + tz);
  }

  _skin(a, b, w, v, c = -1, wc = 0) {
    if (w >= 2.999) {
      // Past the insertion: blend from stretching with it to turning with the bone.
      const g = w - 3, s = b * 3, k = 1 - g;
      this._skin(this.anchorBone[b], a, g, v);
      return v.set(v.x + k * this.anchorDisp[s], v.y + k * this.anchorDisp[s + 1], v.z + k * this.anchorDisp[s + 2]);
    }
    if (w >= 1.5) {
      // Fibre vertex: carried by its trunk bone, then shifted by its share of the stretch.
      const f = w - 2, s = b * 3;
      const rx = v.x, rz = v.z;
      if (c >= 0 && wc > 0) this._skin3(a, a, 1, c, wc, v); else this._skin(a, a, 1, v);
      let dx = f * this.anchorDisp[s], dy = f * this.anchorDisp[s + 1], dz = f * this.anchorDisp[s + 2];
      if (this.anchorWall[b]) {
        const n = _wallN.set(rx, 0, rz - WALL_Z);
        if (n.lengthSq() > 1e-8) {
          n.normalize().transformDirection(this._m[a]);
          const out = dx * n.x + dy * n.y + dz * n.z, keep = 1 - smoothstep(WALL_FREE[0], WALL_FREE[1], f);
          if (out > 0) { dx -= keep * out * n.x; dy -= keep * out * n.y; dz -= keep * out * n.z; }
        }
      }
      return v.set(v.x + dx, v.y + dy, v.z + dz);
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
      const key = bone.side ? `${bone.name}.${bone.side}` : bone.name;
      this.localMatrix(bone, pose[key], local);
      if (bone.parent >= 0) this._m[i].multiplyMatrices(this._m[bone.parent], local);
      else this._m[i].copy(local);
      this._m[i].toArray(this.matrices, i * 16);
      this._writeDual(i, this._m[i]);
    }
    this._writeAnchors();
    this._writeCreases();
    this.enabled.value = 1;
  }

  /**
   * For the creases that hold back only the lower bone's tissue: skin points of the trunk
   * just over each thigh, which decide where the contact sits in each pose.
   */
  collectCreaseSamples(skin, partAt) {
    const P = skin.attributes.position, S = skin.attributes.aSkin, M = skin.attributes.aMorphMask, A = skin.attributes.aPartIndex;
    this.creaseSamples = {};
    CREASES.forEach((c, ci) => {
      if (!c.thighOnly) return;
      for (const side of SIDES) {
        const J = this.p[side][c.at], low = boneIndex(c.dist[0], side), out = [];
        for (let i = 0; i < P.count; i++) {
          const part = partAt(A.getX(i));
          if (!part || (part.sx && part.sx !== 'm') || /hair|nail/i.test(part.n)) continue;
          const a = S.getX(i), b = S.getY(i), w = Math.min(1, S.getZ(i));
          const share = (a === low ? w : 0) + (w < 1 && b === low ? 1 - w : 0);
          if (share > 0.15) continue;
          const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
          if (Math.abs(x - J.x) > 0.08 || z < J.z + 0.02 || y < J.y - 0.03 || y > J.y + 0.2) continue;
          out.push([x, y, z, a, b, S.getZ(i), M ? M.getX(i) : 1]);
        }
        const step = Math.max(1, Math.floor(out.length / 300));
        this.creaseSamples[ci + side] = out.filter((_, k) => k % step === 0);
      }
    });
  }

  /** Where each crease's contact plane is in this pose. See CREASES. */
  _writeCreases() {
    const C = this.crease;
    const J = new THREE.Vector3(), P = new THREE.Vector3(), D = new THREE.Vector3();
    const rj = new THREE.Vector3(), rp = new THREE.Vector3(), rd = new THREE.Vector3();
    const m = new THREE.Vector3(), b = new THREE.Vector3();
    CREASES.forEach((c, ci) => SIDES.forEach((side, si) => {
      const k = (ci * 2 + si) * 4;
      const prox = c.prox === 'root' ? 0 : boneIndex(c.prox, side), dist = boneIndex(c.dist[0], side);
      C.J[k + 3] = 0;
      if (!this.p[side]?.[c.at]) return;
      this.morphedJoint(side, c.at, rj); this.morphedJoint(side, c.to, rd);
      if (c.up) rp.set(...c.up).multiplyScalar(0.2).add(rj);
      else this.morphedJoint(side, c.from, rp);
      // The joint and the far end of the lower bone move with the lower bone; the upper
      // joint with the upper bone.
      J.copy(rj).applyMatrix4(this._m[dist]);
      P.copy(rp).applyMatrix4(this._m[prox]).sub(J).normalize();
      D.copy(rd).applyMatrix4(this._m[boneIndex(c.dist[c.dist.length - 1], side)]).sub(J).normalize();
      b.copy(P).add(D);
      const bend = b.length();
      // Nearly straight, there is no inside of the bend and no crease.
      if (bend < 0.12) return;
      b.divideScalar(bend);
      m.copy(P).sub(D).normalize();
      // At rest: the plane's normal along the straight limb, the hinge axis (the same line
      // in both bones, so the posed axis turned back by the lower bone), and the side of the
      // straight limb that becomes the inside of the bend.
      const restM = rp.clone().sub(rj).normalize().sub(rd.clone().sub(rj).normalize()).normalize();
      const back = new THREE.Quaternion().setFromRotationMatrix(this._m[dist]).invert();
      const h = new THREE.Vector3().crossVectors(P, D).normalize();
      const hr = h.clone().applyQuaternion(back);
      const rn = b.clone().applyQuaternion(back);
      rn.addScaledVector(restM, -rn.dot(restM)).addScaledVector(hr, -rn.dot(hr)).normalize();
      C.J.set([J.x, J.y, J.z, 1], k);
      C.M.set([m.x, m.y, m.z, c.squeeze], k);
      C.B.set([b.x, b.y, b.z, c.reach], k);
      C.H.set([h.x, h.y, h.z, Math.sqrt(Math.max(0.05, 1 - (bend / 2) ** 2))], k);
      C.RJ.set([rj.x, rj.y, rj.z, c.thighOnly ? 1 : 0], k);
      C.RM.set([restM.x, restM.y, restM.z, c.bowstring ? 1 : 0], k);
      C.RH.set([hr.x, hr.y, hr.z, 0], k);
      // Where the contact sits along the plane's normal: through the joint, or for the hip
      // at the underside of the belly over this thigh.
      let offset = 0;
      const samples = c.thighOnly && this.creaseSamples?.[ci + side];
      if (samples?.length) {
        const v = new THREE.Vector3(), o = new THREE.Vector3(), all = [];
        for (const [x, y, z, sa, sbn, sw, mask] of samples) {
          v.set(x, y, z);
          this.morphVertex(v, o, sa, sbn, sw, mask);
          this._skin(sa, sbn, sw, o);
          o.sub(J);
          if (o.dot(b) > 0) all.push(o.dot(m));
        }
        all.sort((p, q) => p - q);
        if (all.length) offset = Math.max(-0.025, Math.min(0, all[Math.floor(all.length * 0.05)]));
      }
      C.RN.set([rn.x, rn.y, rn.z, offset], k);
      C.Bone.set([prox, dist, c.dist[1] ? boneIndex(c.dist[1], side) : c.also ? boneIndex(c.also) : dist, 0], k);
    }));
  }

  /**
   * The crease contact, on the CPU, exactly as the shader does it. `rest` is the point
   * before posing (after the morph), `v` the posed point, changed in place.
   */
  creasePoint(rest, v, a, b, w, mask = 0) {
    // Fibre-bound muscles (the lats, pecs and the psoas deep in front of the hip) stretch
    // along their own fibres and are left out: pushed by the hip's contact, the psoas was
    // driven out through the skin of the groin.
    if (!this.enabled.value || w > 1.5 || (mask & 4)) return v;
    const C = this.crease;
    for (let k = 0; k < CREASE_SLOTS * 4; k += 4) {
      if (C.J[k + 3] < 0.5) continue;
      const on = (x) => x === C.Bone[k] || x === C.Bone[k + 1] || x === C.Bone[k + 2];
      if (!on(a) || (w < 0.999 && !on(b))) continue;
      const rx = rest.x - C.RJ[k], ry = rest.y - C.RJ[k + 1], rz = rest.z - C.RJ[k + 2];
      if (rx * rx + ry * ry + rz * rz > C.B[k + 3] * C.B[k + 3]) continue;
      // How much of this point the lower bone carries.
      const low = (a === C.Bone[k + 1] ? Math.min(1, w) : 0) + (w < 0.999 && b === C.Bone[k + 1] ? 1 - w : 0);
      let side = rx * C.RM[k] + ry * C.RM[k + 1] + rz * C.RM[k + 2] >= 0 ? 1 : -1, hold = 1;
      if (C.RJ[k + 3] > 0.5) {                     // only the lower bone's tissue is held back
        if (low < 0.35) continue;
        side = -1; hold = smoothstep(0.35, 0.65, low);
      }
      let dx = v.x - C.J[k], dy = v.y - C.J[k + 1], dz = v.z - C.J[k + 2];
      const sb = dx * C.B[k] + dy * C.B[k + 1] + dz * C.B[k + 2];
      if (sb <= 0) continue;
      // The bowstring: shared tissue out to the corner of the crease.
      const up = a === C.Bone[k] ? Math.min(1, w) : 0, share = up + (w < 0.999 && b === C.Bone[k] ? 1 - w : 0);
      const even = C.RM[k + 3] > 0.5 ? 4 * share * (1 - share) : 0;
      if (even > 0.001) {
        // How deep under the surface of the bend this tissue lies: its distance from the
        // straight limb's axis at rest, leaving out the hinge's own direction.
        const am = rx * C.RM[k] + ry * C.RM[k + 1] + rz * C.RM[k + 2], ah = rx * C.RH[k] + ry * C.RH[k + 1] + rz * C.RH[k + 2];
        const ex = rx - C.RM[k] * am - C.RH[k] * ah, ey = ry - C.RM[k + 1] * am - C.RH[k + 1] * ah, ez = rz - C.RM[k + 2] * am - C.RH[k + 2] * ah;
        // Only the inside of the limb (the back of the knee, the front of the elbow), and
        // fading out before the edge of the crease.
        const r = ex * C.RN[k] + ey * C.RN[k + 1] + ez * C.RN[k + 2];
        const reach = C.B[k + 3], far = Math.sqrt(rx * rx + ry * ry + rz * rz);
        const fade = 1 - smoothstep(0.55 * reach, reach, far);
        const lift = even * fade * Math.min(0.5 * Math.max(0, r), Math.max(0, r / C.H[k + 3] - sb));
        if (lift > 0) {
          v.set(v.x + C.B[k] * lift, v.y + C.B[k + 1] * lift, v.z + C.B[k + 2] * lift);
          dx = v.x - C.J[k]; dy = v.y - C.J[k + 1]; dz = v.z - C.J[k + 2];
        }
      }
      // The hip's shifted contact applies near the surface only: deep tissue by the joint
      // is never pushed out towards the skin.
      const deep = C.RN[k + 3] ? smoothstep(0.05, 0.09, Math.sqrt(rx * rx + ry * ry + rz * rz)) : 0;
      const sd = side * (dx * C.M[k] + dy * C.M[k + 1] + dz * C.M[k + 2] - C.RN[k + 3] * deep), q = C.M[k + 3];
      if (sd >= q) continue;
      const push = hold * side * (q * Math.exp((sd - q) / q) - sd);
      v.set(v.x + C.M[k] * push, v.y + C.M[k + 1] * push, v.z + C.M[k + 2] * push);
    }
    return v;
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
  wristQuat(side = 'l', dev = 0, extension = WRIST_EXTENSION) {
    const ext = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), extension);
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
  _armTarget(side, target, girdle, morphed = false) {
    const T = morphed ? target.clone() : applyMorph(target, new THREE.Vector3(), { tissue: 'bone' });
    if (!girdle) return { T, inv: null };
    const inv = this.localMatrix(this.bones[boneIndex('girdle', side)], girdle, new THREE.Matrix4()).invert();
    return { T: T.applyMatrix4(inv), inv };
  }

  /**
   * How far `target` is from the shoulder, as a fraction of the whole arm. Over 1 cannot be
   * reached at all; LOCKOUT_REACH is as straight as an elbow should go.
   */
  reachRatio(side, target, girdle = null, morphed = false) {
    if (!this.p[side]) return 0;
    const S = this._morphed(side, 'gh');
    const { T } = this._armTarget(side, target, girdle, morphed);
    return S.distanceTo(T) / this.straightReach(side);
  }

  /**
   * How far the grip can be from the shoulder with the elbow straight. Less than the two
   * bones end to end: a real elbow carries the forearm a little out of line, and turning
   * the palm down rolls the radius over the ulna and draws the hand in by about a
   * centimetre. The shortest over the palm's usual turns, so a lift never plans a reach
   * the arm cannot make.
   */
  straightReach(side) {
    const S = this._morphed(side, 'gh'), E = this._morphed(side, 'el'), Fm = this._morphed(side, 'fm');
    const { hinge, pron } = this.p[side];
    const G0 = this._gripAfterWrist(side), m = side === 'l' ? 1 : -1;
    let reach = Infinity;
    for (const turn of [0, 90, 140, 170]) {
      const Gp = G0.clone().sub(Fm).applyAxisAngle(pron, m * turn * Math.PI / 180).add(Fm);
      let best = 0;
      for (let t = -40; t <= 20; t += 1) best = Math.max(best, S.distanceTo(Gp.clone().sub(E).applyAxisAngle(hinge, t * Math.PI / 180).add(E)));
      reach = Math.min(reach, best);
    }
    return reach;
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
  uprightPole(side, target, girdle, hint, up = new THREE.Vector3(0, 0, 1), { morphed = false, across: acrossIn = null } = {}) {
    if (!this.p[side]) return hint;
    const S = this._morphed(side, 'gh'), E0 = this._morphed(side, 'el');
    const G = this._gripAfterWrist(side);
    const { T, inv } = this._armTarget(side, target, girdle, morphed);
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
    // Standing, "up" runs along the body, and side-to-side has to be given instead.
    const across = acrossIn ? acrossIn.clone().normalize() : up.clone().cross(new THREE.Vector3(0, 1, 0)).normalize();
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
   * Put one hand on its grip target.
   *
   * The elbow is a hinge: the forearm bends about one fixed axis across the lower end of
   * the humerus and about nothing else. Solved as the shortest turn that pointed the
   * forearm at the grip, it bent and twisted 40 to 60 degrees off that axis in most lifts,
   * and 100 degrees with the bar on the back. So the hinge angle comes first, from how far
   * the grip has to be from the shoulder, and the upper arm then turns as a whole, about
   * its own length as well, to put that bent arm where it has to go with the elbow towards
   * `pole`.
   *
   * The palm turns the way a real one does: the radius rolls round the ulna, carrying the
   * hand, about the line from the head of the radius to the head of the ulna (see
   * `_resolveForearm`). That line is not the line to the grip, so turning the palm moves
   * the grip; the turn, the wrist, the hinge and the upper arm are settled together over a
   * few passes.
   *
   * @param opts.pronation  palm turn, radians, if no alignment is asked for
   * @param opts.girdle     this side's girdle pose entry, so the arm solves in its frame
   * @param opts.rootQ      the root's rotation, needed to know which way the hand faces
   * @param opts.align      world direction the bar runs, from this hand's index finger side
   *                        to its little finger side
   * @param opts.wrist      how far the wrist bends back, if not the pressing default. A bar
   *                        resting in the heel of the hand, as in the front rack of an
   *                        overhead press, needs far more.
   */
  solveArm(side, target, pole, opts = {}) {
    const { pronation = 0, girdle = null, rootQ = null, align = null, morphed = false, wrist = WRIST_EXTENSION } = opts;
    if (!this.p[side]) return {};
    // Solve in morphed space, not rest space. The bone matrices rotate vertices that have
    // already been through the height/weight field, so the arm they actually swing is the
    // morphed one — solving against rest lengths lands the grip centimetres off the bar on
    // any body that is not the source model's size.
    const S = this._morphed(side, 'gh');
    const E = this._morphed(side, 'el');
    const Fm = this._morphed(side, 'fm');
    const { hinge, pron } = this.p[side];
    // The shoulder blade moves before the arm does, so by the time this solves, the arm's
    // whole frame has already shifted. Bring the target and the elbow hint back through
    // that rotation — otherwise a few degrees at the collarbone slides the grip several
    // centimetres along the bar, and the hands change width mid-rep.
    const { T, inv } = this._armTarget(side, target, girdle, morphed);
    if (inv) pole = pole.clone().transformDirection(inv);
    const girdleQ = girdle?.rot ? new THREE.Quaternion().setFromEuler(new THREE.Euler(...girdle.rot, 'XYZ')) : new THREE.Quaternion();
    const outer = (rootQ ? rootQ.clone() : new THREE.Quaternion()).multiply(girdleQ);
    const bh = this.barInHand(side);
    const turnAbout = (v, centre, axis, angle) => v.clone().sub(centre).applyAxisAngle(axis, angle).add(centre);

    let dev = 0, phi = (side === 'l' ? 1 : -1) * pronation, roll = 0, straightness = 1;
    let wq, q1, qBend, qTurn;
    const solve = () => {
      wq = this.wristQuat(side, dev, wrist);
      const Gp = turnAbout(this._gripAfterWrist(side, wq), Fm, pron, phi);
      // The hinge angle that puts the grip as far from the shoulder as the target is. The
      // straighter the arm, the further the grip; past either end of the elbow's range the
      // arm stops there and the grip falls short of the target.
      const reach = (th) => S.distanceTo(turnAbout(Gp, E, hinge, th));
      // Fully straight is where the grip is furthest from the shoulder; the elbow opens no
      // further than that.
      let a0 = ELBOW_OPEN, a1 = 0.3;
      for (let i = 0; i < 40; i++) {
        const m1 = a0 + (a1 - a0) / 3, m2 = a1 - (a1 - a0) / 3;
        if (reach(m1) < reach(m2)) a0 = m1; else a1 = m2;
      }
      const straight = (a0 + a1) / 2;
      const want = Math.max(reach(ELBOW_MAX), Math.min(reach(straight), S.distanceTo(T)));
      let lo = straight, hi = ELBOW_MAX;
      for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (reach(mid) > want) lo = mid; else hi = mid; }
      const bend = (lo + hi) / 2;
      const G = turnAbout(Gp, E, hinge, bend);
      // The upper arm turns as one piece, the line to the grip onto the line to the target.
      // Bent, it turns about that line to put the elbow towards its pole. Nearly straight,
      // where the elbow is has no meaning, so it turns to lay the elbow's hinge across the
      // line to the pole instead, which still points the elbow there. The two differ only
      // by the elbow's carrying angle, so blending them cannot flip. The arm used to take
      // the shortest turn when straight, and the shortest turn from hanging to overhead is
      // unstable: at the top of an overhead press it spun the humerus 90 degrees.
      const aim = smoothstep(straight + ELBOW_AIM[0], straight + ELBOW_AIM[1], bend);
      q1 = aimArm(G.clone().sub(S), hinge, T.clone().sub(S), pole)
        .slerp(turnFrame(G.clone().sub(S), E.clone().sub(S), T.clone().sub(S), pole), aim);
      straightness = 1 - aim;
      // A turn of the humerus about the line from the shoulder to the grip leaves the grip
      // where it is.
      if (roll) q1.premultiply(new THREE.Quaternion().setFromAxisAngle(T.clone().sub(S).normalize(), roll));
      qBend = new THREE.Quaternion().setFromAxisAngle(hinge, bend);
      qTurn = new THREE.Quaternion().setFromAxisAngle(pron, phi);
    };
    solve();
    if (align) {
      const w0 = align.clone().normalize();
      for (let pass = 0; pass < 4; pass++) {
        // The wrist's side-bend sets the angle the bar makes with the forearm's turning
        // axis, which no turn about that axis can change. Out of the wrist's range it stops
        // at the limit and the turn does what it can.
        const forearm = outer.clone().multiply(q1).multiply(qBend).multiply(qTurn);
        const want = w0.clone().applyQuaternion(forearm.clone().invert()).dot(pron);
        const along = (x) => bh.clone().applyQuaternion(this.wristQuat(side, x, wrist)).dot(pron);
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
        // Then roll the radius until the bar line in the palm runs along the real bar.
        const base = outer.clone().multiply(q1).multiply(qBend);
        const f = pron.clone().applyQuaternion(base).normalize();
        const k = bh.clone().applyQuaternion(this.wristQuat(side, dev, wrist)).applyQuaternion(qTurn).applyQuaternion(base);
        const w = w0.clone();
        k.addScaledVector(f, -k.dot(f)).normalize();
        w.addScaledVector(f, -w.dot(f)).normalize();
        phi += Math.atan2(new THREE.Vector3().crossVectors(k, w).dot(f), k.dot(w));
        // Past an easy turn, the humerus rolls in with it. With the arm near straight the
        // humerus and the forearm turn about nearly the same line, so the roll takes over
        // that much of the palm's turn.
        const over = (Math.abs(phi) - PRONATION_EASY) * Math.sign(phi);
        if (Math.abs(phi) > PRONATION_EASY && straightness > 0) { roll += over * straightness; phi -= over * straightness; }
        solve();
      }
    }
    (this.wristDev ||= {})[side] = dev;

    return {
      [`upperarm.${side}`]: { quat: q1 },
      [`forearm1.${side}`]: { quat: qBend },
      [`forearm2.${side}`]: { quat: qTurn },
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
    const close = (keys, rate, limit, names, { turn = null, start = [0, 0, 0], solid = [], wrap = false } = {}) => {
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
      const touching = (from = 0) => {
        for (let i = from; i < 3; i++) {
          if (preset[i]) continue;
          const A = P[i].clone().lerp(P[i + 1], 0.25);
          if (reach(A, P[i + 1]) < clear[i]) return i;
          for (const [S0, S1, gap] of solid) if (segSeg(A, P[i + 1], S0, S1) < gap) return i;
        }
        return -1;
      };
      const STEP = 1 * deg;
      if (wrap) {
        // Closing on a bar. All three joints bend together at their own rates, led by the
        // first joint still moving. When a bone meets the bar, the joints past the leading
        // one give way just enough for the finger to slide over the surface, so the leading
        // joint keeps closing; when nothing can give, it stops there and the next joint
        // leads. Every step starts from a grip that clears the bar, so the fingers can only
        // end up round it, never through it or in a fist beside it.
        const active = [true, true, true];
        for (let n = 0; n < 900; n++) {
          const lead = active.indexOf(true);
          if (lead < 0) break;
          const next = th.map((t, q) => (active[q] ? Math.min(limit[q], t + rate[q] * STEP) : t));
          place(next);
          let found = touching() < 0 ? next : null;
          const free = [0, 1, 2].filter(q => q > lead);
          for (let t = 1; !found && free.length && t <= 60; t++) {
            for (let k = 0; k <= (free.length > 1 ? t : 0); k++) {
              const c = next.slice();
              if (free.length > 1) {
                c[free[0]] = Math.max(0, next[free[0]] - k * STEP);
                c[free[1]] = Math.max(0, next[free[1]] - (t - k) * STEP);
              } else c[free[0]] = Math.max(0, next[free[0]] - t * STEP);
              place(c);
              if (touching() < 0) { found = c; break; }
            }
          }
          if (!found) { active[lead] = false; continue; }
          for (let q = 0; q < 3; q++) { th[q] = found[q]; if (th[q] >= limit[q]) active[q] = false; }
        }
        done.fill(true);
      }
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
    // about 80°.
    //
    // Each finger takes the most closed grip that clears the bar (`wrap`). Stopped the
    // moment any bone touched, the fingertip met the bar first, because the bar lies in the
    // heel of the hand well below the knuckles, and the whole finger froze there: every lift
    // held the bar in a loose hook with the fingers standing 5 cm above it, which showed
    // worst from behind an overhead press. Closed one joint at a time from the knuckle, the
    // first bone lay flat over the bar and the middle joint stayed straight.
    (this.gripAngles ||= {})[side] = {};
    const fingers = {};
    for (const { n } of DIGITS) {
      fingers[n] = close([`mcp${n}`, `pip${n}`, `dip${n}`, `tip${n}`],
        [0.8, 1.0, 0.67], [90 * deg, 110 * deg, 80 * deg], [`f${n}a`, `f${n}b`, `f${n}c`], { wrap: true });
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
    // The knee is a hinge, like the elbow (see `solveArm`). Solved as the shortest turn of
    // the shin towards the ankle, it bent 45 degrees off its axis halfway down a squat and
    // twisted far more at the bottom, because the knees push out over the toes. A real leg
    // does that by turning the femur out at the hip, and the knee still only bends.
    const hinge = this.p[side].kneeHinge;
    const turnAbout = (v, centre, axis, angle) => v.clone().sub(centre).applyAxisAngle(axis, angle).add(centre);
    const reach = (th) => S.distanceTo(turnAbout(G, E, hinge, th));
    let a0 = -20 * Math.PI / 180, a1 = 20 * Math.PI / 180;
    for (let i = 0; i < 40; i++) {
      const m1 = a0 + (a1 - a0) / 3, m2 = a1 - (a1 - a0) / 3;
      if (reach(m1) < reach(m2)) a0 = m1; else a1 = m2;
    }
    const straight = (a0 + a1) / 2;
    const want = Math.max(reach(KNEE_MAX), Math.min(reach(straight), S.distanceTo(T)));
    let lo = straight, hi = KNEE_MAX;
    for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (reach(mid) > want) lo = mid; else hi = mid; }
    const bend = (lo + hi) / 2;
    const Gb = turnAbout(G, E, hinge, bend);
    // Bent, the femur turns to put the knee towards its pole; nearly straight, to lay the
    // knee's hinge across the line to the pole (see `solveArm`).
    const q1 = aimArm(Gb.clone().sub(S), hinge, T.clone().sub(S), pole)
      .slerp(turnFrame(Gb.clone().sub(S), E.clone().sub(S), T.clone().sub(S), pole), smoothstep(straight + ELBOW_AIM[0], straight + ELBOW_AIM[1], bend));
    return {
      [`thigh.${side}`]: { quat: q1 },
      [`shin.${side}`]: { quat: new THREE.Quaternion().setFromAxisAngle(hinge, bend) },
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
#ifdef SHARIR_SKIN3
// The skin can take a third bone (bone, weight), on top of the two in aSkin: see skinOverGirdle.
attribute vec2 aSkin2;
#endif
uniform vec4 uBoneReal[${BONE_COUNT}];
uniform vec4 uBoneDual[${BONE_COUNT}];
uniform vec3 uAnchorDisp[${ANCHOR_SLOTS}];
uniform float uAnchorBone[${ANCHOR_SLOTS}];
uniform float uAnchorWall[${ANCHOR_SLOTS}];
uniform float uPosed;
uniform vec4 uCrJ[${CREASE_SLOTS}];
uniform vec4 uCrM[${CREASE_SLOTS}];
uniform vec4 uCrB[${CREASE_SLOTS}];
uniform vec4 uCrRJ[${CREASE_SLOTS}];
uniform vec4 uCrRM[${CREASE_SLOTS}];
uniform vec4 uCrBone[${CREASE_SLOTS}];
uniform vec4 uCrH[${CREASE_SLOTS}];
uniform vec4 uCrRH[${CREASE_SLOTS}];
uniform vec4 uCrRN[${CREASE_SLOTS}];
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
#ifdef SHARIR_SKIN3
  if (ia == 0 && ib == 0 && aSkin.z < 1.5 && aSkin2.y <= 0.0) { sharirQ = uBoneReal[0]; sharirD = uBoneDual[0]; return; }
#else
  if (ia == 0 && ib == 0 && aSkin.z < 1.5) { sharirQ = uBoneReal[0]; sharirD = uBoneDual[0]; return; }
#endif
  float w = clamp(aSkin.z, 0.0, 1.0);
  if (aSkin.z > 2.999) {                            // past the insertion: trunk to limb bone
    w = 1.0 - (aSkin.z - 3.0);
    ib = int(uAnchorBone[ib] + 0.5);
  } else if (aSkin.z > 1.5) {                       // fibre vertex: its trunk bone only
    sharirQ = uBoneReal[ia]; sharirD = uBoneDual[ia];
#ifdef SHARIR_SKIN3
    if (aSkin2.y > 0.0) {                           // ...or the spine's blend at its height
      int ic = int(aSkin2.x + 0.5);
      vec4 qc = uBoneReal[ic], dc = uBoneDual[ic];
      if (dot(sharirQ, qc) < 0.0) { qc = -qc; dc = -dc; }
      vec4 q = sharirQ * (1.0 - aSkin2.y) + qc * aSkin2.y;
      vec4 d = sharirD * (1.0 - aSkin2.y) + dc * aSkin2.y;
      float len = length(q);
      sharirQ = q / len; sharirD = d / len;
    }
#endif
    return;
  }
  vec4 qa = uBoneReal[ia], da = uBoneDual[ia];
  vec4 qb = uBoneReal[ib], db = uBoneDual[ib];
  if (dot(qa, qb) < 0.0) { qb = -qb; db = -db; }   // same hemisphere: the short way round
  vec4 q = qa * w + qb * (1.0 - w);
  vec4 d = da * w + db * (1.0 - w);
#ifdef SHARIR_SKIN3
  if (aSkin2.y > 0.0 && aSkin.z < 1.5) {
    int ic = int(aSkin2.x + 0.5);
    vec4 qc = uBoneReal[ic], dc = uBoneDual[ic];
    if (dot(q, qc) < 0.0) { qc = -qc; dc = -dc; }
    q = q * (1.0 - aSkin2.y) + qc * aSkin2.y;
    d = d * (1.0 - aSkin2.y) + dc * aSkin2.y;
  }
#endif
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
  if (aSkin.z > 1.5) {
    int slot = int(aSkin.y + 0.5);
    vec3 shift = min(aSkin.z - 2.0, 4.0 - aSkin.z) * uAnchorDisp[slot];
    // On the trunk's wall: slide along it, never lift off it (WALL_Z in rig.js).
    if (uAnchorWall[slot] > 0.5 && aSkin.z < 2.999) {
      vec3 nr = vec3(p.x, 0.0, p.z - ${WALL_Z.toFixed(4)});
      if (dot(nr, nr) > 1e-8) {
        vec3 n = sharirRotate(normalize(nr));
        float lift = dot(shift, n), keep = 1.0 - smoothstep(${WALL_FREE[0].toFixed(3)}, ${WALL_FREE[1].toFixed(3)}, aSkin.z - 2.0);
        if (lift > 0.0) shift -= keep * lift * n;
      }
    }
    q += shift;
  }
  return q;
}
// The crease contact (CREASES in rig.js; Rig.creasePoint does the same on the CPU).
bool sharirOnCrease(float x, vec4 bones) {
  return abs(x - bones.x) < 0.5 || abs(x - bones.y) < 0.5 || abs(x - bones.z) < 0.5;
}
vec3 sharirCrease(vec3 rest, vec3 q, float mask) {
  if (uPosed < 0.5 || aSkin.z > 1.5 || mod(floor(mask / 4.0), 2.0) > 0.5) return q;
  vec3 sk = aSkin;
  for (int c = 0; c < ${CREASE_SLOTS}; c++) {
    if (uCrJ[c].w < 0.5) continue;
    if (!sharirOnCrease(sk.x, uCrBone[c]) || (sk.z < 0.999 && !sharirOnCrease(sk.y, uCrBone[c]))) continue;
    vec3 r = rest - uCrRJ[c].xyz;
    if (dot(r, r) > uCrB[c].w * uCrB[c].w) continue;
    float side = dot(r, uCrRM[c].xyz) >= 0.0 ? 1.0 : -1.0, hold = 1.0;
    if (uCrRJ[c].w > 0.5) {
      float low = (abs(sk.x - uCrBone[c].y) < 0.5 ? min(sk.z, 1.0) : 0.0)
                + (sk.z < 0.999 && abs(sk.y - uCrBone[c].y) < 0.5 ? 1.0 - sk.z : 0.0);
      if (low < 0.35) continue;
      side = -1.0; hold = smoothstep(0.35, 0.65, low);
    }
    vec3 d = q - uCrJ[c].xyz;
    float sb = dot(d, uCrB[c].xyz);
    if (sb <= 0.0) continue;
    float share = (abs(sk.x - uCrBone[c].x) < 0.5 ? min(sk.z, 1.0) : 0.0)
                + (sk.z < 0.999 && abs(sk.y - uCrBone[c].x) < 0.5 ? 1.0 - sk.z : 0.0);
    float even = uCrRM[c].w > 0.5 ? 4.0 * share * (1.0 - share) : 0.0;
    if (even > 0.001) {
      vec3 e = r - uCrRM[c].xyz * dot(r, uCrRM[c].xyz) - uCrRH[c].xyz * dot(r, uCrRH[c].xyz);
      float fade = 1.0 - smoothstep(0.55 * uCrB[c].w, uCrB[c].w, length(r));
      float depth = max(0.0, dot(e, uCrRN[c].xyz));
      float lift = even * fade * min(0.5 * depth, max(0.0, depth / uCrH[c].w - sb));
      q += uCrB[c].xyz * lift;
      d = q - uCrJ[c].xyz;
    }
    float sd = side * (dot(d, uCrM[c].xyz) - uCrRN[c].w * smoothstep(0.05, 0.09, length(r))), sq = uCrM[c].w;
    if (sd >= sq) continue;
    q += uCrM[c].xyz * (hold * side * (sq * exp((sd - sq) / sq) - sd));
  }
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
    shader.uniforms.uAnchorBone = rig.uAnchorBone;
    shader.uniforms.uAnchorWall = rig.uAnchorWall;
    shader.uniforms.uPosed = rig.enabled;
    for (const [k, u] of Object.entries(rig.uCrease)) shader.uniforms['uCr' + k] = u;
    const marker = 'transformed = morphBody(transformed);';
    if (!shader.vertexShader.includes(marker)) { console.warn('[rig] morph hook not found — pose disabled'); return; }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + RIG_GLSL)
      .replace(marker, 'vec3 sharirRest = morphBody(transformed);\n transformed = sharirCrease(sharirRest, sharirPose(sharirRest), aMorphMask);');
    if (shader.vertexShader.includes('#include <beginnormal_vertex>')) {
      shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>',
        '#include <beginnormal_vertex>\n objectNormal = sharirPoseNormal(objectNormal);');
    }
  };
  material.needsUpdate = true;
}
