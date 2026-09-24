import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import { EFFECT_KINDS } from '../data/targets.js';
import { closeSkinGaps, blendSkinBindings, orientSkin } from './skinweld.js';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

/**
 * Batched body renderer.
 *
 * The old renderer gave every anatomical part its own THREE.Mesh: 4,078 objects and
 * ~1,976 draw calls a frame, which is what made the app feel heavy. Here every part of a
 * system is merged into ONE geometry, so the whole body draws in about fifteen calls.
 *
 * Per-part control then has to live somewhere the GPU can read per vertex, so each vertex
 * carries its part's index and the shader looks that index up in two 1-pixel-tall data
 * textures:
 *
 *   partState  rgba = offset.xyz, visible
 *   partStyle  rgba = opacity, selected, effectKind, effectIntensity
 *
 * Hiding a part, selecting it, glowing it or exploding the whole body is then four floats
 * written to a texture — no scene-graph churn, no geometry rebuild.
 *
 * Picking does not need duplicate meshes: three.js reports the triangle it hit, and a
 * sorted table maps that triangle back to its part.
 */
export class BatchedBody {
  constructor(scene) {
    this.scene = scene;
    this.parts = [];            // registry parts, in batch order
    this.indexOf = new Map();   // partId -> slot
    this.bounds = [];           // THREE.Box3 per slot (model space, un-morphed)
    this.batches = [];          // { system, mesh, tri: Int32Array starts, slots: Int32Array }
    this.count = 0;
    this.width = 1;
    this.state = null;
    this.style = null;
    this.stateTex = null;
    this.styleTex = null;
    this.uPick = { value: 0 };  // shared by every batch material: 1 during a picking pass
    this._dirtyState = false;
    this._dirtyStyle = false;
  }

  /**
   * @param groups Map(systemKey -> [{ part, geometry }]) — geometry already baked into
   *               world space by the loader. Consumed and disposed here.
   * @param materialFor (systemKey) => THREE.Material  (will be patched for batching)
   * @param rig optional Rig — supplies each vertex's two bone bindings for posing
   */
  build(groups, materialFor, rig = null) {
    // 1. Assign every part a slot. A part can arrive as several primitives from the GLB,
    //    and they must share ONE slot — giving each its own would leave the earlier slots
    //    orphaned, so those pieces could never be hidden or styled again.
    for (const [, items] of groups) {
      for (const it of items) {
        const bb = it.geometry.boundingBox || (it.geometry.computeBoundingBox(), it.geometry.boundingBox);
        const existing = this.indexOf.get(it.part.id);
        if (existing !== undefined) { this.bounds[existing].union(bb); continue; }
        this.indexOf.set(it.part.id, this.parts.length);
        this.parts.push(it.part);
        this.bounds.push(bb.clone());
      }
    }
    this.count = this.parts.length;
    this.batchOf = new Int16Array(this.count);
    this.width = Math.max(1, THREE.MathUtils.ceilPowerOfTwo(this.count));

    this.state = new Float32Array(this.width * 4);
    this.style = new Float32Array(this.width * 4);
    for (let i = 0; i < this.count; i++) {
      this.state[i * 4 + 3] = 1;      // visible
      this.style[i * 4 + 0] = 1;      // opacity
    }
    this.stateTex = new THREE.DataTexture(this.state, this.width, 1, THREE.RGBAFormat, THREE.FloatType);
    this.styleTex = new THREE.DataTexture(this.style, this.width, 1, THREE.RGBAFormat, THREE.FloatType);
    this.stateTex.needsUpdate = this.styleTex.needsUpdate = true;

    // 2. merge each system into one geometry
    for (const [system, items] of groups) {
      const geoms = [];
      // The skin is a patchwork of region meshes. Make them one surface: close the small
      // gaps between neighbouring patches here, and blend their bone weights across the
      // seams once every patch has them (below). Only the skin this body shows: the
      // female chest surface lies over the male one and must not be stitched to it.
      const skin = system === 'integumentary'
        ? items.filter(it => !(it.part.sx && it.part.sx !== 'm') && !/hair/i.test(it.part.n) && it.geometry.index)
        : null;
      if (skin?.length) { this.skinFlipped = orientSkin(skin); closeSkinGaps(skin); }
      for (const it of items) {
        const g = it.geometry;
        const slot = this.indexOf.get(it.part.id);
        const n = g.attributes.position.count;

        // per-vertex: which part am I, what colour, which morph masks apply
        g.setAttribute('aPartIndex', new THREE.BufferAttribute(new Float32Array(n).fill(slot), 1));
        const col = new THREE.Color(it.part.c || '#cccccc');
        const cols = new Uint8Array(n * 3);
        const r = Math.round(col.r * 255), gg = Math.round(col.g * 255), b = Math.round(col.b * 255);
        for (let v = 0; v < n; v++) { cols[v * 3] = r; cols[v * 3 + 1] = gg; cols[v * 3 + 2] = b; }
        g.setAttribute('color', new THREE.BufferAttribute(cols, 3, true));
        // What tissue this is, for the body morph: 1 skin (carries the fat), 2 breast bulge
        // applies, 4 bone and cartilage (never grows with weight), 8 muscle.
        let mask = 0;
        if (it.part.sys === 'integumentary') mask |= 1;
        if (it.part.sys === 'integumentary' || it.part.sub === 'female surface' || it.part.g === 'female') mask |= 2;
        if (it.part.sys === 'skeletal' || it.part.sys === 'joints') mask |= 4;
        if (it.part.sys === 'muscular') mask |= 8;
        g.setAttribute('aMorphMask', new THREE.BufferAttribute(new Float32Array(n).fill(mask), 1));
        // Which two bones move this vertex, and how much of the first. Without a rig every
        // vertex binds to the root, which is the identity — so the attribute always exists
        // and the shader never needs to know whether posing is available.
        g.setAttribute('aSkin', rig ? rig.skinGeometry(g, it.part)
                                    : new THREE.BufferAttribute(rootOnlySkin(n), 3));

        if (!g.index) {
          const idx = new Uint32Array(n);
          for (let v = 0; v < n; v++) idx[v] = v;
          g.setIndex(new THREE.BufferAttribute(idx, 1));
        }
        geoms.push(g);
      }
      if (!geoms.length) continue;
      if (skin?.length && rig) blendSkinBindings(skin);

      const merged = mergeGeometries(geoms, false);
      for (const g of geoms) g.dispose();          // originals are no longer needed
      if (!merged) { console.warn('[batched] merge failed for', system); continue; }
      merged.computeBoundingBox();
      merged.computeBoundingSphere();

      const material = materialFor(system);
      patchForBatching(material, this);
      const mesh = new THREE.Mesh(merged, material);
      mesh.name = 'batch:' + system;
      mesh.frustumCulled = false;                  // parts move via the state texture
      mesh.userData.system = system;
      this.scene.add(mesh);

      this.batches.push({ system, mesh });
      for (const it of items) this.batchOf[this.indexOf.get(it.part.id)] = this.batches.length - 1;
    }
    this._findDominantBones();
    return this;
  }

  /**
   * Switch whole batches on and off from which parts are showing. A part hidden through
   * the state texture is only discarded per pixel, so its vertices still run the full
   * morph-and-pose shader. With only the muscles on, that was the entire body's worth of
   * vertex work for a third of the picture.
   */
  setBatchesFromParts() {
    const any = new Uint8Array(this.batches.length);
    for (let s = 0; s < this.count; s++) if (this.state[s * 4 + 3] > 0.5) any[this.batchOf[s]] = 1;
    for (let i = 0; i < this.batches.length; i++) this.batches[i].mesh.visible = !!any[i];
  }

  /**
   * Which bone carries most of each part.
   *
   * Everything that asks "where is this part?" — framing the camera on it, anchoring its
   * label, drawing its box — used to answer from the rest pose, so in Movement mode the
   * camera flew to where the structure sits on a STANDING body while the body on screen was
   * lying on a bench. One bone per part is enough to answer that properly: parts are small
   * next to the limb segments that move them, and the few that straddle a joint are off by
   * millimetres, not by the length of the body.
   */
  _findDominantBones() {
    this.dominant = new Int32Array(this.count);
    const tally = new Map();
    for (const b of this.batches) {
      const g = b.mesh.geometry;
      const ap = g.attributes.aPartIndex, sk = g.attributes.aSkin;
      if (!ap || !sk) continue;
      for (let i = 0; i < ap.count; i += 3) {
        const slot = ap.getX(i);
        let h = tally.get(slot);
        if (!h) { h = new Map(); tally.set(slot, h); }
        const bone = sk.getZ(i) >= 0.5 ? sk.getX(i) : sk.getY(i);
        h.set(bone, (h.get(bone) || 0) + 1);
      }
    }
    for (const [slot, h] of tally) {
      let best = 0, bestN = -1;
      for (const [bone, n] of h) if (n > bestN) { bestN = n; best = bone; }
      this.dominant[slot] = best;
    }
  }

  /**
   * Move an already-morphed point into the current pose. A no-op when nothing is posed, so
   * Explore, Systems and Age keep behaving exactly as before.
   */
  posedPoint(slot, v) {
    const rig = this.rig;
    if (!rig || !rig.ok || !rig.enabled.value || !this.dominant) return v;
    return rig.applyBone(this.dominant[slot], v);
  }

  /** Build BVHs in idle slices so a big body never blocks the first paint. */
  buildBVH(onDone) {
    let i = 0;
    const step = () => {
      const t0 = performance.now();
      while (i < this.batches.length && performance.now() - t0 < 14) {
        this.batches[i].mesh.geometry.computeBoundsTree({ targetLeafSize: 12 });
        i++;
      }
      // requestIdleCallback takes an options object, setTimeout takes a number — they
      // are not interchangeable with the same second argument.
      if (i < this.batches.length) {
        if (window.requestIdleCallback) window.requestIdleCallback(step, { timeout: 200 });
        else setTimeout(step, 1);
      }
      else onDone && onDone(this.batches.length);
    };
    step();
  }

  slot(partId) { return this.indexOf.get(partId); }
  partAt(slot) { return this.parts[slot]; }
  boundsOf(partId) { const s = this.indexOf.get(partId); return s === undefined ? null : this.bounds[s]; }

  // ---------------- per-part writes ----------------
  setVisible(slot, on) { const v = on ? 1 : 0; if (this.state[slot * 4 + 3] !== v) { this.state[slot * 4 + 3] = v; this._dirtyState = true; } }
  setOffset(slot, x, y, z) {
    const i = slot * 4;
    if (this.state[i] !== x || this.state[i + 1] !== y || this.state[i + 2] !== z) {
      this.state[i] = x; this.state[i + 1] = y; this.state[i + 2] = z; this._dirtyState = true;
    }
  }
  setStyle(slot, opacity, selected, effectKind, effectIntensity) {
    const i = slot * 4;
    if (this.style[i] !== opacity || this.style[i + 1] !== selected ||
        this.style[i + 2] !== effectKind || this.style[i + 3] !== effectIntensity) {
      this.style[i] = opacity; this.style[i + 1] = selected;
      this.style[i + 2] = effectKind; this.style[i + 3] = effectIntensity;
      this._dirtyStyle = true;
    }
  }
  isVisible(slot) { return this.state[slot * 4 + 3] > 0.5; }

  /** Push any pending texture writes. Returns true when something actually changed. */
  flush() {
    const changed = this._dirtyState || this._dirtyStyle;
    if (this._dirtyState) { this.stateTex.needsUpdate = true; this._dirtyState = false; }
    if (this._dirtyStyle) { this.styleTex.needsUpdate = true; this._dirtyStyle = false; }
    return changed;
  }

  setSystemVisible(system, on) {
    for (const b of this.batches) if (b.system === system) b.mesh.visible = on;
  }

  /**
   * Which part does a triangle in this batch belong to?
   *
   * Read it off the same vertex attribute the shader uses, rather than from a table of
   * triangle ranges: three-mesh-bvh reorders the index buffer in place while building the
   * tree, so after buildBVH() a triangle's position in that buffer says nothing about
   * which geometry it was merged from. The attribute travels with the vertex and stays
   * true, and the lookup is O(1) instead of a binary search.
   */
  partForTriangle(batch, faceIndex) {
    const g = batch.mesh.geometry;
    const vi = g.index ? g.index.getX(faceIndex * 3) : faceIndex * 3;
    return g.attributes.aPartIndex.getX(vi);
  }

  dispose() {
    for (const b of this.batches) {
      b.mesh.geometry.disposeBoundsTree?.();
      b.mesh.geometry.dispose();
      b.mesh.material.dispose();
      this.scene.remove(b.mesh);
    }
    this.stateTex?.dispose(); this.styleTex?.dispose();
    this.batches.length = 0;
  }
}

function rootOnlySkin(n) {
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a[i * 3 + 2] = 1;
  return a;
}

const KIND_INDEX = { positive: 1, negative: 2, strain: 3, neutral: 4, activation: 5 };
export function effectKindIndex(kind) { return KIND_INDEX[kind] || 0; }

/** GLSL constants for the four effect colours, so the shader needs no extra uniforms. */
function kindColorGLSL() {
  const c = (k) => { const col = new THREE.Color(EFFECT_KINDS[k].color); return `vec3(${col.r.toFixed(3)},${col.g.toFixed(3)},${col.b.toFixed(3)})`; };
  return `
// Muscle effort reads as heat: idle stays cool and recedes, working goes orange, near-
// maximal goes bright gold. A single hue with rising intensity would just look like a
// brighter muscle; the hue shift is what makes "how hard" legible at a glance. The top
// stop is gold, not white: white washed the hardest-working muscle out into a flat blank
// shape, which is the one muscle the viewer most needs to see the form of.
vec3 activationColor(float a){
  vec3 cool = vec3(0.16, 0.27, 0.46);
  vec3 warm = vec3(0.96, 0.46, 0.10);
  vec3 gold = vec3(1.00, 0.74, 0.18);
  vec3 hot  = vec3(1.00, 0.90, 0.52);
  if (a < 0.50) return mix(cool, warm, a / 0.50);
  if (a < 0.80) return mix(warm, gold, (a - 0.50) / 0.30);
  return mix(gold, hot, (a - 0.80) / 0.20);
}
vec3 effectColor(float k){
  if (k < 0.5) return vec3(0.0);
  if (k < 1.5) return ${c('positive')};
  if (k < 2.5) return ${c('negative')};
  if (k < 3.5) return ${c('strain')};
  return ${c('neutral')};
}`;
}

/**
 * Teach a material to read per-part state out of the two data textures.
 * Runs alongside the body morph, which patches the same shader for its own deformation.
 */
export function patchForBatching(material, body) {
  material.vertexColors = true;
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    shader.uniforms.uPartState = { value: body.stateTex };
    shader.uniforms.uPartStyle = { value: body.styleTex };
    shader.uniforms.uStateWidth = { value: body.width };
    shader.uniforms.uPick = body.uPick;

    shader.vertexShader = `
attribute float aPartIndex;
uniform sampler2D uPartState;
uniform sampler2D uPartStyle;
uniform float uStateWidth;
varying float vVisible;
varying vec4 vStyle;
varying float vPartIdx;
` + shader.vertexShader.replace('#include <begin_vertex>', `
#include <begin_vertex>
vec2 stateUv = vec2((aPartIndex + 0.5) / uStateWidth, 0.5);
vec4 partState = texture2D(uPartState, stateUv);
vStyle = texture2D(uPartStyle, stateUv);
vVisible = partState.w;
vPartIdx = aPartIndex;
transformed += partState.xyz;
`);

    shader.fragmentShader = `
varying float vVisible;
varying vec4 vStyle;
varying float vPartIdx;
uniform float uPick;
${kindColorGLSL()}
` + shader.fragmentShader
      .replace('#include <clipping_planes_fragment>', `
#include <clipping_planes_fragment>
if (vVisible < 0.5) discard;
`)
      .replace('#include <color_fragment>', `
#include <color_fragment>
// selected parts brighten in their own hue; a flat gold wash would hide the organ
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.35 + vec3(0.16, 0.13, 0.03), vStyle.y);
diffuseColor.a *= vStyle.x;
`)
      .replace('#include <dithering_fragment>', `
#include <dithering_fragment>
if (vStyle.z > 4.5) {
  // Tint the lit surface rather than paint over it. The light and dark of the shading is
  // what shows a muscle's shape and fibre direction, and a flat fill threw it away.
  vec3 ac = activationColor(vStyle.w);
  float lum = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
  // Scaled so a fully lit face lands at the colour itself and a face in shadow stays dark:
  // the output here is already tone-mapped, so anything brighter just clips to a flat fill.
  vec3 tinted = ac * (0.12 + 1.05 * lum);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, tinted, 0.35 + 0.45 * vStyle.w);
  // A glow only the hardest-working muscles get, so the leader stands out from a distance.
  gl_FragColor.rgb += ac * vStyle.w * vStyle.w * 0.08;
} else {
  gl_FragColor.rgb += effectColor(vStyle.z) * vStyle.w * 0.55;
}
// Picking pass: write which part this is instead of its colour. It runs through the same
// morph and skinning as the picture, so it finds whatever is on screen in any pose.
// Ghosted layers are click-through as they are see-through: a click on a muscle seen
// through faint skin should land on the muscle.
if (uPick > 0.5) {
  if (vStyle.x < 0.35) discard;
  float id = floor(vPartIdx + 0.5) + 1.0;
  gl_FragColor = vec4(mod(id, 256.0), mod(floor(id / 256.0), 256.0), floor(id / 65536.0), 255.0) / 255.0;
}
`);
  };
  const key = material.customProgramCacheKey;
  material.customProgramCacheKey = () => 'batched|' + (key ? key.call(material) : material.uuid);
  material.needsUpdate = true;
}
