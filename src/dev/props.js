import * as THREE from 'three';
import { state } from '../core/state.js';

/**
 * Do the bar, the plates, the dumbbells, the bench and the floor stay out of the body?
 *
 * Every piece of equipment is a cylinder or a box. At each moment of a movement the skin
 * is posed exactly as the screen draws it (Rig.skinPoint, through the body's shape), and
 * every skin point is tested against every piece. A point inside a piece means the piece
 * has gone into the body. The hands are left out: they hold the bar and the handles, and
 * touch them on purpose.
 *
 * Returns the worst depth for each piece and body region, in mm, with the moment it
 * happens. Anything a few millimetres in is the skin resting on something (the back on the
 * bench, the bar on the shoulders); more than that shows on screen.
 */

const HAND = /hand|palm|digit|finger|thumb|thenar|nail|perionyx|eponych|cuticle/i;
const SKIP = /hair|eyelash|eyebrow|cilia/i;

/** The skin's points, standing, through the body's shape, once per shape. */
function skinRest(app) {
  const body = app.body, rig = body.rig;
  const g = body.batches.find(b => b.system === 'integumentary').mesh.geometry;
  const key = JSON.stringify([app.currentWeight(), app.currentHeightCm(), state.sex, state.age]);
  const c = (g.userData._props ||= {});
  if (c.key === key) return c;
  const pos = g.attributes.position, sk = g.attributes.aSkin, mk = g.attributes.aMorphMask, pi = g.attributes.aPartIndex;
  const sex = state.sex === 'female' ? 'f' : 'm';
  const keep = [];
  for (let i = 0; i < pos.count; i++) {
    const p = body.parts[pi.getX(i)];
    if (!p || p.hide || SKIP.test(p.n) || HAND.test(p.n) || (p.sx && p.sx !== sex)) continue;
    keep.push(i);
  }
  const rest = new Float32Array(keep.length * 3), v = new THREE.Vector3(), o = new THREE.Vector3();
  keep.forEach((i, k) => {
    v.fromBufferAttribute(pos, i);
    rig.morphVertex(v, o, sk.getX(i), sk.getY(i), sk.getZ(i), mk ? mk.getX(i) : 0);
    rest[k * 3] = o.x; rest[k * 3 + 1] = o.y; rest[k * 3 + 2] = o.z;
  });
  Object.assign(c, { key, keep, rest, g });
  return c;
}

/** The skin as posed right now: Float32Array of xyz, and the part of each point. */
export function posedSkin(app) {
  const rig = app.body.rig, c = skinRest(app), g = c.g;
  const sk = g.attributes.aSkin, s2 = g.attributes.aSkin2, mk = g.attributes.aMorphMask, pi = g.attributes.aPartIndex;
  const out = new Float32Array(c.keep.length * 3), part = new Int32Array(c.keep.length), v = new THREE.Vector3();
  c.keep.forEach((i, k) => {
    v.set(c.rest[k * 3], c.rest[k * 3 + 1], c.rest[k * 3 + 2]);
    rig.skinPoint(sk.getX(i), sk.getY(i), sk.getZ(i), v, mk ? mk.getX(i) : 0, s2 ? s2.getX(i) : 0, s2 ? s2.getY(i) : 0);
    out[k * 3] = v.x; out[k * 3 + 1] = v.y; out[k * 3 + 2] = v.z;
    part[k] = pi.getX(i);
  });
  return { pts: out, part };
}

/** Every solid piece of equipment in the scene, with what it is called. */
function pieces(app) {
  const root = app.viewer.scene.getObjectByName('exercise-props');
  if (!root) return [];
  root.updateMatrixWorld(true);
  const list = [];
  const ex = app.exercise;
  const name = (o) => {
    if (ex.dumbbells && (o.parent === ex.dumbbells.l || o.parent === ex.dumbbells.r)) return `dumbbell ${o.parent === ex.dumbbells.l ? 'left' : 'right'}${o.geometry.parameters.height <= 0.08 ? ' head' : ' handle'}`;
    if (ex.bar && o.parent === ex.bar) return o.geometry.parameters.radiusTop > 0.05 ? 'plate' : 'bar';
    if (o.geometry.type === 'BoxGeometry') return o.geometry.parameters.height <= 0.025 ? 'floor' : 'bench';
    return 'prop';
  };
  root.traverse((o) => {
    if (!o.isMesh) return;
    const t = o.geometry.type;
    if (t !== 'CylinderGeometry' && t !== 'BoxGeometry') return;
    list.push({ o, kind: t === 'CylinderGeometry' ? 'cyl' : 'box', p: o.geometry.parameters, inv: o.matrixWorld.clone().invert(), name: name(o) });
  });
  return list;
}

/** How deep each skin point is inside each piece. Returns Map name|part -> mm. */
export function intersections(app, { minMm = 1 } = {}) {
  const { pts, part } = posedSkin(app);
  const body = app.body, out = new Map(), v = new THREE.Vector3();
  for (const pc of pieces(app)) {
    // Quick reject: the piece's bounding sphere.
    const box = new THREE.Box3().setFromObject(pc.o).expandByScalar(0.01);
    const e = pc.inv.elements;
    for (let k = 0; k < part.length; k++) {
      const x = pts[k * 3], y = pts[k * 3 + 1], z = pts[k * 3 + 2];
      if (x < box.min.x || x > box.max.x || y < box.min.y || y > box.max.y || z < box.min.z || z > box.max.z) continue;
      const lx = e[0] * x + e[4] * y + e[8] * z + e[12], ly = e[1] * x + e[5] * y + e[9] * z + e[13], lz = e[2] * x + e[6] * y + e[10] * z + e[14];
      let depth;
      if (pc.kind === 'cyl') {
        const r = Math.hypot(lx, lz), h = pc.p.height / 2;
        if (r >= pc.p.radiusTop || Math.abs(ly) >= h) continue;
        depth = Math.min(pc.p.radiusTop - r, h - Math.abs(ly));
      } else {
        const hx = pc.p.width / 2, hy = pc.p.height / 2, hz = pc.p.depth / 2;
        if (Math.abs(lx) >= hx || Math.abs(ly) >= hy || Math.abs(lz) >= hz) continue;
        depth = Math.min(hx - Math.abs(lx), hy - Math.abs(ly), hz - Math.abs(lz));
        // The floor is a slab under the feet: only the top face counts, from above.
        if (pc.name === 'floor') depth = hy - ly;
      }
      const mm = depth * 1000;
      if (mm < minMm) continue;
      const p = body.parts[part[k]];
      const key = `${pc.name} | ${p.n}${p.side ? '.' + p.side : ''}`;
      if (mm > (out.get(key) || 0)) out.set(key, mm);
    }
  }
  return out;
}

/** The two dumbbells must not pass through each other either. */
export function dumbbellsTouch(app) {
  const ex = app.exercise;
  if (!ex.dumbbells) return 0;
  const heads = (db) => db.children.filter(c => c.geometry?.parameters?.height <= 0.08).map(c => {
    const p = c.getWorldPosition(new THREE.Vector3());
    return { p, r: c.geometry.parameters.radiusTop, h: c.geometry.parameters.height };
  });
  const L = heads(ex.dumbbells.l), R = heads(ex.dumbbells.r);
  let worst = 0;
  for (const a of L) for (const b of R) {
    // Treated as spheres round each head: enough to see two weights pass through each other.
    const ra = Math.hypot(a.r, a.h / 2), rb = Math.hypot(b.r, b.h / 2);
    worst = Math.max(worst, (ra + rb) - a.p.distanceTo(b.p) - 0.02);
  }
  return Math.round(Math.max(0, worst) * 1000);
}

/** Every movement through every moment. Worst first. */
export async function scanProps(app = window.app, { steps = 24, only = null, minMm = 4 } = {}) {
  const { EXERCISES } = await import('../data/exercises.js');
  if (state.mode !== 'move') app.setMode('move');
  const rows = [];
  for (const ex of EXERCISES) {
    if (only && !only.includes(ex.id)) continue;
    app.setExercise(ex.id);
    await new Promise(r => setTimeout(r, 30));
    const worst = new Map();
    let clash = 0, clashAt = 0;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      app.exercise.seek(t);
      for (const [k, mm] of intersections(app, { minMm })) if (mm > (worst.get(k)?.mm || 0)) worst.set(k, { mm, t });
      const c = dumbbellsTouch(app);
      if (c > clash) { clash = c; clashAt = t; }
    }
    for (const [k, e] of worst) rows.push({ id: ex.id, what: k, mm: Math.round(e.mm), t: +e.t.toFixed(2) });
    if (clash > 0) rows.push({ id: ex.id, what: 'dumbbell | the other dumbbell', mm: clash, t: +clashAt.toFixed(2) });
  }
  return rows.sort((a, b) => b.mm - a.mm);
}
