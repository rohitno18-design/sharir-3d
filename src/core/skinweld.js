import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * The atlas builds the skin out of separate region patches: pectoral, deltoid, anterior
 * thigh and so on. Their edges were meant to meet, and mostly do, but about a fifth of the
 * edge points stop one to ten millimetres short of the next patch. Every one of those gaps
 * shows as a dark crack in the skin.
 *
 * Two passes make the patches behave as one surface:
 *
 * - `closeSkinGaps` moves each edge point halfway to the nearest edge of a neighbouring
 *   patch, measured to the edge itself and not to its nearest point, so it works where
 *   the two sides are cut into different lengths.
 * - `blendSkinBindings` gives the skin across a seam the same bones. A trunk patch binds to
 *   the trunk and an arm patch to the arm, so where they meet the two edges moved apart as
 *   soon as the arm moved or grew. The weights are averaged over a few rings either side,
 *   so the skin over the shoulder and the hip stretches instead of splitting.
 */
const GAP = 0.0065;          // edges further apart than this are not the same seam
const CELL = 0.01;

function key(x, y, z) { return `${Math.floor(x / CELL)},${Math.floor(y / CELL)},${Math.floor(z / CELL)}`; }

/**
 * Where two patch edges lying close together are NOT a seam. The face has real openings
 * (eyelids, lips, nostrils); neighbouring fingers and toes lie a few millimetres apart; the
 * genitals rest against the thighs. Stitching any of those shut is worse than a crack.
 */
const LOOSE = /penis|scrot|glans|prepuce|nipple|areola|umbilic/i;
function stitchable(x, y, z, name) {
  if (y > 1.50) return false;                                // head and face
  if (Math.abs(x) > 0.20 && y < 0.97) return false;          // hands, hanging by the thighs
  if (y < 0.10) return false;                                // feet
  return !LOOSE.test(name || '');
}
/** Two edges belong to one seam only if they run alongside each other. */
const PARALLEL = 0.6;

/** Boundary edges of one indexed geometry: edges used by exactly one triangle. */
function boundaryEdges(geom) {
  const idx = geom.index;
  const count = new Map();
  const n = geom.attributes.position.count;
  const k = (a, b) => (a < b ? a * n + b : b * n + a);
  const tri = (f) => [idx ? idx.getX(f) : f, idx ? idx.getX(f + 1) : f + 1, idx ? idx.getX(f + 2) : f + 2];
  const faces = idx ? idx.count : n;
  for (let f = 0; f < faces; f += 3) {
    const v = tri(f);
    for (let e = 0; e < 3; e++) { const kk = k(v[e], v[(e + 1) % 3]); count.set(kk, (count.get(kk) || 0) + 1); }
  }
  const edges = [];
  for (const [kk, c] of count) if (c === 1) edges.push([Math.floor(kk / n), kk % n]);
  return edges;
}

/** @param items [{ part, geometry }] of one system, in rest space. Moves points in place. */
export function closeSkinGaps(items) {
  const patches = items.map((it, pi) => ({ pi, g: it.geometry, edges: boundaryEdges(it.geometry) }));
  // Every boundary edge, filed under each grid cell its box touches.
  const grid = new Map();
  const A = new THREE.Vector3(), B = new THREE.Vector3();
  for (const p of patches) {
    const pos = p.g.attributes.position;
    for (const [a, b] of p.edges) {
      A.fromBufferAttribute(pos, a); B.fromBufferAttribute(pos, b);
      const x0 = Math.floor((Math.min(A.x, B.x) - GAP) / CELL), x1 = Math.floor((Math.max(A.x, B.x) + GAP) / CELL);
      const y0 = Math.floor((Math.min(A.y, B.y) - GAP) / CELL), y1 = Math.floor((Math.max(A.y, B.y) + GAP) / CELL);
      const z0 = Math.floor((Math.min(A.z, B.z) - GAP) / CELL), z1 = Math.floor((Math.max(A.z, B.z) + GAP) / CELL);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
        const kk = `${x},${y},${z}`;
        if (!grid.has(kk)) grid.set(kk, []);
        grid.get(kk).push({ pi: p.pi, a, b });
      }
    }
  }
  const P = new THREE.Vector3(), Q = new THREE.Vector3(), best = new THREE.Vector3(), seg = new THREE.Vector3();
  const moves = [];
  for (const p of patches) {
    const pos = p.g.attributes.position;
    const name = items[p.pi].part.n;
    // Each edge point's own direction along its patch's edge.
    const dir = new Map();
    for (const [a, b] of p.edges) {
      A.fromBufferAttribute(pos, a); B.fromBufferAttribute(pos, b);
      const d = B.clone().sub(A).normalize();
      for (const v of [a, b]) { const o = dir.get(v); if (o) o.add(o.dot(d) < 0 ? d.clone().negate() : d); else dir.set(v, d.clone()); }
    }
    const seen = new Set();
    for (const [a, b] of p.edges) for (const v of [a, b]) {
      if (seen.has(v)) continue;
      seen.add(v);
      P.fromBufferAttribute(pos, v);
      if (!stitchable(P.x, P.y, P.z, name)) continue;
      const own = dir.get(v).clone().normalize();
      const cands = grid.get(key(P.x, P.y, P.z));
      if (!cands) continue;
      let bestD = GAP;
      let found = false;
      for (const c of cands) {
        if (c.pi === p.pi) continue;
        if (LOOSE.test(items[c.pi].part.n)) continue;
        const op = patches[c.pi].g.attributes.position;
        A.fromBufferAttribute(op, c.a); B.fromBufferAttribute(op, c.b);
        seg.subVectors(B, A);
        if (Math.abs(seg.clone().normalize().dot(own)) < PARALLEL) continue;
        const l2 = seg.lengthSq();
        const t = l2 > 0 ? Math.min(1, Math.max(0, Q.subVectors(P, A).dot(seg) / l2)) : 0;
        Q.copy(A).addScaledVector(seg, t);
        const d = Q.distanceTo(P);
        if (d < bestD) { bestD = d; best.copy(Q); found = true; }
      }
      if (found && bestD > 1e-5) moves.push([pos, v, best.x, best.y, best.z]);
    }
  }
  // Meet in the middle: both sides move, so neither patch is dragged the whole way.
  for (const [pos, v, x, y, z] of moves) {
    pos.setXYZ(v, (pos.getX(v) + x) / 2, (pos.getY(v) + y) / 2, (pos.getZ(v) + z) / 2);
  }
  for (const it of items) { it.geometry.attributes.position.needsUpdate = true; it.geometry.computeBoundingBox(); }
  return moves.length;
}

/**
 * Average the bone weights across skin seams. Call after every item has its `aSkin`.
 * Works on the skin as one graph: triangle edges inside each patch, plus a link from each
 * edge point to the nearest point on the patch beside it.
 */
export function blendSkinBindings(items, { rings = 8, passes = 18 } = {}) {
  // Global vertex numbering across patches.
  const offs = [];
  let total = 0;
  for (const it of items) { offs.push(total); total += it.geometry.attributes.position.count; }
  const px = new Float32Array(total * 3);
  const weights = new Array(total);             // Map(bone -> weight)
  items.forEach((it, i) => {
    const pos = it.geometry.attributes.position, sk = it.geometry.attributes.aSkin;
    for (let v = 0; v < pos.count; v++) {
      const g = offs[i] + v;
      px[g * 3] = pos.getX(v); px[g * 3 + 1] = pos.getY(v); px[g * 3 + 2] = pos.getZ(v);
      const a = sk.getX(v), b = sk.getY(v), w = Math.min(1, Math.max(0, sk.getZ(v)));
      const m = new Map();
      m.set(a, w);
      if (w < 1) m.set(b, (m.get(b) || 0) + 1 - w);
      weights[g] = m;
    }
  });
  // Neighbours: within each patch from its triangles...
  const nbr = Array.from({ length: total }, () => []);
  items.forEach((it, i) => {
    const idx = it.geometry.index, n = it.geometry.attributes.position.count;
    const faces = idx ? idx.count : n;
    for (let f = 0; f < faces; f += 3) {
      const v = [0, 1, 2].map(k => offs[i] + (idx ? idx.getX(f + k) : f + k));
      nbr[v[0]].push(v[1], v[2]); nbr[v[1]].push(v[0], v[2]); nbr[v[2]].push(v[0], v[1]);
    }
  });
  // ...and across seams, edge point to the nearest point of another patch.
  const grid = new Map();
  const owner = new Int32Array(total);
  items.forEach((it, i) => { const n = it.geometry.attributes.position.count; for (let v = 0; v < n; v++) owner[offs[i] + v] = i; });
  for (let g = 0; g < total; g++) {
    const kk = key(px[g * 3], px[g * 3 + 1], px[g * 3 + 2]);
    if (!grid.has(kk)) grid.set(kk, []);
    grid.get(kk).push(g);
  }
  const boundary = new Uint8Array(total);
  items.forEach((it, i) => { for (const [a, b] of boundaryEdges(it.geometry)) { boundary[offs[i] + a] = 1; boundary[offs[i] + b] = 1; } });
  const names = items.map(it => it.part.n);
  for (let g = 0; g < total; g++) {
    if (!boundary[g]) continue;
    const x = px[g * 3], y = px[g * 3 + 1], z = px[g * 3 + 2];
    if (!stitchable(x, y, z, names[owner[g]])) continue;
    const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL), cz = Math.floor(z / CELL);
    let best = -1, bestD = GAP;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const l = grid.get(`${cx + dx},${cy + dy},${cz + dz}`);
      if (!l) continue;
      for (const h of l) {
        if (owner[h] === owner[g] || !boundary[h] || LOOSE.test(names[owner[h]])) continue;
        const d = Math.hypot(px[h * 3] - x, px[h * 3 + 1] - y, px[h * 3 + 2] - z);
        if (d < bestD) { bestD = d; best = h; }
      }
    }
    if (best >= 0) { nbr[g].push(best); nbr[best].push(g); }
  }

  // Where does the binding change? Only there, and a few rings round it, gets smoothed.
  const differs = (m1, m2) => {
    let d = 0;
    for (const [k, w] of m1) d += Math.abs(w - (m2.get(k) || 0));
    for (const [k, w] of m2) if (!m1.has(k)) d += w;
    return d > 0.15;
  };
  let front = [];
  const inRegion = new Uint8Array(total);
  for (let g = 0; g < total; g++) {
    for (const h of nbr[g]) if (differs(weights[g], weights[h])) { inRegion[g] = 1; front.push(g); break; }
  }
  for (let r = 0; r < rings; r++) {
    const next = [];
    for (const g of front) for (const h of nbr[g]) if (!inRegion[h]) { inRegion[h] = 1; next.push(h); }
    front = next;
  }
  const region = [];
  for (let g = 0; g < total; g++) if (inRegion[g]) region.push(g);

  for (let pass = 0; pass < passes; pass++) {
    const out = new Map();
    for (const g of region) {
      const acc = new Map(weights[g]);
      for (const [k, w] of acc) acc.set(k, w * 0.5);
      const ns = nbr[g];
      if (!ns.length) continue;
      const share = 0.5 / ns.length;
      for (const h of ns) for (const [k, w] of weights[h]) acc.set(k, (acc.get(k) || 0) + w * share);
      out.set(g, acc);
    }
    for (const [g, m] of out) weights[g] = m;
  }

  // Points that touch across a seam must end up with exactly the same weights, or the
  // smallest difference opens a gap as soon as a limb moves. Group every set of touching
  // points and give each group its average.
  const TOUCH = 0.0006;
  const parent = new Int32Array(total);
  for (let g = 0; g < total; g++) parent[g] = g;
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (let g = 0; g < total; g++) {
    if (!inRegion[g]) continue;
    const x = px[g * 3], y = px[g * 3 + 1], z = px[g * 3 + 2];
    const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL), cz = Math.floor(z / CELL);
    // Points that already coincide belong together anywhere; only nearby-but-apart
    // points are held to the seam rule, and 0.6 mm is well inside any real opening.
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const l = grid.get(`${cx + dx},${cy + dy},${cz + dz}`);
      if (!l) continue;
      for (const h of l) {
        if (h <= g || Math.hypot(px[h * 3] - x, px[h * 3 + 1] - y, px[h * 3 + 2] - z) > TOUCH) continue;
        inRegion[h] = 1;
        const ra = find(g), rb = find(h);
        if (ra !== rb) parent[ra] = rb;
      }
    }
  }
  const groups = new Map();
  for (let g = 0; g < total; g++) {
    if (!inRegion[g]) continue;
    const r = find(g);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(g);
  }
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const avg = new Map();
    for (const g of members) for (const [k, w] of weights[g]) avg.set(k, (avg.get(k) || 0) + w / members.length);
    for (const g of members) weights[g] = avg;
  }

  // Back to two bones per vertex, as the shader takes them. A merged vertex may carry more
  // than two bones; it keeps the two heaviest, chosen the same way for every member of a
  // group, so the group still moves as one.
  let changed = 0;
  items.forEach((it, i) => {
    const sk = it.geometry.attributes.aSkin, n = it.geometry.attributes.position.count;
    for (let v = 0; v < n; v++) {
      const g = offs[i] + v;
      if (!inRegion[g]) continue;
      const top = [...weights[g]].sort((p, q) => q[1] - p[1]);
      const [a, wa] = top[0];
      const [b, wb] = top[1] || [a, 0];
      const w = wa + wb > 0 ? wa / (wa + wb) : 1;
      sk.setXYZ(v, a, b, w);
      changed++;
    }
    sk.needsUpdate = true;
  });
  return { region: region.length, changed };
}

/**
 * Turn every skin patch the right way out. Some of the atlas's patches are wound inside
 * out: the back, for one. Drawn from both sides that went unnoticed, except that a
 * reversed patch is lit as if its surface faced inwards, which is where dark patches on
 * the skin came from, and its inside faces showed through elsewhere. With every patch
 * facing out, skin can be drawn from the outside only, which is all anyone should see.
 *
 * "Out" is decided by ray parity, which nothing about the body's shape can fool: a ray
 * leaving the skin on its outer side crosses the skin an even number of times on its way
 * to open air (none, or twice if it passes through an arm), and one leaving on the inner
 * side crosses it an odd number of times. Each patch takes a vote over a spread of its
 * triangles; its winding is set to face out, and its normals to agree with the winding.
 */
export function orientSkin(items) {
  const parts = items.filter(it => it.geometry.index);
  if (!parts.length) return 0;
  // One throwaway copy of the whole skin to cast rays against.
  const geoms = parts.map(it => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', it.geometry.attributes.position);
    g.setIndex(it.geometry.index);
    return g;
  });
  const merged = mergeGeometries(geoms, false);
  geoms.forEach(g => g.dispose());
  if (!merged) return 0;
  merged.computeBoundsTree?.();
  const probe = new THREE.Mesh(merged, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  probe.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  ray.firstHitOnly = false;

  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3(), ns = new THREE.Vector3(), o = new THREE.Vector3();
  let flipped = 0;
  for (const it of parts) {
    const g = it.geometry, idx = g.index, pos = g.attributes.position, nor = g.attributes.normal;
    const faces = idx.count / 3;
    const step = Math.max(1, Math.floor(faces / 40));
    let out = 0;
    for (let f = 0; f < faces; f += step) {
      const i0 = idx.getX(f * 3), i1 = idx.getX(f * 3 + 1), i2 = idx.getX(f * 3 + 2);
      A.fromBufferAttribute(pos, i0); B.fromBufferAttribute(pos, i1); C.fromBufferAttribute(pos, i2);
      n.crossVectors(e1.subVectors(B, A), e2.subVectors(C, A));
      const area = n.length();
      if (area < 1e-10) continue;
      n.divideScalar(area);
      o.copy(A).add(B).add(C).multiplyScalar(1 / 3).addScaledVector(n, 0.0015);
      ray.set(o, n);
      ray.far = 3;
      const hits = ray.intersectObject(probe, false).filter(h => h.distance > 0.0008).length;
      out += (hits % 2 === 0 ? 1 : -1);
    }
    const reverse = out < 0;
    if (reverse) {
      const arr = idx.array;
      for (let f = 0; f < arr.length; f += 3) { const t = arr[f]; arr[f] = arr[f + 2]; arr[f + 2] = t; }
      idx.needsUpdate = true;
      flipped++;
    }
    // Normals follow the (now outward) winding.
    if (nor) {
      let agree = 0;
      for (let f = 0; f < faces; f += step) {
        const i0 = idx.getX(f * 3), i1 = idx.getX(f * 3 + 1), i2 = idx.getX(f * 3 + 2);
        A.fromBufferAttribute(pos, i0); B.fromBufferAttribute(pos, i1); C.fromBufferAttribute(pos, i2);
        n.crossVectors(e1.subVectors(B, A), e2.subVectors(C, A));
        ns.fromBufferAttribute(nor, i0).add(e1.fromBufferAttribute(nor, i1)).add(e2.fromBufferAttribute(nor, i2));
        agree += Math.sign(n.dot(ns));
      }
      if (agree < 0) {
        for (let i = 0; i < nor.count; i++) nor.setXYZ(i, -nor.getX(i), -nor.getY(i), -nor.getZ(i));
        nor.needsUpdate = true;
      }
    }
  }
  merged.disposeBoundsTree?.();
  merged.dispose();
  probe.material.dispose();
  return flipped;
}

/**
 * Smooth one geometry's bone weights along its own mesh, so neighbouring points move
 * together. Made for thin tubes (nerves, vessels, lymphatics), where the points round one
 * ring of the tube could otherwise follow different bones and a bent joint tore the tube
 * into spikes. Light enough to run on every tube: a tube only ever involves two or three
 * bones, so the weights are a small dense table, not a map per point.
 */
export function smoothBindings(geom, passes = 20) {
  const sk = geom.attributes.aSkin, pos = geom.attributes.position, n = sk.count;
  const bones = [], at = new Map();
  const use = (b) => { if (!at.has(b)) { at.set(b, bones.length); bones.push(b); } return at.get(b); };
  for (let i = 0; i < n; i++) {
    const w = sk.getZ(i);
    if (w >= 1.5) return;                        // stretch-bound muscle fibres are left alone
    use(sk.getX(i)); if (w < 1) use(sk.getY(i));
  }
  const K = bones.length;
  if (K < 2) return;
  let W = new Float32Array(n * K);
  for (let i = 0; i < n; i++) {
    const w = Math.min(1, Math.max(0, sk.getZ(i)));
    W[i * K + at.get(sk.getX(i))] += w;
    if (w < 1) W[i * K + at.get(sk.getY(i))] += 1 - w;
  }
  // Neighbours: the triangles' edges, plus points that sit on top of each other (a mesh
  // split along a seam has two copies of the same point, and they must move as one).
  const idx = geom.index ? geom.index.array : null;
  const tris = idx ? idx.length : n;
  const deg = new Uint32Array(n + 1);
  const each = (fn) => {
    for (let t = 0; t < tris; t += 3) {
      const a = idx ? idx[t] : t, b = idx ? idx[t + 1] : t + 1, c = idx ? idx[t + 2] : t + 2;
      fn(a, b); fn(b, a); fn(b, c); fn(c, b); fn(c, a); fn(a, c);
    }
  };
  const same = new Int32Array(n).fill(-1);
  const seen = new Map();
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(pos.getX(i) * 5000)},${Math.round(pos.getY(i) * 5000)},${Math.round(pos.getZ(i) * 5000)}`;
    const j = seen.get(k);
    if (j === undefined) seen.set(k, i); else same[i] = j;
  }
  each((a) => { deg[a + 1]++; });
  for (let i = 0; i < n; i++) if (same[i] >= 0) { deg[i + 1]++; deg[same[i] + 1]++; }
  for (let i = 0; i < n; i++) deg[i + 1] += deg[i];
  const nb = new Uint32Array(deg[n]), fill = deg.slice(0, n);
  each((a, b) => { nb[fill[a]++] = b; });
  for (let i = 0; i < n; i++) if (same[i] >= 0) { nb[fill[i]++] = same[i]; nb[fill[same[i]]++] = i; }
  let V = new Float32Array(n * K);
  for (let pass = 0; pass < passes; pass++) {
    for (let i = 0; i < n; i++) {
      const s = deg[i], e = deg[i + 1], cnt = e - s;
      for (let k = 0; k < K; k++) {
        let acc = 0;
        for (let j = s; j < e; j++) acc += W[nb[j] * K + k];
        V[i * K + k] = cnt ? 0.5 * W[i * K + k] + 0.5 * acc / cnt : W[i * K + k];
      }
    }
    const tmp = W; W = V; V = tmp;
  }
  // Back to two bones per point: the two heaviest, renormalised.
  for (let i = 0; i < n; i++) {
    let a = 0, b = -1;
    for (let k = 1; k < K; k++) if (W[i * K + k] > W[i * K + a]) a = k;
    for (let k = 0; k < K; k++) if (k !== a && (b < 0 || W[i * K + k] > W[i * K + b])) b = k;
    const wa = W[i * K + a], wb = b >= 0 ? W[i * K + b] : 0;
    const sum = wa + wb || 1;
    sk.setXYZ(i, bones[a], bones[b >= 0 ? b : a], wa / sum);
  }
  sk.needsUpdate = true;
}
