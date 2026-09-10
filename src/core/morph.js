import * as THREE from 'three';

/**
 * Body morph field — a smooth, GPU-side deformation applied to every vertex (model space, metres, y-up, feet at y=0).
 * Drives: overall height, head proportion (children), shoulder & hip width (sex), belly (adiposity), breasts (female).
 * A JS mirror (apply / invert) keeps labels, focus boxes and raycasts consistent.
 */
export const MODEL_HEIGHT = 1.7433;   // Z-Anatomy adult male model
/** y of the chin on the source model: everything above this is "head" for proportion purposes. */
export const NECK_Y = 1.512;
export const HEAD_MODEL = MODEL_HEIGHT - NECK_Y;   // 0.2313 m ≈ 13.3% of height
/** Model's own head fraction, i.e. the adult baseline. */
export const HEAD_FRACTION = HEAD_MODEL / MODEL_HEIGHT;

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

export const uniforms = {
  uScale:   { value: 1.0 },
  uHeadF:   { value: 1.0 },
  uNeckY:   { value: 1.512 },
  uShW:     { value: 1.0 },
  uHipW:    { value: 1.0 },
  uBelly:   { value: 0.0 },
  uBreast:  { value: 0.0 },
  uLimbW:   { value: 1.0 },
  uWaist:   { value: 1.0 },
  uGlute:   { value: 0.0 },
  uThigh:   { value: 1.0 },
  uArm:     { value: 1.0 },
  uChestD:  { value: 1.0 },
};

const GLSL_FUNCS = /* glsl */`
uniform float uScale, uHeadF, uNeckY, uShW, uHipW, uBelly, uBreast, uLimbW;
uniform float uWaist, uGlute, uThigh, uArm, uChestD;
attribute float aMorphMask;   // 1 = belly bulge applies, 2 = breast bulge applies
float mbump(float y, float a, float b) { float t = clamp((y - a) / (b - a), 0.0, 1.0); return sin(3.14159265 * t); }
vec3 morphBody(vec3 p) {
  float s = uScale;
  float hb = smoothstep(uNeckY - 0.035, uNeckY + 0.02, p.y);
  float hf = mix(1.0, uHeadF, hb);
  vec3 pivot = vec3(0.0, uNeckY, 0.0);
  vec3 q = pivot * s + (p - pivot) * s * hf;

  // Girth bands down the body. Overlapping sine bumps so every transition stays smooth.
  float shB    = mbump(p.y, 1.15, 1.52);   // shoulder yoke
  float chestB = mbump(p.y, 1.16, 1.42);   // ribcage depth
  float waistB = mbump(p.y, 1.00, 1.30);   // waist
  float hipB   = mbump(p.y, 0.78, 1.08);   // hips / pelvis
  float gluteB = mbump(p.y, 0.83, 1.04);   // buttocks
  float thighB = mbump(p.y, 0.52, 0.90);   // thighs
  float armB   = mbump(p.y, 1.05, 1.50);   // upper arm

  float lateral = abs(p.x);
  float isLimb  = smoothstep(0.10, 0.17, lateral);   // arms hang outside the torso
  float torso   = 1.0 - isLimb;

  float w = 1.0
    + (uShW  - 1.0) * shB   * torso
    + (uHipW - 1.0) * hipB  * torso
    + (uWaist- 1.0) * waistB* torso
    + (uThigh- 1.0) * thighB
    + (uArm  - 1.0) * armB  * isLimb;
  float limb = 1.0 + (uLimbW - 1.0) * (1.0 - hb);
  q.x *= w * limb;
  q.z *= mix(1.0, w, 0.6) * limb;
  q.z *= 1.0 + (uChestD - 1.0) * chestB * torso;

  float front = smoothstep(0.0, 0.07, p.z);
  float back  = smoothstep(0.0, 0.05, -p.z);
  float mid   = 1.0 - smoothstep(0.10, 0.20, lateral);

  // Abdomen forward (visceral + subcutaneous fat)
  float belB = mbump(p.y, 0.86, 1.26) * front * mid;
  float maskBelly = mod(aMorphMask, 2.0) >= 1.0 ? 1.0 : 0.0;
  q.z += uBelly * belB * s * maskBelly;

  // Buttocks backward — the single biggest cue for a female silhouette from the side
  float glB = gluteB * back * (1.0 - smoothstep(0.07, 0.17, lateral));
  q.z -= uGlute * glB * s * maskBelly;

  // Breasts
  float brB = mbump(p.y, 1.19, 1.37) * mbump(lateral, 0.035, 0.175) * smoothstep(0.03, 0.10, p.z);
  float maskBreast = aMorphMask >= 2.0 ? 1.0 : 0.0;
  q.z += uBreast * brB * s * maskBreast;
  q.y += uBreast * brB * s * maskBreast * -0.25;
  return q;
}
`;

/**
 * Patch a material so its vertices run through the morph field.
 * Which bulges apply is now a per-vertex attribute (`aMorphMask`) rather than a uniform,
 * because a merged batch contains parts from several systems in one draw call.
 */
export function patchMaterial(mat) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + GLSL_FUNCS)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n transformed = morphBody(transformed);');
  };
  mat.needsUpdate = true;
}

// ---------- JS mirror ----------
function mbump(y, a, b) { const t = Math.min(1, Math.max(0, (y - a) / (b - a))); return Math.sin(Math.PI * t); }
function smoothstep(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
const u = uniforms;

export function applyMorph(p, out = new THREE.Vector3(), mask = { belly: 0, breast: 0 }) {
  const s = u.uScale.value;
  const hb = smoothstep(u.uNeckY.value - 0.035, u.uNeckY.value + 0.02, p.y);
  const hf = 1 + (u.uHeadF.value - 1) * hb;
  const ny = u.uNeckY.value;
  let qx = (p.x) * s * hf;
  let qy = ny * s + (p.y - ny) * s * hf;
  let qz = (p.z) * s * hf;

  const shB = mbump(p.y, 1.15, 1.52);
  const chestB = mbump(p.y, 1.16, 1.42);
  const waistB = mbump(p.y, 1.00, 1.30);
  const hipB = mbump(p.y, 0.78, 1.08);
  const gluteB = mbump(p.y, 0.83, 1.04);
  const thighB = mbump(p.y, 0.52, 0.90);
  const armB = mbump(p.y, 1.05, 1.50);

  const lateral = Math.abs(p.x);
  const isLimb = smoothstep(0.10, 0.17, lateral);
  const torso = 1 - isLimb;

  const w = 1
    + (u.uShW.value - 1) * shB * torso
    + (u.uHipW.value - 1) * hipB * torso
    + (u.uWaist.value - 1) * waistB * torso
    + (u.uThigh.value - 1) * thighB
    + (u.uArm.value - 1) * armB * isLimb;
  const limb = 1 + (u.uLimbW.value - 1) * (1 - hb);
  qx *= w * limb;
  qz *= (1 + (w - 1) * 0.6) * limb;
  qz *= 1 + (u.uChestD.value - 1) * chestB * torso;

  const front = smoothstep(0, 0.07, p.z);
  const back = smoothstep(0, 0.05, -p.z);
  const mid = 1 - smoothstep(0.10, 0.20, lateral);

  if (mask.belly) {
    const belB = mbump(p.y, 0.86, 1.26) * front * mid;
    qz += u.uBelly.value * belB * s;
    const glB = gluteB * back * (1 - smoothstep(0.07, 0.17, lateral));
    qz -= u.uGlute.value * glB * s;
  }
  if (mask.breast) {
    const brB = mbump(p.y, 1.19, 1.37) * mbump(lateral, 0.035, 0.175) * smoothstep(0.03, 0.10, p.z);
    qz += u.uBreast.value * brB * s;
    qy += u.uBreast.value * brB * s * -0.25;
  }
  return out.set(qx, qy, qz);
}

/** Approximate inverse (2 fixed-point iterations) — used to raycast against unmorphed geometry. */
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

/** Set body parameters. All optional. */
export function setBody(opts = {}) {
  const map = { scale: 'uScale', headF: 'uHeadF', shW: 'uShW', hipW: 'uHipW', belly: 'uBelly',
                breast: 'uBreast', limbW: 'uLimbW', waist: 'uWaist', glute: 'uGlute',
                thigh: 'uThigh', arm: 'uArm', chestD: 'uChestD' };
  for (const [k, uni] of Object.entries(map)) {
    if (opts[k] !== undefined && Number.isFinite(opts[k])) u[uni].value = opts[k];
  }
}

export function currentHeight() { return MODEL_HEIGHT * u.uScale.value; }
