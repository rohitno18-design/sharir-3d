import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { patchMaterial } from './morph.js';
import { BatchedBody } from './batched.js';
import { Rig, patchForRig } from './rig.js';
import { SYSTEMS, GLB_FILES } from '../data/systems.js';

const STYLE = {
  skeletal:       { roughness: 0.62, metalness: 0, clearcoat: 0.05 },
  joints:         { roughness: 0.5,  metalness: 0, clearcoat: 0.25 },
  muscular:       { roughness: 0.42, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.5 },
  nervous:        { roughness: 0.5,  metalness: 0, clearcoat: 0.15 },
  senses:         { roughness: 0.3,  metalness: 0, clearcoat: 0.6 },
  cardiovascular: { roughness: 0.38, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.4 },
  lymphoid:       { roughness: 0.45, metalness: 0, clearcoat: 0.3 },
  respiratory:    { roughness: 0.45, metalness: 0, clearcoat: 0.35 },
  digestive:      { roughness: 0.4,  metalness: 0, clearcoat: 0.45, clearcoatRoughness: 0.45 },
  urinary:        { roughness: 0.4,  metalness: 0, clearcoat: 0.45 },
  reproductive:   { roughness: 0.42, metalness: 0, clearcoat: 0.4 },
  endocrine:      { roughness: 0.45, metalness: 0, clearcoat: 0.35 },
  cavities:       { roughness: 0.6,  metalness: 0, clearcoat: 0.1 },
  integumentary:  { roughness: 0.72, metalness: 0, clearcoat: 0.08 },
  references:     { roughness: 0.9,  metalness: 0 },
};

/** Systems whose parts are routinely shown semi-transparent. */
const TRANSPARENT = new Set(['integumentary', 'cavities']);

/** One material per system — the batch it draws carries per-part colour as vertex colours. */
export function systemMaterial(system, rig) {
  const st = STYLE[system] || STYLE.digestive;
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,                       // vertex colours carry the real hue
    roughness: st.roughness, metalness: st.metalness,
    clearcoat: st.clearcoat || 0, clearcoatRoughness: st.clearcoatRoughness ?? 0.4,
    envMapIntensity: 0.55,
    // Skin is the body's outer surface and only its outside should ever show. Drawn
    // double-sided, its inside faces came through as flat planes across the face and dark
    // cracks over the body. Everything else stays double-sided: many inner structures are
    // open sheets that have to read from both sides.
    side: system === 'integumentary' ? THREE.FrontSide : THREE.DoubleSide,
    transparent: true,                     // per-part opacity comes from the style texture
    depthWrite: !TRANSPARENT.has(system),
    // three.js draws a transparent DOUBLE-SIDED material in two passes (back faces, then
    // front). Across the whole atlas that doubled the triangle count for no visible gain,
    // so ask for the single pass explicitly.
    forceSinglePass: true,
  });
  // A see-through system must not write depth while it is see-through, or its far side
  // hides behind its near side in patches. Opaque, it must: the highlighter switches this
  // per frame from what is actually showing.
  mat.userData.ghostable = TRANSPARENT.has(system);
  // The skin over the shoulders blends three bones (see skinOverGirdle in skinweld.js).
  // So do the neck muscles bound along their fibres (Rig.blendFibreTrunks), and the nerves
  // and vessels that copy a muscle's binding (followSkinBinding).
  if (['integumentary', 'muscular', 'nervous', 'cardiovascular'].includes(system)) mat.defines = { ...(mat.defines || {}), SHARIR_SKIN3: '' };
  patchMaterial(mat);                      // body morph runs first…
  if (rig) patchForRig(mat, rig);          // …then the pose…
  return mat;                              // …and batching patches on top of both
}

/**
 * Load every GLB, bake transforms, then merge each system into a single batch.
 * Returns { body: BatchedBody, partCount }.
 */
export async function loadBody(viewer, registry, onProgress = () => {}) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const sizes = { skeletal: 6.7, muscular: 6.5, nervous: 6.7, cardiovascular: 5.2, visceral: 3.3, joints: 1.4, lymphoid: 0.5, regions: 0.9, references: 0.1, extra: 0.6 };
  const total = Object.values(sizes).reduce((a, b) => a + b, 0);
  const progress = Object.fromEntries(GLB_FILES.map(k => [k, 0]));
  const report = (label) => {
    const done = GLB_FILES.reduce((a, k) => a + progress[k] * (sizes[k] || 0), 0);
    onProgress(done / total * 0.86, label);
  };

  // system -> [{ part, geometry }], in a stable order
  const groups = new Map(SYSTEMS.map(s => [s.key, []]));

  const order = ['skeletal', 'muscular', 'cardiovascular', 'visceral', 'nervous', 'joints', 'lymphoid', 'regions', 'references', 'extra'];
  await Promise.all(order.map(async (glb) => {
    // __MODELS_ID__ changes whenever a .glb on disk changes — see vite.config.js.
    const url = `/models/${glb}.glb?v=${__MODELS_ID__}`;
    let gltf;
    try {
      gltf = await new Promise((res, rej) => loader.load(url, res, (ev) => {
        if (ev.total) { progress[glb] = Math.min(0.95, ev.loaded / ev.total); report(`Loading ${glb}…`); }
      }, rej));
    } catch (e) {
      console.error('[loader] failed', url, e); progress[glb] = 1; report(''); return;
    }
    collect(glb, gltf.scene, registry, groups);
    progress[glb] = 1; report(`Built ${glb}`);
  }));

  onProgress(0.89, 'Building the skeleton rig…');
  // The rig reads finger joints off the bones' own geometry, so it needs to see it before
  // the geometry is merged away into batches.
  const rig = new Rig(registry, groups);

  onProgress(0.9, 'Merging geometry…');
  const body = new BatchedBody(viewer.bodyRoot).build(groups, (sys) => systemMaterial(sys, rig), rig);
  rig.releaseGeometry();
  body.rig = rig;
  onProgress(0.96, `Indexing ${body.count} structures…`);
  body.buildBVH((n) => console.log(`[sharir] BVH ready for ${n} batches`));
  viewer.body = body;
  viewer.rig = rig;
  return body;
}

function collect(glb, root, registry, groups) {
  root.updateMatrixWorld(true);
  const list = [];
  root.traverse(o => { if (o.isMesh) list.push(o); });
  // Shared geometry must be cloned from the pristine original before baking, or the
  // second bake stacks on top of the first.
  const useCount = new Map();
  for (const m of list) useCount.set(m.geometry, (useCount.get(m.geometry) || 0) + 1);

  for (const m of list) {
    let node = m, part = null;
    while (node && node !== root) {
      part = registry.bySanitized.get(glb + '/' + node.name);
      if (part) break;
      node = node.parent;
    }
    if (!part) continue;
    if (part.k !== 'mesh') continue;            // markers, landmarks and attachment maps are data, not geometry

    // meshopt stores positions as normalised 16-bit ints inside one shared interleaved
    // buffer; baking world coordinates into that would overflow the range and corrupt
    // every other mesh in the buffer, so each geometry gets plain float attributes first.
    let geom = m.geometry;
    if (useCount.get(geom) > 1) geom = geom.clone();
    toFloatAttributes(geom);
    geom.applyMatrix4(m.matrixWorld);
    if (m.matrixWorld.determinant() < 0) flipWinding(geom);   // mirrored parts come out inside-out
    if (!geom.attributes.normal) geom.computeVertexNormals();
    geom.computeBoundingBox();

    const bucket = groups.get(part.sys) || groups.get('cavities');
    bucket.push({ part, geometry: geom });
  }
}

function flipWinding(geom) {
  if (geom.index) {
    const a = geom.index.array;
    for (let i = 0; i < a.length; i += 3) { const t = a[i]; a[i] = a[i + 2]; a[i + 2] = t; }
    geom.index.needsUpdate = true;
  } else {
    for (const attr of [geom.attributes.position, geom.attributes.normal]) {
      if (!attr) continue;
      const a = attr.array, s = attr.itemSize;
      for (let i = 0; i < attr.count; i += 3) {
        for (let c = 0; c < s; c++) { const t = a[i * s + c]; a[i * s + c] = a[(i + 2) * s + c]; a[(i + 2) * s + c] = t; }
      }
      attr.needsUpdate = true;
    }
  }
}

const KEEP_ATTRS = ['position', 'normal'];

/** De-interleave + de-normalise into standalone Float32 attributes; drop everything else
 *  so that merging across files never hits mismatched attribute sets. */
function toFloatAttributes(geom) {
  for (const name of Object.keys(geom.attributes)) {
    if (!KEEP_ATTRS.includes(name)) { geom.deleteAttribute(name); continue; }
    const a = geom.attributes[name];
    if (!a.isInterleavedBufferAttribute && !a.normalized && a.array instanceof Float32Array) continue;
    const n = a.itemSize, arr = new Float32Array(a.count * n);
    for (let i = 0; i < a.count; i++) {
      arr[i * n] = a.getX(i);
      if (n > 1) arr[i * n + 1] = a.getY(i);
      if (n > 2) arr[i * n + 2] = a.getZ(i);
    }
    geom.setAttribute(name, new THREE.BufferAttribute(arr, n));
  }
}
