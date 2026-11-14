import * as THREE from 'three';
import { state } from './state.js';
import { morphKey } from './morph.js';

/**
 * Delta Mush for the skin round the shoulders.
 *
 * Raised overhead, the arm turns some 170 degrees from the trunk, and the skin of the
 * armpit has to cover about three times the length it has with the arm hanging. Bound to
 * bones, it could only do that in steps: neighbouring points a few millimetres apart, one
 * carried half by the arm and the next nine tenths, were put many centimetres apart, and
 * the skin tore into long strips, up to 130 times their length. Weights can spread the
 * change, but bones can only turn skin round a joint, never slide it along the chest wall:
 * smoother weights, weights copied from the muscle under the skin, and weights fitted to a
 * dozen arm positions were all tried, and each lifted the chest's skin off the muscles or
 * tore it somewhere else.
 *
 * Delta Mush, the method film rigs use for the same trouble, fixes the shape after the
 * bones have posed it. The posed skin is smoothed as a surface, which pulls the torn points
 * back together and spreads the stretch evenly; the fine shape the same smoothing takes off
 * the standing skin (every crease and contour) is kept as a small offset in each point's
 * own frame, and put back on the smoothed posed surface. It is applied only where the skin
 * is actually torn (stretched past half again its length), fading in over a few rings
 * round each tear, so the folds the muscles make under the skin everywhere else stay.
 *
 * It needs each point's neighbours, which the graphics chip does not have, so it is worked
 * out here for 21 moments of a lift, when the lift opens, in the gaps between frames
 * (under a second). While the lift plays, each skin point gets the correction for the
 * moment it is at, blended between the two worked out nearest, as one extra offset after
 * posing (`aCorr`, added in the skin's shader). The correction is full near the shoulder
 * and fades to nothing 26 cm out, and towards the elbow, so nothing changes beyond. Where
 * the mended skin folds over itself, its back faces are drawn (rig.js, patchForRig);
 * dropped, as the rest of the skin's are, a fold showed as a crack.
 *
 * Tried at the hip as well, for a deep squat: it crumpled the skin of the buttock, which
 * folds there rather than tears, so the hip is left to the bones.
 */

const REGIONS = [
  { joint: 'gh', rIn: 0.17, rOut: 0.26 },
];
const ITERATIONS = 30, LAMBDA = 0.5;
/** Stretch past which the skin counts as torn, from not at all to fully, and how many rings round a tear the correction spreads. */
const TORN = [1.5, 2.3], SPREAD = 8;
/** How far apart, standing, the two sides of a seam between the skin's patches can be (the stitching allows 6.5 mm). */
const SEAM = 0.007;
/** Parts that are their own loose pieces, or hang free: never smoothed into the skin round them. */
const APART = /hair|eyelash|eyebrow|cilia|nail|penis|scrot|glans|prepuce|nipple|areola|umbilic|urogenital/i;

export class SkinFix {
  constructor(body) {
    this.body = body;
    this.batch = body.batches.find(b => b.system === 'integumentary');
    this.data = null;          // per body shape and sex: the region, its neighbours, the rest detail
    this.sets = new Map();     // per lift, shape and mistake: the corrections, moment by moment
    this.current = null;       // the set being shown
    this.active = false;
  }

  get ok() { return !!this.batch?.mesh.geometry.attributes.aCorr && !!this.body.rig?.ok; }

  /** The region, its neighbours and the standing skin's detail, for this body. */
  _prepare() {
    const key = `${morphKey()}|${state.sex}`;
    if (this.data?.key === key) return this.data;
    const body = this.body, rig = body.rig, g = this.batch.mesh.geometry;
    const P = g.attributes.position, S = g.attributes.aSkin, S2 = g.attributes.aSkin2, MK = g.attributes.aMorphMask, A = g.attributes.aPartIndex;
    const n = P.count, sex = state.sex === 'female' ? 'f' : 'm';
    const keep = new Uint8Array(n), apart = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const p = body.parts[A.getX(i)];
      if (!p || p.hide || (p.sx && p.sx !== sex)) continue;
      keep[i] = 1;
      if (APART.test(p.n)) apart[i] = 1;
    }
    // Standing, at this body's shape.
    const rest = new Float32Array(n * 3), v = new THREE.Vector3(), o = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      if (!keep[i]) continue;
      v.fromBufferAttribute(P, i);
      rig.morphVertex(v, o, S.getX(i), S.getY(i), S.getZ(i), MK ? MK.getX(i) : 0);
      rest[i * 3] = o.x; rest[i * 3 + 1] = o.y; rest[i * 3 + 2] = o.z;
    }
    // Which points are corrected, and by how much: full near a joint, fading to its edge.
    const centres = [];
    for (const r of REGIONS) for (const side of ['l', 'r']) centres.push({ ...r, c: rig.morphedJoint(side, r.joint, new THREE.Vector3()) });
    const fall = new Float32Array(n);
    // Fading out towards the elbow too: its skin folds as it bends, and smoothing a fold
    // only crumples it. By distance alone, so the two sides of every seam fade together; a
    // rule by bone left out the inner arm beside a mended chest wall, and the seam between
    // them opened into a crack.
    const elbows = ['l', 'r'].map(side => rig.morphedJoint(side, 'el', new THREE.Vector3()));
    // The head and the neck turn on their own bones, and lying down or bending over they tip
    // well away from the shoulders: smoothing their thin skin (the ears, the lips) together
    // with the shoulder's crumpled it.
    const headBones = new Set([rig.bones.findIndex(bn => bn.name === 'neck'), rig.bones.findIndex(bn => bn.name === 'head')]);
    for (let i = 0; i < n; i++) {
      if (!keep[i] || apart[i]) continue;
      if (headBones.has(S.getX(i)) || (S.getZ(i) < 0.999 && headBones.has(S.getY(i))) || (S2 && S2.getY(i) > 0 && headBones.has(S2.getX(i)))) continue;
      const x = rest[i * 3], y = rest[i * 3 + 1], z = rest[i * 3 + 2];
      let f = 0;
      for (const C of centres) {
        const d = Math.hypot(x - C.c.x, y - C.c.y, z - C.c.z);
        if (d < C.rOut) f = Math.max(f, 1 - smoothstep(C.rIn, C.rOut, d));
      }
      if (f > 0) {
        const e = Math.min(...elbows.map(E => Math.hypot(x - E.x, y - E.y, z - E.z)));
        f *= smoothstep(0.07, 0.14, e);
      }
      fall[i] = f;
    }
    // The points smoothed are those corrected; their neighbours outside the regions hold.
    const idx = g.index.array;
    const nbs = new Map();
    const push = (a, b) => { let l = nbs.get(a); if (!l) nbs.set(a, l = []); l.push(b); };
    for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) {
      const a = idx[t + e], b = idx[t + (e + 1) % 3];
      if (!keep[a] || !keep[b] || apart[a] !== apart[b]) continue;
      if (fall[a] > 0) push(a, b);
    }
    // Across the seams between the skin's patches: a point on a patch's open edge to the
    // points on another patch's open edge within 5 mm. Only open edges: the skin of the
    // inner arm lies against the skin of the chest wall when the arm hangs, and tied to it
    // as if it were one surface, it was drawn across the armpit like a web when the arm rose.
    const open = new Uint8Array(n), seen = new Map(), M = 4194304, seams = [];
    for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) {
      const a = idx[t + e], b = idx[t + (e + 1) % 3], k = a < b ? a * M + b : b * M + a;
      seen.set(k, (seen.get(k) || 0) + 1);
    }
    for (const [k, c] of seen) if (c === 1) { open[Math.floor(k / M)] = 1; open[k % M] = 1; }
    const cell = 0.006, key2 = (a, b, c) => ((a + 2048) * 4096 + (b + 2048)) * 4096 + (c + 2048), grid = new Map();
    for (let i = 0; i < n; i++) {
      if (!keep[i] || apart[i] || !open[i]) continue;
      const k = key2(Math.floor(rest[i * 3] / cell), Math.floor(rest[i * 3 + 1] / cell), Math.floor(rest[i * 3 + 2] / cell));
      (grid.get(k) || grid.set(k, []).get(k)).push(i);
    }
    for (let i = 0; i < n; i++) {
      if (!(fall[i] > 0) || !open[i]) continue;
      const x = rest[i * 3], y = rest[i * 3 + 1], z = rest[i * 3 + 2], pa = A.getX(i);
      const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const list = grid.get(key2(cx + dx, cy + dy, cz + dz));
        if (!list) continue;
        for (const j of list) {
          if (j === i || A.getX(j) === pa) continue;
          if (Math.hypot(rest[j * 3] - x, rest[j * 3 + 1] - y, rest[j * 3 + 2] - z) < SEAM) { push(i, j); seams.push(i, j); }
        }
      }
    }
    // Compact numbering: the corrected points first, then the ones they lean on.
    const free = [];
    for (let i = 0; i < n; i++) if (fall[i] > 0 && nbs.get(i)?.length) free.push(i);
    const local = new Int32Array(n).fill(-1), work = [];
    for (const i of free) { local[i] = work.length; work.push(i); }
    const F = free.length;
    for (const i of free) for (const j of nbs.get(i)) if (local[j] < 0) { local[j] = work.length; work.push(j); }
    const W = work.length;
    const start = new Int32Array(F + 1), list = [];
    for (let k = 0; k < F; k++) { for (const j of nbs.get(free[k])) list.push(local[j]); start[k + 1] = list.length; }
    const nb = Int32Array.from(list);
    // Triangles round the corrected points, for their normals.
    const tris = [];
    for (let t = 0; t < idx.length; t += 3) {
      const a = local[idx[t]], b = local[idx[t + 1]], c = local[idx[t + 2]];
      if (a < 0 || b < 0 || c < 0 || (a >= F && b >= F && c >= F)) continue;
      tris.push(a, b, c);
    }
    const tri = Int32Array.from(tris);
    const restW = new Float32Array(W * 3);
    work.forEach((i, k) => { restW[k * 3] = rest[i * 3]; restW[k * 3 + 1] = rest[i * 3 + 1]; restW[k * 3 + 2] = rest[i * 3 + 2]; });
    const d = { key, n, F, W, work: Int32Array.from(work), start, nb, tri, fall: Float32Array.from(free.map(i => fall[i])), restW };
    // Pairs across the seams, as corrected points, for evening out the correction across them.
    const pairs = [];
    for (let q = 0; q < seams.length; q += 2) { const a = local[seams[q]], b = local[seams[q + 1]]; if (a >= 0 && b >= 0 && a < F && b < F) pairs.push(a, b); }
    d.pairs = Int32Array.from(pairs);
    // The standing skin's detail, in each point's own frame on its smoothed surface.
    const s0 = this._smooth(d, restW), f0 = this._frames(d, s0);
    d.delta = new Float32Array(F * 3);
    for (let k = 0; k < F; k++) {
      const dx = restW[k * 3] - s0[k * 3], dy = restW[k * 3 + 1] - s0[k * 3 + 1], dz = restW[k * 3 + 2] - s0[k * 3 + 2], b = k * 9;
      d.delta[k * 3] = dx * f0[b] + dy * f0[b + 1] + dz * f0[b + 2];
      d.delta[k * 3 + 1] = dx * f0[b + 3] + dy * f0[b + 4] + dz * f0[b + 5];
      d.delta[k * 3 + 2] = dx * f0[b + 6] + dy * f0[b + 7] + dz * f0[b + 8];
    }
    // The skin's own attribute ranges the corrected points fall in, so only those are sent.
    const sorted = [...free].sort((a, b) => a - b), ranges = [];
    for (const i of sorted) {
      const last = ranges[ranges.length - 1];
      if (last && i - last[1] < 400) last[1] = i; else ranges.push([i, i]);
    }
    d.ranges = ranges;
    this.data = d;
    this.sets.clear();
    return d;
  }

  /** Smooth the corrected points over the surface, the rest holding still. */
  _smooth(d, src) {
    let cur = src.slice(), nxt = src.slice();
    const { F, start, nb } = d;
    for (let it = 0; it < ITERATIONS; it++) {
      for (let k = 0; k < F; k++) {
        const a = start[k], b = start[k + 1], c = b - a;
        let sx = 0, sy = 0, sz = 0;
        for (let q = a; q < b; q++) { const j = nb[q] * 3; sx += cur[j]; sy += cur[j + 1]; sz += cur[j + 2]; }
        const o = k * 3;
        nxt[o] = cur[o] + LAMBDA * (sx / c - cur[o]);
        nxt[o + 1] = cur[o + 1] + LAMBDA * (sy / c - cur[o + 1]);
        nxt[o + 2] = cur[o + 2] + LAMBDA * (sz / c - cur[o + 2]);
      }
      [cur, nxt] = [nxt, cur];
    }
    return cur;
  }

  /** A frame at each corrected point: tangent towards its first neighbour, the second axis, the normal. */
  _frames(d, pos) {
    const { F, start, nb, tri } = d;
    const N = new Float32Array(d.W * 3);
    for (let t = 0; t < tri.length; t += 3) {
      const a = tri[t] * 3, b = tri[t + 1] * 3, c = tri[t + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
      for (const q of [a, b, c]) { N[q] += fx; N[q + 1] += fy; N[q + 2] += fz; }
    }
    const out = new Float32Array(F * 9);
    for (let k = 0; k < F; k++) {
      const o = k * 3;
      let nx = N[o], ny = N[o + 1], nz = N[o + 2];
      let l = Math.hypot(nx, ny, nz);
      if (l < 1e-20) { nx = 0; ny = 0; nz = 1; l = 1; }
      nx /= l; ny /= l; nz /= l;
      const j = nb[start[k]] * 3;
      let tx = pos[j] - pos[o], ty = pos[j + 1] - pos[o + 1], tz = pos[j + 2] - pos[o + 2];
      const dn = tx * nx + ty * ny + tz * nz;
      tx -= dn * nx; ty -= dn * ny; tz -= dn * nz;
      let tl = Math.hypot(tx, ty, tz);
      if (tl < 1e-12) { tx = 1 - nx * nx; ty = -nx * ny; tz = -nx * nz; tl = Math.hypot(tx, ty, tz) || 1; }
      tx /= tl; ty /= tl; tz /= tl;
      const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
      out.set([tx, ty, tz, bx, by, bz, nx, ny, nz], k * 9);
    }
    return out;
  }

  /** The correction at the rig's current pose, for the corrected points (F x 3). */
  _correct(d) {
    const rig = this.body.rig, g = this.batch.mesh.geometry;
    const P = g.attributes.position, S = g.attributes.aSkin, S2 = g.attributes.aSkin2, MK = g.attributes.aMorphMask;
    const { F, W, work, restW, delta, fall } = d;
    const posed = new Float32Array(W * 3), v = new THREE.Vector3();
    for (let k = 0; k < W; k++) {
      const i = work[k];
      v.set(restW[k * 3], restW[k * 3 + 1], restW[k * 3 + 2]);
      rig.skinPoint(S.getX(i), S.getY(i), S.getZ(i), v, MK ? MK.getX(i) : 0, S2 ? S2.getX(i) : 0, S2 ? S2.getY(i) : 0);
      posed[k * 3] = v.x; posed[k * 3 + 1] = v.y; posed[k * 3 + 2] = v.z;
    }
    const s1 = this._smooth(d, posed), f1 = this._frames(d, s1);
    // Only where the skin is torn. Each point's worst stretch to a neighbour, against its
    // standing length, says how torn it is there: skin stretched less than half again is
    // left exactly as the bones put it, so the muscles' folds under it stay; past that the
    // correction comes in, and spreads a few rings round the tear so it fades in smoothly.
    // Smoothing everywhere flattened the folds the pectoral and the latissimus make under
    // the skin, and the muscles came out through it.
    const { start, nb } = d;
    const torn = new Float32Array(F);
    for (let k = 0; k < F; k++) {
      let worst = 0;
      for (let q = start[k]; q < start[k + 1]; q++) {
        const j = nb[q];
        const r0 = Math.hypot(restW[k * 3] - restW[j * 3], restW[k * 3 + 1] - restW[j * 3 + 1], restW[k * 3 + 2] - restW[j * 3 + 2]);
        const r1 = Math.hypot(posed[k * 3] - posed[j * 3], posed[k * 3 + 1] - posed[j * 3 + 1], posed[k * 3 + 2] - posed[j * 3 + 2]);
        worst = Math.max(worst, r1 / Math.max(r0, 0.004));
      }
      torn[k] = smoothstep(TORN[0], TORN[1], worst);
    }
    for (let it = 0; it < SPREAD; it++) {
      for (let k = 0; k < F; k++) {
        let m = torn[k];
        for (let q = start[k]; q < start[k + 1]; q++) { const j = nb[q]; if (j < F && torn[j] * 0.8 > m) m = torn[j] * 0.8; }
        torn[k] = m;
      }
    }
    // Mended where it was torn, exactly as the bones put it everywhere else.
    const out = new Float32Array(F * 3);
    for (let k = 0; k < F; k++) {
      const b = k * 9, a0 = delta[k * 3], a1 = delta[k * 3 + 1], a2 = delta[k * 3 + 2], f = fall[k] * torn[k];
      for (let c = 0; c < 3; c++) {
        const target = s1[k * 3 + c] + a0 * f1[b + c] + a1 * f1[b + 3 + c] + a2 * f1[b + 6 + c];
        out[k * 3 + c] = f * (target - posed[k * 3 + c]);
      }
    }
    // The two sides of a seam end up in the same place: each takes the other's posed point
    // plus its correction, averaged with its own. A seam whose sides were mended by different
    // amounts opened into a crack.
    const P2 = d.pairs;
    for (let it = 0; it < 3; it++) {
      for (let q = 0; q < P2.length; q += 2) {
        const a = P2[q], b = P2[q + 1];
        for (let c = 0; c < 3; c++) {
          const pa = posed[a * 3 + c] + out[a * 3 + c], pb = posed[b * 3 + c] + out[b * 3 + c], mid = (pa + pb) / 2;
          out[a * 3 + c] = mid - posed[a * 3 + c] + (restW[a * 3 + c] - restW[b * 3 + c]) / 2;
          out[b * 3 + c] = mid - posed[b * 3 + c] - (restW[a * 3 + c] - restW[b * 3 + c]) / 2;
        }
      }
    }
    return out;
  }

  /**
   * Work out the corrections for a lift, `samples` moments of it, between frames. `poseAt(u)`
   * gives the pose at movement point u; `restore()` puts the shown pose back after each.
   * Calls `ready()` when they are all in.
   */
  plan(id, poseAt, restore, { samples = 21, ready = null } = {}) {
    if (!this.ok) return;
    const d = this._prepare();
    const key = `${id}|${d.key}`;
    let set = this.sets.get(key);
    if (!set) {
      if (this.sets.size > 6) this.sets.clear();
      set = { key, dataKey: d.key, samples, data: new Array(samples), done: false, k: 0, running: false };
      this.sets.set(key, set);
    }
    this.current = set;
    if (set.done) { ready?.(); return; }
    // A lift left part way through stopped its work; coming back carries on where it stopped.
    if (set.running) return;
    set.running = true;
    const rig = this.body.rig;
    const step = () => {
      if (this.current !== set || this.data !== d) { set.running = false; return; }
      const t0 = performance.now();
      while (set.k < samples && performance.now() - t0 < 14) {
        rig.setPose(poseAt(set.k / (samples - 1)));
        set.data[set.k] = this._correct(d);
        set.k++;
      }
      restore();
      if (set.k < samples) (window.requestIdleCallback || setTimeout)(step, { timeout: 120 });
      else { set.done = true; set.running = false; ready?.(); }
    };
    (window.requestIdleCallback || setTimeout)(step, { timeout: 200 });
  }

  /** Show the correction for movement point u, or none if it is not worked out yet. */
  apply(u) {
    const set = this.current, d = this.data;
    if (!this.ok || !set || !d || set.dataKey !== d.key) { this.clear(); return; }
    const x = Math.min(1, Math.max(0, u)) * (set.samples - 1);
    const k = Math.min(set.samples - 2, Math.floor(x)), t = x - k;
    const a = set.data[k], b = set.data[k + 1];
    if (!a || !b) { this.clear(); return; }
    const attr = this.batch.mesh.geometry.attributes.aCorr, arr = attr.array;
    const { F, work } = d;
    for (let q = 0; q < F; q++) {
      const i = work[q] * 3, o = q * 3;
      arr[i] = a[o] + (b[o] - a[o]) * t;
      arr[i + 1] = a[o + 1] + (b[o + 1] - a[o + 1]) * t;
      arr[i + 2] = a[o + 2] + (b[o + 2] - a[o + 2]) * t;
    }
    this._send(d);
    this.active = true;
  }

  /** No correction: the skin exactly as the bones pose it. */
  clear() {
    if (!this.active) return;
    const d = this.data, attr = this.batch.mesh.geometry.attributes.aCorr;
    if (d) { for (let q = 0; q < d.F; q++) { const i = d.work[q] * 3; attr.array[i] = 0; attr.array[i + 1] = 0; attr.array[i + 2] = 0; } this._send(d); }
    else { attr.array.fill(0); attr.needsUpdate = true; }
    this.active = false;
  }

  /** Stop showing a lift's corrections (it closed). */
  stop() { this.current = null; this.clear(); }

  _send(d) {
    const attr = this.batch.mesh.geometry.attributes.aCorr;
    attr.clearUpdateRanges?.();
    if (attr.addUpdateRange) for (const [a, b] of d.ranges) attr.addUpdateRange(a * 3, (b - a + 1) * 3);
    attr.needsUpdate = true;
  }
}

function smoothstep(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
