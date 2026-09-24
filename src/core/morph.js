import * as THREE from 'three';

/**
 * Body morph field: a smooth, GPU-side deformation applied to every vertex (model space,
 * metres, y-up, feet at y=0), before any pose. A JS mirror keeps the rig's joints, labels,
 * focus boxes and picking in step with the picture.
 *
 * It drives height and head proportion (children), the sex frame (shoulder and hip width),
 * and body composition. Composition is where the anatomy matters, so it follows a few rules:
 *
 * - Every vertex knows which bone it belongs to, from the rig's skinning. Trunk tissue gets
 *   the trunk's shape changes, which vary with height up the body. Limb tissue thickens
 *   round its own bone, all the way down the limb, and the limb as a whole moves with the
 *   joint it hangs from. A limb squeezed sideways by the trunk's bands kept its old size
 *   below wherever the band stopped, which pinned the forearm and the lower leg in place
 *   while everything above them swelled.
 * - Tissues change differently. Bone does not grow with weight or training. Muscle grows
 *   with muscle. Skin sits on top of both and also carries the fat, so fat shows as a real
 *   layer between muscle and skin, and not as muscle turning fatter.
 * - Belly fat is mostly visceral in men: it pushes the abdominal wall out, muscles and all.
 *   Moving the skin alone left a hollow balloon floating in front of flat abdominal muscles.
 * - The stance that goes with a bigger body (arms carried away from the trunk, feet
 *   further apart) is not faked here. The rig reads it off these same numbers and turns the
 *   shoulders and hips out, so the limbs swing out as limbs instead of being slid sideways.
 */
export const MODEL_HEIGHT = 1.7433;   // Z-Anatomy adult male model
/** y of the chin on the source model: everything above this is "head" for proportion purposes. */
export const NECK_Y = 1.512;
export const HEAD_MODEL = MODEL_HEIGHT - NECK_Y;   // 0.2313 m ≈ 13.3% of height
/** Model's own head fraction, i.e. the adult baseline. */
export const HEAD_FRACTION = HEAD_MODEL / MODEL_HEIGHT;

/** Tissue bits carried per vertex in aMorphMask. */
export const MASK = { SKIN: 1, BREAST: 2, BONE: 4, MUSCLE: 8 };
/** How much of each driver a tissue takes, as [frame, muscle, fat]. */
const TISSUE = {
  skin:   [1, 1, 1],
  muscle: [1, 1, 0.3],
  bone:   [1, 0, 0],
  other:  [1, 0.5, 0.25],
};
/** How much of the belly's forward push each tissue takes. Visceral fat moves the wall. */
const BELLY_SHARE = { skin: 1, muscle: 0.55, bone: 0, other: 0.22 };

/**
 * Split a target height and head fraction into the two scales the shader needs.
 * Keeps BOTH the head proportion and the total height correct — scaling the head
 * alone would otherwise make a toddler taller than the number says.
 */
export function proportions(heightM, headRatio) {
  const r = Math.min(0.32, Math.max(0.10, headRatio || HEAD_FRACTION));
  const bodyScale = ((1 - r) * heightM) / NECK_Y;
  const headScale = (r * heightM) / HEAD_MODEL;
  return { bodyScale, headF: headScale / bodyScale, headScale };
}

/** Rows in the segment texture: axis start + chain, axis end, girth by tissue. */
const SEG_ROWS = 3;
const MAX_SEGS = 64;
const ANCHOR_SLOTS = 12;

const segData = new Float32Array(MAX_SEGS * SEG_ROWS * 4);
const segTex = new THREE.DataTexture(segData, MAX_SEGS, SEG_ROWS, THREE.RGBAFormat, THREE.FloatType);
segTex.minFilter = segTex.magFilter = THREE.NearestFilter;
segTex.needsUpdate = true;

export const uniforms = {
  uScale:   { value: 1.0 },
  uHeadF:   { value: 1.0 },
  uNeckY:   { value: 1.512 },
  uLimbW:   { value: 1.0 },
  // Trunk bands, each as (frame, muscle, fat) changes in width: frame is the skeleton
  // (sex and age), muscle and fat are soft tissue.
  uShD:     { value: new THREE.Vector3() },
  uHipD:    { value: new THREE.Vector3() },
  uWaistD:  { value: new THREE.Vector3() },
  uChestDD: { value: new THREE.Vector3() },
  uBelly:   { value: 0.0 },
  uBreast:  { value: 0.0 },
  uGlute:   { value: 0.0 },
  uNeckG:   { value: new THREE.Vector3(1, 1, 1) },   // neck girth: skin, muscle, other
  uFace:    { value: 0.0 },                          // facial fullness
  // Skeleton, for limb girth.
  uSegTex:   { value: segTex },
  uSegCount: { value: 0 },
  uRootD:    { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
  uAnchorLimb: { value: new Float32Array(ANCHOR_SLOTS) },
};

const GLSL_FUNCS = /* glsl */`
uniform float uScale, uHeadF, uNeckY, uLimbW, uBelly, uBreast, uGlute, uFace;
uniform vec3 uShD, uHipD, uWaistD, uChestDD, uNeckG;
uniform sampler2D uSegTex;
uniform float uSegCount;
uniform vec3 uRootD[4];
uniform float uAnchorLimb[${ANCHOR_SLOTS}];
attribute float aMorphMask;
float mbump(float y, float a, float b) { float t = clamp((y - a) / (b - a), 0.0, 1.0); return sin(3.14159265 * t); }
float mbit(float m, float bit) { return mod(floor(m / bit), 2.0); }

// Which drivers this vertex's tissue takes: (frame, muscle, fat), and its belly share.
vec4 tissueOf(float m) {
  if (mbit(m, 4.0) > 0.5) return vec4(1.0, 0.0, 0.0, 0.0);          // bone
  if (mbit(m, 1.0) > 0.5) return vec4(1.0, 1.0, 1.0, 1.0);          // skin
  if (mbit(m, 8.0) > 0.5) return vec4(1.0, 1.0, 0.3, 0.55);         // muscle
  return vec4(1.0, 0.5, 0.25, 0.22);                                // everything else
}

vec3 scaleBody(vec3 p) {
  float hb = smoothstep(uNeckY - 0.035, uNeckY + 0.02, p.y);
  float hf = mix(1.0, uHeadF, hb);
  vec3 pivot = vec3(0.0, uNeckY, 0.0);
  return pivot * uScale + (p - pivot) * uScale * hf;
}

// The trunk's change of shape at p, already in scaled units.
vec3 trunkDisp(vec3 p, vec3 base, vec4 tw) {
  float shB    = mbump(p.y, 1.15, 1.52);
  float chestB = mbump(p.y, 1.16, 1.42);
  float waistB = mbump(p.y, 1.00, 1.30);
  float hipB   = mbump(p.y, 0.78, 1.08);
  float gluteB = mbump(p.y, 0.83, 1.04);
  float hb = smoothstep(uNeckY - 0.035, uNeckY + 0.02, p.y);
  float lateral = abs(p.x);

  float w = 1.0 + dot(uShD, tw.xyz) * shB + dot(uHipD, tw.xyz) * hipB + dot(uWaistD, tw.xyz) * waistB;
  float limb = 1.0 + (uLimbW - 1.0) * (1.0 - hb);
  vec3 q = base;
  q.x *= w * limb;
  q.z *= mix(1.0, w, 0.6) * limb;
  q.z *= 1.0 + dot(uChestDD, tw.xyz) * chestB;

  // Neck: thicker round its own axis with muscle and with fat, fading into head and chest.
  float neckB = mbump(p.y, 1.42, 1.58) * (1.0 - smoothstep(0.06, 0.11, lateral));
  float gN = tw.x > 0.5 && tw.y < 0.5 ? 1.0 : (tw.w > 0.9 ? uNeckG.x : (tw.w > 0.5 ? uNeckG.y : uNeckG.z));
  vec3 nc = vec3(0.0, base.y, -0.012 * uScale);
  q.xz += (base.xz - nc.xz) * (gN - 1.0) * neckB;

  // Face: fuller cheeks and jaw, and a little fullness under the chin.
  float faceB = mbump(p.y, 1.53, 1.66) * smoothstep(0.0, 0.05, p.z) * tw.z;
  q.x += base.x * uFace * faceB;
  float chinB = mbump(p.y, 1.49, 1.57) * smoothstep(0.02, 0.07, p.z) * (1.0 - smoothstep(0.03, 0.07, lateral)) * tw.z;
  q.z += uFace * 0.30 * chinB * uScale;
  q.y -= uFace * 0.12 * chinB * uScale;

  float front = smoothstep(0.0, 0.07, p.z);
  float back  = smoothstep(0.0, 0.05, -p.z);
  float mid   = 1.0 - smoothstep(0.10, 0.20, lateral);
  q.z += uBelly * mbump(p.y, 0.86, 1.26) * front * mid * uScale * tw.w;
  q.z -= uGlute * gluteB * back * (1.0 - smoothstep(0.07, 0.17, lateral)) * uScale * min(tw.w * 1.6, 1.0);
  return q - base;
}

vec4 segRow(float i, float row) { return texture2D(uSegTex, vec2((i + 0.5) / ${MAX_SEGS}.0, (row + 0.5) / ${SEG_ROWS}.0)); }

// A limb's change at p, bound to bone i: its hanging joint's move, plus girth round its axis.
vec3 limbDisp(vec3 p, float i, vec4 tw, float chain) {
  vec4 A = segRow(i, 0.0), B = segRow(i, 1.0), G = segRow(i, 2.0);
  vec3 ab = B.xyz - A.xyz;
  float t = clamp(dot(p - A.xyz, ab) / max(dot(ab, ab), 1e-8), 0.0, 1.0);
  vec3 off = p - (A.xyz + ab * t);
  // G holds girth for skin, muscle and other tissue; bone keeps its size.
  float g = (tw.x > 0.5 && tw.y < 0.5) ? 1.0 : (tw.w > 0.9 ? G.x : (tw.w > 0.5 ? G.y : G.z));
  g *= uLimbW;
  int c = int(chain + 0.5);
  vec3 root = c == 0 ? uRootD[0] : c == 1 ? uRootD[1] : c == 2 ? uRootD[2] : uRootD[3];
  return root + off * (g - 1.0) * uScale;
}

vec3 boneDisp(vec3 p, vec3 base, float i, vec4 tw) {
  if (uSegCount < 0.5) return trunkDisp(p, base, tw);
  float chain = segRow(i, 0.0).w;
  if (chain < -0.5) return trunkDisp(p, base, tw);
  return limbDisp(p, i, tw, chain);
}

vec3 morphBody(vec3 p) {
  vec3 base = scaleBody(p);
  vec4 tw = tissueOf(aMorphMask);
  float ia = aSkin.x, ib = aSkin.y, w = aSkin.z;
  vec3 dA, dB;
  if (w > 1.5) {
    // A muscle stretched between trunk and limb: its fraction along itself decides how
    // much of it moves like the limb it inserts on.
    float limbBone = uAnchorLimb[int(ib + 0.5)];
    dA = boneDisp(p, base, limbBone, tw);
    dB = trunkDisp(p, base, tw);
    w = w - 2.0;
  } else {
    dA = boneDisp(p, base, ia, tw);
    dB = ia == ib ? dA : boneDisp(p, base, ib, tw);
    w = clamp(w, 0.0, 1.0);
  }
  vec3 q = base + mix(dB, dA, w);

  // Breasts
  float lateral = abs(p.x);
  float brB = mbump(p.y, 1.19, 1.37) * mbump(lateral, 0.035, 0.175) * smoothstep(0.03, 0.10, p.z);
  float maskBreast = mbit(aMorphMask, 2.0);
  q.z += uBreast * brB * uScale * maskBreast;
  q.y += uBreast * brB * uScale * maskBreast * -0.25;
  return q;
}
`;

/**
 * Patch a material so its vertices run through the morph field. The field reads the rig's
 * skinning attribute, so the rig's own shader code has to be declared before it; both
 * patches share `aSkin`.
 */
export function patchMaterial(mat) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    // Declared above everything, because the rig's code lands between <common> and this
    // block and reads the same attribute.
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', 'attribute vec3 aSkin;\n#include <common>\n' + GLSL_FUNCS)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n transformed = morphBody(transformed);');
  };
  mat.needsUpdate = true;
}

// ---------- skeleton ----------
/**
 * The segments limbs thicken round, from the rig: for each bone its axis (rest space),
 * which chain it hangs from (0 left arm, 1 right arm, 2 left leg, 3 right leg, -1 trunk)
 * and which joint that chain hangs from.
 */
const skel = { segs: [], roots: [], anchorLimb: new Float32Array(ANCHOR_SLOTS) };
/** Girth of each segment by tissue, recomputed whenever the body changes. */
let girth = [];

export function setSkeleton({ segs, roots, anchorLimb }) {
  skel.segs = segs.slice(0, MAX_SEGS);
  skel.roots = roots;
  skel.anchorLimb.set((anchorLimb || []).slice(0, ANCHOR_SLOTS));
  uniforms.uAnchorLimb.value = skel.anchorLimb;
  uniforms.uSegCount.value = skel.segs.length;
  for (let i = 0; i < skel.segs.length; i++) {
    const s = skel.segs[i];
    segData.set([s.a.x, s.a.y, s.a.z, s.chain], (0 * MAX_SEGS + i) * 4);
    segData.set([s.b.x, s.b.y, s.b.z, 0], (1 * MAX_SEGS + i) * 4);
  }
  writeGirth();
  segTex.needsUpdate = true;
}

/**
 * How much a limb segment thickens, per unit of the muscle and fat drivers, for muscle and
 * for skin. Taken from how limb circumferences move with body composition: the upper arm
 * and thigh change most, the forearm and calf about half as much, the wrist, hand, ankle
 * and foot only a little. Fingers thicken with fat but hardly with training.
 */
const LIMB_GIRTH = {
  upperarm: { m: 0.100, f: 0.125 },
  forearm:  { m: 0.060, f: 0.062 },
  hand:     { m: 0.012, f: 0.026 },
  thigh:    { m: 0.070, f: 0.105 },
  shin:     { m: 0.050, f: 0.062 },
  foot:     { m: 0.010, f: 0.020 },
};
function limbKind(name) {
  if (name === 'upperarm') return 'upperarm';
  if (name === 'forearm1' || name === 'forearm2') return 'forearm';
  if (name === 'thigh' || name === 'shin' || name === 'foot') return name;
  return 'hand';                                  // hand, fingers and thumb
}

const drive = { mUp: 0, mDown: 0, fUp: 0, fDown: 0 };
function writeGirth() {
  girth = skel.segs.map(s => {
    if (s.chain < 0) return { skin: 1, muscle: 1, other: 1 };
    const k = LIMB_GIRTH[limbKind(s.name)];
    const m = k.m * drive.mUp - k.m * 0.6 * drive.mDown;
    const f = k.f * drive.fUp - k.f * 0.3 * drive.fDown;
    return { skin: 1 + m + f, muscle: 1 + m + 0.3 * f, other: 1 + 0.5 * m + 0.25 * f };
  });
  for (let i = 0; i < girth.length; i++) {
    const g = girth[i];
    segData.set([g.skin, g.muscle, g.other, 0], (2 * MAX_SEGS + i) * 4);
  }
  segTex.needsUpdate = true;
}

/** Girth of bone `i` for a tissue, as the shader has it. */
export function segmentGirth(i, tissue = 'skin') {
  const g = girth[i];
  return (g ? (tissue === 'bone' ? 1 : g[tissue] ?? g.other) : 1) * u.uLimbW.value;
}

// ---------- JS mirror ----------
function mbump(y, a, b) { const t = Math.min(1, Math.max(0, (y - a) / (b - a))); return Math.sin(Math.PI * t); }
function smoothstep(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
const u = uniforms;
const dot3 = (v, t) => v.x * t[0] + v.y * t[1] + v.z * t[2];

function scaleBody(p, out) {
  const s = u.uScale.value, ny = u.uNeckY.value;
  const hb = smoothstep(ny - 0.035, ny + 0.02, p.y);
  const hf = 1 + (u.uHeadF.value - 1) * hb;
  return out.set(p.x * s * hf, ny * s + (p.y - ny) * s * hf, p.z * s * hf);
}

function tissueName(mask) {
  if (!mask) return 'other';
  if (mask.tissue) return mask.tissue;
  if (mask.belly || mask.breast) return 'skin';
  return 'other';
}

/** The trunk's change at p (scaled units), for a tissue. */
function trunkDisp(p, base, tissue, out) {
  const tw = TISSUE[tissue];
  const s = u.uScale.value, ny = u.uNeckY.value;
  const shB = mbump(p.y, 1.15, 1.52), chestB = mbump(p.y, 1.16, 1.42), waistB = mbump(p.y, 1.00, 1.30);
  const hipB = mbump(p.y, 0.78, 1.08), gluteB = mbump(p.y, 0.83, 1.04);
  const hb = smoothstep(ny - 0.035, ny + 0.02, p.y);
  const lateral = Math.abs(p.x);
  const w = 1 + dot3(u.uShD.value, tw) * shB + dot3(u.uHipD.value, tw) * hipB + dot3(u.uWaistD.value, tw) * waistB;
  const limb = 1 + (u.uLimbW.value - 1) * (1 - hb);
  let qx = base.x * w * limb, qy = base.y;
  let qz = base.z * (1 + (w - 1) * 0.6) * limb;
  qz *= 1 + dot3(u.uChestDD.value, tw) * chestB;

  const neckB = mbump(p.y, 1.42, 1.58) * (1 - smoothstep(0.06, 0.11, lateral));
  const ng = u.uNeckG.value;
  const gN = tissue === 'bone' ? 1 : tissue === 'skin' ? ng.x : tissue === 'muscle' ? ng.y : ng.z;
  const ncz = -0.012 * s;
  qx += base.x * (gN - 1) * neckB;
  qz += (base.z - ncz) * (gN - 1) * neckB;

  const faceB = mbump(p.y, 1.53, 1.66) * smoothstep(0, 0.05, p.z) * tw[2];
  qx += base.x * u.uFace.value * faceB;
  const chinB = mbump(p.y, 1.49, 1.57) * smoothstep(0.02, 0.07, p.z) * (1 - smoothstep(0.03, 0.07, lateral)) * tw[2];
  qz += u.uFace.value * 0.30 * chinB * s;
  qy -= u.uFace.value * 0.12 * chinB * s;

  const front = smoothstep(0, 0.07, p.z), back = smoothstep(0, 0.05, -p.z);
  const mid = 1 - smoothstep(0.10, 0.20, lateral);
  const bs = BELLY_SHARE[tissue];
  qz += u.uBelly.value * mbump(p.y, 0.86, 1.26) * front * mid * s * bs;
  qz -= u.uGlute.value * gluteB * back * (1 - smoothstep(0.07, 0.17, lateral)) * s * Math.min(bs * 1.6, 1);
  return out.set(qx - base.x, qy - base.y, qz - base.z);
}

const _base = new THREE.Vector3(), _dA = new THREE.Vector3(), _dB = new THREE.Vector3();
const _off = new THREE.Vector3(), _ab = new THREE.Vector3();

function limbDisp(p, i, tissue, out) {
  const sg = skel.segs[i];
  _ab.subVectors(sg.b, sg.a);
  const len2 = _ab.lengthSq();
  const t = len2 > 1e-8 ? Math.min(1, Math.max(0, _off.subVectors(p, sg.a).dot(_ab) / len2)) : 0;
  _off.copy(p).sub(sg.a).addScaledVector(_ab, -t);
  const g = segmentGirth(i, tissue);
  return out.copy(u.uRootD.value[sg.chain]).addScaledVector(_off, (g - 1) * u.uScale.value);
}

function boneDisp(p, base, i, tissue, out) {
  const sg = skel.segs[i];
  if (!sg || sg.chain < 0) return trunkDisp(p, base, tissue, out);
  return limbDisp(p, i, tissue, out);
}

/**
 * Morph one point. `mask` may say which tissue it is ({ tissue } or the older
 * { belly, breast } for skin) and which bones carry it: `bone` for one bone, or `skin` as
 * the vertex's own [a, b, w] binding. With neither, the point is treated as trunk.
 */
export function applyMorph(p, out = new THREE.Vector3(), mask = null) {
  const tissue = tissueName(mask);
  const base = scaleBody(p, _base);
  let d;
  if (mask && mask.skin && skel.segs.length) {
    let [a, b, w] = mask.skin;
    if (w > 1.5) {
      boneDisp(p, base, skel.anchorLimb[Math.round(b)], tissue, _dA);
      trunkDisp(p, base, tissue, _dB);
      w -= 2;
    } else {
      boneDisp(p, base, a, tissue, _dA);
      if (a === b) _dB.copy(_dA); else boneDisp(p, base, b, tissue, _dB);
      w = Math.min(1, Math.max(0, w));
    }
    d = _dB.lerp(_dA, w);
  } else if (mask && mask.bone != null && skel.segs.length) {
    d = boneDisp(p, base, mask.bone, tissue, _dA);
  } else {
    d = trunkDisp(p, base, tissue, _dA);
  }
  out.copy(base).add(d);
  if (mask && mask.breast) {
    const lateral = Math.abs(p.x);
    const brB = mbump(p.y, 1.19, 1.37) * mbump(lateral, 0.035, 0.175) * smoothstep(0.03, 0.10, p.z);
    out.z += u.uBreast.value * brB * u.uScale.value;
    out.y += u.uBreast.value * brB * u.uScale.value * -0.25;
  }
  return out;
}

/**
 * The trunk's width factor at height y for a tissue, without the neck, face and belly:
 * how much wider the trunk is there than in the source model. The rig uses it to see how
 * far the trunk has grown into the arms.
 */
export function trunkWidth(y, tissue = 'skin') {
  const tw = TISSUE[tissue];
  return 1 + dot3(u.uShD.value, tw) * mbump(y, 1.15, 1.52) + dot3(u.uHipD.value, tw) * mbump(y, 0.78, 1.08)
    + dot3(u.uWaistD.value, tw) * mbump(y, 1.00, 1.30);
}

/** Approximate inverse (fixed-point iterations) — used to raycast against unmorphed geometry. */
export function invertMorph(q, out = new THREE.Vector3()) {
  const s = u.uScale.value || 1;
  const p = out.set(q.x / s, q.y / s, q.z / s);
  const tmp = new THREE.Vector3();
  for (let i = 0; i < 3; i++) {
    applyMorph(p, tmp);
    p.x += (q.x - tmp.x) / s;
    p.y += (q.y - tmp.y) / s;
    p.z += (q.z - tmp.z) / s;
  }
  return p;
}

/**
 * True when nothing but height and head proportion is changed. Only then does the rest-pose
 * raycast still match the picture well enough to pick with.
 */
export function isPlainScale() {
  const z = (v) => Math.abs(v.x) + Math.abs(v.y) + Math.abs(v.z) < 1e-6;
  return z(u.uShD.value) && z(u.uHipD.value) && z(u.uWaistD.value) && z(u.uChestDD.value)
    && !u.uBelly.value && !u.uBreast.value && !u.uGlute.value && !u.uFace.value && u.uLimbW.value === 1
    && drive.mUp + drive.mDown + drive.fUp + drive.fDown === 0;
}

/**
 * Set body parameters. All optional.
 *
 * Trunk bands take { frame, muscle, fat } width changes: sh, hip, waist, chestD.
 * Composition drivers mUp/mDown/fUp/fDown set limb girth; neck and face fullness follow.
 */
export function setBody(opts = {}) {
  const set = (k, uni) => { if (opts[k] !== undefined && Number.isFinite(opts[k])) u[uni].value = opts[k]; };
  set('scale', 'uScale'); set('headF', 'uHeadF'); set('limbW', 'uLimbW');
  set('belly', 'uBelly'); set('breast', 'uBreast'); set('glute', 'uGlute'); set('face', 'uFace');
  const band = (k, uni) => { const b = opts[k]; if (b) u[uni].value.set(b.frame || 0, b.muscle || 0, b.fat || 0); };
  band('sh', 'uShD'); band('hip', 'uHipD'); band('waist', 'uWaistD'); band('chestD', 'uChestDD');
  let girthChanged = false;
  for (const k of ['mUp', 'mDown', 'fUp', 'fDown']) {
    if (opts[k] !== undefined && Number.isFinite(opts[k]) && drive[k] !== opts[k]) { drive[k] = opts[k]; girthChanged = true; }
  }
  if (girthChanged) {
    u.uNeckG.value.set(
      1 + 0.060 * drive.mUp - 0.03 * drive.mDown + 0.075 * drive.fUp - 0.02 * drive.fDown,
      1 + 0.060 * drive.mUp - 0.03 * drive.mDown + 0.022 * drive.fUp,
      1 + 0.030 * drive.mUp + 0.018 * drive.fUp);
    writeGirth();
  }
  updateRoots();
}

/**
 * Where each limb's hanging joint moves to, as a displacement in scaled units. A limb moves
 * with the skeleton at its root (a woman's narrower shoulders carry the arms in, her wider
 * pelvis carries the legs out), so the root is morphed as bone.
 */
function updateRoots() {
  const out = new THREE.Vector3();
  for (let c = 0; c < 4; c++) {
    const r = skel.roots[c];
    const d = u.uRootD.value[c];
    if (!r) { d.set(0, 0, 0); continue; }
    const base = scaleBody(r, new THREE.Vector3());
    trunkDisp(r, base, 'bone', out);
    d.copy(out);
  }
}

export function currentHeight() { return MODEL_HEIGHT * u.uScale.value; }

/** A short string that changes whenever the body's shape does. For caches keyed on it. */
export function morphKey() {
  const v = (x) => x.toFixed(5);
  const v3 = (x) => `${v(x.x)},${v(x.y)},${v(x.z)}`;
  return [u.uScale.value, u.uHeadF.value, u.uLimbW.value, u.uBelly.value, u.uBreast.value, u.uGlute.value, u.uFace.value].map(v).join(',')
    + `|${v3(u.uShD.value)}|${v3(u.uHipD.value)}|${v3(u.uWaistD.value)}|${v3(u.uChestDD.value)}`
    + `|${v(drive.mUp)},${v(drive.mDown)},${v(drive.fUp)},${v(drive.fDown)}`;
}
