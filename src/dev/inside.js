import * as THREE from 'three';
import { morphKey } from '../core/morph.js';
import { state } from '../core/state.js';

/**
 * Two checks of how the body holds together when it is posed, for every system.
 *
 *   out    Anything under the skin that comes out through it. Each point of every part is
 *          paired with the nearest point of the skin on the standing body, and its depth
 *          under the skin there is noted. Posed, the depth is measured again along the
 *          skin's own turned normal. A point that was under the skin and is now more than
 *          5 mm outside it has come out of the body.
 *
 *   apart  Parts that touch on the standing body and are pulled apart by a pose: a nerve's
 *          branch leaving its trunk, a vein leaving the vein it drains into. Points of two
 *          different parts within 1.5 mm of each other standing, more than 1 cm apart posed.
 *
 * Both run on the CPU through the same morph and skinning the screen uses (Rig.skinPoint),
 * so they see exactly what is drawn.
 */

const SKIN_SKIP = /hair|nail|eyebrow|eyelash|cilia/i;

/** Every point of a batch on the standing body of this shape, and posed now. */
function points(app, geom) {
  const rig = app.body.rig;
  const pos = geom.attributes.position, sk = geom.attributes.aSkin, s2 = geom.attributes.aSkin2, mk = geom.attributes.aMorphMask;
  const n = pos.count, key = morphKey();
  const c = (geom.userData._inside ||= {});
  if (c.key !== key) {
    c.key = key; c.rest = new Float32Array(n * 3);
    const v = new THREE.Vector3(), o = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(pos, i);
      rig.morphVertex(v, o, sk.getX(i), sk.getY(i), sk.getZ(i), mk ? mk.getX(i) : 0);
      c.rest[i * 3] = o.x; c.rest[i * 3 + 1] = o.y; c.rest[i * 3 + 2] = o.z;
    }
    c.near = null;
  }
  return c;
}

function posedPoint(rig, geom, i, rest, v) {
  const sk = geom.attributes.aSkin, s2 = geom.attributes.aSkin2, mk = geom.attributes.aMorphMask;
  v.set(rest[i * 3], rest[i * 3 + 1], rest[i * 3 + 2]);
  return rig.skinPoint(sk.getX(i), sk.getY(i), sk.getZ(i), v, mk ? mk.getX(i) : 0, s2 ? s2.getX(i) : 0, s2 ? s2.getY(i) : 0);
}

/** A surface's points (the skin, or the muscles) for the body on show, with their outward normals, standing. */
function skinOf(app, sys = 'integumentary') {
  const body = app.body, batch = body.batches.find(b => b.system === sys);
  if (!batch) return null;
  const g = batch.mesh.geometry, c = points(app, g);
  if (c.skin) return { g, c };
  const SKIP = sys === 'integumentary' ? SKIN_SKIP : /fascia|aponeuros|retinacul|septum|sheath|bursa|tendon|ligament/i;
  const pi = g.attributes.aPartIndex, nor = g.attributes.normal, sex = state.sex === 'female' ? 'f' : 'm';
  const use = new Uint8Array(pi.count);
  for (let i = 0; i < pi.count; i++) {
    const p = body.parts[pi.getX(i)];
    use[i] = p && !p.hide && !SKIP.test(p.n) && (!p.sx || p.sx === sex) ? 1 : 0;
  }
  const grid = new Map(), cell = 0.02;
  for (let i = 0; i < pi.count; i++) {
    if (!use[i]) continue;
    const k = key3(c.rest[i * 3] / cell, c.rest[i * 3 + 1] / cell, c.rest[i * 3 + 2] / cell);
    (grid.get(k) || grid.set(k, []).get(k)).push(i);
  }
  c.skin = { use, grid, cell, nor };
  return { g, c };
}

const key3 = (x, y, z) => ((Math.floor(x) + 2048) * 4096 + (Math.floor(y) + 2048)) * 4096 + (Math.floor(z) + 2048);

/** For each point of `geom` within 6 cm of the skin: its nearest skin point and depth under it, standing. */
function nearestSkin(app, geom, skin) {
  const c = points(app, geom);
  const tag = skin.c.key + skin.g.uuid;
  if (c.near && c.nearKey === tag) return c;
  const { grid, cell, nor } = skin.c.skin, S = skin.c.rest;
  const n = geom.attributes.position.count, R = 3;
  const near = new Int32Array(n).fill(-1), depth = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = c.rest[i * 3], y = c.rest[i * 3 + 1], z = c.rest[i * 3 + 2];
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
    let best = -1, bd = (R * cell) ** 2;
    for (let dx = -R; dx <= R; dx++) for (let dy = -R; dy <= R; dy++) for (let dz = -R; dz <= R; dz++) {
      const list = grid.get(((cx + dx + 2048) * 4096 + (cy + dy + 2048)) * 4096 + (cz + dz + 2048));
      if (!list) continue;
      for (const j of list) {
        const d2 = (S[j * 3] - x) ** 2 + (S[j * 3 + 1] - y) ** 2 + (S[j * 3 + 2] - z) ** 2;
        if (d2 < bd) { bd = d2; best = j; }
      }
    }
    if (best < 0) continue;
    near[i] = best;
    depth[i] = (S[best * 3] - x) * nor.getX(best) + (S[best * 3 + 1] - y) * nor.getY(best) + (S[best * 3 + 2] - z) * nor.getZ(best);
  }
  c.near = near; c.depth = depth; c.nearKey = tag;
  return c;
}

/**
 * What comes out through the skin at the rig's current pose, by part: how many points and
 * how far out the furthest is, in mm.
 */
export function outOfBody(app, systems, { limit = 0.005, ref = 'integumentary' } = {}) {
  const body = app.body, rig = body.rig, skin = skinOf(app, ref);
  if (!skin || !rig?.enabled.value) return [];
  const sg = skin.g, S = skin.c.rest, nor = skin.c.skin.nor;
  // The skin posed, with its normals turned with it, worked out only where it is asked for.
  const sp = new Map();
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  const skinAt = (j) => {
    let e = sp.get(j);
    if (e) return e;
    posedPoint(rig, sg, j, S, a);
    // A point 1 cm out along the normal, moved with the same binding: the normal, turned.
    b.set(S[j * 3] + nor.getX(j) * 0.01, S[j * 3 + 1] + nor.getY(j) * 0.01, S[j * 3 + 2] + nor.getZ(j) * 0.01);
    const sk = sg.attributes.aSkin, s2 = sg.attributes.aSkin2, mk = sg.attributes.aMorphMask;
    rig.skinPoint(sk.getX(j), sk.getY(j), sk.getZ(j), b, mk ? mk.getX(j) : 0, s2 ? s2.getX(j) : 0, s2 ? s2.getY(j) : 0);
    const nx = b.x - a.x, ny = b.y - a.y, nz = b.z - a.z, l = Math.hypot(nx, ny, nz) || 1;
    e = [a.x, a.y, a.z, nx / l, ny / l, nz / l];
    sp.set(j, e);
    return e;
  };
  const by = new Map(), v = new THREE.Vector3();
  for (const batch of body.batches) {
    if (!systems.includes(batch.system)) continue;
    const g = batch.mesh.geometry, c = nearestSkin(app, g, skin), pi = g.attributes.aPartIndex;
    for (let i = 0; i < c.near.length; i++) {
      const j = c.near[i];
      // Already outside the skin standing (a vein on the surface), or, measured against the
      // muscles, more than 5 mm off them standing (it was never on them).
      if (j < 0 || c.depth[i] < (ref === 'integumentary' ? -0.002 : -0.005)) continue;
      const part = body.parts[pi.getX(i)];
      if (!part || part.hide || (part.sx && part.sx !== (state.sex === 'female' ? 'f' : 'm'))) continue;
      posedPoint(rig, g, i, c.rest, v);
      const e = skinAt(j);
      const d = (e[0] - v.x) * e[3] + (e[1] - v.y) * e[4] + (e[2] - v.z) * e[5];
      if (d < -limit && d < Math.min(0, c.depth[i]) - limit) {
        const k = pi.getX(i);
        const r = by.get(k) || { n: 0, mm: 0 };
        r.n++; r.mm = Math.max(r.mm, -d * 1000);
        by.set(k, r);
      }
    }
  }
  return [...by.entries()].map(([slot, r]) => ({ slot, part: body.parts[slot], n: r.n, mm: Math.round(r.mm) }))
    .sort((x, y) => y.n * y.mm - x.n * x.mm);
}

/** Parts that touch standing and are pulled more than `gap` apart at the current pose. */
export function pulledApart(app, systems, { touch = 0.0015, gap = 0.01 } = {}) {
  const body = app.body, rig = body.rig, out = new Map();
  const v = new THREE.Vector3(), w = new THREE.Vector3();
  for (const batch of body.batches) {
    if (!systems.includes(batch.system)) continue;
    const g = batch.mesh.geometry, c = points(app, g), pi = g.attributes.aPartIndex, n = pi.count;
    if (!c.pairs) {
      // Pairs of points of different parts that touch, found once per shape.
      const grid = new Map(), cell = touch * 2, pairs = [];
      for (let i = 0; i < n; i++) {
        const k = key3(c.rest[i * 3] / cell, c.rest[i * 3 + 1] / cell, c.rest[i * 3 + 2] / cell);
        (grid.get(k) || grid.set(k, []).get(k)).push(i);
      }
      const seen = new Set();
      for (let i = 0; i < n; i++) {
        const x = c.rest[i * 3], y = c.rest[i * 3 + 1], z = c.rest[i * 3 + 2], pa = pi.getX(i);
        const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
          const list = grid.get(((cx + dx + 2048) * 4096 + (cy + dy + 2048)) * 4096 + (cz + dz + 2048));
          if (!list) continue;
          for (const j of list) {
            if (j <= i) continue;
            const pb = pi.getX(j);
            if (pb === pa) continue;
            const pk = pa < pb ? pa * 65536 + pb : pb * 65536 + pa;
            if (seen.has(pk)) continue;
            if ((c.rest[j * 3] - x) ** 2 + (c.rest[j * 3 + 1] - y) ** 2 + (c.rest[j * 3 + 2] - z) ** 2 > touch * touch) continue;
            seen.add(pk); pairs.push(i, j);
          }
        }
      }
      c.pairs = Int32Array.from(pairs);
    }
    for (let k = 0; k < c.pairs.length; k += 2) {
      const i = c.pairs[k], j = c.pairs[k + 1];
      posedPoint(rig, g, i, c.rest, v); posedPoint(rig, g, j, c.rest, w);
      const d = v.distanceTo(w);
      if (d <= gap) continue;
      const a = body.parts[pi.getX(i)], b = body.parts[pi.getX(j)];
      if ((a.sx && a.sx !== 'm') || (b.sx && b.sx !== 'm')) continue;
      const name = `${a.n}${a.side ? '.' + a.side : ''} / ${b.n}${b.side ? '.' + b.side : ''}`;
      out.set(name, Math.max(out.get(name) || 0, Math.round(d * 1000)));
    }
  }
  return [...out.entries()].sort((x, y) => y[1] - x[1]).map(([pair, mm]) => ({ pair, mm }));
}

/** Both checks over every movement at a few moments of the rep, worst first. */
export async function scanAll(app = window.app, { systems = ['nervous', 'cardiovascular', 'lymphoid'], moments = [0, 0.25, 0.5, 0.75], movements = null } = {}) {
  const { EXERCISES } = await import('../data/exercises.js');
  const out = new Map(), apart = new Map();
  if (state.mode !== 'move') app.setMode('move');
  for (const ex of EXERCISES) {
    if (movements && !movements.includes(ex.id)) continue;
    app.setExercise(ex.id);
    await new Promise(r => setTimeout(r, 50));
    for (const t of moments) {
      app.exercise.seek(t);
      for (const r of [...outOfBody(app, systems), ...outOfBody(app, systems, { ref: 'muscular', limit: 0.012 })]) {
        const name = `${r.part.sys}: ${r.part.n}${r.part.side ? '.' + r.part.side : ''}`;
        const e = out.get(name) || { n: 0, mm: 0, in: new Set() };
        e.n = Math.max(e.n, r.n); e.mm = Math.max(e.mm, r.mm); e.in.add(ex.id);
        out.set(name, e);
      }
      for (const r of pulledApart(app, systems)) {
        const e = apart.get(r.pair) || { mm: 0, in: new Set() };
        e.mm = Math.max(e.mm, r.mm); e.in.add(ex.id);
        apart.set(r.pair, e);
      }
    }
  }
  const fmt = (m, f) => [...m.entries()].sort((a, b) => f(b[1]) - f(a[1])).map(([k, e]) => ({ what: k, ...e, in: [...e.in] }));
  return { out: fmt(out, e => e.n * e.mm), apart: fmt(apart, e => e.mm) };
}
