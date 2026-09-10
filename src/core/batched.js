import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import { EFFECT_KINDS } from '../data/targets.js';

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
    this._dirtyState = false;
    this._dirtyStyle = false;
  }

  /**
   * @param groups Map(systemKey -> [{ part, geometry }]) — geometry already baked into
   *               world space by the loader. Consumed and disposed here.
   * @param materialFor (systemKey) => THREE.Material  (will be patched for batching)
   */
  build(groups, materialFor) {
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
      const slots = [];
      const triStarts = [];
      let tri = 0;
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
        // 1 = belly bulge applies, 2 = breast bulge applies
        let mask = 0;
        if (it.part.sys === 'integumentary') mask |= 1;
        if (it.part.sys === 'integumentary' || it.part.sub === 'female surface' || it.part.g === 'female') mask |= 2;
        g.setAttribute('aMorphMask', new THREE.BufferAttribute(new Float32Array(n).fill(mask), 1));

        if (!g.index) {
          const idx = new Uint32Array(n);
          for (let v = 0; v < n; v++) idx[v] = v;
          g.setIndex(new THREE.BufferAttribute(idx, 1));
        }
        // One range per primitive; consecutive primitives of the same part collapse,
        // since the triangle -> part lookup only needs the boundaries.
        if (slots.length === 0 || slots[slots.length - 1] !== slot) {
          triStarts.push(tri);
          slots.push(slot);
        }
        tri += g.index.count / 3;
        geoms.push(g);
      }
      if (!geoms.length) continue;

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

      this.batches.push({
        system, mesh,
        triStarts: Int32Array.from(triStarts),
        slots: Int32Array.from(slots),
        triTotal: tri,
      });
    }
    return this;
  }

  /** Build BVHs in idle slices so a big body never blocks the first paint. */
  buildBVH(onDone) {
    let i = 0;
    const step = () => {
      const t0 = performance.now();
      while (i < this.batches.length && performance.now() - t0 < 14) {
        this.batches[i].mesh.geometry.computeBoundsTree({ maxLeafTris: 12 });
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

  /** Which part does a triangle in this batch belong to? */
  partForTriangle(batch, faceIndex) {
    const starts = batch.triStarts;
    let lo = 0, hi = starts.length - 1, ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid] <= faceIndex) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return batch.slots[ans];
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

const KIND_INDEX = { positive: 1, negative: 2, strain: 3, neutral: 4 };
export function effectKindIndex(kind) { return KIND_INDEX[kind] || 0; }

/** GLSL constants for the four effect colours, so the shader needs no extra uniforms. */
function kindColorGLSL() {
  const c = (k) => { const col = new THREE.Color(EFFECT_KINDS[k].color); return `vec3(${col.r.toFixed(3)},${col.g.toFixed(3)},${col.b.toFixed(3)})`; };
  return `
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

    shader.vertexShader = `
attribute float aPartIndex;
uniform sampler2D uPartState;
uniform sampler2D uPartStyle;
uniform float uStateWidth;
varying float vVisible;
varying vec4 vStyle;
` + shader.vertexShader.replace('#include <begin_vertex>', `
#include <begin_vertex>
vec2 stateUv = vec2((aPartIndex + 0.5) / uStateWidth, 0.5);
vec4 partState = texture2D(uPartState, stateUv);
vStyle = texture2D(uPartStyle, stateUv);
vVisible = partState.w;
transformed += partState.xyz;
`);

    shader.fragmentShader = `
varying float vVisible;
varying vec4 vStyle;
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
vec3 fx = effectColor(vStyle.z);
gl_FragColor.rgb += fx * vStyle.w * 0.55;
`);
  };
  const key = material.customProgramCacheKey;
  material.customProgramCacheKey = () => 'batched|' + (key ? key.call(material) : material.uuid);
  material.needsUpdate = true;
}
