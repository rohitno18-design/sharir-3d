import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { patchMaterial } from './morph.js';
import { GLB_FILES } from '../data/systems.js';

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

export function makeMaterial(part, colorHex, opts = {}) {
  const st = STYLE[part.sys] || STYLE.digestive;
  const mat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(colorHex),
    roughness: st.roughness, metalness: st.metalness,
    clearcoat: st.clearcoat || 0, clearcoatRoughness: st.clearcoatRoughness ?? 0.4,
    envMapIntensity: 0.55,
    side: THREE.FrontSide,
  });
  mat.userData.baseColor = mat.color.clone();
  mat.userData.baseOpacity = opts.opacity ?? 1;
  if (part.sys === 'integumentary' || part.sys === 'cavities') {
    mat.transparent = true; mat.depthWrite = false; mat.opacity = mat.userData.baseOpacity;
  }
  patchMaterial(mat, { belly: part.sys === 'integumentary', breast: part.sys === 'integumentary' || part.g === 'female' });
  return mat;
}

/**
 * Load all GLBs, bake transforms, attach meshes to viewer.systemGroups.
 * Returns Map(partId → Mesh).
 */
export async function loadBody(viewer, registry, onProgress = () => {}) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const meshes = new Map();
  const sizes = { skeletal: 6.7, muscular: 6.5, nervous: 6.7, cardiovascular: 5.2, visceral: 3.3, joints: 1.4, lymphoid: 0.5, regions: 0.9, references: 0.1, extra: 0.4 };
  const total = Object.values(sizes).reduce((a, b) => a + b, 0);
  const progress = Object.fromEntries(GLB_FILES.map(k => [k, 0]));
  const report = (label) => {
    const done = GLB_FILES.reduce((a, k) => a + progress[k] * sizes[k], 0);
    onProgress(done / total, label);
  };

  const order = ['skeletal', 'muscular', 'cardiovascular', 'visceral', 'nervous', 'joints', 'lymphoid', 'regions', 'references', 'extra'];
  const tasks = order.map(async (glb) => {
    const url = `/models/${glb}.glb`;
    let gltf;
    try {
      const head = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-3' } });
      const magic = new Uint8Array(await head.arrayBuffer());
      if (!(magic[0] === 0x67 && magic[1] === 0x6c && magic[2] === 0x54 && magic[3] === 0x46)) throw new Error('not a glb');
      gltf = await new Promise((res, rej) => loader.load(url, res, (ev) => {
        if (ev.total) { progress[glb] = Math.min(0.95, ev.loaded / ev.total); report(`Loading ${glb}…`); }
      }, rej));
    } catch (e) {
      console.error('failed', url, e); progress[glb] = 1; report(''); return;
    }
    integrate(glb, gltf.scene, viewer, registry, meshes);
    progress[glb] = 1; report(`Built ${glb}`);
  });
  await Promise.all(tasks);
  viewer.pickables = [...meshes.values()].filter(m => m.userData.part.k === 'mesh');
  const n = buildBVHs(viewer, (c) => console.log(`[sharir] BVH built for ${c} meshes`));
  onProgress(1, `Indexing ${n} meshes…`);
  return meshes;
}

function integrate(glb, root, viewer, registry, meshes) {
  root.updateMatrixWorld(true);
  const list = [];
  root.traverse(o => { if (o.isMesh) list.push(o); });
  // Count how many nodes share each geometry: shared ones must be cloned from the
  // pristine original before baking, or the second bake stacks on the first.
  const useCount = new Map();
  for (const m of list) useCount.set(m.geometry, (useCount.get(m.geometry) || 0) + 1);
  for (const m of list) {
    // find registry part: this node or nearest named ancestor
    let node = m, part = null;
    while (node && node !== root) {
      part = registry.bySanitized.get(glb + '/' + node.name);
      if (part) break;
      node = node.parent;
    }
    if (!part) { continue; }
    if (part.k === 'marker') continue; // tiny anchor cubes — positions already in registry
    // meshopt files store positions as normalized 16-bit ints inside one shared
    // interleaved buffer. Baking world coordinates into that would overflow the
    // integer range and corrupt every other mesh in the buffer, so every geometry
    // gets its own plain float attributes first.
    let geom = m.geometry;
    if (useCount.get(geom) > 1) geom = geom.clone();
    toFloatAttributes(geom);
    geom.applyMatrix4(m.matrixWorld);
    // Mirrored objects (negative scale) come out with reversed winding, so their
    // front faces get culled. Flip the triangle order back.
    if (m.matrixWorld.determinant() < 0) flipWinding(geom);
    if (!geom.attributes.normal) geom.computeVertexNormals();
    geom.computeBoundingBox();
    geom.computeBoundingSphere();
    const mesh = new THREE.Mesh(geom, makeMaterial(part, part.c || '#cccccc'));
    mesh.name = part.n;
    mesh.userData.part = part;
    mesh.userData.partId = part.id;
    mesh.frustumCulled = true;
    mesh.matrixAutoUpdate = true;
    if (part.k !== 'mesh') mesh.visible = false; // origin/insertion maps hidden until requested
    const grp = viewer.systemGroups[part.sys] || viewer.systemGroups.cavities;
    grp.add(mesh);
    if (meshes.has(part.id)) {
      // multi-primitive: keep a list
      const prev = meshes.get(part.id);
      (prev.userData.extra ||= []).push(mesh);
      mesh.userData.primary = prev;
    } else {
      meshes.set(part.id, mesh);
    }
  }
}

function flipWinding(geom) {
  if (geom.index) {
    const a = geom.index.array;
    for (let i = 0; i < a.length; i += 3) { const t = a[i]; a[i] = a[i + 2]; a[i + 2] = t; }
    geom.index.needsUpdate = true;
  } else {
    const p = geom.attributes.position, n = geom.attributes.normal;
    for (const attr of [p, n]) {
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

/** De-interleave + de-normalize into standalone Float32 attributes; drop the rest. */
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
      if (n > 3) arr[i * n + 3] = a.getW(i);
    }
    geom.setAttribute(name, new THREE.BufferAttribute(arr, n, false));
  }
  if (geom.index && geom.index.isInterleavedBufferAttribute) {
    const idx = new Uint32Array(geom.index.count);
    for (let i = 0; i < geom.index.count; i++) idx[i] = geom.index.getX(i);
    geom.setIndex(new THREE.BufferAttribute(idx, 1));
  }
}

/** Build BVH acceleration structures for every mesh, in idle slices so the UI stays responsive. */
export function buildBVHs(viewer, onDone = () => {}) {
  const all = [];
  for (const grp of Object.values(viewer.systemGroups)) for (const c of grp.children) if (!c.geometry.boundsTree) all.push(c);
  let i = 0;
  const idle = window.requestIdleCallback ? (fn) => window.requestIdleCallback(fn, { timeout: 200 }) : (fn) => setTimeout(fn, 1);
  const step = () => {
    const t0 = performance.now();
    while (i < all.length && performance.now() - t0 < 14) { try { all[i].geometry.computeBoundsTree({ targetLeafSize: 8 }); } catch (e) { /* skip degenerate */ } i++; }
    if (i < all.length) idle(step); else onDone(all.length);
  };
  idle(step);
  return all.length;
}
