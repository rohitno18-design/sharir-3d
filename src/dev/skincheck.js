import * as THREE from 'three';
import { state } from '../core/state.js';

/**
 * How whole the skin is at the rig's current pose, by skin region.
 *
 *   stretched  edges more than `ratio` times their standing length: the skin pulled into long
 *              flat triangles.
 *   crushed    triangles squeezed to under a fifth of their standing area, or turned over:
 *              the skin folded through itself.
 *
 * Posed on the CPU through the same morph and skinning the screen uses (Rig.skinPoint).
 */
export function skinQuality(app, { ratio = 1.8 } = {}) {
  const body = app.body, rig = body.rig;
  const g = body.batches.find(b => b.system === 'integumentary').mesh.geometry;
  const pos = g.attributes.position, sk = g.attributes.aSkin, s2 = g.attributes.aSkin2, mk = g.attributes.aMorphMask, pi = g.attributes.aPartIndex;
  const corr = g.attributes.aCorr;
  const n = pos.count, sex = state.sex === 'female' ? 'f' : 'm';
  const keep = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const p = body.parts[pi.getX(i)];
    keep[i] = p && !p.hide && !/hair|eyelash|eyebrow|cilia/i.test(p.n) && (!p.sx || p.sx === sex) ? 1 : 0;
  }
  const rest = new Float32Array(n * 3), posed = new Float32Array(n * 3);
  const v = new THREE.Vector3(), o = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    if (!keep[i]) continue;
    v.fromBufferAttribute(pos, i);
    rig.morphVertex(v, o, sk.getX(i), sk.getY(i), sk.getZ(i), mk ? mk.getX(i) : 0);
    rest[i * 3] = o.x; rest[i * 3 + 1] = o.y; rest[i * 3 + 2] = o.z;
    rig.skinPoint(sk.getX(i), sk.getY(i), sk.getZ(i), o, mk ? mk.getX(i) : 0, s2 ? s2.getX(i) : 0, s2 ? s2.getY(i) : 0);
    // The skin's correction after posing, as the shader adds it (skinfix.js).
    if (corr && rig.enabled.value) { o.x += corr.getX(i); o.y += corr.getY(i); o.z += corr.getZ(i); }
    posed[i * 3] = o.x; posed[i * 3 + 1] = o.y; posed[i * 3 + 2] = o.z;
  }
  const by = new Map();
  const rowOf = (slot) => {
    let r = by.get(slot);
    if (!r) by.set(slot, r = { stretched: 0, crushed: 0, tris: 0, torn: 0, worst: 0 });
    return r;
  };
  const idx = g.index.array;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n0 = new THREE.Vector3(), n1 = new THREE.Vector3();
  const len = (arr, i, j) => Math.hypot(arr[i * 3] - arr[j * 3], arr[i * 3 + 1] - arr[j * 3 + 1], arr[i * 3 + 2] - arr[j * 3 + 2]);
  for (let t = 0; t < idx.length; t += 3) {
    const i0 = idx[t], i1 = idx[t + 1], i2 = idx[t + 2];
    if (!keep[i0] || !keep[i1] || !keep[i2]) continue;
    const r = rowOf(pi.getX(i0));
    r.tris++;
    for (const [i, j] of [[i0, i1], [i1, i2], [i2, i0]]) {
      if (i > j) continue;
      const l0 = len(rest, i, j);
      if (l0 <= 0.0015) continue;
      const k = len(posed, i, j) / l0;
      if (k > ratio) r.stretched++;
      if (k > 4) r.torn++;
      if (k > r.worst) r.worst = k;
    }
    a.fromArray(rest, i0 * 3); b.fromArray(rest, i1 * 3); c.fromArray(rest, i2 * 3);
    n0.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
    a.fromArray(posed, i0 * 3); b.fromArray(posed, i1 * 3); c.fromArray(posed, i2 * 3);
    n1.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
    const A0 = n0.length(), A1 = n1.length();
    if (A0 < 1e-9) continue;
    if (A1 < A0 * 0.2) r.crushed++;
  }
  const rows = [...by.entries()].map(([slot, r]) => ({ part: `${body.parts[slot].n}${body.parts[slot].side ? '.' + body.parts[slot].side : ''}`, ...r }))
    .filter(r => r.stretched + r.crushed > 0).sort((x, y) => (y.stretched + y.crushed) - (x.stretched + x.crushed));
  const total = rows.reduce((s, r) => ({ stretched: s.stretched + r.stretched, crushed: s.crushed + r.crushed, torn: s.torn + r.torn, worst: Math.max(s.worst, r.worst) }), { stretched: 0, crushed: 0, torn: 0, worst: 0 });
  return { total, rows };
}
